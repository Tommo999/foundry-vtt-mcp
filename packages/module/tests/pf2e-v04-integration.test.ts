import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ conditions: vi.fn(), inventory: vi.fn() }));
vi.mock("../src/pf2e-conditions", () => ({
  handlePF2eConditions: mocks.conditions,
}));
vi.mock("../src/pf2e-inventory", () => ({
  handlePF2eInventory: mocks.inventory,
}));

class MockApplicationV2 {
  render() {}
}
const hooks = { once: vi.fn(), on: vi.fn() };
let game: any;
let api: any;
let socket: any;

beforeAll(async () => {
  vi.stubGlobal("Hooks", hooks);
  vi.stubGlobal("foundry", {
    applications: { api: { ApplicationV2: MockApplicationV2 } },
  });
  vi.stubGlobal("ui", {});
  vi.stubGlobal("window", {
    setTimeout: (...args: any[]) => (globalThis.setTimeout as any)(...args),
    clearTimeout: (timer: any) => globalThis.clearTimeout(timer),
  });
  vi.stubGlobal("fromUuid", vi.fn());
  game = {
    world: { id: "world-a", title: "Test World" },
    user: { id: "gm-a", isGM: true },
    version: "14.0",
    system: { id: "pf2e", version: "7.1.0" },
    settings: {
      get: (_module: string, key: string) =>
        key === "pf2eEnabled" ? true : "assets/foundry-mcp",
    },
    pf2e: {
      gm: { calculateXP: vi.fn() },
      settings: { variants: { pwol: { enabled: false } } },
    },
    actors: new Map(),
    items: new Map(),
    journal: new Map(),
    scenes: new Map(),
    packs: new Map(),
  };
  vi.stubGlobal("game", game);
  api = await import("../src/main");
});

beforeEach(() => {
  game.world.id = "world-a";
  game.user.id = "gm-a";
  game.user.isGM = true;
  game.system = { id: "pf2e", version: "7.1.0" };
  game.settings = {
    get: (_module: string, key: string) =>
      key === "pf2eEnabled" ? true : "assets/foundry-mcp",
  };
  game.pf2e = {
    gm: { calculateXP: vi.fn() },
    settings: { variants: { pwol: { enabled: false } } },
  };
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  api.__test.runtime.socket = socket;
  api.__test.runtime.worldId = "world-a";
  api.__test.runtime.userId = "gm-a";
  api.__test.runtime.autoWrites = false;
  api.__test.runtime.queue.clear();
  mocks.conditions
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (ctx.game.system.id !== "pf2e" || !ctx.game.pf2e)
        throw Object.assign(new Error("PF2e unavailable"), {
          code: "PF2E_UNAVAILABLE",
        });
      if (tool !== "pf2e_inspect_conditions") {
        await Promise.resolve();
        ctx.assertWrite();
      }
      return { routed: tool };
    });
  mocks.inventory
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (ctx.game.system.id !== "pf2e" || !ctx.game.pf2e)
        throw Object.assign(new Error("PF2e unavailable"), {
          code: "PF2E_UNAVAILABLE",
        });
      if (tool !== "pf2e_inventory") ctx.assertWrite();
      return { routed: tool };
    });
});

describe("v0.4 PF2e bridge integration", () => {
  it("routes condition/effect and inventory tools through their adapters", async () => {
    expect(
      await api.__test.execute(
        "pf2e_inspect_conditions",
        { targetUuid: "Actor.a" },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_inspect_conditions" } });
    expect(
      await api.__test.execute(
        "pf2e_set_condition",
        { targetUuid: "Actor.a", slug: "frightened", value: 2 },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_set_condition" } });
    expect(
      await api.__test.execute(
        "pf2e_adjust_condition",
        {
          targetUuid: "Actor.a",
          conditionUuid: "Actor.a.Item.c",
          operation: "decrease",
        },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_adjust_condition" } });
    expect(
      await api.__test.execute(
        "pf2e_apply_effect",
        { targetUuid: "Actor.a", uuid: "Compendium.pf2e.effects.Item.x" },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_apply_effect" } });
    expect(
      await api.__test.execute(
        "pf2e_remove_effect",
        { targetUuid: "Actor.a", effectUuid: "Actor.a.Item.e" },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_remove_effect" } });
    expect(
      await api.__test.execute(
        "pf2e_inventory",
        { actorUuid: "Actor.a", offset: 0, limit: 25 },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_inventory" } });
    expect(
      await api.__test.execute(
        "pf2e_add_inventory_item",
        {
          actorUuid: "Actor.a",
          uuid: "Compendium.pf2e.equipment.Item.x",
          quantity: 1,
          newStack: false,
        },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_add_inventory_item" } });
    expect(
      await api.__test.execute(
        "pf2e_set_item_quantity",
        { actorUuid: "Actor.a", itemUuid: "Actor.a.Item.x", quantity: 1 },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_set_item_quantity" } });
    expect(
      await api.__test.execute(
        "pf2e_transfer_item",
        {
          sourceActorUuid: "Actor.a",
          targetActorUuid: "Actor.b",
          itemUuid: "Actor.a.Item.x",
          quantity: 1,
        },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_transfer_item" } });
    expect(
      await api.__test.execute(
        "pf2e_add_coins",
        { actorUuid: "Actor.a", coins: { gp: 1 } },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_add_coins" } });
    expect(
      await api.__test.execute(
        "pf2e_create_loot",
        { name: "Recovered Gear" },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: true, data: { routed: "pf2e_create_loot" } });
    expect(mocks.conditions).toHaveBeenCalledTimes(5);
    expect(mocks.inventory).toHaveBeenCalledTimes(6);
  });

  it("reports v0.4 adapter tool groups without claiming target API support", async () => {
    const result = await api.__test.execute(
      "get_status",
      {},
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        pf2eAdapter: {
          available: true,
          tools: { conditionsAndEffects: true, inventory: true },
          note: expect.stringContaining("checked when each PF2e tool runs"),
        },
      },
    });
  });

  it("rechecks the PF2e enable setting after async preparation before a write", async () => {
    const pending = api.__test.execute(
      "pf2e_set_condition",
      { targetUuid: "Actor.a", slug: "frightened", value: 2 },
      undefined,
      socket,
    );
    game.settings = {
      get: (_module: string, key: string) =>
        key === "pf2eEnabled" ? false : undefined,
    };
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: "PF2E_UNAVAILABLE" },
    });
  });

  it("keeps v0.4 PF2e tools unavailable in other systems without affecting generic tools", async () => {
    game.system = { id: "dnd5e", version: "4" };
    const denied = await api.__test.execute(
      "pf2e_inspect_conditions",
      { targetUuid: "Actor.a" },
      undefined,
      socket,
    );
    expect(denied).toMatchObject({
      ok: false,
      error: { code: "PF2E_UNAVAILABLE" },
    });
    const generic = await api.__test.execute(
      "search_world",
      { documentType: "Actor", query: "", offset: 0, limit: 25 },
      undefined,
      socket,
    );
    expect(generic).toMatchObject({
      ok: true,
      data: { total: 0, results: [] },
    });
  });

  it("preserves partial inventory transfer outcomes as MCP error data", async () => {
    mocks.inventory.mockRejectedValue(
      Object.assign(
        new Error("Target insertion failed after source removal."),
        {
          code: "PF2E_PARTIAL_FAILURE",
          partial: {
            sourceActorUuid: "Actor.a",
            targetActorUuid: "Actor.b",
            sourceItemUuid: "Actor.a.Item.x",
            removedQuantity: 1,
            targetItemUuid: null,
          },
        },
      ),
    );
    const result = await api.__test.execute(
      "pf2e_transfer_item",
      {
        sourceActorUuid: "Actor.a",
        targetActorUuid: "Actor.b",
        itemUuid: "Actor.a.Item.x",
        quantity: 1,
      },
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PF2E_PARTIAL_FAILURE",
        partial: {
          sourceActorUuid: "Actor.a",
          targetActorUuid: "Actor.b",
          removedQuantity: 1,
        },
      },
    });
  });
});
