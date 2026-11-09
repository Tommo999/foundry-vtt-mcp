// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
class MockApplicationV2 {
  render() {}
}
let api: any, game: any, socket: any;
describe("preparation and asset tools", () => {
  beforeAll(async () => {
    vi.stubGlobal("Hooks", { once: vi.fn(), on: vi.fn() });
    vi.stubGlobal("foundry", {
      applications: { api: { ApplicationV2: MockApplicationV2 } },
      documents: {
        Folder: {
          create: vi.fn(async (d) => ({
            ...d,
            documentName: "Folder",
            id: "new-folder",
            uuid: "Folder.new",
          })),
        },
      },
      utils: { randomID: () => "random123" },
    });
    vi.stubGlobal("ui", {});
    game = {
      world: { id: "w", title: "World" },
      user: { id: "gm", isGM: true },
      version: "14",
      system: { id: "generic", version: "1" },
      actors: new Map(),
      items: new Map(),
      journal: new Map(),
      scenes: new Map(),
      packs: new Map(),
      folders: [],
      settings: {
        get: (_m: string, key: string) =>
          key === "assetRoot" ? "assets/foundry-mcp" : "",
        register: vi.fn(),
        registerMenu: vi.fn(),
      },
    };
    vi.stubGlobal("game", game);
    api = await import("../src/main");
  });
  beforeEach(() => {
    socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    api.__test.runtime.socket = socket;
    api.__test.runtime.worldId = "w";
    api.__test.runtime.userId = "gm";
    api.__test.runtime.autoWrites = true;
  });
  it("searches world content as plain text and omits script contents", async () => {
    const actor = {
      documentName: "Actor",
      name: "Clara",
      uuid: "Actor.a",
      toObject: () => ({
        name: "Clara",
        system: {
          bio:
            "<p>" +
            "filler ".repeat(100) +
            "Hello &amp; world</p><script>secretneedle()</script>",
        },
      }),
    };
    game.actors = [actor];
    expect(api.__test.searchableText("<p>Hello &amp; world</p>")).toContain(
      "Hello & world",
    );
    const r = await api.__test.execute(
      "search_content",
      { query: "hello & world" },
      api.__test.identity(),
      socket,
      "automatic",
    );
    expect(r.ok).toBe(true);
    const results = (r as any).data.results;
    expect(results).toHaveLength(1);
    expect(results[0].snippets[0]).toContain("Hello & world");
    expect(JSON.stringify(results)).not.toContain("secretneedle");
  });
  it("lists world folders and creates typed folders", async () => {
    game.folders = [
      {
        id: "f",
        uuid: "Folder.f",
        name: "People",
        type: "Actor",
        folder: null,
      },
    ];
    const r = await api.__test.execute(
      "list_folders",
      { documentType: "Actor", offset: 0, limit: 10 },
      api.__test.identity(),
      socket,
    );
    expect((r as any).data.results[0].name).toBe("People");
    const made = await api.__test.execute(
      "create_folder",
      { name: "Places", documentType: "JournalEntry" },
      api.__test.identity(),
      socket,
      "approved",
    );
    expect(made.ok).toBe(true);
  });
  it("moves world documents and rejects mismatched folder types", async () => {
    const update = vi.fn(async () => ({
      uuid: "Actor.a",
      documentName: "Actor",
    }));
    const doc = { uuid: "Actor.a", documentName: "Actor", update };
    const folder = {
      uuid: "Folder.f",
      documentName: "Folder",
      type: "JournalEntry",
      id: "f",
    };
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async (u: string) => (u === "Actor.a" ? doc : folder)),
    );
    const r = await api.__test.execute(
      "move_document",
      { uuid: "Actor.a", folderUuid: "Folder.f" },
      api.__test.identity(),
      socket,
      "approved",
    );
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it("browses safe data directories and image files", async () => {
    vi.stubGlobal("FilePicker", {
      browse: vi.fn(async () => ({
        dirs: ["assets"],
        files: ["map.png", "evil.svg"],
      })),
    });
    const r = await api.__test.execute(
      "browse_assets",
      { directory: "assets", query: "", offset: 0, limit: 10 },
      api.__test.identity(),
      socket,
    );
    expect((r as any).data.files).toEqual(["map.png"]);
  });
  it("inspects scene collections with capped summaries and bounds", async () => {
    const tokens = Array.from({ length: 101 }, (_, i) => ({
      id: String(i),
      name: "Token",
      x: i,
      y: i,
      actor: null,
    }));
    const scene = {
      uuid: "Scene.s",
      documentName: "Scene",
      name: "Map",
      width: 1000,
      height: 800,
      dimensions: { sceneRect: { x: -10, y: -20, width: 1020, height: 840 } },
      tokens,
      walls: [],
      lights: [],
      levels: [],
      notes: [],
      grid: { size: 100, distance: 5 },
      background: { src: "map.webp" },
    };
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async () => scene),
    );
    const r = await api.__test.execute(
      "inspect_scene",
      { uuid: scene.uuid },
      api.__test.identity(),
      socket,
    );
    expect((r as any).data.tokens.items).toHaveLength(100);
    expect((r as any).data.tokens.truncated).toBe(true);
    expect((r as any).data.sceneBounds.x).toBe(-10);
  });
  it("creates a note with a verified page reference and V14 texture field", async () => {
    const journal = {
      uuid: "JournalEntry.j",
      id: "j",
      documentName: "JournalEntry",
    };
    const page = {
      uuid: "JournalEntry.j.JournalEntryPage.p",
      id: "p",
      documentName: "JournalEntryPage",
      parent: journal,
    };
    const scene = {
      uuid: "Scene.s",
      documentName: "Scene",
      width: 100,
      height: 100,
      dimensions: { sceneRect: { x: 0, y: 0, width: 100, height: 100 } },
      createEmbeddedDocuments: vi.fn(async (_t: string, data: any[]) => data),
    };
    vi.stubGlobal(
      "fromUuid",
      vi.fn(async (u: string) =>
        u.startsWith("Scene")
          ? scene
          : u.includes("JournalEntryPage")
            ? page
            : journal,
      ),
    );
    const r = await api.__test.execute(
      "add_map_note",
      {
        sceneUuid: scene.uuid,
        journalUuid: journal.uuid,
        pageUuid: page.uuid,
        x: 20,
        y: 20,
        icon: "icons/custom.png",
      },
      api.__test.identity(),
      socket,
      "approved",
    );
    expect(r.ok).toBe(true);
    expect(scene.createEmbeddedDocuments.mock.calls[0][1][0].texture.src).toBe(
      "icons/custom.png",
    );
  });
  it("uploads a signature-checked image into the configured root with a random filename", async () => {
    const created = new Set(["assets", "assets/foundry-mcp"]);
    const browse = vi.fn(async (_source: string, path: string) => ({
      dirs: [...created].filter(
        (d) =>
          d.startsWith(path ? path + "/" : "") &&
          d.split("/").length === (path ? path.split("/").length + 1 : 1),
      ),
      files: [],
    }));
    const upload = vi.fn(async (_s: string, path: string, file: File) => ({
      path: `${path}/${file.name}`,
    }));
    vi.stubGlobal("FilePicker", {
      browse,
      upload,
      createDirectory: vi.fn(async (_s: string, path: string) =>
        created.add(path),
      ),
    });
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const r = await api.__test.execute(
      "upload_asset",
      {
        filename: "map.png",
        mimeType: "image/png",
        dataBase64: btoa(String.fromCharCode(...png)),
        directory: "maps",
      },
      api.__test.identity(),
      socket,
      "automatic",
    );
    expect(r.ok).toBe(true);
    expect(upload.mock.calls[0][2].name).toMatch(/^random123-map\.png$/);
  });
  it("does not create directories if automatic permission is revoked during browse", async () => {
    const createDirectory = vi.fn();
    vi.stubGlobal("FilePicker", {
      browse: vi.fn(async () => {
        api.__test.runtime.autoWrites = false;
        return { dirs: [] };
      }),
      upload: vi.fn(),
      createDirectory,
    });
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const r = await api.__test.execute(
      "upload_asset",
      {
        filename: "map.png",
        mimeType: "image/png",
        dataBase64: btoa(String.fromCharCode(...png)),
        directory: "maps",
      },
      api.__test.identity(),
      socket,
      "automatic",
    );
    expect(r.ok).toBe(false);
    expect(createDirectory).not.toHaveBeenCalled();
  });
});
