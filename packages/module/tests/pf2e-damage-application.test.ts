import { beforeEach, describe, expect, it, vi } from "vitest";

const { prepareMock, snapshotMock, guardMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  snapshotMock: vi.fn(),
  guardMock: vi.fn(),
}));
vi.mock("../src/pf2e-damage-context.js", () => ({
  prepareDamageApplication: prepareMock,
  snapshotDamageTarget: snapshotMock,
  assertPreparedDamageCurrent: guardMock,
}));

import {
  handlePF2eApplyDamage,
  readPF2eDamageApplicationLedger,
} from "../src/pf2e-damage-application.js";

function setup() {
  const actor: any = {
    id: "actor1",
    uuid: "Actor.actor1",
    system: {},
    damageSnapshot: {
      health: {
        hp: { value: 20, max: 20, temp: 0 },
        stamina: { value: 5, max: 5 },
      },
      shield: null,
    },
  };
  snapshotMock.mockImplementation((document: any) =>
    structuredClone(document.damageSnapshot),
  );
  guardMock.mockImplementation(() => undefined);
  const scene: any = { id: "scene1", uuid: "Scene.scene1", tokens: new Map() };
  const token: any = {
    id: "token1",
    uuid: "Scene.scene1.Token.token1",
    parent: scene,
    actor,
  };
  scene.tokens.set(token.id, token);
  const messages: any[] = [];
  let settingsValue: any = { version: 1, entries: {} };
  const settings = {
    get: vi.fn((_module: string, key: string) =>
      key === "damageApplications" ? settingsValue : true,
    ),
    set: vi.fn(async (_module: string, _key: string, value: any) => {
      settingsValue = structuredClone(value);
    }),
  };
  const game: any = {
    world: { id: "world1" },
    system: { id: "pf2e" },
    pf2e: {},
    settings,
    messages,
  };
  const ctx: any = {
    game,
    assertWrite: vi.fn(),
    resolve: vi.fn(),
    serialize: vi.fn(),
  };
  const contextActor: any = { applyDamage: vi.fn(async () => contextActor) };
  const snapshot = () => ({
    target: { health: { hp: { value: 20, max: 20, temp: 0 } }, shield: null },
  });
  const prepared: any = {
    message: { uuid: "ChatMessage.msg1" },
    roll: {},
    rollIndex: 0,
    targetToken: token,
    actor,
    contextActor,
    item: null,
    nativeDamage: 8,
    nativeRollOptions: new Set(),
    outcome: "success",
    skipIWR: false,
    shieldBlockRequest: false,
    applicationKey: "ChatMessage.msg1:0:Actor.actor1",
    reviewToken: "a".repeat(64),
    operation: "damage",
    multiplier: 1,
    shieldBlock: false,
    targetTokenUuid: token.uuid,
    targetActorUuid: actor.uuid,
    snapshot: snapshot(),
  };
  prepareMock.mockImplementation(async () => prepared);
  const args = {
    messageUuid: prepared.message.uuid,
    targetTokenUuid: token.uuid,
    rollIndex: 0,
    operation: "damage",
    multiplier: 1,
    shieldBlock: false,
    reviewToken: prepared.reviewToken,
  };
  const emitOutcome = () =>
    messages.push({
      uuid: `ChatMessage.outcome${messages.length}`,
      speaker: { actor: actor.id, token: token.id, scene: scene.id },
      flags: {
        pf2e: {
          context: { type: "damage-taken" },
          appliedDamage: { uuid: actor.uuid },
        },
      },
    });
  return {
    actor,
    token,
    contextActor,
    messages,
    settings,
    ctx,
    prepared,
    args,
    emitOutcome,
    setSettings: (value: any) => {
      settingsValue = value;
    },
    getSettings: () => settingsValue,
  };
}

describe("PF2e damage application", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    snapshotMock.mockReset();
    guardMock.mockReset();
  });

  it("reserves the persistent ledger before invoking native damage and commits the outcome", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.emitOutcome();
      return s.contextActor;
    });
    const result: any = await handlePF2eApplyDamage(s.args, s.ctx);
    expect(s.settings.set).toHaveBeenCalledTimes(2);
    expect(
      s.settings.set.mock.calls[0][2].entries[s.prepared.applicationKey].status,
    ).toBe("reserved");
    expect(s.contextActor.applyDamage).toHaveBeenCalledWith(
      expect.objectContaining({ damage: 8, token: s.token, final: false }),
    );
    expect(result.ledgerStatus).toBe("applied");
    expect(result.nativeChatMessageUuid).toBe("ChatMessage.outcome0");
  });

  it("reports the native HP, temporary HP, stamina, and shield deltas", async () => {
    const s = setup();
    s.actor.damageSnapshot.shield = { hp: 10, max: 10, hardness: 5 };
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.actor.damageSnapshot.health.hp.value = 14;
      s.actor.damageSnapshot.health.hp.temp = 0;
      s.actor.damageSnapshot.health.stamina.value = 3;
      s.actor.damageSnapshot.shield.hp = 6;
      s.emitOutcome();
      return s.contextActor;
    });
    const result: any = await handlePF2eApplyDamage(s.args, s.ctx);
    expect(result.changes).toEqual({
      hp: -6,
      tempHp: 0,
      stamina: -2,
      shieldHp: -4,
      conditionsAdded: [],
      conditionsRemoved: [],
    });
  });

  it("accepts a confirmed native immunity result with zero health delta", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.emitOutcome();
      return s.contextActor;
    });
    const result: any = await handlePF2eApplyDamage(s.args, s.ctx);
    expect(result.changes).toEqual({
      hp: 0,
      tempHp: 0,
      stamina: 0,
      shieldHp: null,
      conditionsAdded: [],
      conditionsRemoved: [],
    });
    expect(result.nativeConfirmed).toBe(true);
  });

  it("blocks duplicates across token aliases and changed operation", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.emitOutcome();
      return s.contextActor;
    });
    await handlePF2eApplyDamage(s.args, s.ctx);
    const linkedToken: any = {
      ...s.token,
      id: "token2",
      uuid: "Scene.scene1.Token.token2",
    };
    s.token.parent.tokens.set(linkedToken.id, linkedToken);
    s.prepared.targetToken = linkedToken;
    s.prepared.operation = "healing";
    const changedArgs = {
      ...s.args,
      targetTokenUuid: linkedToken.uuid,
      operation: "healing",
    };
    await expect(
      handlePF2eApplyDamage(changedArgs, s.ctx),
    ).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
    expect(s.contextActor.applyDamage).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent attempts so only one reaches native apply", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockImplementation(async () => {
      await Promise.resolve();
      s.emitOutcome();
      return s.contextActor;
    });
    const results = await Promise.allSettled([
      handlePF2eApplyDamage(s.args, s.ctx),
      handlePF2eApplyDamage(s.args, s.ctx),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(s.contextActor.applyDamage).toHaveBeenCalledTimes(1);
  });

  it("rejects stale review without reserving or applying", async () => {
    const s = setup();
    s.prepared.reviewToken = "b".repeat(64);
    await expect(handlePF2eApplyDamage(s.args, s.ctx)).rejects.toMatchObject({
      code: "STALE_REVIEW",
    });
    expect(s.settings.set).not.toHaveBeenCalled();
    expect(s.contextActor.applyDamage).not.toHaveBeenCalled();
  });

  it("does not apply when reservation persistence fails", async () => {
    const s = setup();
    s.settings.set.mockRejectedValueOnce(new Error("storage offline"));
    await expect(handlePF2eApplyDamage(s.args, s.ctx)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { nativeConfirmed: false },
    });
    expect(s.contextActor.applyDamage).not.toHaveBeenCalled();
  });

  it("leaves an uncertain reservation after native throw or ambiguous chat", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockRejectedValue(new Error("native failed"));
    await expect(handlePF2eApplyDamage(s.args, s.ctx)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
    });
    expect(s.getSettings().entries[s.prepared.applicationKey].status).toBe(
      "uncertain",
    );
    await expect(handlePF2eApplyDamage(s.args, s.ctx)).rejects.toMatchObject({
      code: "RECONCILIATION_REQUIRED",
    });
    expect(s.contextActor.applyDamage).toHaveBeenCalledTimes(1);
  });

  it("keeps a confirmed native outcome blocked if ledger commit fails", async () => {
    const s = setup();
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.emitOutcome();
      return s.contextActor;
    });
    s.settings.set.mockImplementationOnce(
      async (_m: string, _k: string, value: any) => {
        s.setSettings(value);
      },
    );
    s.settings.set.mockRejectedValueOnce(new Error("commit failed"));
    await expect(handlePF2eApplyDamage(s.args, s.ctx)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { nativeConfirmed: true, ledgerStatus: "reserved" },
    });
    expect(s.getSettings().entries[s.prepared.applicationKey].status).toBe(
      "reserved",
    );
    expect(readPF2eDamageApplicationLedger(s.ctx)).toMatchObject({ count: 1 });
  });

  it("does not mutate global token controls or settings outside the ledger", async () => {
    const s = setup();
    const canvas = { tokens: { controlled: [s.token] } };
    (globalThis as any).canvas = canvas;
    s.contextActor.applyDamage.mockImplementation(async () => {
      s.emitOutcome();
      return s.contextActor;
    });
    await handlePF2eApplyDamage(s.args, s.ctx);
    expect((globalThis as any).canvas).toBe(canvas);
    expect(canvas.tokens.controlled).toEqual([s.token]);
    expect(
      s.settings.set.mock.calls.every(
        (call) =>
          call[0] === "foundry-vtt-mcp" && call[1] === "damageApplications",
      ),
    ).toBe(true);
    delete (globalThis as any).canvas;
  });
});
