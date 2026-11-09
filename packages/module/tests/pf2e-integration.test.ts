import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handlePF2eWrite: vi.fn() }));
vi.mock("../src/pf2e-writes", () => ({
  handlePF2eWrite: mocks.handlePF2eWrite,
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
    system: { id: "dnd5e", version: "4" },
    settings: {
      get: (_module: string, key: string) =>
        key === "pf2eEnabled" ? true : "assets/foundry-mcp",
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
  game.system = { id: "dnd5e", version: "4" };
  game.settings = {
    get: (_module: string, key: string) =>
      key === "pf2eEnabled" ? true : "assets/foundry-mcp",
  };
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  api.__test.runtime.socket = socket;
  api.__test.runtime.worldId = "world-a";
  api.__test.runtime.userId = "gm-a";
  api.__test.runtime.autoWrites = false;
  api.__test.runtime.queue.clear();
  mocks.handlePF2eWrite.mockReset();
});

describe("PF2e routing through the GM bridge", () => {
  it("keeps PF2e tools listed but rejects them clearly in non-PF2e worlds", async () => {
    const denied = await api.__test.execute(
      "pf2e_search_compendium",
      { kind: "creature" },
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

  it("honors the GM world setting for PF2e reads", async () => {
    game.system = { id: "pf2e", version: "7.1.0" };
    game.settings = {
      get: (_module: string, key: string) =>
        key === "pf2eEnabled" ? false : undefined,
    };
    const result = await api.__test.execute(
      "pf2e_party_summary",
      {},
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "PF2E_UNAVAILABLE" },
    });
  });

  it("reports PF2e availability in general bridge status", async () => {
    game.system = { id: "pf2e", version: "7.1.0" };
    game.pf2e = {
      gm: { calculateXP: vi.fn() },
      settings: { variants: { pwol: { enabled: false } } },
    };
    const result = await api.__test.execute(
      "get_status",
      {},
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        pf2eAdapter: { detected: true, available: true, version: "7.1.0" },
      },
    });
  });

  it("preserves partial PF2e write UUIDs as an error result", async () => {
    game.system = { id: "pf2e", version: "7.1.0" };
    mocks.handlePF2eWrite.mockRejectedValue(
      Object.assign(new Error("A later token placement failed."), {
        code: "PF2E_PARTIAL_FAILURE",
        partial: {
          createdActors: ["Actor.a"],
          createdItems: [],
          createdTokens: ["Scene.s.Token.t"],
          failedPlacementIndex: 1,
        },
      }),
    );
    const result = await api.__test.execute(
      "pf2e_stage_encounter",
      { sceneUuid: "Scene.s", placements: [{ uuid: "Actor.a", x: 0, y: 0 }] },
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PF2E_PARTIAL_FAILURE",
        partial: {
          createdActors: ["Actor.a"],
          createdTokens: ["Scene.s.Token.t"],
          failedPlacementIndex: 1,
        },
      },
    });
  });
});
