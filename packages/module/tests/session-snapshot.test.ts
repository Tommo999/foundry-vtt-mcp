// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { handleSessionSnapshot } from "../src/session-snapshot";

describe("session snapshot", () => {
  it("returns read-only bounded structured data without attempting writes", async () => {
    const scene = {
      documentName: "Scene",
      id: "s1",
      uuid: "Scene.s1",
      name: "Hall",
      width: 2000,
      height: 1000,
      grid: { type: 1, size: 100, distance: 5 },
      dimensions: { sceneRect: { x: 0, y: 0, width: 2000, height: 1000 } },
      tokens: {
        contents: Array.from({ length: 60 }, (_, i) => ({
          uuid: `Scene.s1.Token.${i}`,
          name: `T${i}`,
          x: i,
          y: i,
        })),
      },
      notes: { contents: [] },
    };
    const scenes: any = new Map([["s1", scene]]);
    scenes.current = scene;
    const assertWrite = vi.fn(() => {
      throw new Error("snapshot must remain read-only");
    });
    const result: any = await handleSessionSnapshot(
      {},
      {
        game: {
          world: { id: "w1", title: "World" },
          system: { id: "generic", version: "1" },
          scenes,
          combats: [],
          actors: [],
          journal: [],
          settings: { get: () => true },
        },
        resolve: vi.fn(),
        assertWrite,
        serialize: vi.fn(),
      },
    );
    expect(result).toMatchObject({
      readOnly: true,
      world: { id: "w1" },
      scene: { uuid: "Scene.s1" },
    });
    expect(result.scene.tokens).toMatchObject({ total: 60, truncated: true });
    expect(result.scene.tokens.items).toHaveLength(50);
    expect(result.party).toBeNull();
    expect(assertWrite).not.toHaveBeenCalled();
  });

  it("bounds selected journal references and strips HTML to plain text", async () => {
    const journal: any = {
      documentName: "JournalEntry",
      id: "j1",
      uuid: "JournalEntry.j1",
      name: "Notes",
      pages: {
        contents: [
          {
            documentName: "JournalEntryPage",
            id: "p1",
            uuid: "JournalEntry.j1.JournalEntryPage.p1",
            name: "Entry",
            type: "text",
            text: {
              content: "<p>Useful <b>facts</b></p><script>hidden()</script>",
            },
          },
        ],
      },
    };
    const game = {
      world: {},
      system: { id: "generic" },
      scenes: new Map(),
      combats: [],
      actors: [],
      journal: new Map([["j1", journal]]),
      settings: { get: () => true },
    };
    const result: any = await handleSessionSnapshot(
      { journalUuids: [journal.uuid] },
      {
        game,
        resolve: async (uuid: string) =>
          uuid === journal.uuid ? journal : null,
        assertWrite: () => {
          throw new Error("read-only");
        },
        serialize: vi.fn(),
      },
    );
    expect(result.journals.items[0].pages.items[0].text).toContain(
      "Useful facts",
    );
    expect(result.journals.items[0].pages.items[0].text).not.toContain(
      "hidden",
    );
  });
});
