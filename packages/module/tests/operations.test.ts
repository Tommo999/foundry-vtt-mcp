import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = { once: vi.fn(), on: vi.fn() };
class MockApplicationV2 {
  render() {}
}
let game: any;
let api: any;
let socket: any;

describe("Foundry write operations", () => {
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
      system: { id: "test", version: "1" },
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
    socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    api.__test.runtime.socket = socket;
    api.__test.runtime.worldId = "world-a";
    api.__test.runtime.userId = "gm-a";
    api.__test.runtime.autoWrites = false;
    api.__test.runtime.app = { render: vi.fn() };
    api.__test.runtime.queue.clear();
    api.__test.runtime.history.length = 0;
  });

  it("creates a system agnostic actor through Foundry document APIs", async () => {
    const create = vi.fn(async (data) => ({
      ...data,
      documentName: "Actor",
      toObject() {
        return data;
      },
    }));
    vi.stubGlobal("CONFIG", {
      Actor: { documentClass: { TYPES: ["character"], create } },
    });
    const result = await api.__test.execute(
      "create_document",
      {
        documentType: "Actor",
        data: { name: "Mira", type: "character", system: { custom: true } },
      },
      api.__test.identity(),
      socket,
    );
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it("does not write when the world changes during asynchronous UUID lookup", async () => {
    const update = vi.fn();
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => {
        game.world.id = "world-b";
        return { documentName: "Actor", update };
      }),
    );
    const result = await api.__test.execute(
      "update_document",
      { uuid: "Actor.a", data: { name: "Changed" } },
      { ...api.__test.identity(), worldId: "world-a" },
      socket,
    );
    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("queues a write and executes only after GM approval", async () => {
    const update = vi.fn(async () => ({ documentName: "Actor" }));
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => ({ documentName: "Actor", update })),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "approve-1",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "OK" } },
      },
      socket,
    );
    expect(update).not.toHaveBeenCalled();
    await new api.__test.BridgeApp().approve("approve-1");
    expect(update).toHaveBeenCalledOnce();
  });

  it("denies a queued write without mutation", async () => {
    const update = vi.fn();
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => ({ documentName: "Actor", update })),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "deny-1",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "No" } },
      },
      socket,
    );
    new api.__test.BridgeApp().deny("deny-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("expires an unanswered write approval", async () => {
    vi.useFakeTimers();
    await api.__test.handleRequest(
      {
        type: "request",
        id: "expire-1",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "No" } },
      },
      socket,
    );
    await vi.advanceTimersByTimeAsync(300_001);
    expect(api.__test.runtime.queue.has("expire-1")).toBe(false);
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "APPROVAL_EXPIRED",
    );
    vi.useRealTimers();
  });

  it("rejects automatic writes if the GM disables automatic mode while lookup waits", async () => {
    api.__test.runtime.autoWrites = true;
    const update = vi.fn();
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => {
        api.__test.runtime.autoWrites = false;
        return { documentName: "Actor", update };
      }),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "auto-revoke",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "No" } },
      },
      socket,
    );
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a new request after the connected GM identity changes", async () => {
    game.user.id = "gm-b";
    await api.__test.handleRequest(
      { type: "request", id: "user-change", tool: "get_status", args: {} },
      socket,
    );
    expect(JSON.parse(socket.send.mock.calls.at(-1)[0]).result.error.code).toBe(
      "SESSION_CHANGED",
    );
  });

  it("rejects a queued approval after the GM identity changes", async () => {
    const update = vi.fn();
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => ({ documentName: "Actor", update })),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "stale-approve",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "No" } },
      },
      socket,
    );
    game.user.id = "gm-b";
    await new api.__test.BridgeApp().approve("stale-approve");
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an automatic write while session permission remains enabled", async () => {
    api.__test.runtime.autoWrites = true;
    const update = vi.fn(async () => ({ documentName: "Actor" }));
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => ({ documentName: "Actor", update })),
    );
    await api.__test.handleRequest(
      {
        type: "request",
        id: "auto-ok",
        tool: "update_document",
        args: { uuid: "Actor.a", data: { name: "Yes" } },
      },
      socket,
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it("disconnect resets automatic mode and session identity", () => {
    api.__test.runtime.autoWrites = true;
    api.__test.disconnect(false);
    expect(api.__test.runtime.autoWrites).toBe(false);
    expect(api.__test.runtime.userId).toBeUndefined();
    expect(api.__test.runtime.worldId).toBeUndefined();
  });

  it("rejects mismatched folder parents", async () => {
    const folder = {
      documentName: "Folder",
      type: "Item",
      uuid: "Folder.f",
      id: "f",
    };
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => folder),
    );
    const create = vi.fn();
    vi.stubGlobal("Folder", { create });
    const result = await api.__test.execute(
      "create_folder",
      { name: "Nested", documentType: "Actor", parentUuid: folder.uuid },
      api.__test.identity(),
      socket,
    );
    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects map notes with a page from another journal", async () => {
    const scene = {
      documentName: "Scene",
      uuid: "Scene.s",
      width: 100,
      height: 100,
      dimensions: { sceneRect: { x: 0, y: 0, width: 100, height: 100 } },
      createEmbeddedDocuments: vi.fn(),
    };
    const journal = {
      documentName: "JournalEntry",
      uuid: "JournalEntry.j",
      id: "j",
    };
    const page = {
      documentName: "JournalEntryPage",
      uuid: "JournalEntry.other.JournalEntryPage.p",
      parent: { uuid: "JournalEntry.other" },
    };
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async (uuid: string) =>
        uuid.includes("Scene")
          ? scene
          : uuid.includes("JournalEntryPage")
            ? page
            : journal,
      ),
    );
    const result = await api.__test.execute(
      "add_map_note",
      {
        sceneUuid: scene.uuid,
        journalUuid: journal.uuid,
        pageUuid: page.uuid,
        x: 10,
        y: 10,
      },
      api.__test.identity(),
      socket,
    );
    expect(result.ok).toBe(false);
    expect(scene.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("rejects upload paths outside the configured data root", async () => {
    game.settings = { get: () => "assets/foundry-mcp" };
    const upload = vi.fn();
    vi.stubGlobal("FilePicker", {
      browse: vi.fn(),
      upload,
      createDirectory: vi.fn(),
    });
    api.__test.runtime.autoWrites = true;
    const result = await api.__test.execute(
      "upload_asset",
      {
        filename: "map.png",
        mimeType: "image/png",
        dataBase64: btoa("not png"),
        directory: "../../modules",
      },
      api.__test.identity(),
      socket,
      "automatic",
    );
    expect(result.ok).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("projects imports to supported fields and excludes database metadata", () => {
    const data = api.__test.sanitizeImported(
      {
        _id: "pack-id",
        _stats: { modifiedTime: 1 },
        name: "Imported",
        type: "character",
        ownership: { default: 3 },
        flags: { x: 1 },
        system: { hp: 5 },
        items: [{ _id: "i1", name: "Blade", type: "weapon", system: {} }],
      },
      "Actor",
    );
    expect(data).toEqual({
      name: "Imported",
      type: "character",
      system: { hp: 5 },
      items: [{ name: "Blade", type: "weapon", system: {} }],
    });
  });
});
