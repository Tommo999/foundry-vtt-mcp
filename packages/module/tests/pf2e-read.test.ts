import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eRead, pf2eStatus, requirePF2e } from "../src/pf2e";
import type { PF2eContext } from "../src/pf2e-context";

let ctx: PF2eContext;
function requestAwarePack(
  collection: string,
  documentName: string,
  sourceRows: any[],
  initialFields: string[] = [],
) {
  const loaded = new Set<string>();
  const indexedRows: any[] = sourceRows.map((row) => ({
    _id: row._id,
    uuid: row.uuid,
    name: row.name,
  }));
  const readPath = (value: any, path: string) =>
    path.split(".").reduce((current, key) => current?.[key], value);
  const assignPath = (target: any, path: string, value: any) => {
    const parts = path.split(".");
    for (const part of parts.slice(0, -1)) {
      if (target[part] == null) target[part] = {};
      if (typeof target[part] !== "object")
        throw new TypeError(
          `Cannot create property 'value' on number '${target[part]}'`,
        );
      target = target[part];
    }
    target[parts.at(-1)!] = value;
  };
  for (const field of initialFields) {
    sourceRows.forEach((row, index) =>
      assignPath(indexedRows[index], field, readPath(row, field)),
    );
    loaded.add(field);
  }
  const getIndex = vi.fn(async ({ fields }: { fields: string[] }) => {
    // Model incremental Foundry index loading: only newly requested fields
    // are projected onto persistent cached rows through dotted assignments.
    for (const field of fields) {
      if (loaded.has(field)) continue;
      sourceRows.forEach((row, index) =>
        assignPath(indexedRows[index], field, readPath(row, field)),
      );
      loaded.add(field);
    }
    return indexedRows;
  });
  return { collection, documentName, getIndex };
}
function cachedIndexPack(
  collection: string,
  documentName: string,
  alreadyLoadedRows: any[],
) {
  return {
    collection,
    documentName,
    // These rows represent fields already present in a cached Foundry index.
    getIndex: vi.fn(async () => alreadyLoadedRows),
  };
}
beforeEach(() => {
  ctx = {
    game: {
      system: { id: "pf2e", version: "7.1.0" },
      settings: {
        get: (_m: string, key: string) =>
          key === "pf2eEnabled" ? true : undefined,
      },
      pf2e: {
        gm: {
          calculateXP: vi.fn(
            (
              partyLevel: number,
              partySize: number,
              npcs: number[],
              hazards: any[],
              options: any,
            ) => ({
              partyLevel,
              partySize,
              totalXP: npcs.length * 40 + hazards.length * 30,
              rating: "low",
              ratingXP: 30,
              xpPerPlayer: 10,
              encounterBudgets: { low: 60 },
              args: { npcs, hazards, options },
            }),
          ),
        },
        settings: { variants: { pwol: { enabled: false } } },
      },
      actors: { party: null },
      packs: [],
    },
    resolve: vi.fn(),
    assertWrite: vi.fn(),
    serialize: (doc: any) => doc,
  };
});

describe("PF2e optional read adapter", () => {
  it("reports availability and per-operation APIs without guessing on another system", () => {
    ctx.game.system = { id: "dnd5e", version: "4" };
    expect(() => requirePF2e(ctx)).toThrow(/PF2e/);
    expect(pf2eStatus(ctx)).toMatchObject({
      available: false,
      systemId: "dnd5e",
      version: "4",
      capabilities: { encounterAnalysis: false },
    });
  });
  it("searches only indexed eligible packs and applies structured filters", async () => {
    const rows = [
      {
        _id: "a",
        name: "Steel Shield",
        type: "shield",
        system: {
          level: { value: 2 },
          traits: { value: ["common", "metal"], rarity: "common" },
          price: { value: { gp: 2, sp: 0, cp: 0 }, per: 2 },
        },
      },
      {
        _id: "b",
        name: "Gold Shield",
        type: "shield",
        system: {
          level: { value: 3 },
          traits: { value: ["rare"], rarity: "rare" },
          price: { value: { gp: 4 }, per: 1 },
        },
      },
      {
        _id: "c",
        name: "Unpriced",
        type: "equipment",
        system: {
          level: { value: 1 },
          traits: { value: ["common"], rarity: "common" },
        },
      },
    ];
    const getIndex = vi.fn(async () => rows);
    ctx.game.packs = [
      { collection: "pf2e.equipment", documentName: "Item", getIndex },
    ];
    const result: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "equipment",
        query: "shield",
        traits: ["metal"],
        rarities: ["common"],
        priceMinCp: 100,
        priceMaxCp: 100,
        offset: 0,
        limit: 10,
      },
      ctx,
    );
    expect(getIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining(["system.price"]),
      }),
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      uuid: "Compendium.pf2e.equipment.Item.a",
      level: 2,
      priceCp: 100,
      priceBasis: "listed price per unit",
    });
  });
  it("loads compatible fields from a cold or warm index and finds Goblin Warrior", async () => {
    const rows = [
      {
        _id: "goblin",
        name: "Goblin Warrior",
        type: "npc",
        system: {
          details: { level: { value: -1 } },
          traits: {
            value: ["goblin", "humanoid"],
            rarity: "common",
            size: { value: "sm" },
          },
        },
      },
      {
        _id: "scalar-level",
        name: "Level Zero Creature",
        type: "npc",
        system: {
          details: { level: { value: 0 } },
          traits: { value: ["common"], rarity: "common", size: "med" },
        },
      },
    ];
    for (const initialFields of [[], ["type"]]) {
      const pack = requestAwarePack(
        "pf2e.pathfinder-monster-core",
        "Actor",
        rows,
        initialFields,
      );
      ctx.game.packs = [pack];
      for (let run = 0; run < 2; run++) {
        const result: any = await handlePF2eRead(
          "pf2e_search_compendium",
          {
            kind: "creature",
            pack: pack.collection,
            query: "Goblin Warrior",
            offset: 0,
            limit: 3,
          },
          ctx,
        );
        expect(result.warnings).toEqual([]);
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toMatchObject({
          uuid: "Compendium.pf2e.pathfinder-monster-core.Actor.goblin",
          level: -1,
          size: "sm",
        });
      }
      expect(pack.getIndex.mock.calls[0][0].fields).toEqual([
        "type",
        "system.details.level.value",
        "system.traits",
      ]);
      const requestedFields = pack.getIndex.mock.calls[0][0].fields;
      expect(
        requestedFields.some((field) =>
          requestedFields.some((parent) => field.startsWith(`${parent}.`)),
        ),
      ).toBe(false);
      const zero: any = await handlePF2eRead(
        "pf2e_search_compendium",
        {
          kind: "creature",
          pack: pack.collection,
          query: "Level Zero",
          levelMin: 0,
          levelMax: 0,
          offset: 0,
          limit: 3,
        },
        ctx,
      );
      expect(zero.warnings).toEqual([]);
      expect(zero.results[0]).toMatchObject({ level: 0, size: "med" });
    }
    const unrestricted: any = await handlePF2eRead(
      "pf2e_search_compendium",
      { kind: "creature", query: "Goblin Warrior", offset: 0, limit: 3 },
      ctx,
    );
    expect(unrestricted.results.map((row: any) => row.name)).toContain(
      "Goblin Warrior",
    );
    expect(unrestricted.warnings).toEqual([]);
  });
  it("models the old parent then child index-field collision on a scalar row", async () => {
    const pack = requestAwarePack("scalar-index", "Actor", [
      {
        _id: "one",
        name: "One",
        type: "npc",
        system: { details: { level: 1 } },
      },
    ]);
    // This request matches the conflicting level paths used before the fix.
    // The mock models dotted assignment into the persistent index; it is not
    // a claim about Foundry's internal implementation beyond that behavior.
    await expect(
      pack.getIndex({
        fields: ["system.details.level", "system.details.level.value"],
      }),
    ).rejects.toThrow("Cannot create property 'value' on number '1'");
  });
  it("normalizes scalar values already present in a cached index", async () => {
    const actors = cachedIndexPack("cached-actors", "Actor", [
      {
        _id: "scalar",
        name: "Scalar Level",
        type: "npc",
        system: {
          details: { level: 0 },
          traits: { value: ["goblin"], rarity: "common", size: "med" },
        },
      },
    ]);
    const items = cachedIndexPack("cached-items", "Item", [
      {
        _id: "free-ammo",
        name: "Free Arrows",
        type: "ammo",
        system: {
          level: 0,
          traits: { value: ["consumable"], size: "sm" },
          price: 0,
        },
      },
    ]);
    ctx.game.packs = [actors, items];
    const creature: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "creature",
        pack: actors.collection,
        levelMin: 0,
        levelMax: 0,
        sizes: ["med"],
        offset: 0,
        limit: 5,
      },
      ctx,
    );
    expect(creature.results[0]).toMatchObject({ level: 0, size: "med" });
    const equipment: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "equipment",
        pack: items.collection,
        itemTypes: ["ammo"],
        levelMin: 0,
        levelMax: 0,
        priceMinCp: 0,
        priceMaxCp: 0,
        offset: 0,
        limit: 5,
      },
      ctx,
    );
    expect(equipment.results[0]).toMatchObject({
      level: 0,
      size: "sm",
      priceCp: 0,
    });
  });
  it("keeps good results when another eligible pack has a broken index", async () => {
    const good = requestAwarePack("good", "Actor", [
      {
        _id: "goblin",
        name: "Goblin Warrior",
        type: "npc",
        system: {
          details: { level: { value: -1 } },
          traits: { value: ["goblin"], rarity: "common", size: "sm" },
        },
      },
    ]);
    ctx.game.packs = [
      {
        collection: "broken",
        documentName: "Actor",
        getIndex: vi.fn().mockRejectedValue(new Error("index failed")),
      },
      good,
    ];
    const result: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "creature",
        query: "Goblin Warrior",
        offset: 0,
        limit: 10,
      },
      ctx,
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("Goblin Warrior");
    expect(result.warnings).toEqual([
      "Could not read pack broken: index failed",
    ]);
  });
  it("distinguishes an empty search and keeps bounded pagination", async () => {
    const pack = requestAwarePack("goblins", "Actor", [
      {
        _id: "a",
        name: "Goblin Warrior",
        type: "npc",
        system: {
          details: { level: { value: -1 } },
          traits: { value: ["goblin"] },
        },
      },
      {
        _id: "b",
        name: "Goblin Scout",
        type: "npc",
        system: {
          details: { level: { value: 0 } },
          traits: { value: ["goblin"] },
        },
      },
    ]);
    ctx.game.packs = [pack];
    const empty: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "creature",
        pack: "goblins",
        query: "dragon",
        offset: 0,
        limit: 1,
      },
      ctx,
    );
    expect(empty).toMatchObject({ total: 0, results: [], warnings: [] });
    const page: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "creature",
        pack: "goblins",
        query: "goblin",
        offset: 1,
        limit: 1,
      },
      ctx,
    );
    expect(page).toMatchObject({ total: 2, offset: 1, limit: 1 });
    expect(page.results).toHaveLength(1);
    expect(page.results[0].name).toBe("Goblin Warrior");
  });
  it("matches hazard complexity and equipment filters with normalized index values", async () => {
    const hazards = requestAwarePack("pf2e.hazards", "Actor", [
      {
        _id: "complex",
        name: "Complex Trap",
        type: "hazard",
        system: {
          details: { level: { value: 0 }, isComplex: true },
          traits: { value: ["trap"], rarity: "common", size: "med" },
        },
      },
      {
        _id: "simple",
        name: "Simple Trap",
        type: "hazard",
        system: {
          details: { level: { value: 1 }, isComplex: false },
          traits: { value: ["trap"], rarity: "common", size: { value: "sm" } },
        },
      },
    ]);
    const ammo = requestAwarePack("pf2e.equipment-srd", "Item", [
      {
        _id: "arrows",
        name: "Arrows",
        type: "ammo",
        system: {
          level: { value: 0 },
          traits: { value: ["consumable"], rarity: "common", size: "med" },
          price: 0,
        },
      },
      {
        _id: "rope",
        name: "Rope",
        type: "equipment",
        system: {
          level: { value: 1 },
          traits: { value: ["rope"], rarity: "common" },
          price: { value: { gp: 1 }, per: 2 },
        },
      },
    ]);
    ctx.game.packs = [hazards, ammo];
    const hazardResult: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "hazard",
        pack: hazards.collection,
        complexity: "complex",
        levelMin: 0,
        levelMax: 0,
        sizes: ["med"],
        offset: 0,
        limit: 10,
      },
      ctx,
    );
    expect(hazardResult.warnings).toEqual([]);
    expect(hazardResult.results[0]).toMatchObject({
      name: "Complex Trap",
      level: 0,
      size: "med",
    });
    const ammoResult: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "equipment",
        pack: ammo.collection,
        itemTypes: ["ammo"],
        levelMin: 0,
        levelMax: 0,
        priceMinCp: 0,
        priceMaxCp: 0,
        offset: 0,
        limit: 10,
      },
      ctx,
    );
    expect(ammoResult.warnings).toEqual([]);
    expect(ammoResult.results[0]).toMatchObject({
      type: "ammo",
      level: 0,
      priceCp: 0,
    });
    expect(ammo.getIndex).toHaveBeenCalledWith({
      fields: ["type", "system.level.value", "system.traits", "system.price"],
    });
    const perUnit: any = await handlePF2eRead(
      "pf2e_search_compendium",
      {
        kind: "equipment",
        pack: ammo.collection,
        itemTypes: ["equipment"],
        priceMinCp: 50,
        priceMaxCp: 50,
        offset: 0,
        limit: 10,
      },
      ctx,
    );
    expect(perUnit.results[0]).toMatchObject({
      name: "Rope",
      priceCp: 50,
      priceBasis: "listed price per unit",
    });
  });
  it("rejects unsupported equipment size filters before reading packs", async () => {
    const getIndex = vi.fn();
    ctx.game.packs = [{ collection: "items", documentName: "Item", getIndex }];
    await expect(
      handlePF2eRead(
        "pf2e_search_compendium",
        {
          kind: "equipment",
          sizes: ["med"],
          offset: 0,
          limit: 10,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(getIndex).not.toHaveBeenCalled();
  });
  it("warns when a selected pack cannot provide its requested index", async () => {
    ctx.game.packs = [
      {
        collection: "bad",
        documentName: "Actor",
        getIndex: vi.fn().mockRejectedValue(new Error("broken index")),
      },
    ];
    const result: any = await handlePF2eRead(
      "pf2e_search_compendium",
      { kind: "creature", pack: "bad", query: "", offset: 0, limit: 5 },
      ctx,
    );
    expect(result.results).toEqual([]);
    expect(result.warnings.join(" ")).toContain("broken index");
  });
  it("summarizes party members and reports unavailable statistics as null", async () => {
    const member = {
      documentName: "Actor",
      type: "character",
      uuid: "Actor.pc",
      name: "Mira",
      level: 2,
      perception: { mod: 8 },
      skills: { athletics: { mod: 7 } },
      system: {
        details: { languages: { value: ["common"] } },
        attributes: { hp: { value: 22 } },
        saves: { fortitude: { value: 9 } },
      },
      armorClass: { value: 18 },
      conditions: [{ name: "frightened", active: true, value: 2 }],
    };
    ctx.game.actors.party = {
      documentName: "Actor",
      type: "party",
      uuid: "Actor.party",
      members: [member],
    };
    const result: any = await handlePF2eRead("pf2e_party_summary", {}, ctx);
    expect(result.members[0]).toMatchObject({
      uuid: "Actor.pc",
      level: 2,
      perception: 8,
      preparedSkills: { athletics: 7 },
      armorClass: 18,
      hitPoints: { value: 22, max: null, temp: null },
      conditions: [{ name: "frightened", active: true, value: 2 }],
      saves: { fortitude: 9, reflex: null, will: null },
    });
  });
  it("requires explicit party values for mixed levels", async () => {
    ctx.game.actors.party = {
      documentName: "Actor",
      type: "party",
      uuid: "Actor.party",
      members: [
        { uuid: "Actor.a", type: "character", level: 1 },
        { uuid: "Actor.b", type: "character", level: 2 },
      ],
    };
    await expect(
      handlePF2eRead(
        "pf2e_analyze_encounter",
        {
          participants: [
            { uuid: "Actor.npc", quantity: 1, adjustment: "normal" },
          ],
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(ctx.game.pf2e.gm.calculateXP).not.toHaveBeenCalled();
  });
  it("analyzes encounter with native PF2e calculator and ephemeral adjustments", async () => {
    const original = {
      documentName: "Actor",
      compendium: {},
      type: "npc",
      name: "Wolf",
      level: 3,
      clone: vi.fn(() => ({
        documentName: "Actor",
        type: "npc",
        name: "Wolf Elite",
        level: 4,
        persisted: false,
        applyAdjustment: vi.fn(),
      })),
    };
    const hazard = {
      documentName: "Actor",
      compendium: {},
      type: "hazard",
      name: "Trap",
      level: 2,
      system: { details: { level: { value: 2 }, isComplex: false } },
      clone: vi.fn(() => ({
        documentName: "Actor",
        type: "hazard",
        name: "Trap",
        level: 2,
        persisted: false,
        system: { details: { level: { value: 2 }, isComplex: false } },
        applyAdjustment: vi.fn(),
      })),
    };
    (ctx.resolve as any).mockImplementation(async (uuid: string) =>
      uuid.includes("hazard") ? hazard : original,
    );
    ctx.game.actors.party = {
      documentName: "Actor",
      type: "party",
      uuid: "Actor.party",
      members: [
        { uuid: "Actor.a", type: "character", level: 3 },
        { uuid: "Actor.b", type: "character", level: 3 },
      ],
    };
    const result: any = await handlePF2eRead(
      "pf2e_analyze_encounter",
      {
        participants: [
          { uuid: "Compendium.pf2e.wolf", quantity: 2, adjustment: "elite" },
          { uuid: "Compendium.pf2e.hazard", quantity: 1, adjustment: "normal" },
        ],
      },
      ctx,
    );
    expect(original.clone).toHaveBeenCalledWith(
      {},
      { save: false, keepId: false },
    );
    expect(hazard.clone).not.toHaveBeenCalled();
    expect(
      original.clone.mock.results[0].value.applyAdjustment,
    ).toHaveBeenCalledWith("elite");
    expect(hazard.system.details.isComplex).toBe(false);
    expect(result.totalXP).toBe(110);
    expect(result.participants).toHaveLength(2);
    expect(ctx.assertWrite).not.toHaveBeenCalled();
    expect(original).not.toHaveProperty("update");
  });
  it("fails when the native PF2e XP or PWOL API is unavailable", async () => {
    ctx.game.actors.party = {
      documentName: "Actor",
      type: "party",
      uuid: "Actor.party",
      members: [{ uuid: "Actor.a", type: "character", level: 3 }],
    };
    delete ctx.game.pf2e.settings.variants.pwol.enabled;
    await expect(
      handlePF2eRead(
        "pf2e_analyze_encounter",
        {
          participants: [
            { uuid: "Actor.npc", quantity: 1, adjustment: "normal" },
          ],
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_API" });
  });
  it("uses explicit encounter party size and level without a party actor", async () => {
    const hazard = {
      documentName: "Actor",
      type: "hazard",
      level: 2,
      system: { details: { isComplex: true } },
    };
    (ctx.resolve as any).mockResolvedValue(hazard);
    ctx.game.actors.party = null;
    await handlePF2eRead(
      "pf2e_analyze_encounter",
      {
        partyLevel: 4,
        partySize: 5,
        participants: [
          { uuid: "Actor.hazard", quantity: 1, adjustment: "normal" },
        ],
      },
      ctx,
    );
    expect(ctx.game.pf2e.gm.calculateXP).toHaveBeenLastCalledWith(
      4,
      5,
      [],
      [{ level: 2, isComplex: true }],
      { pwol: false },
    );
  });

  it("does not need hazard clone adjustment APIs and applies PWOL range per hazard complexity", async () => {
    const simple = {
      documentName: "Actor",
      type: "hazard",
      name: "Simple",
      level: 8,
      system: { details: { isComplex: false } },
    };
    const complex = {
      documentName: "Actor",
      type: "hazard",
      name: "Complex",
      level: 8,
      system: { details: { isComplex: true } },
    };
    (ctx.resolve as any).mockImplementation(async (uuid: string) =>
      uuid.includes("simple") ? simple : complex,
    );
    ctx.game.pf2e.settings.variants.pwol.enabled = true;
    await handlePF2eRead(
      "pf2e_analyze_encounter",
      {
        partyLevel: 1,
        partySize: 4,
        participants: [
          { uuid: "Actor.simple", quantity: 1, adjustment: "normal" },
          { uuid: "Actor.complex", quantity: 1, adjustment: "normal" },
        ],
      },
      ctx,
    );
    const call = (ctx.game.pf2e.gm.calculateXP as any).mock.calls.at(-1);
    expect(call[3]).toEqual([
      { level: 8, isComplex: false },
      { level: 8, isComplex: true },
    ]);
  });

  it("awaits native adjustment on a non-persisted clone and uses adjusted level", async () => {
    let level = -1;
    const clone: any = {
      documentName: "Actor",
      type: "npc",
      persisted: false,
      name: "Goblin",
      get level() {
        return level;
      },
      applyAdjustment: vi.fn(async (adjustment: string | null) => {
        await Promise.resolve();
        if (adjustment === "elite") level = 1;
      }),
    };
    const source = {
      documentName: "Actor",
      type: "npc",
      level: -1,
      clone: vi.fn(() => clone),
    };
    (ctx.resolve as any).mockResolvedValue(source);
    ctx.game.actors.party = null;
    await handlePF2eRead(
      "pf2e_analyze_encounter",
      {
        partyLevel: 1,
        partySize: 4,
        participants: [
          { uuid: "Actor.goblin", quantity: 1, adjustment: "elite" },
        ],
      },
      ctx,
    );
    expect(clone.applyAdjustment).toHaveBeenCalledWith("elite");
    expect(ctx.game.pf2e.gm.calculateXP).toHaveBeenLastCalledWith(
      1,
      4,
      [1],
      [],
      { pwol: false },
    );
    expect(source.level).toBe(-1);
  });
});
