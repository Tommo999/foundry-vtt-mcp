import { describe, expect, it, vi } from "vitest";
import { appendSpellReconciliation, spellAuditSourceSnapshot } from "../src/pf2e-spell-reconciliation-ledger.js";
import { __spellReconciliationStoreTest } from "../src/pf2e-spell-reconciliation-ledger.js";

const before = {
  kind: "preparedSlot", cost: 1, value: 1, max: 2, expended: false,
  groupNumber: 1, slotId: 0,
};
const after = { ...before, expended: true };
const source = {
  castId: "cast-1", worldId: "world-1", actorUuid: "Actor.actor-1",
  casterTokenUuid: "Scene.scene-1.Token.token-1", entryUuid: "Actor.actor-1.Item.entry-1",
  spellUuid: "Actor.actor-1.Item.spell-1", rank: 1, slotId: 0,
  targetTokenUuids: [], messageMode: "public", createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z", status: "reserved", nativeConsumed: null,
  resourceBefore: before, resourceAfter: null, chatMessageUuid: null,
};
const snapshot = spellAuditSourceSnapshot("cast", source);
const record = {
  reconciliationId: "rec-1", worldId: "world-1", userId: "gm-1",
  createdAt: "2026-11-15T00:00:00.000Z", sourceKind: "cast", sourceId: "cast-1",
  sourceFingerprint: "a".repeat(64), sourceSnapshot: snapshot, actorUuid: "Actor.actor-1",
  decision: "confirmed-observed", evidenceVersion: 1, evidenceMessageUuid: "ChatMessage.msg-1",
  resourceBefore: before, resourceAfter: after, rollType: null, rollTotal: null,
};

describe("spell reconciliation evidence validation", () => {
  it("accepts a bounded confirmed cast overlay bound to the nonsecret source projection", () => {
    expect(__spellReconciliationStoreTest.validRecord(record, "rec-1")).toBe(true);
    expect(snapshot).not.toContain("sessionId");
    expect(snapshot).not.toContain("reviewToken");
  });

  it("rejects source projections containing undeclared or secret fields", () => {
    const parsed = JSON.parse(snapshot);
    parsed.sessionId = "must-not-be-stored";
    const malformed = { ...record, sourceSnapshot: JSON.stringify(parsed) };
    expect(__spellReconciliationStoreTest.validRecord(malformed, "rec-1")).toBe(false);
  });

  it("confirms a commit whose acknowledgement is lost without retrying the write", async () => {
    let value: any;
    const set = vi.fn(async (_namespace: string, _key: string, next: any) => {
      value = structuredClone(next);
      throw new Error("ack lost after commit");
    });
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: {
        get: vi.fn(() => value), set,
      } },
    };
    const { worldId: _world, userId: _user, createdAt: _time, ...input } = record;
    expect(__spellReconciliationStoreTest.validRecord({ ...input, worldId: "world-1", userId: "gm-1", createdAt: new Date().toISOString() }, "rec-1")).toBe(true);
    await expect(appendSpellReconciliation(ctx, input as any)).resolves.toMatchObject({ reconciliationId: "rec-1" });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("reports unknown after one write when readback is unavailable", async () => {
    const get = vi.fn(() => {
      if (get.mock.calls.length > 1) throw new Error("readback unavailable");
      return undefined;
    });
    const set = vi.fn(async () => { throw new Error("write acknowledgement lost"); });
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: { get, set } },
    };
    const { worldId: _world, userId: _user, createdAt: _time, ...input } = record;
    await expect(appendSpellReconciliation(ctx, input as any)).rejects.toMatchObject({
      code: "SPELL_RECONCILIATION_APPEND_UNCONFIRMED",
      partial: { auditStatus: "unknown" },
    });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("blocks a second append for the same source and fails closed on read errors", async () => {
    let value: any;
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: {
        get: vi.fn(() => value), set: vi.fn(async (_namespace: string, _key: string, next: any) => { value = structuredClone(next); }),
      } },
    };
    const { worldId: _world, userId: _user, createdAt: _time, ...input } = record;
    await appendSpellReconciliation(ctx, input as any);
    await expect(appendSpellReconciliation(ctx, { ...input, reconciliationId: "rec-2" } as any))
      .rejects.toMatchObject({ code: "SPELL_RECONCILIATION_ALREADY_RECORDED" });
    ctx.game.settings.get.mockImplementation(() => { throw new Error("read unavailable"); });
    await expect(appendSpellReconciliation(ctx, { ...input, reconciliationId: "rec-3" } as any))
      .rejects.toMatchObject({ code: "SPELL_RECONCILIATION_LEDGER_READ_FAILED" });
  });

  it("rejects malformed stored audit settings", async () => {
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: {
        get: vi.fn(() => ({ version: 999, entries: {} })), set: vi.fn(),
      } },
    };
    const { worldId: _world, userId: _user, createdAt: _time, ...input } = record;
    await expect(appendSpellReconciliation(ctx, input as any))
      .rejects.toMatchObject({ code: "SPELL_RECONCILIATION_LEDGER_INVALID" });
    expect(ctx.game.settings.set).not.toHaveBeenCalled();
  });

  it("refuses capacity overflow without eviction or another setting write", async () => {
    const entries: Record<string, any> = {};
    for (let index = 0; index < 5000; index += 1) {
      const id = `cast-${index}`;
      const projection = spellAuditSourceSnapshot("cast", { ...source, castId: id });
      entries[`rec-${index}`] = { ...record, reconciliationId: `rec-${index}`, sourceId: id,
        sourceSnapshot: projection, sourceFingerprint: String(index).padStart(64, "0") };
    }
    const ctx: any = {
      sessionId: "session-1", assertWrite: vi.fn(),
      game: { world: { id: "world-1" }, user: { id: "gm-1", isGM: true }, settings: {
        get: vi.fn(() => ({ version: 1, entries })), set: vi.fn(),
      } },
    };
    const { worldId: _world, userId: _user, createdAt: _time, ...input } = record;
    await expect(appendSpellReconciliation(ctx, { ...input, reconciliationId: "overflow" } as any))
      .rejects.toMatchObject({ code: "SPELL_RECONCILIATION_LEDGER_FULL" });
    expect(ctx.game.settings.set).not.toHaveBeenCalled();
  });
});
