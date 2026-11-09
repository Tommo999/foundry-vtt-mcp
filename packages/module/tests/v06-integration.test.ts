import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checks: vi.fn(),
  encounters: vi.fn(),
}));
vi.mock("../src/pf2e-checks", () => ({ handlePF2eChecks: mocks.checks }));
vi.mock("../src/encounters", () => ({ handleEncounters: mocks.encounters }));

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
    system: { id: "pf2e", version: "test" },
    settings: { get: () => true },
    pf2e: {},
    scenes: new Map(),
    combats: {
      documentClass: {
        prototype: {
          activate: vi.fn(),
          startCombat: vi.fn(),
          nextTurn: vi.fn(),
          rollInitiative: vi.fn(),
        },
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
  game.system = { id: "pf2e", version: "test" };
  game.settings.get = () => true;
  socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  api.__test.runtime.socket = socket;
  api.__test.runtime.worldId = "world-a";
  api.__test.runtime.userId = "gm-a";
  api.__test.runtime.autoWrites = false;
  mocks.checks
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (tool === "pf2e_roll_check") ctx.assertWrite();
      return { routed: tool };
    });
  mocks.encounters
    .mockReset()
    .mockImplementation(async (tool: string, _args: any, ctx: any) => {
      if (
        ["pf2e_roll_initiative", "start_encounter", "next_turn"].includes(tool)
      )
        ctx.assertWrite();
      return { routed: tool };
    });
});

describe("v0.6 PF2e checks and combat integration", () => {
  it("routes check and inspection tools through PF2e context", async () => {
    for (const tool of ["pf2e_roll_check", "pf2e_inspect_actions"]) {
      expect(
        await api.__test.execute(tool, {}, undefined, socket),
      ).toMatchObject({ ok: true, data: { routed: tool } });
      expect(mocks.checks).toHaveBeenLastCalledWith(
        tool,
        {},
        expect.objectContaining({ game }),
      );
    }
  });

  it("routes initiative through PF2e context and start/turn through the generic bridge", async () => {
    for (const [tool, pf2e] of [
      ["pf2e_roll_initiative", true],
      ["start_encounter", false],
      ["next_turn", false],
    ] as const) {
      expect(
        await api.__test.execute(tool, {}, undefined, socket),
      ).toMatchObject({ ok: true, data: { routed: tool } });
      expect(mocks.encounters).toHaveBeenLastCalledWith(
        tool,
        {},
        expect.objectContaining({ game }),
      );
      if (pf2e)
        expect(() =>
          mocks.encounters.mock.lastCall?.[2].assertWrite(),
        ).not.toThrow();
    }
  });

  it("keeps encounter start and turn system agnostic while requiring PF2e for initiative", async () => {
    game.system = { id: "dnd5e", version: "test" };
    for (const tool of ["start_encounter", "next_turn"]) {
      expect(
        await api.__test.execute(tool, {}, undefined, socket),
      ).toMatchObject({ ok: true });
    }
    expect(
      await api.__test.execute("pf2e_roll_initiative", {}, undefined, socket),
    ).toMatchObject({
      ok: false,
      error: { code: "PF2E_UNAVAILABLE" },
    });
  });

  it("requires PF2e for PF2e rolls and preserves partial outcomes", async () => {
    game.system = { id: "dnd5e", version: "test" };
    const unavailable = await api.__test.execute(
      "pf2e_roll_check",
      {},
      undefined,
      socket,
    );
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "PF2E_UNAVAILABLE" },
    });
    game.system = { id: "pf2e", version: "test" };
    mocks.checks.mockImplementationOnce(async () => {
      throw Object.assign(new Error("uncertain roll"), {
        code: "PARTIAL_FAILURE",
        partial: { messageUuid: "ChatMessage.a" },
      });
    });
    expect(
      await api.__test.execute("pf2e_roll_check", {}, undefined, socket),
    ).toMatchObject({
      ok: false,
      error: {
        code: "PARTIAL_FAILURE",
        partial: { messageUuid: "ChatMessage.a" },
      },
    });
  });

  it("queues PF2e check rolls for GM approval and rechecks authorization after async work", async () => {
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v06-check-approval",
        tool: "pf2e_roll_check",
        args: { targetUuid: "Actor.a", statistic: "stealth" },
      },
      socket,
    );
    expect(mocks.checks).not.toHaveBeenCalled();
    await new api.__test.BridgeApp().approve("v06-check-approval");
    expect(mocks.checks).toHaveBeenCalledOnce();

    api.__test.runtime.autoWrites = true;
    mocks.checks.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        game.settings.get = () => false;
        ctx.assertWrite();
        return { rolled: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v06-check-revoke",
        tool: "pf2e_roll_check",
        args: { targetUuid: "Actor.a", statistic: "stealth" },
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "PF2E_UNAVAILABLE",
    );
    game.settings.get = () => true;

    api.__test.runtime.autoWrites = true;
    mocks.checks.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        api.__test.runtime.autoWrites = false;
        ctx.assertWrite();
        return { rolled: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v06-check-auto-revoke",
        tool: "pf2e_roll_check",
        args: { targetUuid: "Actor.a", statistic: "stealth" },
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );
  });

  it("queues destructive encounter controls for approval and prevents stale session writes", async () => {
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v06-turn-approval",
        tool: "next_turn",
        args: {
          encounterUuid: "Combat.a",
          expectedRound: 1,
          expectedTurn: 0,
          expectedCombatantUuid: "Combatant.a",
        },
      },
      socket,
    );
    expect(mocks.encounters).not.toHaveBeenCalled();
    await new api.__test.BridgeApp().approve("v06-turn-approval");
    expect(mocks.encounters).toHaveBeenCalledOnce();

    api.__test.runtime.autoWrites = true;
    mocks.encounters.mockImplementationOnce(
      async (_tool: string, _args: any, ctx: any) => {
        await Promise.resolve();
        game.world.id = "world-b";
        ctx.assertWrite();
        return { advanced: true };
      },
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "v06-turn-revoke",
        tool: "next_turn",
        args: {
          encounterUuid: "Combat.a",
          expectedRound: 1,
          expectedTurn: 0,
          expectedCombatantUuid: "Combatant.a",
        },
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );
    game.world.id = "world-a";
    api.__test.runtime.autoWrites = false;
  });
});
