import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ encounters: vi.fn(), snapshot: vi.fn() }));
vi.mock("../src/encounters", () => ({ handleEncounters: mocks.encounters }));
vi.mock("../src/session-snapshot", () => ({
  handleSessionSnapshot: mocks.snapshot,
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
    world: { id: "world-a", title: "Test" },
    user: { id: "gm-a", isGM: true },
    version: "14.0",
    system: { id: "system-a", version: "1.0" },
    settings: {
      get: (_module: string, key: string) =>
        key === "assetRoot" ? "assets/foundry-mcp" : true,
    },
    scenes: new Map(),
    combats: {
      documentClass: {
        create: vi.fn(),
        prototype: { createEmbeddedDocuments: vi.fn() },
      },
    },
    actors: new Map(),
    items: new Map(),
    journal: new Map(),
    packs: new Map(),
  };
  vi.stubGlobal("game", game);
  api = await import("../src/main");
});

beforeEach(() => {
  game.world.id = "world-a";
  game.user.id = "gm-a";
  game.user.isGM = true;
  game.system = { id: "system-a", version: "1.0" };
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  api.__test.runtime.socket = socket;
  api.__test.runtime.worldId = "world-a";
  api.__test.runtime.userId = "gm-a";
  api.__test.runtime.autoWrites = false;
  mocks.encounters
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (
        ["create_encounter", "add_combatants", "remove_combatants"].includes(
          tool,
        )
      )
        ctx.assertWrite();
      return { routed: tool };
    });
  mocks.snapshot
    .mockReset()
    .mockResolvedValue({ readOnly: true, capturedAt: "test" });
});

describe("v0.5 generic encounter and snapshot integration", () => {
  it("routes all encounter tools and snapshots through the generic context in non-PF2e worlds", async () => {
    for (const tool of [
      "list_encounters",
      "inspect_encounter",
      "create_encounter",
      "add_combatants",
      "remove_combatants",
    ]) {
      const result = await api.__test.execute(tool, {}, undefined, socket);
      expect(result).toMatchObject({ ok: true, data: { routed: tool } });
      expect(mocks.encounters).toHaveBeenLastCalledWith(
        tool,
        {},
        expect.objectContaining({ game }),
      );
    }
    expect(
      await api.__test.execute("session_snapshot", {}, undefined, socket),
    ).toMatchObject({ ok: true, data: { readOnly: true } });
    expect(mocks.snapshot).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ game }),
    );
  });

  it("allows generic encounter prep when PF2e integration is disabled", async () => {
    game.settings.get = (_module: string, key: string) =>
      key === "pf2eEnabled" ? false : "assets/foundry-mcp";
    game.system = { id: "pf2e", version: "test" };
    const result = await api.__test.execute(
      "create_encounter",
      { sceneUuid: "Scene.a" },
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { routed: "create_encounter" },
    });
  });

  it("rechecks generic write authorization after an async handler step and preserves partial outcomes", async () => {
    mocks.encounters.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        game.world.id = "world-b";
        ctx.assertWrite();
        return { shouldNotWrite: true };
      },
    );
    expect(
      await api.__test.execute("add_combatants", {}, undefined, socket),
    ).toMatchObject({ ok: false, error: { code: "SESSION_CHANGED" } });

    game.world.id = "world-a";
    mocks.encounters.mockImplementationOnce(async () => {
      throw Object.assign(new Error("partial"), {
        code: "PARTIAL_FAILURE",
        partial: { createdCombatantUuids: ["Combatant.a"] },
      });
    });
    expect(
      await api.__test.execute("add_combatants", {}, undefined, socket),
    ).toMatchObject({
      ok: false,
      error: {
        code: "PARTIAL_FAILURE",
        partial: { createdCombatantUuids: ["Combatant.a"] },
      },
    });
  });
});
