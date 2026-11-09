import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), apply: vi.fn() }));
vi.mock("../src/pf2e-damage-context", () => ({
  handlePF2eInspectDamageApplication: mocks.inspect,
}));
vi.mock("../src/pf2e-damage-application", () => ({
  handlePF2eApplyDamage: mocks.apply,
}));

class MockApplicationV2 {
  render() {}
}
let game: any;
let api: any;
let socket: any;
const hookCallbacks = new Map<string, () => void>();
const common = {
  messageUuid: "ChatMessage.damage",
  targetTokenUuid: "Scene.a.Token.target",
  rollIndex: 0,
  operation: "damage",
  multiplier: 1,
  shieldBlock: false,
};
const reviewToken = "a".repeat(64);

beforeAll(async () => {
  vi.stubGlobal("Hooks", {
    once: vi.fn((name: string, callback: () => void) =>
      hookCallbacks.set(name, callback),
    ),
    on: vi.fn(),
  });
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
    system: { id: "pf2e", version: "test" },
    settings: { get: () => true },
    pf2e: {},
    scenes: new Map(),
    combats: { documentClass: { prototype: {} } },
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
  game.system = { id: "pf2e", version: "test" };
  game.settings.get = () => true;
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  api.__test.runtime.socket = socket;
  api.__test.runtime.worldId = "world-a";
  api.__test.runtime.userId = "gm-a";
  api.__test.runtime.autoWrites = false;
  mocks.inspect.mockReset().mockImplementation(async (_args: any, ctx: any) => {
    if (
      ctx.game.system.id !== "pf2e" ||
      game.settings.get("foundry-vtt-mcp", "pf2eEnabled") === false
    )
      throw Object.assign(new Error("PF2e unavailable"), {
        code: "PF2E_UNAVAILABLE",
      });
    return { reviewToken };
  });
  mocks.apply.mockReset().mockImplementation(async (args: any, ctx: any) => {
    ctx.assertWrite();
    return { applied: args.messageUuid };
  });
});

describe("v0.8 PF2e damage application integration", () => {
  it("routes inspection directly as a read without entering the approval queue", async () => {
    const result = await api.__test.execute(
      "pf2e_inspect_damage_application",
      common,
      undefined,
      socket,
    );
    expect(result).toMatchObject({ ok: true, data: { reviewToken } });
    expect(mocks.inspect).toHaveBeenCalledWith(
      common,
      expect.objectContaining({ game }),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v08-inspect",
        tool: "pf2e_inspect_damage_application",
        args: common,
      },
      socket,
    );
    expect(api.__test.runtime.queue.size).toBe(0);
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
  });

  it("queues apply until GM approval, then passes full approved context", async () => {
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v08-apply",
        tool: "pf2e_apply_damage",
        args: { ...common, reviewToken },
      },
      socket,
    );
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(api.__test.runtime.queue.size).toBe(1);
    await new api.__test.BridgeApp().approve("v08-apply");
    expect(mocks.apply).toHaveBeenCalledWith(
      { ...common, reviewToken },
      expect.objectContaining({ game, assertWrite: expect.any(Function) }),
    );
    expect(api.__test.runtime.queue.size).toBe(0);
  });

  it("preserves adapter partial outcomes for GM reconciliation", async () => {
    mocks.apply.mockRejectedValueOnce(
      Object.assign(new Error("Native result is uncertain"), {
        code: "PARTIAL_FAILURE",
        partial: { applicationId: "application-a", outcome: "uncertain" },
      }),
    );
    const result = await api.__test.execute(
      "pf2e_apply_damage",
      { ...common, reviewToken },
      undefined,
      socket,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PARTIAL_FAILURE",
        partial: { applicationId: "application-a", outcome: "uncertain" },
      },
    });
  });

  it("rejects non-PF2e and disabled integrations and propagates session changes", async () => {
    game.system = { id: "dnd5e", version: "test" };
    expect(
      await api.__test.execute(
        "pf2e_inspect_damage_application",
        common,
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: false, error: { code: "PF2E_UNAVAILABLE" } });
    game.system = { id: "pf2e", version: "test" };
    game.settings.get = () => false;
    expect(
      await api.__test.execute(
        "pf2e_apply_damage",
        { ...common, reviewToken },
        undefined,
        socket,
      ),
    ).toMatchObject({ ok: false, error: { code: "PF2E_UNAVAILABLE" } });
    game.settings.get = () => true;
    mocks.apply.mockImplementationOnce(async (_args: any, ctx: any) => {
      api.__test.runtime.worldId = "other-world";
      ctx.assertWrite();
      return {};
    });
    api.__test.runtime.autoWrites = true;
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v08-session",
        tool: "pf2e_apply_damage",
        args: { ...common, reviewToken },
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );
  });

  it("registers the hidden GM-restricted world ledger setting", () => {
    const registrations: Array<[string, any]> = [];
    game.settings.register = (moduleId: string, key: string, config: any) =>
      registrations.push([key, config]);
    game.settings.registerMenu = vi.fn();
    hookCallbacks.get("ready")?.();
    expect(registrations).toContainEqual([
      "damageApplications",
      expect.objectContaining({
        scope: "world",
        config: false,
        type: Object,
        restricted: true,
        default: { version: 1, entries: {} },
      }),
    ]);
  });
});
