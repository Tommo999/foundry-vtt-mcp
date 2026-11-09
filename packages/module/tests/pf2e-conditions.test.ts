import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eConditions } from "../src/pf2e-conditions";
import { resolvePF2eActor } from "../src/pf2e-target";
import type { PF2eContext } from "../src/pf2e-context";
let ctx: PF2eContext, actor: any, target: any, manager: any, existing: any;
const sourcePack = { collection: "pf2e.effects", metadata: { system: "pf2e" } };
beforeEach(() => {
  actor = {
    documentName: "Actor",
    type: "character",
    id: "pc",
    uuid: "Actor.pc",
    name: "Mira",
    items: new Map(),
    conditions: { contents: [] },
    itemTypes: { effect: [] },
    getCondition: vi.fn(),
    increaseCondition: vi.fn(),
    decreaseCondition: vi.fn(),
    createEmbeddedDocuments: vi.fn(async (_type: string, data: any[]) =>
      data.map((d, i) => {
        const created = {
          ...d,
          id: `new${i}`,
          uuid: `Actor.pc.Item.new${i}`,
          documentName: "Item",
          parent: actor,
        };
        actor.items.set(created.id, created);
        return created;
      }),
    ),
  };
  target = actor;
  manager = {
    getCondition: vi.fn((slug: string) =>
      slug === "bogus"
        ? null
        : { slug, toObject: () => ({ system: { value: { value: 3 } } }) },
    ),
    updateConditionValue: vi.fn(
      async (_id: string, _actor: any, value: number) => {
        existing.value = Math.min(value, 3);
      },
    ),
  };
  existing = {
    documentName: "Item",
    type: "condition",
    id: "frightened",
    uuid: "Actor.pc.Item.frightened",
    slug: "frightened",
    name: "Frightened",
    value: 2,
    active: true,
    parent: actor,
    actor,
    system: { value: { value: 2 } },
    flags: {},
  };
  actor.conditions.contents = [existing];
  actor.items = new Map([["frightened", existing]]);
  actor.getCondition.mockImplementation((slug: string, options?: any) =>
    options?.all
      ? existing.slug === slug
        ? [existing]
        : []
      : existing.slug === slug
        ? existing
        : null,
  );
  ctx = {
    game: {
      system: { id: "pf2e" },
      pf2e: { ConditionManager: manager },
      settings: { get: () => true },
      actors: { get: (id: string) => (id === "pc" ? actor : null) },
      scenes: { get: () => null },
      packs: {
        get: (id: string) => (id === "pf2e.effects" ? sourcePack : null),
      },
      items: {
        fromCompendium: vi.fn(async (source: any) => ({
          ...source.toObject(),
          _id: "source-id",
          folder: "pack",
          ownership: { default: 0 },
          flags: { pf2e: { trusted: true } },
        })),
      },
    },
    resolve: vi.fn(async (uuid: string) =>
      uuid === actor.uuid ? actor : uuid === existing.uuid ? existing : null,
    ),
    assertWrite: vi.fn(),
    serialize: (d: any) => d,
  };
});

describe("PF2e conditions, effects, and targets", () => {
  it("resolves only root world actors and supports explicit linked or unlinked token UUIDs", async () => {
    expect(await resolvePF2eActor(ctx, actor.uuid)).toBe(actor);
    const tokenActor = {
      ...actor,
      id: "synthetic",
      uuid: "Actor.synthetic",
      parent: null,
    };
    const scene = {
      documentName: "Scene",
      id: "s",
      uuid: "Scene.s",
      tokens: new Map(),
    };
    const token = {
      documentName: "Token",
      id: "t",
      uuid: "Scene.s.Token.t",
      parent: scene,
      actor: tokenActor,
    };
    (ctx.game.scenes as any).get = () => scene;
    (ctx.resolve as any).mockResolvedValue(token);
    expect(
      await resolvePF2eActor(ctx, token.uuid, { creatureOnly: true }),
    ).toBe(tokenActor);
  });
  it("rejects synthetic Actor UUIDs and compendium targets", async () => {
    const synthetic = { ...actor, parent: { documentName: "Token" } };
    (ctx.resolve as any).mockResolvedValue(synthetic);
    await expect(resolvePF2eActor(ctx, synthetic.uuid)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    (ctx.resolve as any).mockResolvedValue({ ...actor, compendium: {} });
    await expect(resolvePF2eActor(ctx, actor.uuid)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
  it("inspects bounded current conditions and effects without mutation", async () => {
    actor.itemTypes.effect = Array.from({ length: 101 }, (_, i) => ({
      id: String(i),
      uuid: `Item.${i}`,
      name: "Blessing",
      type: "effect",
      active: true,
      isExpired: i === 0,
      remainingDuration: { remaining: i === 0 ? 0 : 2 },
      system: { duration: { value: 1, unit: "rounds" } },
    }));
    const data: any = await handlePF2eConditions(
      "pf2e_inspect_conditions",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(data.conditions.items[0]).toMatchObject({
      slug: "frightened",
      value: 2,
      active: true,
    });
    expect(data.effects.items).toHaveLength(100);
    expect(data.effects.items[0]).toMatchObject({
      active: false,
      expired: true,
      remainingDuration: 0,
    });
    expect(data.effects.truncated).toBe(true);
    expect(ctx.assertWrite).not.toHaveBeenCalled();
  });
  it("sets an exact valued condition through the native manager and respects native caps", async () => {
    const data: any = await handlePF2eConditions(
      "pf2e_set_condition",
      { targetUuid: actor.uuid, slug: "frightened", value: 5 },
      ctx,
    );
    expect(manager.updateConditionValue).toHaveBeenCalledWith(
      "frightened",
      actor,
      5,
    );
    expect(data.condition.value).toBe(3);
    expect(actor.increaseCondition).not.toHaveBeenCalled();
    expect(ctx.assertWrite).toHaveBeenCalledOnce();
  });
  it("creates a new condition through Actor.increaseCondition with requested initial value", async () => {
    actor.conditions.contents = [];
    actor.getCondition.mockReturnValue(null);
    actor.increaseCondition.mockImplementation(
      async (slug: string, options: any) => {
        const created = {
          id: "new",
          uuid: "Actor.pc.Item.new",
          slug,
          value: options.value,
          active: true,
          system: { value: { value: options.value } },
        };
        actor.conditions.contents.push(created);
        actor.getCondition.mockImplementation((query: string, opts?: any) =>
          opts?.all
            ? query === slug
              ? [created]
              : []
            : query === slug
              ? created
              : null,
        );
        return created;
      },
    );
    const result: any = await handlePF2eConditions(
      "pf2e_set_condition",
      { targetUuid: actor.uuid, slug: "clumsy", value: 2 },
      ctx,
    );
    expect(actor.increaseCondition).toHaveBeenCalledWith("clumsy", {
      value: 2,
      max: 2,
    });
    expect(result.changed).toBe(true);
  });
  it("rejects valued writes to unvalued, locked, and persistent damage conditions", async () => {
    manager.getCondition.mockReturnValue({
      slug: "prone",
      toObject: () => ({ system: { value: { value: null } } }),
    });
    await expect(
      handlePF2eConditions(
        "pf2e_set_condition",
        { targetUuid: actor.uuid, slug: "prone", value: 2 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    existing.value = null;
    existing.system.value.value = null;
    const noChange: any = await handlePF2eConditions(
      "pf2e_adjust_condition",
      {
        targetUuid: actor.uuid,
        conditionUuid: existing.uuid,
        operation: "increase",
      },
      ctx,
    );
    expect(noChange.changed).toBe(false);
    expect(actor.increaseCondition).not.toHaveBeenCalled();
    existing.value = 2;
    existing.system.value.value = 2;
    existing.isLocked = true;
    await expect(
      handlePF2eConditions(
        "pf2e_adjust_condition",
        {
          targetUuid: actor.uuid,
          conditionUuid: existing.uuid,
          operation: "decrease",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_READ_ONLY" });
    existing.isLocked = false;
    existing.slug = "persistent-damage-fire";
    await expect(
      handlePF2eConditions(
        "pf2e_adjust_condition",
        {
          targetUuid: actor.uuid,
          conditionUuid: existing.uuid,
          operation: "decrease",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNSUPPORTED" });
    expect(actor.decreaseCondition).not.toHaveBeenCalled();
  });
  it("requires exact owned condition UUID and uses native adjustment/removal methods", async () => {
    await expect(
      handlePF2eConditions(
        "pf2e_adjust_condition",
        {
          targetUuid: actor.uuid,
          conditionUuid: "Item.other",
          operation: "remove",
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await handlePF2eConditions(
      "pf2e_adjust_condition",
      {
        targetUuid: actor.uuid,
        conditionUuid: existing.uuid,
        operation: "increase",
      },
      ctx,
    );
    expect(actor.increaseCondition).toHaveBeenCalledWith(existing);
    await handlePF2eConditions(
      "pf2e_adjust_condition",
      {
        targetUuid: actor.uuid,
        conditionUuid: existing.uuid,
        operation: "remove",
      },
      ctx,
    );
    expect(actor.decreaseCondition).toHaveBeenCalledWith(existing, {
      forceRemove: true,
    });
  });
  it("rechecks GM authorization after target resolution and reports ambiguous native failures", async () => {
    ctx.assertWrite = vi.fn(() => {
      throw new Error("authorization revoked");
    });
    await expect(
      handlePF2eConditions(
        "pf2e_adjust_condition",
        {
          targetUuid: actor.uuid,
          conditionUuid: existing.uuid,
          operation: "increase",
        },
        ctx,
      ),
    ).rejects.toThrow("authorization revoked");
    expect(actor.increaseCondition).not.toHaveBeenCalled();
    ctx.assertWrite = vi.fn();
    actor.increaseCondition.mockRejectedValue(new Error("connection lost"));
    await expect(
      handlePF2eConditions(
        "pf2e_set_condition",
        { targetUuid: actor.uuid, slug: "clumsy" },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: { outcomeUnknown: true, actorUuid: actor.uuid },
    });
  });
  it("imports only compendium effects through PF2e conversion and creates a fresh owned item", async () => {
    const source = {
      documentName: "Item",
      type: "effect",
      id: "pack-id",
      uuid: "Compendium.pf2e.effects.Item.blessing",
      compendium: sourcePack,
      pack: "pf2e.effects",
      parent: null,
      system: { start: { value: 10 }, duration: { value: 1 } },
      toObject() {
        return {
          _id: "pack-id",
          type: "effect",
          system: { start: { value: 10 }, duration: { value: 1 } },
        };
      },
    };
    (ctx.resolve as any)
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(source);
    const result: any = await handlePF2eConditions(
      "pf2e_apply_effect",
      { targetUuid: actor.uuid, uuid: source.uuid },
      ctx,
    );
    expect(ctx.game.items.fromCompendium).toHaveBeenCalledWith(source, {
      keepId: false,
      clearOwnership: true,
      clearFolder: true,
      clearSort: true,
      clearState: true,
    });
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith(
      "Item",
      [
        expect.objectContaining({
          type: "effect",
          system: { duration: { value: 1 } },
        }),
      ],
      { keepId: false, keepEmbeddedIds: true },
    );
    expect(result.effects).toHaveLength(1);
    expect(source.system.start.value).toBe(10);
  });
  it("reports an ambiguous result when PF2e cancels effect creation", async () => {
    const source: any = {
      documentName: "Item",
      type: "effect",
      id: "pack-id",
      uuid: "Compendium.pf2e.effects.Item.cancel",
      compendium: sourcePack,
      pack: "pf2e.effects",
      parent: null,
      toObject: () => ({
        _id: "pack-id",
        type: "effect",
        system: { duration: { value: 1 } },
      }),
    };
    (ctx.resolve as any)
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(source);
    actor.createEmbeddedDocuments.mockResolvedValueOnce([]);
    await expect(
      handlePF2eConditions(
        "pf2e_apply_effect",
        { targetUuid: actor.uuid, uuid: source.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: { outcomeUnknown: true, operation: "apply effect" },
    });
  });

  it("rejects unrelated and restricted granted effects before deletion", async () => {
    const effect: any = {
      documentName: "Item",
      type: "effect",
      id: "e",
      uuid: "Actor.pc.Item.e",
      parent: actor,
      delete: vi.fn(),
    };
    (ctx.resolve as any)
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ ...effect, parent: { uuid: "Actor.other" } });
    await expect(
      handlePF2eConditions(
        "pf2e_remove_effect",
        { targetUuid: actor.uuid, effectUuid: effect.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const granter = {
      flags: {
        pf2e: { itemGrants: { grant: { id: "e", onDelete: "restrict" } } },
      },
    };
    actor.items.set("g", granter);
    effect.flags = { pf2e: { grantedBy: { id: "g" } } };
    actor.items.set("e", effect);
    (ctx.resolve as any)
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(effect);
    await expect(
      handlePF2eConditions(
        "pf2e_remove_effect",
        { targetUuid: actor.uuid, effectUuid: effect.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_READ_ONLY" });
    expect(effect.delete).not.toHaveBeenCalled();
    effect.flags = {
      pf2e: { itemGrants: { child: { id: "child", onDelete: "restrict" } } },
    };
    actor.items.set("e", effect);
    (ctx.resolve as any)
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(effect);
    await expect(
      handlePF2eConditions(
        "pf2e_remove_effect",
        { targetUuid: actor.uuid, effectUuid: effect.uuid },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_READ_ONLY" });
  });
});
