import { describe, expect, it, vi } from "vitest";
import {
  readSpellCastActorSummary,
  withSpellCastLedger,
  type SpellCastRecord,
  type SpellCastReservation,
} from "../src/pf2e-spell-ledger.js";

const none = {
  kind: "none" as const,
  cost: 0,
  value: null,
  max: null,
  expended: null,
  groupNumber: null,
  slotId: null,
};
const slot = {
  kind: "preparedSlot" as const,
  cost: 1,
  value: 1,
  max: 2,
  expended: false,
  groupNumber: 1,
  slotId: 0,
};

function reservation(overrides: Partial<SpellCastReservation> = {}) {
  const castId = overrides.castId ?? "cast-1";
  return {
    castId,
    sessionId: "session-1",
    actorUuid: "Actor.actor-1",
    casterTokenUuid: "Scene.scene-1.Token.token-1",
    entryUuid: "Actor.actor-1.Item.entry-1",
    spellUuid: "Actor.actor-1.Item.spell-1",
    rank: 1,
    slotId: null,
    targetTokenUuids: [],
    messageMode: "gm" as const,
    reviewToken: `review-${castId}`,
    fingerprint: `fingerprint-${castId}`,
    resourceBefore: slot,
    ...overrides,
  } satisfies SpellCastReservation;
}

function makeContext(initial: unknown = undefined) {
  let stored: unknown = initial;
  let authorized = true;
  const get = vi.fn(() => stored);
  const set = vi.fn(async (_module: string, _key: string, value: unknown) => {
    stored = value;
    return value;
  });
  const assertWrite = vi.fn(() => {
    if (!authorized)
      throw Object.assign(new Error("no authorization"), {
        code: "WRITE_DENIED",
      });
  });
  const ctx: any = {
    game: {
      world: { id: "world-1" },
      user: { id: "gm-1" },
      settings: { get, set },
    },
    assertWrite,
    resolve: vi.fn(),
    serialize: vi.fn(),
  };
  return {
    ctx,
    get,
    set,
    assertWrite,
    get stored() {
      return stored;
    },
    setStored(value: unknown) {
      stored = value;
    },
    set authorized(value: boolean) {
      authorized = value;
    },
  };
}

function entriesOf(value: any): Record<string, SpellCastRecord> {
  return value.entries;
}

async function reserve(
  ctx: any,
  input = reservation(),
): Promise<SpellCastRecord> {
  return withSpellCastLedger(ctx, (ledger) => ledger.reserve(input));
}

function errorCode(error: unknown): unknown {
  return (error as any)?.code;
}

describe("PF2e spell-cast ledger", () => {
  it("persists a validated reservation and confirms it by readback", async () => {
    const fake = makeContext();
    const result = await reserve(fake.ctx);
    expect(result.status).toBe("reserved");
    expect(result.worldId).toBe("world-1");
    expect(result.userId).toBe("gm-1");
    expect(fake.set).toHaveBeenCalledTimes(1);
    expect(entriesOf(fake.stored)[result.castId]).toEqual(result);
    expect(fake.assertWrite).toHaveBeenCalledTimes(1);
  });

  it("allows multi-point focus costs but rejects them for slot and innate resources", async () => {
    const fake = makeContext();
    const focus = {
      kind: "actorFocus" as const,
      cost: 3,
      value: 3,
      max: 3,
      expended: null,
      groupNumber: null,
      slotId: null,
    };
    await reserve(
      fake.ctx,
      reservation({ castId: "focus-cast", resourceBefore: focus }),
    );
    await expect(
      reserve(
        fake.ctx,
        reservation({
          castId: "bad-cost",
          actorUuid: "Actor.actor-2",
          resourceBefore: { ...slot, cost: 3 },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CAST_RESERVATION" });
  });

  it("accepts native focus group numbers above rank ten", async () => {
    const fake = makeContext();
    await reserve(
      fake.ctx,
      reservation({
        castId: "npc-focus",
        resourceBefore: { ...slot, kind: "actorFocus", groupNumber: 13 },
      }),
    );
    expect(entriesOf(fake.stored)["npc-focus"].resourceBefore.groupNumber).toBe(
      13,
    );
  });

  it("rejects duplicate ids and blocks unresolved Actors across fresh contexts", async () => {
    const fake = makeContext();
    await reserve(fake.ctx);
    const reloaded = makeContext(fake.stored);
    await expect(
      reserve(reloaded.ctx, reservation({ castId: "blocked-cast" })),
    ).rejects.toMatchObject({
      code: "SPELL_CAST_RECONCILIATION_REQUIRED",
    });
    await expect(
      reserve(reloaded.ctx, reservation({ castId: "cast-1" })),
    ).rejects.toMatchObject({ code: "CAST_ALREADY_RECORDED" });
    await reserve(
      reloaded.ctx,
      reservation({ castId: "other-actor", actorUuid: "Actor.actor-2" }),
    );
    expect(Object.keys(entriesOf(reloaded.stored))).toHaveLength(2);
  });

  it("allows a new reservation after a confirmed record", async () => {
    const fake = makeContext();
    await withSpellCastLedger(fake.ctx, async (ledger) => {
      await ledger.reserve(reservation());
      await ledger.finalize("cast-1", "confirmed", {
        nativeConsumed: true,
        resourceAfter: { ...slot, value: 0 },
        chatMessageUuid: "ChatMessage.message-1",
      });
      await ledger.reserve(reservation({ castId: "cast-2" }));
    });
    expect(entriesOf(fake.stored)["cast-1"].status).toBe("confirmed");
    expect(entriesOf(fake.stored)["cast-2"].status).toBe("reserved");
    await expect(
      reserve(fake.ctx, reservation({ castId: "cast-1" })),
    ).rejects.toMatchObject({ code: "CAST_ALREADY_RECORDED" });
  });

  it("keeps an uncertain record blocking future intent for that Actor", async () => {
    const fake = makeContext();
    await withSpellCastLedger(fake.ctx, async (ledger) => {
      await ledger.reserve(reservation());
      await ledger.finalize("cast-1", "uncertain", {
        nativeConsumed: null,
        resourceAfter: null,
        chatMessageUuid: null,
      });
    });
    await expect(
      reserve(fake.ctx, reservation({ castId: "cast-2" })),
    ).rejects.toMatchObject({ code: "SPELL_CAST_RECONCILIATION_REQUIRED" });
  });

  it("serializes cross-Actor writers without losing either record", async () => {
    const fake = makeContext();
    await Promise.all([
      reserve(
        fake.ctx,
        reservation({ castId: "cast-a", actorUuid: "Actor.a" }),
      ),
      reserve(
        fake.ctx,
        reservation({ castId: "cast-b", actorUuid: "Actor.b" }),
      ),
    ]);
    expect(Object.keys(entriesOf(fake.stored)).sort()).toEqual([
      "cast-a",
      "cast-b",
    ]);
  });

  it("does not mutate a cached settings object before the write resolves", async () => {
    const cached = { version: 1, entries: {} };
    let finishWrite!: () => void;
    let enteredWrite!: () => void;
    const entered = new Promise<void>((resolve) => (enteredWrite = resolve));
    const pending = new Promise<void>((resolve) => (finishWrite = resolve));
    const fake = makeContext(cached);
    fake.set.mockImplementation(async (_module, _key, value) => {
      enteredWrite();
      await pending;
      fake.setStored(value);
      return value;
    });
    const work = reserve(fake.ctx);
    await entered;
    expect(cached.entries).toEqual({});
    finishWrite();
    await work;
  });

  it("reports fresh audit status when a write commits and then throws", async () => {
    const fake = makeContext();
    fake.set.mockImplementationOnce(async (_module, _key, value) => {
      fake.setStored(value);
      throw new Error("lost response after commit");
    });
    await expect(reserve(fake.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
      partial: {
        reservationMayExist: true,
        persistedStatus: "reserved",
        auditStateKnown: true,
        nativeOperationMayProceed: false,
      },
    });
  });

  it("denies finalization without removing or refunding the reservation", async () => {
    const fake = makeContext();
    await reserve(fake.ctx);
    fake.set.mockClear();
    fake.set.mockImplementationOnce(async () => {
      throw new Error("write failed before commit");
    });
    await expect(
      withSpellCastLedger(fake.ctx, (ledger) =>
        ledger.finalize("cast-1", "uncertain", {
          nativeConsumed: true,
          resourceAfter: slot,
          chatMessageUuid: "ChatMessage.message-1",
        }),
      ),
    ).rejects.toMatchObject({
      code: "SPELL_CAST_FINALIZATION_UNCONFIRMED",
      partial: {
        status: "reserved",
        auditStateKnown: true,
        requestedStatus: "uncertain",
      },
    });
    expect(entriesOf(fake.stored)["cast-1"].status).toBe("reserved");
    expect(fake.set).toHaveBeenCalledTimes(1);
  });

  it("does not write a second time when finalization readback mismatches", async () => {
    const fake = makeContext();
    await reserve(fake.ctx);
    fake.set.mockClear();
    fake.set.mockImplementationOnce(async () => undefined);
    await expect(
      withSpellCastLedger(fake.ctx, (ledger) =>
        ledger.finalize("cast-1", "uncertain", {
          nativeConsumed: true,
          resourceAfter: slot,
          chatMessageUuid: "ChatMessage.message-1",
        }),
      ),
    ).rejects.toMatchObject({
      code: "SPELL_CAST_FINALIZATION_UNCONFIRMED",
      partial: {
        status: "reserved",
        auditStateKnown: true,
        requestedStatus: "uncertain",
      },
    });
    expect(fake.set).toHaveBeenCalledTimes(1);
    expect(entriesOf(fake.stored)["cast-1"].status).toBe("reserved");
  });

  it("fails closed for malformed, null, future-version, and unreadable settings", async () => {
    for (const initial of [
      null,
      { version: 2, entries: {} },
      { version: 1, entries: { broken: {} } },
    ]) {
      const fake = makeContext(initial);
      await expect(reserve(fake.ctx)).rejects.toMatchObject({
        code: "SPELL_LEDGER_INVALID",
      });
      expect(fake.set).not.toHaveBeenCalled();
    }
    const broken = makeContext();
    broken.get.mockImplementation(() => {
      throw new Error("settings unavailable");
    });
    await expect(reserve(broken.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_READ_FAILED",
    });
    const noGet = makeContext();
    delete noGet.ctx.game.settings.get;
    await expect(reserve(noGet.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_API_UNAVAILABLE",
    });
    const noSet = makeContext();
    delete noSet.ctx.game.settings.set;
    await expect(reserve(noSet.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
      partial: { causeCode: "SPELL_LEDGER_API_UNAVAILABLE" },
    });
  });

  it("does not proceed when reservation persistence is absent or unconfirmed", async () => {
    const beforeCommit = makeContext();
    beforeCommit.set.mockImplementationOnce(async () => {
      throw new Error("failed before commit");
    });
    await expect(reserve(beforeCommit.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
      partial: {
        reservationMayExist: false,
        persistedStatus: null,
        auditStateKnown: true,
        nativeOperationMayProceed: false,
      },
    });

    const mismatch = makeContext();
    mismatch.set.mockImplementationOnce(async () => undefined);
    await expect(reserve(mismatch.ctx)).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
      partial: { reservationMayExist: false, auditStateKnown: true },
    });
    expect(mismatch.stored).toBeUndefined();
  });

  it("rechecks write authorization after waiting for the world lock", async () => {
    const fake = makeContext();
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const entered = new Promise<void>((resolve) => (enteredFirst = resolve));
    const first = withSpellCastLedger(fake.ctx, async () => {
      enteredFirst();
      await gate;
    });
    await entered;
    const second = reserve(fake.ctx, reservation({ castId: "queued" }));
    fake.authorized = false;
    releaseFirst();
    await first;
    await expect(second).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
      partial: { causeCode: "WRITE_DENIED", nativeOperationMayProceed: false },
    });
    expect(fake.set).not.toHaveBeenCalled();
  });

  it("rejects queued work if the active world changes while it waits", async () => {
    const fake = makeContext();
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const entered = new Promise<void>((resolve) => (enteredFirst = resolve));
    const first = withSpellCastLedger(fake.ctx, async () => {
      enteredFirst();
      await gate;
    });
    await entered;
    const second = reserve(fake.ctx, reservation({ castId: "queued-world" }));
    fake.ctx.game.world.id = "world-2";
    releaseFirst();
    await first;
    await expect(second).rejects.toMatchObject({ code: "WORLD_CHANGED" });
    expect(fake.set).not.toHaveBeenCalled();
  });

  it("rejects a full ledger without eviction or persistence", async () => {
    const records: Record<string, SpellCastRecord> = {};
    const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
    for (let index = 0; index < 5000; index += 1) {
      const id = `existing-${index}`;
      records[id] = {
        ...reservation({ castId: id, actorUuid: `Actor.${id}` }),
        worldId: "world-1",
        userId: "gm-1",
        createdAt: now,
        updatedAt: now,
        status: "confirmed",
        nativeConsumed: true,
        resourceAfter: slot,
        chatMessageUuid: `ChatMessage.${id}`,
      };
    }
    const initial = { version: 1, entries: records };
    const fake = makeContext(initial);
    await expect(
      reserve(
        fake.ctx,
        reservation({ castId: "new-record", actorUuid: "Actor.new" }),
      ),
    ).rejects.toMatchObject({ code: "SPELL_LEDGER_FULL" });
    expect(fake.set).not.toHaveBeenCalled();
    expect(Object.keys(entriesOf(fake.stored))).toHaveLength(5000);
  });

  it("reports bounded read-only Actor summaries without writing", async () => {
    const records: Record<string, SpellCastRecord> = {};
    for (let index = 0; index < 12; index += 1) {
      const id = `cast-${index}`;
      const now = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      records[id] = {
        ...reservation({ castId: id }),
        worldId: "world-1",
        userId: "gm-1",
        createdAt: now,
        updatedAt: now,
        status: "uncertain",
        nativeConsumed: null,
        resourceAfter: null,
        chatMessageUuid: null,
      };
    }
    const fake = makeContext({ version: 1, entries: records });
    const result = readSpellCastActorSummary(fake.ctx, "Actor.actor-1");
    expect(result.recordCount).toBe(12);
    expect(result.blockedCount).toBe(12);
    expect(result.entries).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(fake.set).not.toHaveBeenCalled();
    expect(fake.assertWrite).not.toHaveBeenCalled();
  });

  it("releases the world lock when a transaction callback throws", async () => {
    const fake = makeContext();
    await expect(
      withSpellCastLedger(fake.ctx, async () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");
    await reserve(fake.ctx);
    expect(entriesOf(fake.stored)["cast-1"].status).toBe("reserved");
  });

  it("rejects extra reservation fields before persistence", async () => {
    const fake = makeContext();
    await expect(
      reserve(fake.ctx, { ...reservation(), userId: "spoofed" } as any),
    ).rejects.toMatchObject({ code: "INVALID_CAST_RESERVATION" });
    expect(fake.set).not.toHaveBeenCalled();
  });

  it("treats inherited object names as ordinary cast IDs or absent keys", async () => {
    const fake = makeContext();
    await withSpellCastLedger(fake.ctx, async (ledger) => {
      expect(ledger.get("toString")).toBeNull();
      await ledger.reserve(reservation({ castId: "constructor" }));
      expect(ledger.get("constructor")?.status).toBe("reserved");
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        entriesOf(fake.stored),
        "constructor",
      ),
    ).toBe(true);
  });

  it("preserves a committed terminal record when its write reports an error", async () => {
    const fake = makeContext();
    await reserve(fake.ctx);
    fake.set.mockClear();
    let writes = 0;
    fake.set.mockImplementation(async (_module, _key, value) => {
      writes += 1;
      if (writes === 1) {
        fake.setStored(value);
        throw new Error("response lost after terminal write");
      }
      throw new Error("rollback failed");
    });
    await expect(
      withSpellCastLedger(fake.ctx, (ledger) =>
        ledger.finalize("cast-1", "confirmed", {
          nativeConsumed: true,
          resourceAfter: none,
          chatMessageUuid: "ChatMessage.message-1",
        }),
      ),
    ).rejects.toMatchObject({
      code: "SPELL_CAST_FINALIZATION_UNCONFIRMED",
      partial: {
        status: "confirmed",
        auditStateKnown: true,
        requestedStatus: "confirmed",
        requestedNativeConsumed: true,
        requestedChatMessageUuid: "ChatMessage.message-1",
      },
    });
    expect(fake.set).toHaveBeenCalledTimes(1);
    expect(entriesOf(fake.stored)["cast-1"]).toMatchObject({
      status: "confirmed",
      nativeConsumed: true,
      resourceAfter: none,
      chatMessageUuid: "ChatMessage.message-1",
    });
  });
});
