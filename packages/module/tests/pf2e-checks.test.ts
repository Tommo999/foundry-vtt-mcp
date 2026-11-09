import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eChecks } from "../src/pf2e-checks";
import type { PF2eContext } from "../src/pf2e-context";

let ctx: PF2eContext;
let actor: any;
let token: any;
let athletics: any;
function statistic(label: string) {
  return { label, mod: 8, check: { mod: 8, roll: vi.fn() } };
}

beforeEach(() => {
  athletics = statistic("Athletics");
  actor = {
    documentName: "Actor",
    type: "character",
    id: "pc",
    uuid: "Actor.pc",
    name: "Mira",
    items: { contents: [] },
    system: { actions: [] },
    perception: statistic("Perception"),
    saves: { fortitude: statistic("Fortitude") },
    skills: { athletics, lore: statistic("Absalom Lore") },
    initiative: { mod: 7 },
  };
  const scene: any = {
    documentName: "Scene",
    id: "scene",
    uuid: "Scene.scene",
    compendium: false,
    parent: null,
    tokens: new Map(),
  };
  token = {
    documentName: "Token",
    id: "token",
    uuid: "Scene.scene.Token.token",
    actor,
    parent: scene,
  };
  scene.tokens.set(token.id, token);
  ctx = {
    game: {
      system: { id: "pf2e" },
      settings: {
        get: (_module: string, key: string) => key === "pf2eEnabled",
      },
      pf2e: {},
      actors: new Map([[actor.id, actor]]),
      scenes: new Map([[scene.id, scene]]),
    },
    resolve: vi.fn(async (uuid: string) =>
      uuid === actor.uuid ? actor : uuid === token.uuid ? token : null,
    ),
    assertWrite: vi.fn(),
    serialize: (doc: any) => doc,
  };
});

describe("PF2e check and action tools", () => {
  it("rolls the requested skill with a native dialog-free check and returns its bounded result", async () => {
    const roll = { total: 22, dice: [{ faces: 20, total: 14 }] };
    athletics.check.roll.mockImplementation(async (options: any) => {
      options.callback(roll, "success", { uuid: "ChatMessage.roll" });
      return roll;
    });
    const result: any = await handlePF2eChecks(
      "pf2e_roll_check",
      { targetUuid: actor.uuid, statistic: "athletics", dc: 20 },
      ctx,
    );
    expect(athletics.check.roll).toHaveBeenCalledWith(
      expect.objectContaining({
        token: null,
        dc: 20,
        skipDialog: true,
        createMessage: true,
        messageMode: "gm",
      }),
    );
    expect(result).toMatchObject({
      total: 22,
      d20: 14,
      degreeOfSuccess: "success",
      messageUuid: "ChatMessage.roll",
      tokenContext: "native-actor-context",
    });
    expect(ctx.assertWrite).toHaveBeenCalledOnce();
  });

  it("supports perception, saves, and lore while rejecting arbitrary statistic slugs", async () => {
    for (const [slug, selected] of [
      ["perception", actor.perception],
      ["fortitude", actor.saves.fortitude],
      ["lore", actor.skills.lore],
    ] as any) {
      selected.check.roll.mockResolvedValue({ total: 10, dice: [] });
      await handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: slug },
        ctx,
      );
      expect(selected.check.roll).toHaveBeenCalledOnce();
    }
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: "spell-attack" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "STATISTIC_UNAVAILABLE" });
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: "toString" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "STATISTIC_UNAVAILABLE" });
  });

  it("uses an explicit Scene Token and revalidates the target before rolling", async () => {
    athletics.check.roll.mockResolvedValue({ total: 12, dice: [] });
    await handlePF2eChecks(
      "pf2e_roll_check",
      { targetUuid: token.uuid, statistic: "athletics" },
      ctx,
    );
    expect(athletics.check.roll).toHaveBeenCalledWith(
      expect.objectContaining({ token }),
    );
    expect(ctx.resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects unresolved targets and disabled PF2e support", async () => {
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: "Actor.foreign", statistic: "athletics" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    ctx.game.settings.get = () => false;
    await expect(
      handlePF2eChecks(
        "pf2e_inspect_actions",
        { targetUuid: actor.uuid, offset: 0, limit: 25 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
  });

  it("rechecks write authorization after resolution and reports native cancellation", async () => {
    ctx.assertWrite = vi.fn(() => {
      throw Object.assign(new Error("revoked"), { code: "SESSION_CHANGED" });
    });
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: "athletics" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(athletics.check.roll).not.toHaveBeenCalled();
    ctx.assertWrite = vi.fn();
    athletics.check.roll.mockResolvedValue(null);
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: "athletics" },
        ctx,
      ),
    ).resolves.toMatchObject({ cancelled: true });
  });

  it("identifies an uncertain roll when PF2e throws after creating a chat message", async () => {
    athletics.check.roll.mockImplementation(async (options: any) => {
      options.callback({}, null, { uuid: "ChatMessage.partial" });
      throw new Error("interrupted");
    });
    await expect(
      handlePF2eChecks(
        "pf2e_roll_check",
        { targetUuid: actor.uuid, statistic: "athletics" },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: { messageUuid: "ChatMessage.partial", outcomeUnknown: true },
    });
  });

  it("returns bounded descriptive features and prepared strikes without executing them", async () => {
    const execute = vi.fn();
    actor.items.contents = Array.from({ length: 130 }, (_, index) => ({
      uuid: `Actor.pc.Item.${index}`,
      name: `Feat ${index}`,
      type: "feat",
      system: {
        actions: { value: 1 },
        traits: { value: ["attack"] },
        description: { value: "<script>private</script>" },
      },
    }));
    actor.system.actions = [
      {
        type: "strike",
        slug: "longsword",
        label: "Longsword",
        item: { uuid: "Actor.pc.Item.sword", name: "Longsword" },
        traits: [{ name: "magical" }],
        ready: true,
        canAttack: true,
        totalModifier: 9,
        variants: [{ label: "MAP -5", penalty: -5, roll: execute }],
        roll: execute,
        damage: execute,
      },
    ];
    const result: any = await handlePF2eChecks(
      "pf2e_inspect_actions",
      { targetUuid: actor.uuid, offset: 100, limit: 10 },
      ctx,
    );
    expect(result).toMatchObject({
      targetUuid: actor.uuid,
      actorUuid: actor.uuid,
      readOnly: true,
      executable: false,
      features: { total: 130, offset: 100, limit: 10 },
      strikes: {
        total: 1,
        items: [
          {
            label: "Longsword",
            modifier: 9,
            variants: [{ label: "MAP -5", penalty: -5 }],
          },
        ],
      },
    });
    expect(result.features.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Feat 100" })]),
    );
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "lore", available: true }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("<script>");
    expect(execute).not.toHaveBeenCalled();
    expect(ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("caps prepared strike output at 50 rows", async () => {
    actor.system.actions = Array.from({ length: 80 }, (_, index) => ({
      type: "strike",
      slug: `strike-${index}`,
      totalModifier: index,
      variants: [],
    }));
    const result: any = await handlePF2eChecks(
      "pf2e_inspect_actions",
      { targetUuid: actor.uuid, offset: 0, limit: 25 },
      ctx,
    );
    expect(result.strikes).toMatchObject({ total: 80, truncated: true });
    expect(result.strikes.items).toHaveLength(50);
  });

  it("paginates beyond 500 actor features and reports omitted check choices", async () => {
    actor.items.contents = Array.from({ length: 501 }, (_, index) => ({
      uuid: `Actor.pc.Item.${index}`,
      name: `Feat ${index}`,
      type: "feat",
      system: {},
    }));
    actor.skills = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `skill-${index}`,
        statistic(`Skill ${index}`),
      ]),
    );
    const result: any = await handlePF2eChecks(
      "pf2e_inspect_actions",
      { targetUuid: actor.uuid, offset: 500, limit: 10 },
      ctx,
    );
    expect(result.features).toMatchObject({
      total: 501,
      offset: 500,
      items: [{ name: "Feat 500" }],
      truncated: false,
    });
    expect(result.checksTotal).toBe(82);
    expect(result.checksTruncated).toBe(true);
    expect(result.checks).toHaveLength(52);
  });
});
