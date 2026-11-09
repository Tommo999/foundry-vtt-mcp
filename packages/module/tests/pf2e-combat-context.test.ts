import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eCombatContext } from "../src/pf2e-combat-context";
import type { PF2eContext } from "../src/pf2e-context";

const strikes = vi.hoisted(() => ({ describe: vi.fn() }));
const conditions = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock("../src/pf2e-strikes", () => ({
  describeStrikes: strikes.describe,
}));
vi.mock("../src/pf2e-conditions", () => ({
  handlePF2eConditions: conditions.inspect,
}));

let ctx: PF2eContext;
let scene: any;
let combat: any;
let tokenA: any;
let tokenB: any;
let actorA: any;
let actorB: any;
let combatant: any;
let resolved: Map<string, any>;

function actor(id: string, name: string) {
  return {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type: "character",
    name,
    system: {
      details: { level: { value: 3 } },
      attributes: { ac: { value: 19 }, hp: { value: 25 } },
    },
    getActiveTokens: vi.fn(() => []),
  };
}
function token(id: string, owner: any) {
  return {
    id,
    uuid: `Scene.s.Token.${id}`,
    documentName: "Token",
    name: owner.name,
    actor: owner,
    parent: scene,
    x: 100,
    y: 200,
    elevation: 0,
    hidden: false,
    object: null,
  };
}
function makeContext() {
  scene = {
    id: "s",
    uuid: "Scene.s",
    documentName: "Scene",
    compendium: null,
    parent: null,
    name: "Hall",
    tokens: new Map(),
  };
  actorA = actor("a", "Mira");
  actorB = actor("b", "Guard");
  tokenA = token("a", actorA);
  tokenB = token("b", actorB);
  scene.tokens.set(tokenA.id, tokenA);
  scene.tokens.set(tokenB.id, tokenB);
  combat = {
    id: "c",
    uuid: "Combat.c",
    documentName: "Combat",
    compendium: null,
    parent: null,
    scene,
    name: "Hall fight",
    active: true,
    started: true,
    round: 2,
    turn: 0,
    combatants: new Map(),
    combatant: null,
  };
  combatant = {
    id: "ca",
    uuid: "Combat.c.Combatant.ca",
    documentName: "Combatant",
    parent: combat,
    actor: actorA,
    token: tokenA,
  };
  combat.combatants.set(combatant.id, combatant);
  combat.combatant = combatant;
  resolved = new Map([
    [combat.uuid, combat],
    [scene.uuid, scene],
    [tokenA.uuid, tokenA],
    [tokenB.uuid, tokenB],
  ]);
  ctx = {
    game: {
      system: { id: "pf2e" },
      pf2e: {},
      settings: { get: () => true },
      combats: new Map([[combat.id, combat]]),
      scenes: Object.assign(new Map([[scene.id, scene]]), { current: scene }),
      combat,
    },
    resolve: vi.fn(async (uuid: string) => resolved.get(uuid) ?? null),
    assertWrite: vi.fn(),
    serialize: (doc: any) => doc,
  };
  strikes.describe.mockReset().mockReturnValue({
    total: 1,
    truncated: false,
    items: [{ index: 0, slug: "sword", label: "Longsword" }],
  });
  conditions.inspect.mockReset().mockResolvedValue({
    conditions: { total: 0, truncated: false, items: [] },
    effects: { total: 0, truncated: false, items: [] },
  });
}

describe("read-only PF2e combat context", () => {
  beforeEach(makeContext);

  it("summarizes the active combatant, strikes, expected turn, and scene tokens", async () => {
    actorA.getActiveTokens.mockReturnValue([tokenA]);
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid, offset: 0, limit: 25 },
      ctx,
    );
    expect(result).toMatchObject({
      readOnly: true,
      executable: false,
      encounter: {
        round: 2,
        turn: 0,
        expectedRound: 2,
        expectedTurn: 0,
        expectedCombatantUuid: combatant.uuid,
      },
      scene: {
        viewed: true,
        tokens: {
          total: 2,
          items: [{ uuid: tokenA.uuid }, { uuid: tokenB.uuid }],
        },
      },
      attacker: {
        tokenUuid: tokenA.uuid,
        nativeAttackerMatches: true,
        strikes: { total: 1 },
      },
    });
    expect(ctx.assertWrite).not.toHaveBeenCalled();
    expect(strikes.describe).toHaveBeenCalledWith(actorA);
  });

  it("accepts an explicit scene target and rejects a foreign or embedded target", async () => {
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid, targetTokenUuid: tokenB.uuid },
      ctx,
    );
    expect(result.target).toMatchObject({
      tokenUuid: tokenB.uuid,
      actor: { name: actorB.name, ac: 19, token: { uuid: tokenB.uuid } },
    });
    resolved.set("Scene.other.Token.x", {
      ...tokenB,
      uuid: "Scene.other.Token.x",
    });
    await expect(
      handlePF2eCombatContext(
        { encounterUuid: combat.uuid, targetTokenUuid: "Scene.other.Token.x" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects compendium and foreign combats", async () => {
    resolved.set("Compendium.pack.Combat.c", {
      ...combat,
      uuid: "Compendium.pack.Combat.c",
      compendium: {},
    });
    await expect(
      handlePF2eCombatContext(
        { encounterUuid: "Compendium.pack.Combat.c" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_ENCOUNTER" });
    resolved.set("Combat.foreign", { ...combat, uuid: "Combat.foreign" });
    await expect(
      handlePF2eCombatContext({ encounterUuid: "Combat.foreign" }, ctx),
    ).rejects.toMatchObject({ code: "INVALID_ENCOUNTER" });
  });

  it("handles no current combatant and no actor without choosing a global token", async () => {
    combat.combatant = null;
    ctx.game.combat = null;
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid },
      ctx,
    );
    expect(result.encounter.currentCombatantUuid).toBeNull();
    expect(result.encounter.expectedCombatantUuid).toBeUndefined();
    expect(result.attacker.actor).toBeNull();
    expect(result.attacker.strikes.items).toEqual([]);
    expect(result.warnings).toContain(
      "The encounter has no current combatant.",
    );
  });

  it("paginates scene tokens and reports an unrendered token and native token mismatch", async () => {
    actorA.getActiveTokens.mockReturnValue([tokenB]);
    for (let i = 0; i < 110; i++) {
      const extra = token(`e${i}`, actorB);
      extra.uuid = `Scene.s.Token.e${i}`;
      scene.tokens.set(extra.id, extra);
    }
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid, offset: 100, limit: 100 },
      ctx,
    );
    expect(result.scene.tokens.items).toHaveLength(12);
    expect(result.scene.tokens.truncated).toBe(false);
    expect(result.attacker.nativeAttackerMatches).toBe(false);
    expect(result.warnings).toContain(
      "PF2e may use a different active token for this Actor; verify the token context before rolling.",
    );
  });

  it("caps conditions and effects projected from native PF2e inspection", async () => {
    const conditionRows = Array.from({ length: 25 }, (_, i) => ({
      uuid: `Actor.a.Item.c${i}`,
      name: `Condition ${i}`,
      slug: `condition-${i}`,
      value: i,
    }));
    conditions.inspect.mockResolvedValue({
      conditions: { total: 25, truncated: false, items: conditionRows },
      effects: { total: 25, truncated: false, items: conditionRows },
    });
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid, targetTokenUuid: tokenB.uuid },
      ctx,
    );
    expect(result.attacker.actor.conditions.items).toHaveLength(20);
    expect(result.attacker.actor.conditions.truncated).toBe(true);
    expect(result.target.actor.effects.items).toHaveLength(20);
  });

  it("does not advertise a familiar's unsupported prepared strikes", async () => {
    actorA.type = "familiar";
    actorA.getActiveTokens.mockReturnValue([tokenA]);
    const result: any = await handlePF2eCombatContext(
      { encounterUuid: combat.uuid },
      ctx,
    );
    expect(result.attacker.actor.type).toBe("familiar");
    expect(result.attacker.strikes.items).toEqual([]);
    expect(strikes.describe).not.toHaveBeenCalled();
    expect(result.warnings).toContain(
      "The current Actor type does not expose PF2e creature strikes.",
    );
  });
});
