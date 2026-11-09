import { z } from "zod";
export const documentTypes = [
  "Actor",
  "Item",
  "JournalEntry",
  "Scene",
] as const;
export const embeddedTypes = ["JournalEntryPage", "Item", "Token"] as const;
const page = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};
const adjustment = z.enum(["normal", "elite", "weak"]).default("normal");
const encounterEntry = z.object({
  uuid: z.string().min(1),
  quantity: z.number().int().min(1).max(20).default(1),
  adjustment,
});
const inventoryQuantity = z.number().int().min(1).max(9999);
const coinsSchema = z.object({
  pp: z.number().int().min(0).max(1_000_000).default(0),
  gp: z.number().int().min(0).max(1_000_000).default(0),
  sp: z.number().int().min(0).max(1_000_000).default(0),
  cp: z.number().int().min(0).max(1_000_000).default(0),
});
const encounterUuidList = z
  .array(z.string().min(1))
  .min(1)
  .max(40)
  .refine((a) => new Set(a).size === a.length, {
    message: "UUIDs must be unique",
  });
export const toolSchemas = {
  pf2e_combat_context: z.object({
    encounterUuid: z.string().min(1),
    targetTokenUuid: z.string().min(1).optional(),
    ...page,
  }),
  pf2e_roll_strike: z.object({
    encounterUuid: z.string().min(1),
    attackerTokenUuid: z.string().min(1),
    targetTokenUuid: z.string().min(1),
    strikeIndex: z.number().int().min(0).max(999),
    strikeSlug: z.string().min(1).max(100),
    strikeItemUuid: z.string().min(1),
    expectedRound: z.number().int().min(1),
    expectedTurn: z.number().int().min(0),
    expectedCombatantUuid: z.string().min(1),
    attackNumber: z.number().int().min(1).max(3).default(1),
  }),
  pf2e_roll_damage: z.object({
    encounterUuid: z.string().min(1),
    attackerTokenUuid: z.string().min(1),
    targetTokenUuid: z.string().min(1),
    strikeIndex: z.number().int().min(0).max(999),
    strikeSlug: z.string().min(1).max(100),
    strikeItemUuid: z.string().min(1),
    expectedRound: z.number().int().min(1),
    expectedTurn: z.number().int().min(0),
    expectedCombatantUuid: z.string().min(1),
    attackNumber: z.number().int().min(1).max(3).default(1),
    critical: z.boolean().default(false),
  }),
  pf2e_roll_check: z.object({
    targetUuid: z.string().min(1),
    statistic: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(80),
    dc: z.number().int().min(0).max(100).optional(),
    messageMode: z.enum(["public", "gm", "blind", "self"]).default("gm"),
  }),
  pf2e_inspect_actions: z.object({ targetUuid: z.string().min(1), ...page }),
  pf2e_roll_initiative: z.object({
    encounterUuid: z.string().min(1),
    combatantUuids: encounterUuidList,
    reroll: z.boolean().default(false),
    messageMode: z.enum(["public", "gm", "blind", "self"]).default("gm"),
  }),
  start_encounter: z.object({ encounterUuid: z.string().min(1) }),
  next_turn: z.object({
    encounterUuid: z.string().min(1),
    expectedRound: z.number().int().min(1),
    expectedTurn: z.number().int().min(0),
    expectedCombatantUuid: z.string().min(1),
  }),
  list_encounters: z.object({
    sceneUuid: z.string().min(1).optional(),
    ...page,
  }),
  inspect_encounter: z.object({ uuid: z.string().min(1), ...page }),
  create_encounter: z.object({ sceneUuid: z.string().min(1) }),
  add_combatants: z.object({
    encounterUuid: z.string().min(1),
    tokenUuids: encounterUuidList,
  }),
  remove_combatants: z.object({
    encounterUuid: z.string().min(1),
    combatantUuids: encounterUuidList,
  }),
  session_snapshot: z.object({
    partyUuid: z.string().min(1).optional(),
    sceneUuid: z.string().min(1).optional(),
    encounterUuids: z.array(z.string().min(1)).max(5).default([]),
    journalUuids: z.array(z.string().min(1)).max(10).default([]),
  }),
  pf2e_inspect_conditions: z.object({ targetUuid: z.string().min(1) }),
  pf2e_inspect_damage_application: z
    .object({
      messageUuid: z.string().min(1),
      targetTokenUuid: z.string().min(1),
      rollIndex: z.number().int().min(0).max(9).default(0),
      operation: z.enum(["damage", "healing"]).default("damage"),
      multiplier: z
        .union([z.literal(0.5), z.literal(1), z.literal(2)])
        .default(1),
      shieldBlock: z.boolean().default(false),
      shieldItemUuid: z.string().min(1).optional(),
    })
    .refine(
      (args) =>
        args.shieldBlock
          ? args.operation === "damage" && Boolean(args.shieldItemUuid)
          : !args.shieldItemUuid,
      {
        message:
          "Shield Block requires damage and an explicit shieldItemUuid; shieldItemUuid is only valid with Shield Block.",
      },
    ),
  pf2e_apply_damage: z
    .object({
      messageUuid: z.string().min(1),
      targetTokenUuid: z.string().min(1),
      rollIndex: z.number().int().min(0).max(9).default(0),
      operation: z.enum(["damage", "healing"]).default("damage"),
      multiplier: z
        .union([z.literal(0.5), z.literal(1), z.literal(2)])
        .default(1),
      shieldBlock: z.boolean().default(false),
      shieldItemUuid: z.string().min(1).optional(),
      reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .refine(
      (args) =>
        args.shieldBlock
          ? args.operation === "damage" && Boolean(args.shieldItemUuid)
          : !args.shieldItemUuid,
      {
        message:
          "Shield Block requires damage and an explicit shieldItemUuid; shieldItemUuid is only valid with Shield Block.",
      },
    ),
  pf2e_set_condition: z.object({
    targetUuid: z.string().min(1),
    slug: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .max(80),
    value: z.number().int().min(1).max(100).optional(),
  }),
  pf2e_adjust_condition: z.object({
    targetUuid: z.string().min(1),
    conditionUuid: z.string().min(1),
    operation: z.enum(["increase", "decrease", "remove"]),
  }),
  pf2e_apply_effect: z.object({
    targetUuid: z.string().min(1),
    uuid: z.string().startsWith("Compendium."),
  }),
  pf2e_remove_effect: z.object({
    targetUuid: z.string().min(1),
    effectUuid: z.string().min(1),
  }),
  pf2e_inventory: z.object({ actorUuid: z.string().min(1), ...page }),
  pf2e_add_inventory_item: z.object({
    actorUuid: z.string().min(1),
    uuid: z.string().startsWith("Compendium."),
    quantity: inventoryQuantity.default(1),
    newStack: z.boolean().default(false),
  }),
  pf2e_set_item_quantity: z.object({
    actorUuid: z.string().min(1),
    itemUuid: z.string().min(1),
    quantity: inventoryQuantity,
  }),
  pf2e_transfer_item: z.object({
    sourceActorUuid: z.string().min(1),
    targetActorUuid: z.string().min(1),
    itemUuid: z.string().min(1),
    quantity: inventoryQuantity,
    newStack: z.boolean().default(false),
  }),
  pf2e_add_coins: z.object({
    actorUuid: z.string().min(1),
    coins: coinsSchema.refine((c) => Object.values(c).some((n) => n > 0), {
      message: "At least one coin denomination must be positive",
    }),
  }),
  pf2e_create_loot: z.object({
    name: z.string().trim().min(1).max(200),
    folderUuid: z.string().min(1).optional(),
    items: z
      .array(
        z.object({
          uuid: z.string().startsWith("Compendium."),
          quantity: inventoryQuantity.default(1),
        }),
      )
      .max(20)
      .default([]),
    coins: coinsSchema.optional(),
  }),
  pf2e_status: z.object({}),
  pf2e_search_compendium: z
    .object({
      kind: z.enum(["creature", "hazard", "equipment"]),
      complexity: z.enum(["simple", "complex"]).optional(),
      pack: z.string().min(1).optional(),
      query: z.string().max(200).default(""),
      levelMin: z.number().int().min(-1).max(30).optional(),
      levelMax: z.number().int().min(-1).max(30).optional(),
      traits: z.array(z.string().min(1).max(100)).max(20).default([]),
      rarities: z
        .array(z.enum(["common", "uncommon", "rare", "unique"]))
        .max(4)
        .default([]),
      sizes: z.array(z.string().min(1).max(30)).max(10).default([]),
      itemTypes: z.array(z.string().min(1).max(50)).max(20).default([]),
      priceMinCp: z.number().min(0).optional(),
      priceMaxCp: z.number().min(0).optional(),
      ...page,
    })
    .refine(
      (a) =>
        a.levelMin === undefined ||
        a.levelMax === undefined ||
        a.levelMin <= a.levelMax,
      { message: "levelMin must not exceed levelMax" },
    )
    .refine(
      (a) =>
        a.priceMinCp === undefined ||
        a.priceMaxCp === undefined ||
        a.priceMinCp <= a.priceMaxCp,
      { message: "priceMinCp must not exceed priceMaxCp" },
    ),
  pf2e_party_summary: z.object({ partyUuid: z.string().min(1).optional() }),
  pf2e_import_document: z.object({
    uuid: z.string().startsWith("Compendium."),
    folderUuid: z.string().min(1).optional(),
    adjustment,
  }),
  pf2e_analyze_encounter: z
    .object({
      partyUuid: z.string().min(1).optional(),
      partyLevel: z.number().int().min(1).max(20).optional(),
      partySize: z.number().int().min(1).max(12).optional(),
      participants: z.array(encounterEntry).min(1).max(20),
    })
    .refine(
      (a) => (a.partyLevel === undefined) === (a.partySize === undefined),
      { message: "Supply both partyLevel and partySize or neither" },
    )
    .refine((a) => a.participants.reduce((n, p) => n + p.quantity, 0) <= 40, {
      message: "Encounter is limited to 40 participants",
    }),
  pf2e_stage_encounter: z.object({
    sceneUuid: z.string().min(1),
    folderUuid: z.string().min(1).optional(),
    placements: z
      .array(
        z.object({
          uuid: z.string().min(1),
          x: z.number().finite(),
          y: z.number().finite(),
          adjustment,
          hidden: z.boolean().default(true),
        }),
      )
      .min(1)
      .max(20),
  }),
  search_content: z.object({
    query: z.string().min(1).max(200),
    documentType: z.enum(documentTypes).optional(),
    ...page,
  }),
  list_folders: z.object({
    documentType: z.enum(documentTypes).optional(),
    ...page,
  }),
  create_folder: z.object({
    name: z.string().trim().min(1).max(200),
    documentType: z.enum(documentTypes),
    parentUuid: z.string().min(1).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  }),
  move_document: z.object({
    uuid: z.string().min(1),
    folderUuid: z.string().min(1).nullable(),
  }),
  browse_assets: z.object({
    directory: z.string().default(""),
    query: z.string().default(""),
    ...page,
  }),
  upload_asset: z
    .object({
      filename: z.string().min(1).max(200),
      mimeType: z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/avif",
      ]),
      dataBase64: z.string().max(11_184_812).optional(),
      localPath: z.string().min(1).optional(),
      directory: z.string().default(""),
    })
    .refine((a) => Boolean(a.dataBase64) !== Boolean(a.localPath), {
      message: "Provide exactly one of dataBase64 or localPath",
    }),
  inspect_scene: z.object({ uuid: z.string().min(1) }),
  add_map_note: z.object({
    sceneUuid: z.string().min(1),
    journalUuid: z.string().min(1),
    pageUuid: z.string().min(1).optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    label: z.string().max(200).optional(),
    icon: z.string().max(500).optional(),
  }),
  get_status: z.object({}),
  discover_types: z.object({ documentType: z.enum(documentTypes).optional() }),
  search_world: z.object({
    documentType: z.enum(documentTypes),
    query: z.string().default(""),
    ...page,
  }),
  list_compendiums: z.object({ ...page }),
  search_compendium: z.object({
    pack: z.string().min(1),
    query: z.string().default(""),
    ...page,
  }),
  get_document: z.object({ uuid: z.string().min(1) }),
  create_document: z.object({
    documentType: z.enum(documentTypes),
    data: z.record(z.string(), z.unknown()),
  }),
  update_document: z.object({
    uuid: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
  create_embedded: z.object({
    parentUuid: z.string().min(1),
    documentType: z.enum(embeddedTypes),
    data: z.record(z.string(), z.unknown()),
  }),
  import_compendium: z.object({ uuid: z.string().startsWith("Compendium.") }),
} as const;
export type ToolName = keyof typeof toolSchemas;
export const toolNames = Object.keys(toolSchemas) as ToolName[];
export const writeTools = new Set<ToolName>([
  "pf2e_apply_damage",
  "pf2e_roll_strike",
  "pf2e_roll_damage",
  "pf2e_roll_check",
  "pf2e_roll_initiative",
  "start_encounter",
  "next_turn",
  "create_document",
  "update_document",
  "create_embedded",
  "import_compendium",
  "create_folder",
  "move_document",
  "upload_asset",
  "add_map_note",
  "pf2e_import_document",
  "pf2e_stage_encounter",
  "pf2e_set_condition",
  "pf2e_adjust_condition",
  "pf2e_apply_effect",
  "pf2e_remove_effect",
  "pf2e_add_inventory_item",
  "pf2e_set_item_quantity",
  "pf2e_transfer_item",
  "pf2e_add_coins",
  "pf2e_create_loot",
  "create_encounter",
  "add_combatants",
  "remove_combatants",
]);
export const destructiveTools = new Set<ToolName>([
  "pf2e_apply_damage",
  "pf2e_roll_initiative",
  "start_encounter",
  "next_turn",
  "pf2e_set_condition",
  "pf2e_adjust_condition",
  "pf2e_remove_effect",
  "pf2e_set_item_quantity",
  "pf2e_transfer_item",
  "remove_combatants",
]);
export const APPROVAL_TIMEOUT_MS = 300_000;
export const MAX_MESSAGE_BYTES = 12 * 1024 * 1024;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export type BridgeIdentity = {
  worldId: string;
  userId: string;
  foundryVersion: string;
  systemId: string;
  systemVersion: string;
};
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; partial?: unknown } };
export type BridgeRequest = {
  type: "request";
  id: string;
  tool: ToolName;
  args: Record<string, unknown>;
};
export type BrowserHello = {
  type: "hello";
  token: string;
  identity: BridgeIdentity;
};
export type BrowserResponse = {
  type: "response";
  id: string;
  result: ToolResult;
};
export type CompanionMessage =
  | BridgeRequest
  | { type: "paired"; sessionId: string }
  | { type: "error"; message: string };
export function failure(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}
export function parseTool(
  name: string,
  args: unknown,
): { tool: ToolName; args: Record<string, unknown> } {
  if (!Object.hasOwn(toolSchemas, name)) throw new Error("Unsupported tool");
  const tool = name as ToolName;
  return {
    tool,
    args: toolSchemas[tool].parse(args) as Record<string, unknown>,
  };
}
