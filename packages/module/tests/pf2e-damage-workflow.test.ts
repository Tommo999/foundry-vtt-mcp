import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eInspectDamageApplication } from "../src/pf2e-damage-context";
import { handlePF2eApplyDamage } from "../src/pf2e-damage-application";
import type { PF2eContext } from "../src/pf2e-context";
import type { BridgeContext } from "../src/bridge-context";

/** Native-shaped fixture for the registered Foundry/PF2e DamageRoll API. */
class DamageRoll {
  _evaluated = true;
  options: any = { degreeOfSuccess: 2 };
  instances = [
    { type: "slashing", category: "physical", materials: [], traits: [] },
  ];
  constructor(
    public total = 12,
    public formula = "2d6+5",
  ) {}
  toJSON() {
    return {
      class: "DamageRoll",
      total: this.total,
      formula: this.formula,
      options: this.options,
      instances: this.instances,
    };
  }
  static fromData(data: any) {
    return new DamageRoll(data.total, data.formula);
  }
  alter(multiplier: number) {
    this.total = Math.floor(this.total * multiplier);
    return this;
  }
}

function fixture() {
  (globalThis as any).CONFIG = { Dice: { rolls: [DamageRoll] } };
  const settingValues = new Map<string, any>([
    ["pf2eEnabled", true],
    ["automation.actorsDeadAtZero", true],
    ["damageApplications", { version: 1, entries: {} }],
  ]);
  const settings = {
    get: vi.fn((scope: string, key: string) =>
      settingValues.get(scope === "pf2e" ? key : key),
    ),
    set: vi.fn(async (_scope: string, key: string, value: any) =>
      settingValues.set(key, structuredClone(value)),
    ),
  };
  const scene: any = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    parent: null,
    compendium: null,
    tokens: new Map(),
  };
  const messages: any = new Map();
  const shield: any = {
    id: "shield",
    uuid: "Actor.target.Item.shield",
    documentName: "Item",
    type: "shield",
    name: "Steel Shield",
    system: { hp: { value: 20, max: 20, broken: false }, hardness: 5 },
    toObject() {
      return {
        _id: this.id,
        type: this.type,
        system: structuredClone(this.system),
      };
    },
  };
  const actor: any = {
    id: "target",
    uuid: "Actor.target",
    documentName: "Actor",
    type: "character",
    name: "Target",
    system: {
      attributes: {
        hp: { value: 23, max: 30, temp: 2, sp: { value: 4, max: 6 } },
        shield: { itemId: "shield", raised: true },
      },
      traits: { immunity: [], weakness: [], resistance: [] },
    },
    items: new Map([[shield.id, shield]]),
    heldShield: shield,
    synthetics: { ephemeralEffects: { "damage-received": { target: [] } } },
    getSelfRollOptions: vi.fn((domain?: string) =>
      domain === "target" ? ["target:trait:living"] : ["self:actor:character"],
    ),
    getRollOptions: vi.fn(() => ["self:actor:character"]),
    applyDamage: vi.fn(),
    toObject() {
      return {
        _id: this.id,
        type: this.type,
        system: structuredClone(this.system),
        items: [...this.items.values()].map((item: any) => item.toObject()),
      };
    },
    getContextualClone: vi.fn(function (this: any) {
      const root = this;
      const clone: any = {
        id: this.id,
        uuid: this.uuid,
        documentName: this.documentName,
        type: this.type,
        name: this.name,
        system: structuredClone(this.system),
        items: this.items,
        heldShield: this.heldShield,
        synthetics: this.synthetics,
        getSelfRollOptions: this.getSelfRollOptions,
        getRollOptions: this.getRollOptions,
        toObject: this.toObject,
        async applyDamage(options: any) {
          expect(options.token).toBe(token);
          expect(options.final).toBe(false);
          // Mirror the native API changing the Actor and the explicitly held shield.
          root.system.attributes.hp.value = 17;
          root.system.attributes.hp.temp = 0;
          root.system.attributes.hp.sp.value = 3;
          if (options.shieldBlockRequest) shield.system.hp.value = 16;
          clone.system = structuredClone(root.system);
          const nativeMessage = {
            id: "damage-taken",
            uuid: "ChatMessage.damage-taken",
            documentName: "ChatMessage",
            speaker: { actor: root.id, token: token.id, scene: scene.id },
            flags: {
              pf2e: {
                context: { type: "damage-taken" },
                appliedDamage: { uuid: root.uuid },
              },
            },
          };
          messages.set(nativeMessage.id, nativeMessage);
          return clone;
        },
      };
      return clone;
    }),
  };
  const token: any = {
    id: "token",
    uuid: "Scene.scene.Token.token",
    documentName: "Token",
    parent: scene,
    actor,
    compendium: null,
  };
  scene.tokens.set(token.id, token);
  const sourceActor: any = {
    id: "source",
    uuid: "Actor.source",
    documentName: "Actor",
    type: "npc",
    name: "Attacker",
    synthetics: { ephemeralEffects: { "damage-received": { target: [] } } },
    getSelfRollOptions: vi.fn(() => ["self:actor:npc"]),
    getRollOptions: vi.fn(() => ["self:actor:npc"]),
    toObject() {
      return { _id: this.id, type: this.type, system: {} };
    },
  };
  const message: any = {
    id: "damage",
    uuid: "ChatMessage.damage",
    documentName: "ChatMessage",
    parent: null,
    compendium: null,
    rolls: [new DamageRoll()],
    actor: sourceActor,
    item: null,
    flags: {
      pf2e: {
        context: { type: "damage-roll", options: ["self:attack:melee"] },
      },
    },
  };
  messages.set(message.id, message);
  const resolved = new Map([
    [token.uuid, token],
    [message.uuid, message],
  ]);
  const game: any = {
    world: { id: "world" },
    time: { worldTime: 600 },
    system: { id: "pf2e" },
    pf2e: { settings: { iwr: true, variants: { stamina: true } } },
    settings,
    scenes: new Map([[scene.id, scene]]),
    messages,
  };
  const ctx: PF2eContext & BridgeContext = {
    game,
    resolve: vi.fn(async (uuid: string) => resolved.get(uuid) ?? null),
    assertWrite: vi.fn(),
    serialize: (document: any) => document,
  };
  return {
    ctx,
    actor,
    token,
    scene,
    shield,
    message,
    messages,
    settings,
    settingValues,
  };
}

describe("PF2e native damage review-to-application workflow", () => {
  let state: ReturnType<typeof fixture>;
  beforeEach(() => {
    state = fixture();
  });

  it("inspects then applies the exact reviewed roll through the native contextual clone", async () => {
    const choices = {
      messageUuid: state.message.uuid,
      targetTokenUuid: state.token.uuid,
      rollIndex: 0,
      operation: "damage" as const,
      multiplier: 1 as const,
      shieldBlock: true,
      shieldItemUuid: state.shield.uuid,
    };
    const preview = await handlePF2eInspectDamageApplication(
      choices,
      state.ctx,
    );
    expect(preview.readOnly).toBe(true);
    expect(state.ctx.assertWrite).not.toHaveBeenCalled();
    expect(state.actor.system.attributes.hp).toMatchObject({
      value: 23,
      temp: 2,
    });
    expect(state.shield.system.hp.value).toBe(20);

    const result: any = await handlePF2eApplyDamage(
      { ...choices, reviewToken: preview.reviewToken },
      state.ctx,
    );
    expect(state.ctx.assertWrite).toHaveBeenCalledTimes(3); // reservation, native authorization, and ledger commit
    expect(state.actor.system.attributes.hp).toMatchObject({
      value: 17,
      temp: 0,
      sp: { value: 3 },
    });
    expect(state.shield.system.hp.value).toBe(16);
    expect(result).toMatchObject({
      nativeConfirmed: true,
      ledgerStatus: "applied",
      sourceMessageUuid: state.message.uuid,
      targetTokenUuid: state.token.uuid,
      changes: { hp: -6, tempHp: -2, stamina: -1, shieldHp: -4 },
      nativeChatMessageUuid: "ChatMessage.damage-taken",
    });
    expect(
      state.settingValues.get("damageApplications").entries[
        "ChatMessage.damage:0:Actor.target"
      ].status,
    ).toBe("applied");
  });

  it("blocks a duplicate after module reload and through another token for the same Actor", async () => {
    const choices = {
      messageUuid: state.message.uuid,
      targetTokenUuid: state.token.uuid,
      rollIndex: 0,
      operation: "damage" as const,
      multiplier: 1 as const,
      shieldBlock: false,
    };
    const preview = await handlePF2eInspectDamageApplication(
      choices,
      state.ctx,
    );
    // Reload the module cache: the duplicate record must live in world settings, not module memory.
    vi.resetModules();
    const handlerAfterReload = await import("../src/pf2e-damage-application");
    const result: any = await handlerAfterReload.handlePF2eApplyDamage(
      { ...choices, reviewToken: preview.reviewToken },
      state.ctx,
    );
    expect(result.ledgerStatus).toBe("applied");
    const linkedToken = {
      ...state.token,
      id: "linked",
      uuid: "Scene.scene.Token.linked",
    };
    state.scene.tokens.set(linkedToken.id, linkedToken);
    (state.ctx.resolve as any).mockImplementation(async (uuid: string) =>
      uuid === linkedToken.uuid
        ? linkedToken
        : uuid === state.message.uuid
          ? state.message
          : null,
    );
    const linkedArgs = { ...choices, targetTokenUuid: linkedToken.uuid };
    const linkedPreview = await handlePF2eInspectDamageApplication(
      linkedArgs,
      state.ctx,
    );
    await expect(
      handlerAfterReload.handlePF2eApplyDamage(
        { ...linkedArgs, reviewToken: linkedPreview.reviewToken },
        state.ctx,
      ),
    ).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
    // One application was the only operation that changed Actor health.
    expect(state.actor.system.attributes.hp.value).toBe(17);
  });
});
