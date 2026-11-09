import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPreparedDamageCurrent,
  handlePF2eInspectDamageApplication,
  prepareDamageApplication,
} from "../src/pf2e-damage-context";
import type { PF2eContext } from "../src/pf2e-context";

class DamageRoll {
  _evaluated = true;
  options: any = { degreeOfSuccess: 2 };
  instances = [
    {
      type: "slashing",
      category: "physical",
      materials: [],
      traits: ["magical"],
    },
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

let ctx: PF2eContext;
let actor: any;
let message: any;
let token: any;
let scene: any;
let roll: DamageRoll;
let sourceActor: any;
let shield: any;
let resolved: Map<string, any>;

function makeActor(id: string): any {
  return {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type: "character",
    name: "Target",
    system: {
      attributes: {
        hp: { value: 23, max: 30, temp: 2, sp: { value: 4, max: 6 } },
        shield: { itemId: null, raised: false },
      },
      traits: { immunity: [], weakness: [], resistance: [] },
    },
    items: new Map(),
    synthetics: { ephemeralEffects: { "damage-received": { target: [] } } },
    getSelfRollOptions: vi.fn((domain?: string) =>
      domain === "target" ? ["target:trait:living"] : ["self:actor:character"],
    ),
    getRollOptions: vi.fn(() => ["self:actor:npc"]),
    getContextualClone: vi.fn(function (this: any) {
      const clone = makeActor(id);
      clone.system = JSON.parse(JSON.stringify(this.system));
      clone.toObject = this.toObject;
      clone.heldShield = this.heldShield;
      return clone;
    }),
    applyDamage: vi.fn(),
    toObject() {
      return { _id: id, type: "character", system: this.system, items: [] };
    },
  };
}
function setup() {
  (globalThis as any).CONFIG = { Dice: { rolls: [DamageRoll] } };
  scene = {
    id: "s",
    uuid: "Scene.s",
    documentName: "Scene",
    parent: null,
    compendium: null,
    tokens: new Map(),
  };
  actor = makeActor("target");
  token = {
    id: "t",
    uuid: "Scene.s.Token.t",
    documentName: "Token",
    parent: scene,
    actor,
    compendium: null,
  };
  scene.tokens.set(token.id, token);
  sourceActor = makeActor("source");
  sourceActor.type = "npc";
  sourceActor.name = "Attacker";
  roll = new DamageRoll();
  message = {
    id: "m",
    uuid: "ChatMessage.m",
    documentName: "ChatMessage",
    parent: null,
    compendium: null,
    rolls: [roll],
    actor: sourceActor,
    item: null,
    flags: {
      pf2e: {
        context: {
          type: "damage-roll",
          options: [
            "self:source:spell",
            "self:actor:npc",
            "origin:effect:bless",
          ],
        },
      },
    },
  };
  const scenes: any = new Map([[scene.id, scene]]);
  const messages: any = new Map([[message.id, message]]);
  resolved = new Map([
    [token.uuid, token],
    [message.uuid, message],
  ]);
  ctx = {
    game: {
      world: { id: "world" },
      time: { worldTime: 600 },
      system: { id: "pf2e" },
      pf2e: { settings: { iwr: true, variants: { stamina: true } } },
      settings: {
        get: vi.fn((_scope: string, key: string) =>
          key === "pf2eEnabled"
            ? true
            : key === "automation.actorsDeadAtZero"
              ? true
              : null,
        ),
      },
      scenes,
      messages,
    },
    resolve: vi.fn(async (uuid: string) => resolved.get(uuid) ?? null),
    assertWrite: vi.fn(),
    serialize: (doc: any) => doc,
  };
}

describe("PF2e damage application inspection context", () => {
  beforeEach(setup);

  it("clones a registered evaluated DamageRoll and builds native context without mutating chat source", async () => {
    const result = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid, multiplier: 2 },
      ctx,
    );
    expect(roll.total).toBe(12);
    expect(result.nativeDamage).toBeInstanceOf(DamageRoll);
    expect(result.nativeDamage.total).toBe(24);
    expect(result.nativeRollOptions).toContain("origin:actor:npc");
    expect(result.nativeRollOptions).not.toContain("target:trait:living");
    expect(result.nativeRollOptions).not.toContain("self:source:spell");
    expect(result.applicationKey).toBe("ChatMessage.m:0:Actor.target");
    expect(result.reviewToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("previews healing as a negative native amount and reports no predicted final HP", async () => {
    const result: any = await handlePF2eInspectDamageApplication(
      {
        messageUuid: message.uuid,
        targetTokenUuid: token.uuid,
        operation: "healing",
        multiplier: 0.5,
      },
      ctx,
    );
    expect(result.readOnly).toBe(true);
    expect(result.source.operation).toBe("healing");
    expect(result.target.health.stamina).toEqual({ value: 4, max: 6 });
    expect(result.context.nativeIWR).toContain("does not predict final HP");
    const prepared = await prepareDamageApplication(
      {
        messageUuid: message.uuid,
        targetTokenUuid: token.uuid,
        operation: "healing",
        multiplier: 0.5,
      },
      ctx,
    );
    expect(prepared.nativeDamage).toBe(-6);
    expect(prepared.skipIWR).toBe(true);
  });

  it("requires explicit current physical raised shield for Shield Block", async () => {
    shield = {
      id: "sh",
      uuid: "Actor.target.Item.sh",
      documentName: "Item",
      name: "Steel Shield",
      system: { hp: { value: 20, max: 20, broken: false }, hardness: 5 },
      toObject() {
        return {};
      },
    };
    actor.heldShield = shield;
    actor.items.set(shield.id, shield);
    actor.system.attributes.shield = { itemId: shield.id, raised: true };
    await expect(
      prepareDamageApplication(
        {
          messageUuid: message.uuid,
          targetTokenUuid: token.uuid,
          shieldBlock: true,
          shieldItemUuid: shield.uuid,
        },
        ctx,
      ),
    ).resolves.toMatchObject({ shieldBlockRequest: true });
    await expect(
      prepareDamageApplication(
        {
          messageUuid: message.uuid,
          targetTokenUuid: token.uuid,
          shieldBlock: true,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    actor.system.attributes.shield.raised = false;
    await expect(
      prepareDamageApplication(
        {
          messageUuid: message.uuid,
          targetTokenUuid: token.uuid,
          shieldBlock: true,
          shieldItemUuid: shield.uuid,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_SHIELD" });
  });

  it("rejects wrong, foreign, unregistered, unevaluated, and oversized damage sources", async () => {
    await expect(
      prepareDamageApplication(
        {
          messageUuid: "Compendium.pack.ChatMessage.m",
          targetTokenUuid: token.uuid,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DAMAGE_SOURCE" });
    const foreign = {
      ...token,
      id: "foreign",
      uuid: "Scene.other.Token.foreign",
    };
    resolved.set(foreign.uuid, foreign);
    await expect(
      prepareDamageApplication(
        { messageUuid: message.uuid, targetTokenUuid: foreign.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    const original = message.rolls;
    message.rolls = [new (class DamageRoll {})()];
    await expect(
      prepareDamageApplication(
        { messageUuid: message.uuid, targetTokenUuid: token.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DAMAGE_SOURCE" });
    message.rolls = original;
    roll._evaluated = false;
    await expect(
      prepareDamageApplication(
        { messageUuid: message.uuid, targetTokenUuid: token.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DAMAGE_SOURCE" });
    roll._evaluated = true;
    roll.toJSON = (() => ({ huge: "x".repeat(200_001) })) as any;
    await expect(
      prepareDamageApplication(
        { messageUuid: message.uuid, targetTokenUuid: token.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DAMAGE_SOURCE" });
  });

  it("rejects overflow from damage multipliers before returning a prepared application", async () => {
    roll.total = Number.MAX_VALUE;
    await expect(
      prepareDamageApplication(
        {
          messageUuid: message.uuid,
          targetTokenUuid: token.uuid,
          multiplier: 2,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_DAMAGE_SOURCE" });
  });

  it("changes the review fingerprint when source, HP, IWR state, shield, or world time changes", async () => {
    const original = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    actor.system.traits.resistance = [{ type: "physical", value: 5 }];
    const iwrChanged = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    expect(iwrChanged.reviewToken).not.toBe(original.reviewToken);
    actor.system.attributes.hp.value -= 1;
    const hpChanged = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    expect(hpChanged.reviewToken).not.toBe(iwrChanged.reviewToken);
    roll.total += 1;
    const sourceChanged = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    expect(sourceChanged.reviewToken).not.toBe(hpChanged.reviewToken);
    ctx.game.time.worldTime += 6;
    const timeChanged = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    expect(timeChanged.reviewToken).not.toBe(sourceChanged.reviewToken);
  });

  it("keeps fingerprints stable across generated ephemeral IDs and accepts null callbacks", async () => {
    sourceActor.synthetics.ephemeralEffects["damage-received"].target = [
      vi.fn(async () => null),
      vi.fn(async () => ({
        type: "effect",
        _id: crypto.randomUUID(),
        system: { duration: {}, context: {} },
        toObject() {
          return {
            _id: crypto.randomUUID(),
            type: "effect",
            system: { duration: {}, context: {} },
          };
        },
      })),
    ];
    const first = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    const second = await prepareDamageApplication(
      { messageUuid: message.uuid, targetTokenUuid: token.uuid },
      ctx,
    );
    expect(first.reviewToken).toBe(second.reviewToken);
    expect(first.conditionalEffects).toHaveLength(1);
  });

  it("binds shield intent and rejects a replaced roll or removed scene", async () => {
    shield = {
      id: "sh",
      uuid: "Actor.target.Item.sh",
      documentName: "Item",
      name: "Steel Shield",
      system: { hp: { value: 20, max: 20 }, hardness: 5 },
      toObject() {
        return {};
      },
    };
    actor.heldShield = shield;
    actor.items.set(shield.id, shield);
    actor.system.attributes.shield = { itemId: shield.id, raised: true };
    const blocked = await prepareDamageApplication(
      {
        messageUuid: message.uuid,
        targetTokenUuid: token.uuid,
        shieldBlock: true,
        shieldItemUuid: shield.uuid,
      },
      ctx,
    );
    const unblocked = await prepareDamageApplication(
      {
        messageUuid: message.uuid,
        targetTokenUuid: token.uuid,
        shieldBlock: false,
      },
      ctx,
    );
    expect(blocked.reviewToken).not.toBe(unblocked.reviewToken);
    message.rolls[0] = new DamageRoll();
    expect(() => assertPreparedDamageCurrent(blocked, ctx)).toThrowError();
    message.rolls[0] = roll;
    scene.parent = { id: "world" };
    expect(() => assertPreparedDamageCurrent(blocked, ctx)).toThrowError();
  });
});
