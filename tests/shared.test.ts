import { describe, expect, it } from "vitest";
import {
  parseTool,
  toolNames,
  writeTools,
  destructiveTools,
} from "@foundry-mcp/shared";

describe("shared MCP tool contracts", () => {
  it("publishes the agreed tool set", () => {
    expect(toolNames).toEqual([
      "pf2e_combat_context",
      "pf2e_roll_strike",
      "pf2e_roll_damage",
      "pf2e_roll_check",
      "pf2e_inspect_actions",
      "pf2e_roll_initiative",
      "start_encounter",
      "next_turn",
      "list_encounters",
      "inspect_encounter",
      "create_encounter",
      "add_combatants",
      "remove_combatants",
      "session_snapshot",
      "pf2e_inspect_conditions",
      "pf2e_inspect_damage_application",
      "pf2e_apply_damage",
      "pf2e_set_condition",
      "pf2e_adjust_condition",
      "pf2e_apply_effect",
      "pf2e_remove_effect",
      "pf2e_inventory",
      "pf2e_add_inventory_item",
      "pf2e_set_item_quantity",
      "pf2e_transfer_item",
      "pf2e_add_coins",
      "pf2e_create_loot",
      "pf2e_status",
      "pf2e_search_compendium",
      "pf2e_party_summary",
      "pf2e_import_document",
      "pf2e_analyze_encounter",
      "pf2e_stage_encounter",
      "search_content",
      "list_folders",
      "create_folder",
      "move_document",
      "browse_assets",
      "upload_asset",
      "inspect_scene",
      "add_map_note",
      "get_status",
      "discover_types",
      "search_world",
      "list_compendiums",
      "search_compendium",
      "get_document",
      "create_document",
      "update_document",
      "create_embedded",
      "import_compendium",
    ]);
  });
  it("validates v0.7 combat selectors and expected state", () => {
    const current = {
      encounterUuid: "Combat.a",
      attackerTokenUuid: "Scene.s.Token.attacker",
      targetTokenUuid: "Scene.s.Token.target",
      strikeIndex: 0,
      strikeSlug: "longsword",
      strikeItemUuid: "Actor.a.Item.sword",
      expectedRound: 1,
      expectedTurn: 0,
      expectedCombatantUuid: "Combat.a.Combatant.a",
    };
    expect(
      parseTool("pf2e_combat_context", { encounterUuid: "Combat.a" }).args,
    ).toMatchObject({ offset: 0, limit: 25 });
    expect(parseTool("pf2e_roll_strike", current).args).toMatchObject({
      attackNumber: 1,
    });
    expect(parseTool("pf2e_roll_damage", current).args).toMatchObject({
      attackNumber: 1,
      critical: false,
    });
    expect(() =>
      parseTool("pf2e_roll_strike", { ...current, attackNumber: 4 }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_roll_damage", { ...current, strikeIndex: -1 }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_roll_strike", { ...current, expectedRound: 0 }),
    ).toThrow();
    for (const tool of ["pf2e_roll_strike", "pf2e_roll_damage"] as const) {
      expect(writeTools.has(tool)).toBe(true);
      expect(destructiveTools.has(tool)).toBe(false);
    }
    expect(writeTools.has("pf2e_combat_context")).toBe(false);
  });
  it("validates v0.8 damage application options and classifications", () => {
    const base = {
      messageUuid: "ChatMessage.damage",
      targetTokenUuid: "Scene.s.Token.t",
    };
    expect(
      parseTool("pf2e_inspect_damage_application", base).args,
    ).toMatchObject({
      rollIndex: 0,
      operation: "damage",
      multiplier: 1,
      shieldBlock: false,
    });
    expect(
      parseTool("pf2e_inspect_damage_application", {
        ...base,
        operation: "healing",
        multiplier: 0.5,
      }).args,
    ).toMatchObject({ operation: "healing", multiplier: 0.5 });
    expect(() =>
      parseTool("pf2e_inspect_damage_application", { ...base, rollIndex: 10 }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_inspect_damage_application", {
        ...base,
        shieldBlock: true,
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_inspect_damage_application", {
        ...base,
        shieldItemUuid: "Actor.a.Item.shield",
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_inspect_damage_application", {
        ...base,
        operation: "healing",
        shieldBlock: true,
        shieldItemUuid: "Actor.a.Item.shield",
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_apply_damage", { ...base, reviewToken: "A".repeat(64) }),
    ).toThrow();
    expect(
      parseTool("pf2e_apply_damage", {
        ...base,
        reviewToken: "a".repeat(64),
        shieldBlock: true,
        shieldItemUuid: "Actor.a.Item.shield",
      }).args,
    ).toMatchObject({ shieldBlock: true });
    expect(writeTools.has("pf2e_inspect_damage_application")).toBe(false);
    expect(destructiveTools.has("pf2e_inspect_damage_application")).toBe(false);
    expect(writeTools.has("pf2e_apply_damage")).toBe(true);
    expect(destructiveTools.has("pf2e_apply_damage")).toBe(true);
  });
  it("validates v0.6 check and combat controls", () => {
    expect(
      parseTool("pf2e_roll_check", {
        targetUuid: "Actor.a",
        statistic: "stealth",
      }).args,
    ).toMatchObject({ messageMode: "gm" });
    expect(() =>
      parseTool("pf2e_roll_check", {
        targetUuid: "Actor.a",
        statistic: "bad slug",
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_roll_check", {
        targetUuid: "Actor.a",
        statistic: "will",
        dc: 101,
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_inspect_actions", { targetUuid: "Actor.a" }).args,
    ).toMatchObject({ offset: 0, limit: 25 });
    expect(
      parseTool("pf2e_roll_initiative", {
        encounterUuid: "Combat.a",
        combatantUuids: ["Combat.a.Combatant.b"],
      }).args,
    ).toMatchObject({ reroll: false, messageMode: "gm" });
    expect(() =>
      parseTool("pf2e_roll_initiative", {
        encounterUuid: "Combat.a",
        combatantUuids: ["Combatant.a", "Combatant.a"],
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_roll_initiative", {
        encounterUuid: "Combat.a",
        combatantUuids: [],
      }),
    ).toThrow();
    expect(
      parseTool("start_encounter", { encounterUuid: "Combat.a" }).tool,
    ).toBe("start_encounter");
    expect(
      parseTool("next_turn", {
        encounterUuid: "Combat.a",
        expectedRound: 1,
        expectedTurn: 0,
        expectedCombatantUuid: "Combatant.a",
      }).tool,
    ).toBe("next_turn");
    expect(() =>
      parseTool("next_turn", {
        encounterUuid: "Combat.a",
        expectedRound: 0,
        expectedTurn: 0,
        expectedCombatantUuid: "Combatant.a",
      }),
    ).toThrow();
    for (const tool of [
      "pf2e_roll_check",
      "pf2e_roll_initiative",
      "start_encounter",
      "next_turn",
    ] as const)
      expect(writeTools.has(tool)).toBe(true);
    expect(writeTools.has("pf2e_inspect_actions")).toBe(false);
    for (const tool of [
      "pf2e_roll_initiative",
      "start_encounter",
      "next_turn",
    ] as const)
      expect(destructiveTools.has(tool)).toBe(true);
    expect(destructiveTools.has("pf2e_roll_check")).toBe(false);
  });
  it("validates bounded encounter and snapshot inputs and classifies writes", () => {
    expect(parseTool("list_encounters", {}).args).toMatchObject({
      offset: 0,
      limit: 25,
    });
    expect(() =>
      parseTool("add_combatants", {
        encounterUuid: "Combat.a",
        tokenUuids: [],
      }),
    ).toThrow();
    expect(() =>
      parseTool("add_combatants", {
        encounterUuid: "Combat.a",
        tokenUuids: ["Scene.a.Token.b", "Scene.a.Token.b"],
      }),
    ).toThrow();
    expect(() =>
      parseTool("remove_combatants", {
        encounterUuid: "Combat.a",
        combatantUuids: Array.from({ length: 41 }, (_, i) => `Combatant.${i}`),
      }),
    ).toThrow();
    expect(parseTool("session_snapshot", {}).args).toMatchObject({
      encounterUuids: [],
      journalUuids: [],
    });
    expect(() =>
      parseTool("session_snapshot", {
        journalUuids: Array.from({ length: 11 }, (_, i) => `JournalEntry.${i}`),
      }),
    ).toThrow();
    expect(writeTools.has("create_encounter")).toBe(true);
    expect(writeTools.has("add_combatants")).toBe(true);
    expect(writeTools.has("remove_combatants")).toBe(true);
    expect(destructiveTools.has("remove_combatants")).toBe(true);
    expect(writeTools.has("session_snapshot")).toBe(false);
  });
  it("applies bounded pagination defaults", () => {
    expect(parseTool("search_world", { documentType: "Actor" }).args).toEqual({
      documentType: "Actor",
      query: "",
      offset: 0,
      limit: 25,
    });
    expect(() => parseTool("list_compendiums", { offset: -1 })).toThrow();
    expect(() => parseTool("list_compendiums", { limit: 101 })).toThrow();
  });
  it("rejects unknown tools and invalid inputs", () => {
    expect(() => parseTool("eval", {})).toThrow("Unsupported tool");
    expect(() =>
      parseTool("create_document", { documentType: "Macro", data: {} }),
    ).toThrow();
    expect(() =>
      parseTool("import_compendium", { uuid: "Actor.abc" }),
    ).toThrow();
  });

  it("validates discovery, folder, asset, scene, and map-note contracts", () => {
    expect(
      parseTool("search_content", {
        query: "storm",
        documentType: "JournalEntry",
      }).args,
    ).toMatchObject({ offset: 0, limit: 25 });
    expect(() => parseTool("search_content", { query: "" })).toThrow();
    expect(
      parseTool("create_folder", {
        name: "Places",
        documentType: "JournalEntry",
      }).tool,
    ).toBe("create_folder");
    expect(
      parseTool("move_document", { uuid: "Actor.a", folderUuid: "Folder.b" })
        .args,
    ).toMatchObject({ folderUuid: "Folder.b" });
    expect(() => parseTool("move_document", { uuid: "Actor.a" })).toThrow();
    expect(() =>
      parseTool("upload_asset", {
        filename: "map.svg",
        mimeType: "image/svg+xml",
        dataBase64: "AA==",
      }),
    ).toThrow();
    expect(() =>
      parseTool("upload_asset", {
        filename: "map.png",
        mimeType: "image/png",
        dataBase64: "A".repeat(11_184_813),
      }),
    ).toThrow();
    expect(parseTool("inspect_scene", { uuid: "Scene.a" }).args).toEqual({
      uuid: "Scene.a",
    });
    expect(() =>
      parseTool("add_map_note", {
        sceneUuid: "Scene.a",
        journalUuid: "JournalEntry.b",
        x: NaN,
        y: 0,
      }),
    ).toThrow();
    expect(writeTools.has("create_folder")).toBe(true);
    expect(writeTools.has("move_document")).toBe(true);
    expect(writeTools.has("upload_asset")).toBe(true);
    expect(writeTools.has("add_map_note")).toBe(true);
    expect(writeTools.has("search_content")).toBe(false);
    expect(writeTools.has("browse_assets")).toBe(false);
    expect(writeTools.has("inspect_scene")).toBe(false);
  });

  it("validates PF2e query, party, import, analysis, and staging contracts", () => {
    expect(parseTool("pf2e_status", {}).tool).toBe("pf2e_status");
    expect(
      parseTool("pf2e_search_compendium", {
        kind: "creature",
        levelMin: 1,
        levelMax: 4,
      }).args,
    ).toMatchObject({
      kind: "creature",
      levelMin: 1,
      levelMax: 4,
      offset: 0,
      limit: 25,
    });
    expect(
      parseTool("pf2e_search_compendium", {
        kind: "hazard",
        complexity: "complex",
      }).args,
    ).toMatchObject({ kind: "hazard", complexity: "complex" });
    expect(() =>
      parseTool("pf2e_search_compendium", {
        kind: "hazard",
        complexity: "extreme",
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_search_compendium", {
        kind: "creature",
        levelMin: 4,
        levelMax: 1,
      }),
    ).toThrow();
    expect(() =>
      parseTool("pf2e_search_compendium", {
        kind: "equipment",
        priceMinCp: 100,
        priceMaxCp: 10,
      }),
    ).toThrow();
    expect(parseTool("pf2e_party_summary", {}).tool).toBe("pf2e_party_summary");
    expect(
      parseTool("pf2e_import_document", {
        uuid: "Compendium.pf2e-creatures.Actor.abc",
        adjustment: "elite",
      }).args,
    ).toMatchObject({ adjustment: "elite" });
    expect(() =>
      parseTool("pf2e_analyze_encounter", {
        participants: [{ uuid: "Actor.a" }],
        partyLevel: 3,
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_analyze_encounter", {
        participants: [{ uuid: "Actor.a" }],
        partyLevel: 3,
        partySize: 4,
      }).tool,
    ).toBe("pf2e_analyze_encounter");
    expect(() =>
      parseTool("pf2e_analyze_encounter", {
        participants: Array.from({ length: 20 }, (_, i) => ({
          uuid: `Actor.${i}`,
          quantity: 20,
        })),
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_stage_encounter", {
        sceneUuid: "Scene.a",
        placements: [
          { uuid: "Compendium.pf2e-creatures.Actor.a", x: 20, y: 30 },
        ],
      }).args,
    ).toMatchObject({ placements: [{ adjustment: "normal", hidden: true }] });
    expect(writeTools.has("pf2e_import_document")).toBe(true);
    expect(writeTools.has("pf2e_stage_encounter")).toBe(true);
    expect(writeTools.has("pf2e_analyze_encounter")).toBe(false);
  });

  it("validates PF2e condition, effect, inventory, and loot contracts", () => {
    expect(
      parseTool("pf2e_inspect_conditions", { targetUuid: "Actor.a" }).tool,
    ).toBe("pf2e_inspect_conditions");
    expect(
      parseTool("pf2e_set_condition", {
        targetUuid: "Actor.a",
        slug: "frightened",
        value: 2,
      }).args,
    ).toMatchObject({ slug: "frightened", value: 2 });
    expect(() =>
      parseTool("pf2e_set_condition", {
        targetUuid: "Actor.a",
        slug: "bad slug",
        value: 0,
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_adjust_condition", {
        targetUuid: "Actor.a",
        conditionUuid: "Actor.a.Item.c",
        operation: "decrease",
      }).tool,
    ).toBe("pf2e_adjust_condition");
    expect(() =>
      parseTool("pf2e_adjust_condition", {
        targetUuid: "Actor.a",
        conditionUuid: "Item.c",
        operation: "increment",
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_apply_effect", {
        targetUuid: "Actor.a",
        uuid: "Compendium.pf2e.effects.Item.bless",
      }).tool,
    ).toBe("pf2e_apply_effect");
    expect(
      parseTool("pf2e_remove_effect", {
        targetUuid: "Actor.a",
        effectUuid: "Actor.a.Item.effect",
      }).tool,
    ).toBe("pf2e_remove_effect");
    expect(
      parseTool("pf2e_inventory", { actorUuid: "Actor.a" }).args,
    ).toMatchObject({ offset: 0, limit: 25 });
    expect(
      parseTool("pf2e_add_inventory_item", {
        actorUuid: "Actor.a",
        uuid: "Compendium.pf2e.equipment.Item.rope",
      }).args,
    ).toMatchObject({ quantity: 1, newStack: false });
    expect(() =>
      parseTool("pf2e_add_inventory_item", {
        actorUuid: "Actor.a",
        uuid: "Compendium.pf2e.equipment.Item.rope",
        quantity: 10_000,
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_set_item_quantity", {
        actorUuid: "Actor.a",
        itemUuid: "Actor.a.Item.rope",
        quantity: 2,
      }).tool,
    ).toBe("pf2e_set_item_quantity");
    expect(
      parseTool("pf2e_transfer_item", {
        sourceActorUuid: "Actor.a",
        targetActorUuid: "Actor.b",
        itemUuid: "Actor.a.Item.rope",
        quantity: 1,
      }).args,
    ).toMatchObject({ newStack: false });
    expect(
      parseTool("pf2e_add_coins", { actorUuid: "Actor.a", coins: { gp: 2 } })
        .args.coins,
    ).toMatchObject({ pp: 0, gp: 2, sp: 0, cp: 0 });
    expect(() =>
      parseTool("pf2e_add_coins", {
        actorUuid: "Actor.a",
        coins: { gp: 0, sp: 0 },
      }),
    ).toThrow();
    expect(
      parseTool("pf2e_create_loot", { name: "Recovered Gear" }).args,
    ).toMatchObject({ items: [] });
    expect(() =>
      parseTool("pf2e_create_loot", {
        name: "",
        items: Array.from({ length: 21 }, () => ({
          uuid: "Compendium.pf2e.equipment.Item.rope",
        })),
      }),
    ).toThrow();
    for (const tool of [
      "pf2e_set_condition",
      "pf2e_adjust_condition",
      "pf2e_remove_effect",
      "pf2e_set_item_quantity",
      "pf2e_transfer_item",
    ] as const) {
      expect(writeTools.has(tool)).toBe(true);
      expect(destructiveTools.has(tool)).toBe(true);
    }
    for (const tool of [
      "pf2e_apply_effect",
      "pf2e_add_inventory_item",
      "pf2e_add_coins",
      "pf2e_create_loot",
    ] as const) {
      expect(writeTools.has(tool)).toBe(true);
      expect(destructiveTools.has(tool)).toBe(false);
    }
    expect(writeTools.has("pf2e_inspect_conditions")).toBe(false);
    expect(writeTools.has("pf2e_inventory")).toBe(false);
  });
});
