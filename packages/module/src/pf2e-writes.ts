import type { PF2eContext } from "./pf2e-context.js";
import { requirePF2e } from "./pf2e.js";

const ITEM_TYPES = new Set([
  "action",
  "armor",
  "backpack",
  "book",
  "consumable",
  "effect",
  "equipment",
  "feat",
  "spell",
  "spellcastingEntry",
  "shield",
  "treasure",
  "weapon",
  "condition",
]);
type Adjustment = "normal" | "elite" | "weak";
type Source = { document: any; kind: "Actor" | "Item"; type: string };
type Created = {
  createdActors: string[];
  createdItems: string[];
  createdTokens: string[];
};

function codedError(
  code: string,
  message: string,
  partial?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial ? { partial } : {}),
  });
}
function partialError(
  message: string,
  created: Created,
  extra: Record<string, unknown> = {},
): Error {
  return codedError("PF2E_PARTIAL_FAILURE", message, { ...created, ...extra });
}
function adjustmentOf(value: unknown): Adjustment {
  if (value === undefined || value === "normal") return "normal";
  if (value === "elite" || value === "weak") return value;
  throw codedError(
    "PF2E_INVALID_ADJUSTMENT",
    "Adjustment must be normal, elite, or weak.",
  );
}
function uuidId(uuid: string): { packId: string; documentId: string } {
  const parts = uuid.split(".");
  if (parts[0] !== "Compendium" || parts.length < 4) {
    throw codedError(
      "PF2E_INVALID_SOURCE",
      "Source must be a root document in an installed compendium.",
    );
  }
  return { packId: parts.slice(1, -2).join("."), documentId: parts.at(-1)! };
}
function safeRootData(data: any): any {
  const clone = structuredClone(data);
  delete clone._id;
  delete clone.id;
  delete clone.folder;
  delete clone.sort;
  delete clone.ownership;
  delete clone.permission;
  return clone;
}
function assertSupported(source: Source): void {
  if (source.kind === "Actor" && !["npc", "hazard"].includes(source.type)) {
    throw codedError(
      "PF2E_UNSUPPORTED_SOURCE",
      "Only PF2e NPCs and hazards can be imported or staged.",
    );
  }
  if (source.kind === "Item" && !ITEM_TYPES.has(source.type)) {
    throw codedError(
      "PF2E_UNSUPPORTED_SOURCE",
      `PF2e item type ${source.type} is not supported for import.`,
    );
  }
}
async function compendiumSource(
  uuid: string,
  ctx: PF2eContext,
): Promise<Source> {
  const { packId, documentId } = uuidId(uuid);
  const pack = ctx.game.packs.get(packId);
  if (!pack)
    throw codedError(
      "PF2E_SOURCE_NOT_FOUND",
      "The requested compendium pack is not installed.",
    );
  const packSystem = pack.metadata?.system;
  if (packSystem && packSystem !== "pf2e") {
    throw codedError(
      "PF2E_SOURCE_SYSTEM_MISMATCH",
      "Source compendium does not belong to the PF2e system.",
    );
  }
  const document = await ctx.resolve(uuid);
  if (
    !document ||
    document.id !== documentId ||
    !document.compendium ||
    document.pack !== pack.collection ||
    document.parent != null ||
    document.isEmbedded
  ) {
    throw codedError(
      "PF2E_SOURCE_NOT_FOUND",
      "The requested root compendium document was not found.",
    );
  }
  const source = {
    document,
    kind: document.documentName as "Actor" | "Item",
    type: document.type,
  };
  if (source.kind !== "Actor" && source.kind !== "Item") {
    throw codedError(
      "PF2E_UNSUPPORTED_SOURCE",
      "Only root PF2e Actor and Item compendium documents are supported.",
    );
  }
  assertSupported(source);
  return source;
}
async function validateFolder(
  folderUuid: string | undefined,
  kind: string,
  ctx: PF2eContext,
): Promise<any | null> {
  if (!folderUuid) return null;
  const folder = await ctx.resolve(folderUuid);
  if (
    !folder ||
    folder.documentName !== "Folder" ||
    folder.compendium ||
    folder.uuid !== folderUuid ||
    folder.type !== kind
  ) {
    throw codedError(
      "PF2E_INVALID_FOLDER",
      `Select a world ${kind.toLowerCase()} folder.`,
    );
  }
  return folder;
}
function collectionFor(source: Source, ctx: PF2eContext): any {
  return source.kind === "Actor" ? ctx.game.actors : ctx.game.items;
}
function createSourceData(source: Source, folder: any, ctx: PF2eContext): any {
  const collection = collectionFor(source, ctx);
  let data: any;
  if (source.document.compendium) {
    if (typeof collection.fromCompendium !== "function") {
      throw codedError(
        "PF2E_API_UNAVAILABLE",
        "Foundry compendium import API is unavailable.",
      );
    }
    data = collection.fromCompendium(source.document, {
      keepId: false,
      clearOwnership: true,
      clearFolder: true,
      clearSort: true,
      clearState: true,
    });
  } else {
    data = source.document.toObject();
  }
  const safeData = safeRootData(data);
  delete safeData.root_id;
  if (folder) safeData.folder = folder.id;
  return safeData;
}
function validateAdjustmentAvailable(source: Source): void {
  if (
    source.kind === "Actor" &&
    source.type === "npc" &&
    typeof source.document.applyAdjustment !== "function"
  ) {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "PF2e native Actor adjustment API is unavailable.",
    );
  }
}
function validateCreation(source: Source, ctx: PF2eContext): void {
  const collection = collectionFor(source, ctx);
  if (
    source.document.compendium &&
    typeof collection.fromCompendium !== "function"
  ) {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Foundry compendium import API is unavailable.",
    );
  }
  if (typeof collection.documentClass?.create !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      `Foundry ${source.kind} creation API is unavailable.`,
    );
  }
}
function currentAdjustment(actor: any): Adjustment {
  const value = actor.system?.attributes?.adjustment;
  if (value === "elite" || value === "weak") return value;
  if (value == null || value === "normal") {
    if (actor.isElite === true) return "elite";
    if (actor.isWeak === true) return "weak";
    return "normal";
  }
  throw codedError(
    "PF2E_UNSUPPORTED_ADJUSTMENT",
    "Actor has an unsupported native adjustment state.",
  );
}
async function createFromCompendium(
  source: Source,
  folder: any,
  adjustment: Adjustment,
  ctx: PF2eContext,
  created?: Created,
): Promise<any> {
  const collection = collectionFor(source, ctx);
  const data = createSourceData(source, folder, ctx);
  validateCreation(source, ctx);
  validateAdjustmentAvailable(source);
  ctx.assertWrite();
  let document: any;
  try {
    document = await collection.documentClass.create(data, {
      keepId: false,
      keepEmbeddedIds: true,
      renderSheet: false,
    });
  } catch (error) {
    throw partialError(
      "Foundry did not confirm document creation. Check the world before retrying.",
      created ?? { createdActors: [], createdItems: [], createdTokens: [] },
      { outcomeUnknown: true, sourceUuid: source.document.uuid },
    );
  }
  if (!document)
    throw codedError(
      "PF2E_CREATE_FAILED",
      "Foundry did not create the imported document.",
    );
  if (source.kind === "Actor") created?.createdActors.push(document.uuid);
  else created?.createdItems.push(document.uuid);
  if (source.kind === "Actor" && source.type === "npc") {
    ctx.assertWrite();
    await document.applyAdjustment(adjustment === "normal" ? null : adjustment);
  }
  return document;
}
async function resolveStageSource(
  uuid: string,
  adjustment: Adjustment,
  ctx: PF2eContext,
): Promise<{ source: Source; world?: any }> {
  if (uuid.startsWith("Compendium.")) {
    const source = await compendiumSource(uuid, ctx);
    if (source.kind !== "Actor")
      throw codedError(
        "PF2E_UNSUPPORTED_SOURCE",
        "Encounter staging accepts NPC and hazard Actors only.",
      );
    if (adjustment !== "normal" && source.type === "hazard") {
      throw codedError(
        "PF2E_INVALID_ADJUSTMENT",
        "Elite and weak adjustments are only supported for NPC Actors.",
      );
    }
    validateAdjustmentAvailable(source);
    validateCreation(source, ctx);
    return { source };
  }
  const world = await ctx.resolve(uuid);
  if (
    !world ||
    world.documentName !== "Actor" ||
    world.compendium ||
    world.isEmbedded ||
    world.parent != null ||
    !["npc", "hazard"].includes(world.type)
  ) {
    throw codedError(
      "PF2E_UNSUPPORTED_SOURCE",
      "Encounter staging accepts world NPCs, hazards, or compendium NPCs and hazards.",
    );
  }
  if (adjustment !== "normal" && world.type === "hazard") {
    throw codedError(
      "PF2E_INVALID_ADJUSTMENT",
      "Elite and weak adjustments are only supported for NPC Actors.",
    );
  }
  validateAdjustmentAvailable({
    document: world,
    kind: "Actor",
    type: world.type,
  });
  if (world.type === "npc") currentAdjustment(world);
  const source = { document: world, kind: "Actor" as const, type: world.type };
  validateCreation(source, ctx);
  return { source, world };
}
async function tokenPreview(
  actor: any,
  placement: any,
  scene: any,
): Promise<any> {
  if (typeof actor.getTokenDocument !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Actor token document API is unavailable.",
    );
  }
  const token = await actor.getTokenDocument(
    {
      x: placement.x,
      y: placement.y,
      hidden: placement.hidden,
      actorLink: false,
    },
    { parent: scene },
  );
  validateTokenBounds(token, placement, scene);
  return token;
}
function validateTokenBounds(token: any, placement: any, scene: any): void {
  const grid = scene.grid?.size ?? scene.dimensions?.size;
  const rect = scene.dimensions?.sceneRect;
  if (!Number.isFinite(grid) || grid <= 0 || !rect) {
    throw codedError(
      "PF2E_INVALID_SCENE",
      "Scene grid dimensions are unavailable.",
    );
  }
  if (!Number.isFinite(token.width) || !Number.isFinite(token.height)) {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Native token footprint is unavailable for this Actor.",
    );
  }
  const width = token.width * grid;
  const height = token.height * grid;
  if (
    placement.x < rect.x ||
    placement.y < rect.y ||
    placement.x + width > rect.x + rect.width ||
    placement.y + height > rect.y + rect.height
  ) {
    throw codedError(
      "PF2E_TOKEN_OUT_OF_BOUNDS",
      "A token footprint falls outside the scene bounds.",
    );
  }
}

export async function handlePF2eWrite(
  tool: string,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_import_document") return importDocument(args, ctx);
  if (tool === "pf2e_stage_encounter") return stageEncounter(args, ctx);
  throw codedError(
    "PF2E_UNKNOWN_WRITE",
    `Unsupported PF2e write tool ${tool}.`,
  );
}

async function importDocument(
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  const adjustment = adjustmentOf(args.adjustment);
  const source = await compendiumSource(String(args.uuid), ctx);
  const folder = await validateFolder(
    args.folderUuid as string | undefined,
    source.kind,
    ctx,
  );
  validateAdjustmentAvailable(source);
  if (adjustment !== "normal" && source.type === "hazard") {
    throw codedError(
      "PF2E_INVALID_ADJUSTMENT",
      "Elite and weak adjustments are only supported for NPC Actors.",
    );
  }
  if (adjustment !== "normal" && source.kind !== "Actor") {
    throw codedError(
      "PF2E_INVALID_ADJUSTMENT",
      "Elite and weak adjustments apply only to NPC and hazard Actors.",
    );
  }
  const created: Created = {
    createdActors: [],
    createdItems: [],
    createdTokens: [],
  };
  try {
    const document = await createFromCompendium(
      source,
      folder,
      adjustment,
      ctx,
      created,
    );
    return ctx.serialize(document);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as any).code === "PF2E_PARTIAL_FAILURE"
    ) {
      throw error;
    }
    if (created.createdActors.length || created.createdItems.length) {
      throw partialError(
        "PF2e document was created, but a later operation failed. Inspect the created UUID before retrying.",
        created,
      );
    }
    throw error;
  }
}

async function stageEncounter(
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  const scene = await ctx.resolve(String(args.sceneUuid));
  if (
    !scene ||
    scene.documentName !== "Scene" ||
    scene.compendium ||
    scene.uuid !== args.sceneUuid
  ) {
    throw codedError(
      "PF2E_SCENE_NOT_FOUND",
      "A world Scene is required as the staging target.",
    );
  }
  if (typeof scene.createEmbeddedDocuments !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Foundry scene token creation API is unavailable.",
    );
  }
  const folder = await validateFolder(
    args.folderUuid as string | undefined,
    "Actor",
    ctx,
  );
  const placements = args.placements as any[];
  const prepared = [] as Array<{
    source: Source;
    world?: any;
    adjustment: Adjustment;
    placement: any;
    preview: any;
  }>;
  for (const placement of placements) {
    const adjustment = adjustmentOf(placement.adjustment);
    const resolved = await resolveStageSource(
      String(placement.uuid),
      adjustment,
      ctx,
    );
    const sourceActor = resolved.world ?? resolved.source.document;
    const preview = await tokenPreview(sourceActor, placement, scene);
    prepared.push({ ...resolved, adjustment, placement, preview });
  }
  ctx.assertWrite();
  const created: Created = {
    createdActors: [],
    createdItems: [],
    createdTokens: [],
  };
  const cache = new Map<string, any>();
  const results: any[] = [];
  for (let index = 0; index < prepared.length; index++) {
    const row = prepared[index];
    let tokenCreateStarted = false;
    try {
      let actor = row.world;
      const sourceAdjustment = row.world
        ? currentAdjustment(row.world)
        : "normal";
      if (
        !actor ||
        sourceAdjustment !== "normal" ||
        row.adjustment !== "normal"
      ) {
        const key = `${row.source.document.uuid}:${row.adjustment}`;
        actor = cache.get(key);
        if (!actor) {
          actor = await createFromCompendium(
            row.source,
            folder,
            row.adjustment,
            ctx,
            created,
          );
          cache.set(key, actor);
        }
      }
      const tokenDocument = await actor.getTokenDocument(
        {
          x: row.placement.x,
          y: row.placement.y,
          hidden: row.placement.hidden,
          actorLink: false,
        },
        { parent: scene },
      );
      validateTokenBounds(tokenDocument, row.placement, scene);
      const tokenData = tokenDocument.toObject();
      ctx.assertWrite();
      tokenCreateStarted = true;
      const tokens = await scene.createEmbeddedDocuments("Token", [tokenData]);
      const token = tokens?.[0];
      if (!token) {
        throw partialError(
          "Foundry did not confirm encounter token creation. Inspect the scene before retrying.",
          created,
          {
            failedPlacementIndex: index,
            completedPlacements: results,
            outcomeUnknown: true,
            sceneUuid: scene.uuid,
          },
        );
      }
      created.createdTokens.push(token.uuid);
      results.push({ actorUuid: actor.uuid, tokenUuid: token.uuid });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as any).code === "PF2E_PARTIAL_FAILURE"
      ) {
        const existing = (error as any).partial ?? {};
        throw partialError(
          error instanceof Error
            ? error.message
            : "PF2e encounter staging failed.",
          {
            createdActors: existing.createdActors ?? created.createdActors,
            createdItems: existing.createdItems ?? created.createdItems,
            createdTokens: existing.createdTokens ?? created.createdTokens,
          },
          {
            ...existing,
            failedPlacementIndex: index,
            completedPlacements: results,
            ...(tokenCreateStarted
              ? { outcomeUnknown: true, sceneUuid: scene.uuid }
              : {}),
          },
        );
      }
      throw partialError(
        error instanceof Error
          ? error.message
          : "PF2e encounter staging failed.",
        created,
        {
          failedPlacementIndex: index,
          completedPlacements: results,
          ...(tokenCreateStarted
            ? { outcomeUnknown: true, sceneUuid: scene.uuid }
            : {}),
          ...(error instanceof Error ? { cause: error.message } : {}),
        },
      );
    }
  }
  return { sceneUuid: scene.uuid, placements: results, created };
}
