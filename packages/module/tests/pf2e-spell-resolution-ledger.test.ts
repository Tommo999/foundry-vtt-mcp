import { describe, expect, it, vi } from "vitest";
import {
  finalizeSpellResolution,
  inspectSpellResolutionLedger,
  readSpellResolutionRecords,
  reserveSpellResolution,
  type SpellResolutionReservation,
} from "../src/pf2e-spell-resolution-ledger.js";

function makeContext(initial: any = undefined) {
  let stored = initial;
  const ctx: any = {
    sessionId: "session-a",
    game: {
      world: { id: "world-a" },
      user: { id: "gm-a", isGM: true },
      settings: {
        get: vi.fn(() => stored),
        set: vi.fn(async (_module: string, _key: string, value: any) => {
          stored = structuredClone(value);
        }),
      },
    },
    assertWrite: vi.fn(),
  };
  return {
    ctx,
    get stored() {
      return stored;
    },
    setStored(value: any) {
      stored = value;
    },
  };
}
function input(
  overrides: Partial<SpellResolutionReservation> = {},
): SpellResolutionReservation {
  return {
    resolutionId: "spell-resolution-a",
    operationKey: "[cast,attack,target,1]",
    sessionId: "session-a",
    castId: "cast-a",
    castMessageUuid: "ChatMessage.cast",
    action: "attack",
    messageMode: "gm",
    casterActorUuid: "Actor.caster",
    targetActorUuid: "Actor.target",
    casterTokenUuid: "Scene.s.Token.c",
    targetTokenUuid: "Scene.s.Token.t",
    attackNumber: 1,
    reviewToken: "review-a",
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

describe("PF2e spell-resolution ledger", () => {
  it("reserves, reads back and finalizes one native outcome exactly once", async () => {
    const fake = makeContext();
    const reserved = await reserveSpellResolution(fake.ctx, input());
    expect(reserved.status).toBe("reserved");
    expect(reserved).toMatchObject({
      messageMode: "gm",
      casterActorUuid: "Actor.caster",
      targetActorUuid: "Actor.target",
    });
    expect(
      inspectSpellResolutionLedger(fake.ctx, input().operationKey),
    ).toMatchObject({ blocked: true, status: "reserved" });
    const final = await finalizeSpellResolution(
      fake.ctx,
      reserved.resolutionId,
      "confirmed",
      { messageUuid: "ChatMessage.roll", rollType: "check", rollTotal: 21 },
    );
    expect(final.status).toBe("confirmed");
    expect(final).toMatchObject({
      messageMode: "gm",
      casterActorUuid: "Actor.caster",
      targetActorUuid: "Actor.target",
    });
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(2);
    await expect(
      finalizeSpellResolution(fake.ctx, reserved.resolutionId, "uncertain", {
        messageUuid: null,
        rollType: null,
        rollTotal: null,
      }),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_RESERVATION_LOST" });
  });

  it("blocks semantic duplicates across reload and rejects ID collisions", async () => {
    const first = makeContext();
    await reserveSpellResolution(first.ctx, input());
    const reloaded = makeContext(first.stored);
    await expect(
      reserveSpellResolution(
        reloaded.ctx,
        input({ resolutionId: "spell-resolution-b" }),
      ),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_ALREADY_RECORDED" });
    await expect(
      reserveSpellResolution(reloaded.ctx, input({ operationKey: "other" })),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_ID_COLLISION" });
  });

  it("rejects action and roll-type mismatches", async () => {
    const fake = makeContext();
    await reserveSpellResolution(
      fake.ctx,
      input({ action: "save", attackNumber: null }),
    );
    await expect(
      finalizeSpellResolution(fake.ctx, "spell-resolution-a", "confirmed", {
        messageUuid: "ChatMessage.roll",
        rollType: "damage",
        rollTotal: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESOLUTION_FINALIZATION" });
    await expect(
      reserveSpellResolution(
        fake.ctx,
        input({
          action: "damage",
          attackNumber: 1,
          resolutionId: "spell-resolution-b",
          operationKey: "other",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESOLUTION_RESERVATION" });
  });

  it("checks the active user and session after a settings write", async () => {
    const fake = makeContext();
    fake.ctx.game.settings.set.mockImplementationOnce(
      async (_m: string, _k: string, value: any) => {
        fake.ctx.sessionId = "session-b";
        fake.setStored(value);
      },
    );
    await expect(
      reserveSpellResolution(fake.ctx, input()),
    ).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
    });
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(1);
  });

  it("marks terminal status unknown when readback is unavailable after the write", async () => {
    const fake = makeContext();
    await reserveSpellResolution(fake.ctx, input());
    const get = fake.ctx.game.settings.get;
    let failNextRead = false;
    fake.ctx.game.settings.get = vi.fn((_module: string, key: string) => {
      if (failNextRead && key === "spellResolutions") throw new Error("readback unavailable");
      return get(_module, key);
    });
    fake.ctx.game.settings.set.mockImplementationOnce(async (_module: string, _key: string, value: any) => {
      fake.setStored(value);
      failNextRead = true;
    });
    await expect(finalizeSpellResolution(fake.ctx, "spell-resolution-a", "confirmed", {
      messageUuid: "ChatMessage.roll", rollType: "check", rollTotal: 21,
    })).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_FINALIZATION_UNCONFIRMED",
      partial: { status: null, known: false },
    });
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(2);
  });

  it("fails closed for malformed, cross-world and duplicate semantic records", async () => {
    const first = makeContext();
    const record = await reserveSpellResolution(first.ctx, input());
    const malformed = structuredClone(first.stored);
    malformed.entries[record.resolutionId].action = "save";
    expect(() =>
      readSpellResolutionRecords(makeContext(malformed).ctx),
    ).toThrow();
    const crossWorld = structuredClone(first.stored);
    crossWorld.entries[record.resolutionId].worldId = "world-b";
    expect(() =>
      readSpellResolutionRecords(makeContext(crossWorld).ctx),
    ).toThrow();
    const duplicate = structuredClone(first.stored);
    duplicate.entries["spell-resolution-other"] = {
      ...duplicate.entries[record.resolutionId],
      resolutionId: "spell-resolution-other",
    };
    expect(() =>
      readSpellResolutionRecords(makeContext(duplicate).ctx),
    ).toThrow();
  });

  it("rejects a missing settings read API instead of treating it as empty", () => {
    const fake = makeContext();
    delete fake.ctx.game.settings.get;
    expect(() => readSpellResolutionRecords(fake.ctx)).toThrowError(
      expect.objectContaining({
        code: "SPELL_RESOLUTION_LEDGER_API_UNAVAILABLE",
      }),
    );
  });

  it("serializes concurrent reservations and blocks the semantic operation once", async () => {
    const fake = makeContext();
    const results = await Promise.allSettled([
      reserveSpellResolution(fake.ctx, input()),
      reserveSpellResolution(
        fake.ctx,
        input({ resolutionId: "spell-resolution-b" }),
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results
        .filter((result) => result.status === "rejected")
        .map((result: any) => result.reason.code),
    ).toEqual(["SPELL_RESOLUTION_ALREADY_RECORDED"]);
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(1);
  });

  it("fails closed at capacity without eviction", async () => {
    const fake = makeContext();
    const first = await reserveSpellResolution(fake.ctx, input());
    const entries: Record<string, any> = {};
    for (let index = 0; index < 5000; index += 1) {
      const resolutionId = `spell-resolution-${index}`;
      entries[resolutionId] = {
        ...structuredClone(first),
        resolutionId,
        operationKey: `operation-${index}`,
      };
    }
    fake.setStored({ version: 1, entries });
    await expect(
      reserveSpellResolution(
        fake.ctx,
        input({
          resolutionId: "spell-resolution-over-capacity",
          operationKey: "new-operation",
        }),
      ),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_LEDGER_FULL" });
    expect(Object.keys((fake.stored as any).entries)).toHaveLength(5000);
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(1);
  });

  it("isolates returned snapshots from the persistent cached store", async () => {
    const fake = makeContext();
    await reserveSpellResolution(fake.ctx, input());
    const snapshot = readSpellResolutionRecords(fake.ctx);
    snapshot.entries["spell-resolution-a"].status = "uncertain";
    expect(
      readSpellResolutionRecords(fake.ctx).entries["spell-resolution-a"].status,
    ).toBe("reserved");
  });

  it("does not write when authorization or world identity changes before commit", async () => {
    const denied = makeContext();
    denied.ctx.assertWrite.mockImplementation(() => {
      denied.ctx.game.user.isGM = false;
    });
    await expect(
      reserveSpellResolution(denied.ctx, input()),
    ).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
    });
    expect(denied.ctx.game.settings.set).not.toHaveBeenCalled();

    const switched = makeContext();
    switched.ctx.assertWrite.mockImplementation(() => {
      switched.ctx.game.world.id = "world-b";
    });
    await expect(
      reserveSpellResolution(switched.ctx, input()),
    ).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
    });
    expect(switched.ctx.game.settings.set).not.toHaveBeenCalled();
  });

  it("reports a readback mismatch without repeating a reservation write", async () => {
    const fake = makeContext();
    fake.ctx.game.settings.set.mockImplementation(async () => undefined);
    await expect(
      reserveSpellResolution(fake.ctx, input()),
    ).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
    });
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(1);
  });

  it("makes one terminal write and reports status after a lost finalization acknowledgement", async () => {
    const fake = makeContext();
    await reserveSpellResolution(fake.ctx, input());
    fake.ctx.game.settings.set.mockImplementationOnce(
      async (_m: string, _k: string, value: any) => {
        fake.setStored(value);
        throw new Error("ack lost");
      },
    );
    await expect(
      finalizeSpellResolution(fake.ctx, "spell-resolution-a", "confirmed", {
        messageUuid: "ChatMessage.roll",
        rollType: "check",
        rollTotal: 12,
      }),
    ).rejects.toMatchObject({
      code: "SPELL_RESOLUTION_FINALIZATION_UNCONFIRMED",
      partial: { status: "confirmed" },
    });
    expect(fake.ctx.game.settings.set).toHaveBeenCalledTimes(2);
    expect(
      readSpellResolutionRecords(fake.ctx).entries["spell-resolution-a"].status,
    ).toBe("confirmed");
  });

  it("rejects malformed empty-key and inherited-id lookups", () => {
    const fake = makeContext({
      version: 1,
      entries: { "": { resolutionId: "" } },
    });
    expect(() => readSpellResolutionRecords(fake.ctx)).toThrowError(
      expect.objectContaining({ code: "SPELL_RESOLUTION_LEDGER_INVALID" }),
    );
    const inherited = Object.create({
      "spell-resolution-a": { status: "confirmed" },
    });
    const isolated = makeContext({ version: 1, entries: inherited });
    expect(
      inspectSpellResolutionLedger(isolated.ctx, "operation").blocked,
    ).toBe(false);
  });
});
