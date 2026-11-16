import { vi } from "vitest";

/** Installs the minimal Foundry globals and imports the bridge integration seam. */
export async function installBridgeTestBootstrap(options: {
  onHookOnce?: (name: string, callback: () => void) => void;
} = {}): Promise<{ game: any; api: any }> {
  class MockApplicationV2 {
    render() {}
  }

  vi.stubGlobal("Hooks", {
    once: vi.fn((name: string, callback: () => void) =>
      options.onHookOnce?.(name, callback),
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

  const game: any = {
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

  const api = await import("../src/main");
  return { game, api };
}
