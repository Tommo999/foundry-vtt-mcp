import { describe, expect, it, vi } from "vitest";
import { handlePF2eWrite } from "../src/pf2e-writes.js";
import type { PF2eContext } from "../src/pf2e-context.js";

const pnglessSourceData = {
  _id: "duplicate-root-id",
  root_id: "foreign-root-id",
  name: "Clockwork Wolf",
  type: "npc",
  system: {
    details: { level: { value: 3 } },
    attributes: { adjustment: null },
    rules: [{ key: "GrantItem", uuid: "Compendium.pf2e.spells.Item.heal" }],
  },
  flags: { pf2e: { linkToActorSize: true } },
  items: [
    {
      _id: "spellcasting-entry-id",
      name: "Innate Magic",
      type: "spellcastingEntry",
      system: { tradition: { value: "arcane" } },
    },
    {
      _id: "embedded-spell-id",
      name: "Healing Spell",
      type: "spell",
      system: {
        level: { value: 1 },
        location: { value: "spellcasting-entry-id" },
      },
    },
  ],
  ownership: { default: 0, user1: 3 },
  folder: "old-folder",
  sort: 20,
};

function makeContext(
  options: {
    sourceData?: any;
    tokenCreate?: (...args: any[]) => Promise<any>;
    assertWrite?: () => void;
  } = {},
) {
  const sourceData = structuredClone(options.sourceData ?? pnglessSourceData);
  const calls = {
    creates: [] as any[],
    adjustments: [] as any[],
    tokens: [] as any[],
    fromOptions: undefined as any,
  };
  const source: any = {
    ...sourceData,
    id: "wolf",
    uuid: "Compendium.pf2e.bestiary.Actor.wolf",
    documentName: "Actor",
    pack: "pf2e.bestiary",
    compendium: {},
    parent: null,
    isEmbedded: false,
    toObject: () => structuredClone(sourceData),
    applyAdjustment: vi.fn(),
    getTokenDocument: async (data: any, context: any) => {
      expect(context.parent).toBe(scene);
      return {
        ...data,
        width: 1,
        height: 1,
        toObject() {
          return { ...data, width: 1, height: 1 };
        },
      };
    },
  };
  const pack: any = {
    collection: "pf2e.bestiary",
    metadata: { system: "pf2e" },
    documentName: "Actor",
  };
  const makeCreatedActor = (data: any) => ({
    ...structuredClone(data),
    id: "new-actor-" + calls.creates.length,
    uuid: "Actor.new-actor-" + calls.creates.length,
    documentName: "Actor",
    type: "npc",
    system: structuredClone(data.system),
    applyAdjustment: async (value: any) => {
      calls.adjustments.push(value);
      data.system.attributes.adjustment = value;
    },
    getTokenDocument: async (tokenData: any, context: any) => {
      expect(context.parent).toBe(scene);
      return {
        ...tokenData,
        width: 1,
        height: 1,
        toObject() {
          return { ...tokenData, width: 1, height: 1 };
        },
      };
    },
  });
  const actors: any = {
    fromCompendium: vi.fn((document: any, options: any) => {
      calls.fromOptions = options;
      return document.toObject();
    }),
    documentClass: {
      create: vi.fn(async (data: any, options: any) => {
        calls.creates.push({ data, options });
        return makeCreatedActor(data);
      }),
    },
  };
  const scene: any = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    grid: { size: 100 },
    dimensions: { sceneRect: { x: 0, y: 0, width: 1000, height: 1000 } },
    createEmbeddedDocuments:
      options.tokenCreate ??
      vi.fn(async (_type, rows) => {
        const token = {
          uuid: "Scene.scene.Token.token-" + (calls.tokens.length + 1),
          data: rows[0],
        };
        calls.tokens.push(token);
        return [token];
      }),
  };
  const folder = {
    id: "folder",
    uuid: "Folder.folder",
    documentName: "Folder",
    type: "Actor",
    compendium: null,
  };
  const resolved = new Map<string, any>([
    [source.uuid, source],
    [scene.uuid, scene],
    [folder.uuid, folder],
  ]);
  const ctx: PF2eContext = {
    game: {
      system: { id: "pf2e", version: "6.0.0" },
      pf2e: {},
      settings: { get: () => true },
      packs: {
        get: (id: string) => (id === pack.collection ? pack : undefined),
      },
      actors,
      items: { fromCompendium: vi.fn(), documentClass: { create: vi.fn() } },
      folders: new Map([[folder.id, folder]]),
    },
    resolve: async (uuid) => resolved.get(uuid),
    assertWrite: options.assertWrite ?? (() => {}),
    serialize: (document) => ({ uuid: document.uuid, data: document }),
  };
  source.parent = null;
  return { ctx, source, scene, calls, pack, folder, resolved };
}

describe("PF2e write adapter", () => {
  it("imports native compendium data with a new root id and preserved rules and embedded ids", async () => {
    const { ctx, source, calls } = makeContext();
    const result: any = await handlePF2eWrite(
      "pf2e_import_document",
      { uuid: source.uuid, adjustment: "normal" },
      ctx,
    );
    const data = calls.creates[0].data;
    expect(calls.fromOptions).toMatchObject({
      keepId: false,
      clearOwnership: true,
      clearFolder: true,
      clearSort: true,
      clearState: true,
    });
    expect(calls.creates[0].options).toMatchObject({
      keepId: false,
      keepEmbeddedIds: true,
    });
    expect(data._id).toBeUndefined();
    expect(data.root_id).toBeUndefined();
    expect(data.ownership).toBeUndefined();
    expect(data.flags.pf2e.linkToActorSize).toBe(true);
    expect(data.system.rules[0].uuid).toBe("Compendium.pf2e.spells.Item.heal");
    expect(data.items[0]._id).toBe("spellcasting-entry-id");
    expect(data.items[1]._id).toBe("embedded-spell-id");
    expect(data.items[1].system.location.value).toBe(data.items[0]._id);
    expect(calls.adjustments).toEqual([null]);
    expect(source.system.attributes.adjustment).toBeNull();
    expect(result.uuid).toMatch(/^Actor\.new-actor-/);
  });

  it("uses the native elite adjustment after creating an independent NPC", async () => {
    const { ctx, source, calls } = makeContext();
    await handlePF2eWrite(
      "pf2e_import_document",
      { uuid: source.uuid, adjustment: "elite" },
      ctx,
    );
    expect(calls.adjustments).toEqual(["elite"]);
    expect(source.system.attributes.adjustment).toBeNull();
  });

  it("rejects unsupported roots and unsupported adjustments before any create", async () => {
    const unsupported = makeContext({
      sourceData: { ...pnglessSourceData, type: "character" },
    });
    await expect(
      handlePF2eWrite(
        "pf2e_import_document",
        { uuid: unsupported.source.uuid },
        unsupported.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNSUPPORTED_SOURCE" });
    expect(unsupported.calls.creates).toHaveLength(0);

    const item = makeContext({
      sourceData: { ...pnglessSourceData, type: "spell" },
    });
    item.source.documentName = "Item";
    item.source.type = "spell";
    await expect(
      handlePF2eWrite(
        "pf2e_import_document",
        { uuid: item.source.uuid, adjustment: "elite" },
        item.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_INVALID_ADJUSTMENT" });
    expect(item.calls.creates).toHaveLength(0);
  });

  it("stages tokens using async native token documents with scene context and reuses imported actors", async () => {
    const { ctx, source, calls, scene } = makeContext();
    const result: any = await handlePF2eWrite(
      "pf2e_stage_encounter",
      {
        sceneUuid: scene.uuid,
        placements: [
          { uuid: source.uuid, x: 0, y: 0, adjustment: "elite", hidden: true },
          {
            uuid: source.uuid,
            x: 100,
            y: 0,
            adjustment: "elite",
            hidden: true,
          },
        ],
      },
      ctx,
    );
    expect(calls.creates).toHaveLength(1);
    expect(calls.adjustments).toEqual(["elite"]);
    expect(calls.tokens).toHaveLength(2);
    expect(result.placements).toHaveLength(2);
    expect(calls.tokens[0].data.hidden).toBe(true);
    expect(calls.tokens[0].data.actorLink).toBe(false);
  });

  it("normalizes an adjusted world NPC clone without changing the original", async () => {
    const env = makeContext({
      sourceData: {
        ...pnglessSourceData,
        system: {
          ...pnglessSourceData.system,
          attributes: { adjustment: "elite" },
        },
      },
    });
    env.source.uuid = "Actor.world-elite";
    env.source.pack = null;
    env.source.compendium = null;
    env.resolved.set(env.source.uuid, env.source);

    await handlePF2eWrite(
      "pf2e_stage_encounter",
      {
        sceneUuid: env.scene.uuid,
        placements: [
          {
            uuid: env.source.uuid,
            x: 0,
            y: 0,
            adjustment: "normal",
            hidden: true,
          },
        ],
      },
      env.ctx,
    );

    expect(env.calls.creates).toHaveLength(1);
    expect(env.calls.adjustments).toEqual([null]);
    expect(env.source.system.attributes.adjustment).toBe("elite");
    expect(env.source.applyAdjustment).not.toHaveBeenCalled();
    expect(env.source.flags.pf2e.linkToActorSize).toBe(true);
  });

  it("reuses an unadjusted world NPC for a normal placement", async () => {
    const env = makeContext();
    env.source.uuid = "Actor.world-normal";
    env.source.pack = null;
    env.source.compendium = null;
    env.resolved.set(env.source.uuid, env.source);

    const result: any = await handlePF2eWrite(
      "pf2e_stage_encounter",
      {
        sceneUuid: env.scene.uuid,
        placements: [
          {
            uuid: env.source.uuid,
            x: 0,
            y: 0,
            adjustment: "normal",
            hidden: true,
          },
        ],
      },
      env.ctx,
    );

    expect(env.calls.creates).toHaveLength(0);
    expect(env.calls.tokens).toHaveLength(1);
    expect(result.placements[0].actorUuid).toBe(env.source.uuid);
  });

  it("does not mutate when the write session expires after asynchronous preflight", async () => {
    let valid = true;
    const env = makeContext({
      assertWrite: () => {
        if (!valid)
          throw Object.assign(new Error("stale"), { code: "STALE_SESSION" });
      },
    });
    const originalResolve = env.ctx.resolve;
    env.ctx.resolve = async (uuid) => {
      const result = await originalResolve(uuid);
      if (uuid === env.source.uuid) valid = false;
      return result;
    };
    await expect(
      handlePF2eWrite(
        "pf2e_stage_encounter",
        {
          sceneUuid: env.scene.uuid,
          placements: [
            {
              uuid: env.source.uuid,
              x: 0,
              y: 0,
              adjustment: "normal",
              hidden: true,
            },
          ],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
    expect(env.calls.creates).toHaveLength(0);
    expect(env.calls.tokens).toHaveLength(0);
  });

  it("reports partial token failure with known actor UUIDs and unknown token outcome", async () => {
    const env = makeContext({
      tokenCreate: vi.fn(async () => {
        throw new Error("connection lost after send");
      }),
    });
    await expect(
      handlePF2eWrite(
        "pf2e_stage_encounter",
        {
          sceneUuid: env.scene.uuid,
          placements: [
            {
              uuid: env.source.uuid,
              x: 0,
              y: 0,
              adjustment: "elite",
              hidden: true,
            },
          ],
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: {
        createdActors: ["Actor.new-actor-1"],
        failedPlacementIndex: 0,
        outcomeUnknown: true,
      },
    });
  });
});
