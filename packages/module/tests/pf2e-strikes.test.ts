import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eStrikes } from "../src/pf2e-strikes";
import type { PF2eContext } from "../src/pf2e-context";
import { describeStrikes } from "../src/pf2e-strikes";
import { handleEncounters } from "../src/encounters";

function collection(entries: any[] = []) {
  return {
    contents: entries,
    get(id: string) {
      return this.contents.find((entry: any) => entry.id === id) ?? null;
    },
    values() {
      return this.contents.values();
    },
    add(entry: any) {
      this.contents.push(entry);
      return entry;
    },
  };
}
function setup() {
  const handlers = new Map<number, Function>();
  let hookIndex = 0;
  const hooks: any = {
    on: vi.fn((_name: string, fn: Function) => {
      const id = ++hookIndex;
      handlers.set(id, fn);
      return id;
    }),
    off: vi.fn((_name: string, id: number) => handlers.delete(id)),
    emit: (name: string, value: any) => {
      if (name === "createChatMessage")
        for (const fn of handlers.values()) fn(value);
    },
  };
  vi.stubGlobal("Hooks", hooks);
  const scene: any = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    parent: null,
    compendium: null,
    tokens: collection(),
  };
  const targetActor: any = {
    id: "target-actor",
    uuid: "Actor.target",
    documentName: "Actor",
    type: "npc",
  };
  const attackerActor: any = {
    id: "attacker-actor",
    uuid: "Actor.attacker",
    documentName: "Actor",
    type: "character",
    system: { actions: [] },
    getActiveTokens: vi.fn(),
  };
  const target: any = {
    id: "target",
    uuid: "Scene.scene.Token.target",
    documentName: "Token",
    parent: scene,
    actor: targetActor,
    object: null,
  };
  const attacker: any = {
    id: "attacker",
    uuid: "Scene.scene.Token.attacker",
    documentName: "Token",
    parent: scene,
    actor: attackerActor,
    object: null,
  };
  target.object = { document: target };
  attacker.object = { document: attacker, controlled: true };
  attackerActor.getActiveTokens.mockReturnValue([attacker]);
  scene.tokens.add(attacker);
  scene.tokens.add(target);
  const entry: any = {
    id: "combatant",
    uuid: "Combat.combat.Combatant.combatant",
    documentName: "Combatant",
    parent: null,
    combat: null,
    token: attacker,
    actor: attackerActor,
  };
  const combat: any = {
    id: "combat",
    uuid: "Combat.combat",
    documentName: "Combat",
    parent: null,
    compendium: null,
    scene,
    started: true,
    active: true,
    round: 1,
    turn: 0,
    combatants: collection(),
    combatant: entry,
  };
  entry.parent = combat;
  entry.combat = combat;
  combat.combatants.add(entry);
  const messages: any = collection();
  const actors: any = collection([attackerActor, targetActor]);
  const scenes: any = collection([scene]);
  (scenes as any).current = scene;
  const combats: any = collection([combat]);
  const resolved = new Map<string, any>([
    [scene.uuid, scene],
    [attacker.uuid, attacker],
    [target.uuid, target],
    [combat.uuid, combat],
    [entry.uuid, entry],
  ]);
  const ctx: PF2eContext = {
    game: {
      system: { id: "pf2e" },
      pf2e: {},
      settings: { get: () => true },
      scenes,
      combats,
      actors,
      messages,
      combat,
      user: {
        id: "gm",
        settings: { showCheckDialogs: true, showDamageDialogs: true },
      },
    },
    resolve: vi.fn(async (uuid: string) => resolved.get(uuid) ?? null),
    assertWrite: vi.fn(),
    serialize: (doc: any) => doc,
  };
  const makeStrike = (opts: any = {}) => {
    const item: any = {
      id: "sword",
      uuid: "Actor.attacker.Item.sword",
      name: "Sword",
      actor: attackerActor,
      isOfType: (type: string) => type === "weapon",
      traits: new Set(opts.consumable ? ["consumable"] : []),
    };
    const variantRolls = [vi.fn(), vi.fn(), vi.fn()];
    const damage = vi.fn();
    const critical = vi.fn();
    const strike: any = {
      type: "strike",
      slug: "sword",
      label: "Sword",
      item,
      ready: opts.ready ?? true,
      canAttack: opts.canAttack ?? true,
      totalModifier: 12,
      traits: [{ name: "agile" }],
      variants: variantRolls.map((roll, i) => ({
        penalty: i ? -5 * i : 0,
        label: `Attack ${i + 1}`,
        roll,
      })),
      damage,
      critical,
    };
    attackerActor.system.actions = [
      { type: "action", slug: "raise-shield" },
      strike,
    ];
    return { strike, item, variantRolls, damage, critical };
  };
  function nativeRoll(total: number, degree = 2) {
    const json: any = {
      formula: "1d20+12",
      total,
      options: { degreeOfSuccess: degree },
      dice: [{ faces: 20, total: 14 }],
    };
    return { ...json, toJSON: () => json };
  }
  function message(
    type: "attack-roll" | "damage-roll",
    roll: any,
    item: any,
    overrides: any = {},
  ) {
    const damage = type === "damage-roll";
    const context: any = damage
      ? {
          type,
          sourceType: "attack",
          actor: attackerActor.id,
          token: attacker.id,
          messageMode: "gm",
          target: { actor: targetActor.uuid, token: target.uuid },
        }
      : {
          type,
          action: "strike",
          actor: attackerActor.id,
          token: attacker.id,
          messageMode: "gm",
          origin: { actor: attackerActor.uuid, token: attacker.uuid },
          target: { actor: targetActor.uuid, token: target.uuid },
        };
    const result: any = {
      id: `message-${messages.contents.length + 1}`,
      uuid: `ChatMessage.message-${messages.contents.length + 1}`,
      speaker: { actor: attackerActor.id, token: attacker.id, scene: scene.id },
      rolls: [{ toJSON: () => roll.toJSON() }],
      flags: {
        pf2e: {
          context,
          origin: { actor: attackerActor.uuid, uuid: item.uuid },
          target: { actor: targetActor.uuid, token: target.uuid },
        },
      },
      ...overrides,
    };
    messages.add(result);
    (globalThis as any).Hooks.emit("createChatMessage", result);
    return result;
  }
  function args(extra: any = {}) {
    return {
      encounterUuid: combat.uuid,
      attackerTokenUuid: attacker.uuid,
      targetTokenUuid: target.uuid,
      strikeIndex: 1,
      strikeSlug: "sword",
      strikeItemUuid: "Actor.attacker.Item.sword",
      expectedRound: 1,
      expectedTurn: 0,
      expectedCombatantUuid: entry.uuid,
      attackNumber: 1,
      ...extra,
    };
  }
  return {
    ctx,
    scene,
    attackerActor,
    targetActor,
    attacker,
    target,
    combat,
    entry,
    messages,
    resolved,
    makeStrike,
    nativeRoll,
    message,
    args,
    hooks,
    handlers,
  };
}

let env: ReturnType<typeof setup>;
beforeEach(() => {
  vi.unstubAllGlobals();
  env = setup();
});

describe("PF2e native strike and damage tools", () => {
  it("describes stable native strike indices, variants and unsupported consumables", async () => {
    const { strike } = env.makeStrike({ consumable: true });
    const result: any = describeStrikes(env.attackerActor);
    expect(result).toMatchObject({
      total: 1,
      items: [
        {
          index: 1,
          type: "strike",
          slug: "sword",
          itemUuid: strike.item.uuid,
          modifier: 12,
          consumableWeapon: true,
          rollAvailable: false,
          damageAvailable: true,
          variants: [
            { attackNumber: 1, penalty: 0 },
            { attackNumber: 2, penalty: -5 },
            { attackNumber: 3, penalty: -10 },
          ],
        },
      ],
    });
  });

  it.each([1, 2, 3])(
    "rolls the selected native attack variant %i against explicit tokens in GM mode",
    async (attackNumber) => {
      const { strike, variantRolls } = env.makeStrike();
      const roll = env.nativeRoll(19);
      variantRolls[attackNumber - 1].mockImplementation(
        async (options: any) => {
          expect(options.target).toBe(env.target.object);
          expect(options.consumeAmmo).toBe(false);
          expect(options.createMessage).toBe(true);
          expect(options.event.ctrlKey).toBe(true);
          expect(options.event.shiftKey).toBe(true);
          env.message("attack-roll", roll, strike.item);
          options.callback?.(roll);
          return roll;
        },
      );
      const result: any = await handlePF2eStrikes(
        "pf2e_roll_strike" as any,
        env.args({ attackNumber }),
        env.ctx,
      );
      expect(result).toMatchObject({
        total: 19,
        d20: 14,
        degreeOfSuccess: "success",
        attackNumber,
        chatMessageUuid: "ChatMessage.message-1",
      });
      expect(variantRolls[attackNumber - 1]).toHaveBeenCalledOnce();
      expect(env.ctx.assertWrite).toHaveBeenCalled();
      expect(env.hooks.off).toHaveBeenCalledOnce();
    },
  );

  it("rolls normal or critical damage natively without applying HP or changing target selection", async () => {
    const { strike } = env.makeStrike();
    const targetState = { hp: 20 };
    env.targetActor.system = { attributes: { hp: targetState } };
    const existingTargets = new Set([env.target]);
    (env.ctx.game.user as any).targets = existingTargets;
    const roll: any = {
      total: 17,
      formula: "2d6+4",
      instances: [{ type: "slashing", category: "physical", total: 17 }],
      toJSON: () => ({ total: 17, formula: "2d6+4" }),
    };
    strike.critical.mockImplementation(async (options: any) => {
      expect(options.target).toBe(env.target.object);
      expect(options.mapIncreases).toBe(1);
      expect(options.event.ctrlKey).toBe(true);
      expect(options.event.shiftKey).toBe(true);
      env.message("damage-roll", roll, strike.item);
      options.callback?.(roll);
      return roll;
    });
    const result: any = await handlePF2eStrikes(
      "pf2e_roll_damage" as any,
      env.args({ critical: true, attackNumber: 2 }),
      env.ctx,
    );
    expect(result).toMatchObject({
      critical: true,
      attackNumber: 2,
      total: 17,
      damage: [{ type: "slashing", total: 17 }],
      chatMessageUuid: "ChatMessage.message-1",
    });
    expect(strike.critical).toHaveBeenCalledOnce();
    expect(strike.damage).not.toHaveBeenCalled();
    expect(targetState.hp).toBe(20);
    expect((env.ctx.game.user as any).targets).toBe(existingTargets);
    const normal = {
      total: 8,
      formula: "2d6+4",
      instances: [{ type: "slashing", category: "physical", total: 8 }],
      toJSON: () => ({ total: 8, formula: "2d6+4" }),
    };
    strike.damage.mockImplementationOnce(async (options: any) => {
      expect(options.target).toBe(env.target.object);
      env.message("damage-roll", normal, strike.item);
      options.callback?.(normal);
      return normal;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_damage" as any, env.args(), env.ctx),
    ).resolves.toMatchObject({
      critical: false,
      total: 8,
      chatMessageUuid: "ChatMessage.message-2",
    });
    expect(strike.damage).toHaveBeenCalledOnce();
    expect((env.ctx.game.user as any).targets).toBe(existingTargets);
  });

  it("rejects stale strike selections, invalid attack numbers, and consumable weapons before rolling", async () => {
    const { variantRolls } = env.makeStrike({ consumable: true });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "CONSUMABLE_WEAPON_UNSUPPORTED" });
    expect(variantRolls[0]).not.toHaveBeenCalled();
    await expect(
      handlePF2eStrikes(
        "pf2e_roll_strike" as any,
        env.args({ strikeItemUuid: "Actor.attacker.Item.changed" }),
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "STALE_STRIKE" });
    const clean = env.makeStrike();
    await expect(
      handlePF2eStrikes(
        "pf2e_roll_strike" as any,
        env.args({ attackNumber: 4 }),
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "STRIKE_UNAVAILABLE" });
    expect(clean.variantRolls[0]).not.toHaveBeenCalled();
  });

  it("rejects wrong current turn, token, scene, native attacker choice and unready strikes", async () => {
    env.makeStrike();
    await expect(
      handlePF2eStrikes(
        "pf2e_roll_strike" as any,
        env.args({ expectedTurn: 1 }),
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "STALE_TURN" });
    const alternate: any = {
      ...env.attacker,
      id: "alternate",
      uuid: "Scene.scene.Token.alternate",
      object: { controlled: true },
    };
    env.attackerActor.getActiveTokens.mockReturnValue([
      alternate,
      env.attacker,
    ]);
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_ATTACKER_TOKEN" });
    env.attackerActor.getActiveTokens.mockReturnValue([env.attacker]);
    env.makeStrike({ ready: false });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "STRIKE_UNAVAILABLE" });
    const secondScene: any = {
      ...env.scene,
      id: "other",
      uuid: "Scene.other",
      tokens: collection(),
    };
    env.target.parent = secondScene;
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rechecks settings and write approval immediately before native rolls", async () => {
    const { variantRolls } = env.makeStrike();
    env.ctx.assertWrite = vi.fn(() => {
      throw Object.assign(new Error("revoked"), { code: "SESSION_CHANGED" });
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(variantRolls[0]).not.toHaveBeenCalled();
    env.ctx.assertWrite = vi.fn();
    env.ctx.game.settings.get = () => false;
    await expect(
      handlePF2eStrikes("pf2e_roll_damage" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
  });

  it("reports native cancellation only when no matching message was created", async () => {
    const { variantRolls } = env.makeStrike();
    variantRolls[0].mockResolvedValue(null);
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).resolves.toMatchObject({ cancelled: true });
    variantRolls[0].mockImplementationOnce(async () => {
      env.message(
        "attack-roll",
        env.nativeRoll(9),
        env.attackerActor.system.actions[1].item,
      );
      return null;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
  });

  it("preserves known chat and result information after a native error or changed turn", async () => {
    const { strike, variantRolls } = env.makeStrike();
    const roll = env.nativeRoll(21);
    variantRolls[0].mockImplementationOnce(async () => {
      env.message("attack-roll", roll, strike.item);
      throw new Error("native interruption");
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        observedTotal: 21,
        chatMessageUuids: ["ChatMessage.message-1"],
      },
    });
    variantRolls[0].mockImplementationOnce(async () => {
      env.message("attack-roll", roll, strike.item);
      env.combat.turn = 1;
      return roll;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { total: 21, chatMessageUuid: "ChatMessage.message-2" },
    });
  });

  it("supports NPC native rolls that omit a callback and verifies their GM chat message", async () => {
    const { strike, variantRolls } = env.makeStrike();
    env.attackerActor.type = "npc";
    const roll = env.nativeRoll(16);
    variantRolls[0].mockImplementationOnce(async (options: any) => {
      expect(options.event.ctrlKey).toBe(true);
      env.message("attack-roll", roll, strike.item);
      return roll;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).resolves.toMatchObject({
      total: 16,
      chatMessageUuid: "ChatMessage.message-1",
    });
  });

  it("serializes strike rolls and turn advancement on the shared encounter lock", async () => {
    const { strike, variantRolls } = env.makeStrike();
    const roll = env.nativeRoll(20);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reachedNative = new Promise<void>((resolve) => {
      entered = resolve;
    });
    variantRolls[0].mockImplementationOnce(async () => {
      entered();
      await barrier;
      env.message("attack-roll", roll, strike.item);
      return roll;
    });
    const strikePromise = handlePF2eStrikes(
      "pf2e_roll_strike" as any,
      env.args(),
      env.ctx,
    );
    await reachedNative;
    env.combat.nextTurn = vi.fn(async () => {
      env.combat.turn = 1;
      return env.combat;
    });
    const turnPromise = handleEncounters(
      "next_turn",
      {
        encounterUuid: env.combat.uuid,
        expectedRound: 1,
        expectedTurn: 0,
        expectedCombatantUuid: env.entry.uuid,
      },
      env.ctx as any,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(env.combat.nextTurn).not.toHaveBeenCalled();
    release();
    await expect(strikePromise).resolves.toMatchObject({ total: 20 });
    await expect(turnPromise).resolves.toMatchObject({ round: 1, turn: 1 });
    expect(env.combat.nextTurn).toHaveBeenCalledOnce();
  });

  it("keeps immutable message identity when the target changes after chat is posted", async () => {
    const { strike, variantRolls } = env.makeStrike();
    const roll = env.nativeRoll(11);
    variantRolls[0].mockImplementationOnce(async () => {
      env.message("attack-roll", roll, strike.item);
      env.target.actor = null;
      env.combat.turn = 1;
      return roll;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { total: 11, chatMessageUuid: "ChatMessage.message-1" },
    });
  });

  it("rejects an ambiguous chat correlation even when multiple exact native messages were created", async () => {
    const { strike, variantRolls } = env.makeStrike();
    const roll = env.nativeRoll(21);
    variantRolls[0].mockImplementation(async () => {
      env.message("attack-roll", roll, strike.item);
      env.message("attack-roll", roll, strike.item);
      return roll;
    });
    await expect(
      handlePF2eStrikes("pf2e_roll_strike" as any, env.args(), env.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        chatMessageUuids: ["ChatMessage.message-1", "ChatMessage.message-2"],
      },
    });
  });
});
