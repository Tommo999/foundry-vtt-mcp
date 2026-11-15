import { describe, expect, it, vi } from "vitest";
import {
  finalizeSpellEffect,
  readSpellEffectLedger,
  reserveSpellEffect,
  spellEffectLedgerAvailability,
  spellEffectSemanticKey,
  __spellEffectLedgerTest,
  type SpellEffectReservation,
} from "../src/pf2e-spell-effect-ledger.js";
import { withSpellAuditLock } from "../src/pf2e-spell-audit-lock.js";

const effectChoice = { kind: "effect", uuid: "Compendium.pf2e.spell-effects.Item.bless" } as const;
function reservation(overrides: Partial<SpellEffectReservation> = {}): SpellEffectReservation {
  const castMessageUuid = "ChatMessage.cast-1";
  const targetActorUuid = "Actor.target-1";
  const choice = effectChoice;
  return {
    applicationId: "spell-effect-application-a",
    semanticKey: spellEffectSemanticKey(castMessageUuid, targetActorUuid, choice),
    castMessageUuid,
    castId: "cast-1",
    casterActorUuid: "Actor.caster-1",
    casterTokenUuid: "Scene.scene.Token.caster",
    targetActorUuid,
    targetTokenUuid: "Scene.scene.Token.target",
    choice,
    sessionId: "session-1",
    reviewFingerprint: "a".repeat(64),
    expectedOperation: "create-effect",
    beforeConditionUuid: null,
    beforeConditionValue: null,
    ...overrides,
  };
}
function context(initial?: any, options: { lostAck?: boolean; readFail?: boolean } = {}) {
  let stored = initial;
  const get = vi.fn(() => {
    if (options.readFail) throw new Error("settings read failed");
    return stored;
  });
  const set = vi.fn(async (_module: string, _setting: string, next: any) => {
    stored = structuredClone(next);
    if (options.lostAck) throw new Error("acknowledgement lost after commit");
  });
  const ctx: any = {
    sessionId: "session-1",
    assertWrite: vi.fn(),
    game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: { get, set } },
  };
  return { ctx, get, set, value: () => stored };
}

describe("PF2e spell-effect outcome ledger", () => {
  it("keys by cast card, target Actor identity, and selected effect/condition while ignoring intent and condition value", () => {
    const card = "ChatMessage.cast-1";
    const key = spellEffectSemanticKey(card, "Actor.target-1", effectChoice);
    expect(key).toBe(spellEffectSemanticKey(card, "Actor.target-1", { ...effectChoice }));
    expect(key).not.toBe(spellEffectSemanticKey(card, "Actor.target-2", effectChoice));
    expect(key).not.toBe(spellEffectSemanticKey("ChatMessage.cast-2", "Actor.target-1", effectChoice));
    expect(spellEffectSemanticKey(card, "Actor.target-1", { kind: "condition", slug: "frightened", value: 1 }))
      .toBe(spellEffectSemanticKey(card, "Actor.target-1", { kind: "condition", slug: "frightened", value: 4 }));
  });

  it("reserves, reads back, finalizes once, and permanently blocks the semantic key", async () => {
    const f = context();
    const reserved = await reserveSpellEffect(f.ctx, reservation());
    expect(reserved.status).toBe("reserved");
    const ledger = readSpellEffectLedger(f.ctx);
    expect(ledger.entries[reserved.semanticKey]).toEqual(reserved);
    expect(spellEffectLedgerAvailability(ledger, reserved.semanticKey)).toMatchObject({ available: false, blockedStatus: "reserved" });
    const final = await finalizeSpellEffect(f.ctx, reserved.semanticKey, reserved.applicationId, "confirmed", {
      kind: "effect-created", documentUuids: ["Actor.target-1.Item.bless-1"], observedValue: null,
    });
    expect(final.status).toBe("confirmed");
    await expect(reserveSpellEffect(f.ctx, reservation({ applicationId: "spell-effect-application-b", targetTokenUuid: "Scene.scene.Token.same-actor-alias" })))
      .rejects.toMatchObject({ code: "SPELL_EFFECT_ALREADY_RESERVED" });
    await expect(finalizeSpellEffect(f.ctx, reserved.semanticKey, reserved.applicationId, "uncertain", null))
      .rejects.toMatchObject({ code: "SPELL_EFFECT_ALREADY_FINAL" });
    expect(f.set).toHaveBeenCalledTimes(2);
  });

  it("uses one reserve/finalize setting attempt and reports a committed write with lost acknowledgement", async () => {
    const f = context(undefined, { lostAck: true });
    const reserved = await reserveSpellEffect(f.ctx, reservation());
    expect(reserved.status).toBe("reserved");
    expect(f.set).toHaveBeenCalledTimes(1);
    expect(f.ctx.assertWrite).toHaveBeenCalledTimes(1);
  });

  it("makes one terminal attempt after a committed lost acknowledgement", async () => {
    const f = context(undefined, { lostAck: true });
    const reserved = await reserveSpellEffect(f.ctx, reservation());
    const finalized = await finalizeSpellEffect(f.ctx, reserved.semanticKey, reserved.applicationId, "confirmed", {
      kind: "effect-created", documentUuids: ["Actor.target-1.Item.effect-1"], observedValue: null,
    });
    expect(finalized.status).toBe("confirmed");
    expect(f.set).toHaveBeenCalledTimes(2); // exactly one reserve attempt and one terminal attempt
  });

  it("does not replay after lost acknowledgement when readback is unavailable", async () => {
    let reads = 0;
    const set = vi.fn(async () => { throw new Error("ack lost"); });
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: {
        get: vi.fn(() => { reads++; if (reads > 1) throw new Error("readback failed"); return undefined; }), set,
      } },
    };
    await expect(reserveSpellEffect(ctx, reservation())).rejects.toMatchObject({
      code: "SPELL_EFFECT_LEDGER_WRITE_UNCONFIRMED",
      partial: { auditStatus: "unknown" },
    });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("rechecks the paired session after waiting for the shared world audit lock", async () => {
    const f = context();
    let release!: () => void;
    const held = withSpellAuditLock(f.ctx, async () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const waiting = reserveSpellEffect(f.ctx, reservation());
    f.ctx.sessionId = "session-changed-while-waiting";
    release();
    await held;
    await expect(waiting).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(f.set).not.toHaveBeenCalled();
  });

  it("supports truthful unvalued-condition no-op outcomes without inventing a numeric value", async () => {
    const choice = { kind: "condition", slug: "blinded", value: null } as const;
    const castMessageUuid = "ChatMessage.unvalued";
    const targetActorUuid = "Actor.target-1";
    const input = reservation({
      applicationId: "spell-effect-application-unvalued",
      castMessageUuid,
      targetActorUuid,
      targetTokenUuid: "Scene.scene.Token.target",
      choice,
      semanticKey: spellEffectSemanticKey(castMessageUuid, targetActorUuid, choice),
      expectedOperation: "already-satisfied",
      beforeConditionUuid: "Actor.target-1.Item.blinded",
      beforeConditionValue: null,
    });
    const f = context();
    const reserved = await reserveSpellEffect(f.ctx, input);
    const final = await finalizeSpellEffect(f.ctx, reserved.semanticKey, reserved.applicationId, "confirmed", {
      kind: "already-satisfied", documentUuids: ["Actor.target-1.Item.blinded"], observedValue: null,
    });
    expect(final.outcome?.observedValue).toBeNull();
  });

  it("rejects choice-incompatible outcomes on uncertain as well as confirmed records", async () => {
    const f = context();
    const reserved = await reserveSpellEffect(f.ctx, reservation());
    const incompatible = {
      ...reserved,
      status: "uncertain",
      outcome: { kind: "condition-created", documentUuids: ["Actor.target-1.Item.frightened"], observedValue: null },
    };
    expect(__spellEffectLedgerTest.validRecord(incompatible, reserved.semanticKey)).toBe(false);
  });

  it("rejects session-crossed reservations/finalizations, application ID collisions, and absent set APIs before attempting writes", async () => {
    const f = context();
    await expect(reserveSpellEffect(f.ctx, reservation({ sessionId: "old-session" })))
      .rejects.toMatchObject({ code: "SESSION_CHANGED" });
    const reserved = await reserveSpellEffect(f.ctx, reservation());
    await expect(reserveSpellEffect(f.ctx, reservation({
      semanticKey: spellEffectSemanticKey("ChatMessage.other", "Actor.other", effectChoice),
      castMessageUuid: "ChatMessage.other",
      targetActorUuid: "Actor.other",
    }))).rejects.toMatchObject({ code: "SPELL_EFFECT_APPLICATION_ID_COLLISION" });
    f.ctx.sessionId = "new-session";
    await expect(finalizeSpellEffect(f.ctx, reserved.semanticKey, reserved.applicationId, "uncertain", null))
      .rejects.toMatchObject({ code: "SESSION_CHANGED" });
    const noSet = context();
    delete noSet.ctx.game.settings.set;
    await expect(reserveSpellEffect(noSet.ctx, reservation()))
      .rejects.toMatchObject({ code: "SPELL_EFFECT_LEDGER_API_UNAVAILABLE" });
    expect(noSet.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("fails closed for malformed records, wrong worlds, duplicate application IDs, and settings read errors", () => {
    const good = {
      ...reservation(), worldId: "world-1", userId: "gm-1", sessionId: "session-1",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "reserved", outcome: null,
    };
    const key = good.semanticKey;
    expect(__spellEffectLedgerTest.validRecord(good, key)).toBe(true);
    expect(() => readSpellEffectLedger(context({ version: 9, entries: {} }).ctx)).toThrow(expect.objectContaining({ code: "SPELL_EFFECT_LEDGER_INVALID" }));
    expect(() => readSpellEffectLedger(context({ version: 1, entries: { [key]: { ...good, targetActorUuid: "Actor.other" } } }).ctx))
      .toThrow(expect.objectContaining({ code: "SPELL_EFFECT_LEDGER_INVALID" }));
    const two = reservation({ applicationId: "spell-effect-application-b", targetActorUuid: "Actor.target-2" });
    const other = { ...good, ...two, worldId: "world-1", userId: "gm-1", sessionId: "session-1", createdAt: good.createdAt, updatedAt: good.updatedAt, status: "reserved", outcome: null };
    expect(() => readSpellEffectLedger(context({ version: 1, entries: { [key]: good, [other.semanticKey]: { ...other, applicationId: good.applicationId } } }).ctx))
      .toThrow(expect.objectContaining({ code: "SPELL_EFFECT_LEDGER_INVALID" }));
    expect(() => readSpellEffectLedger(context(undefined, { readFail: true }).ctx))
      .toThrow(expect.objectContaining({ code: "SPELL_EFFECT_LEDGER_READ_FAILED" }));
  });

  it("fails at 5000 records without eviction or a setting write", async () => {
    const entries: Record<string, any> = {};
    for (let index = 0; index < 5000; index += 1) {
      const castMessageUuid = `ChatMessage.${index}`;
      const targetActorUuid = `Actor.${index}`;
      const key = spellEffectSemanticKey(castMessageUuid, targetActorUuid, effectChoice);
      entries[key] = {
        ...reservation({ applicationId: `spell-effect-application-${index}`, semanticKey: key, castMessageUuid, targetActorUuid }),
        worldId: "world-1", userId: "gm-1", sessionId: "session-1", createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), status: "reserved", outcome: null,
      };
    }
    const f = context({ version: 1, entries });
    await expect(reserveSpellEffect(f.ctx, reservation({ applicationId: "spell-effect-application-overflow" })))
      .rejects.toMatchObject({ code: "SPELL_EFFECT_LEDGER_FULL" });
    expect(f.set).not.toHaveBeenCalled();
    expect(Object.keys(f.value().entries)).toHaveLength(5000);
  });
});
