import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), strikes: vi.fn() }));
vi.mock("../src/pf2e-combat-context", () => ({
  handlePF2eCombatContext: mocks.context,
}));
vi.mock("../src/pf2e-strikes", () => ({ handlePF2eStrikes: mocks.strikes }));

class MockApplicationV2 {
  render() {}
}
let game: any;
let api: any;
let socket: any;
const rollArgs = {
  encounterUuid: "Combat.a",
  attackerTokenUuid: "Scene.a.Token.attacker",
  targetTokenUuid: "Scene.a.Token.target",
  strikeIndex: 0,
  strikeSlug: "longsword",
  strikeItemUuid: "Actor.a.Item.longSword",
  expectedRound: 1,
  expectedTurn: 0,
  expectedCombatantUuid: "Combat.a.Combatant.a",
  attackNumber: 1,
};

beforeAll(async () => {
  vi.stubGlobal("Hooks", { once: vi.fn(), on: vi.fn() });
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
  api.__test.runtime.sessionId = "fixture-session";
  api.__test.runtime.autoWrites = false;
  mocks.context.mockReset().mockImplementation(async (_args: any, ctx: any) => {
    if (ctx.game.system.id !== "pf2e")
      throw Object.assign(new Error("PF2e unavailable"), {
        code: "PF2E_UNAVAILABLE",
      });
    return { readOnly: true };
  });
  mocks.strikes
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (ctx.game.system.id !== "pf2e")
        throw Object.assign(new Error("PF2e unavailable"), {
          code: "PF2E_UNAVAILABLE",
        });
      if (tool === "pf2e_roll_strike" || tool === "pf2e_roll_damage")
        ctx.assertWrite();
      return { rolled: tool };
    });
});

describe("v0.7 PF2e combat context and strike integration", () => {
  it("routes combat context through the PF2e read path", async () => {
    const result = await api.__test.execute(
      "pf2e_combat_context",
      { encounterUuid: "Combat.a" },
      undefined,
      socket,
    );
    expect(result).toMatchObject({ ok: true, data: { readOnly: true } });
    expect(mocks.context).toHaveBeenCalledWith(
      { encounterUuid: "Combat.a" },
      expect.objectContaining({ game }),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v07-context-read",
        tool: "pf2e_combat_context",
        args: { encounterUuid: "Combat.a" },
      },
      socket,
    );
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(api.__test.runtime.queue.size).toBe(0);
  });

  it("routes both roll tools through the PF2e context and preserves uncertain outcomes", async () => {
    for (const tool of ["pf2e_roll_strike", "pf2e_roll_damage"]) {
      expect(
        await api.__test.execute(tool, rollArgs, undefined, socket),
      ).toMatchObject({ ok: true, data: { rolled: tool } });
      expect(mocks.strikes).toHaveBeenLastCalledWith(
        tool,
        rollArgs,
        expect.objectContaining({ game }),
      );
    }
    mocks.strikes.mockImplementationOnce(async () => {
      throw Object.assign(new Error("uncertain roll"), {
        code: "PARTIAL_FAILURE",
        partial: { messageUuid: "ChatMessage.a", outcomeUnknown: true },
      });
    });
    expect(
      await api.__test.execute("pf2e_roll_strike", rollArgs, undefined, socket),
    ).toMatchObject({
      ok: false,
      error: {
        code: "PARTIAL_FAILURE",
        partial: { messageUuid: "ChatMessage.a", outcomeUnknown: true },
      },
    });
  });

  it("requires PF2e for context and queues the strike and damage writes", async () => {
    game.system = { id: "dnd5e", version: "test" };
    expect(
      await api.__test.execute("pf2e_combat_context", {}, undefined, socket),
    ).toMatchObject({ ok: false, error: { code: "PF2E_UNAVAILABLE" } });
    game.system = { id: "pf2e", version: "test" };

    for (const [id, tool] of [
      ["v07-strike-approval", "pf2e_roll_strike"],
      ["v07-damage-approval", "pf2e_roll_damage"],
    ]) {
      const callsBeforeApproval = mocks.strikes.mock.calls.length;
      await api.__test.handleRequest(
        { type: "request", id, tool, args: rollArgs },
        socket,
      );
      expect(mocks.strikes).toHaveBeenCalledTimes(callsBeforeApproval);
      await new api.__test.BridgeApp().approve(id);
    }
    expect(mocks.strikes).toHaveBeenCalledTimes(2);
  });

  it("rechecks PF2e enablement, automatic-write consent, and session after asynchronous work", async () => {
    api.__test.runtime.autoWrites = true;
    mocks.strikes.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        game.settings.get = () => false;
        ctx.assertWrite();
        return { unreachable: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v07-revoke-setting",
        tool: "pf2e_roll_strike",
        args: rollArgs,
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "PF2E_UNAVAILABLE",
    );

    game.settings.get = () => true;
    mocks.strikes.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        api.__test.runtime.autoWrites = false;
        ctx.assertWrite();
        return { unreachable: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v07-revoke-auto",
        tool: "pf2e_roll_damage",
        args: rollArgs,
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );

    api.__test.runtime.autoWrites = true;
    mocks.strikes.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        game.world.id = "world-b";
        ctx.assertWrite();
        return { unreachable: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v07-revoke-session",
        tool: "pf2e_roll_strike",
        args: rollArgs,
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(3));
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );
  });
});
