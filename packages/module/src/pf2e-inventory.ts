import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context.js";
import { requirePF2e } from "./pf2e.js";
import { resolvePF2eActor } from "./pf2e-target.js";

const PHYSICAL_ITEM_TYPES = new Set([
  "armor",
  "backpack",
  "book",
  "consumable",
  "ammo",
  "equipment",
  "shield",
  "treasure",
  "weapon",
]);
const DENOMINATIONS = ["pp", "gp", "sp", "cp"] as const;
type Denomination = (typeof DENOMINATIONS)[number];
type Coins = Record<Denomination, number>;
type PartialFailure = {
  createdActors: string[];
  createdItems: string[];
  createdTokens: string[];
  [key: string]: unknown;
};
type PhysicalSource = { uuid: string; document: any; data: any };

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
function partialError(message: string, partial: PartialFailure): Error {
  return codedError("PF2E_PARTIAL_FAILURE", message, partial);
}
function array(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value[Symbol.iterator] === "function")
    return Array.from(value);
  if (value && typeof value.values === "function")
    return Array.from(value.values());
  return [];
}
function assertPhysical(item: any): void {
  const physical =
    typeof item?.isOfType === "function"
      ? item.isOfType("physical")
      : PHYSICAL_ITEM_TYPES.has(item?.type);
  if (!physical || !PHYSICAL_ITEM_TYPES.has(item.type)) {
    throw codedError(
      "PF2E_UNSUPPORTED_ITEM",
      "Only PF2e physical inventory item types can be transferred or added.",
    );
  }
}
function assertWritableActor(actor: any, ctx: PF2eContext): void {
  if (!actor || actor.documentName !== "Actor" || actor.compendium) {
    throw codedError(
      "PF2E_INVALID_TARGET",
      "A writable world PF2e Actor is required.",
    );
  }
  if (
    actor.isOwner === false ||
    (typeof actor.canUserModify === "function" &&
      !actor.canUserModify(ctx.game.user, "update"))
  ) {
    throw codedError(
      "PF2E_PERMISSION_DENIED",
      "The current GM cannot update this Actor.",
    );
  }
}
function inventoryItems(actor: any): any[] {
  const contents = actor.inventory?.contents;
  if (!Array.isArray(contents)) {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "PF2e inventory contents API is unavailable.",
    );
  }
  return contents.filter((item) => {
    try {
      assertPhysical(item);
      return true;
    } catch {
      return false;
    }
  });
}
function safeNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toNumber === "function") {
    const result = value.toNumber();
    return Number.isFinite(result) ? result : null;
  }
  return null;
}
function coinsSnapshot(actor: any): Coins | null {
  const inventory = actor.inventory;
  const raw = inventory?.currency ?? inventory?.coins;
  if (!raw) return null;
  const object = typeof raw.toObject === "function" ? raw.toObject() : raw;
  const snapshot = Object.fromEntries(
    DENOMINATIONS.map((denomination) => [
      denomination,
      safeNumber(raw[denomination]) ?? safeNumber(object[denomination]),
    ]),
  ) as Record<Denomination, number | null>;
  if (DENOMINATIONS.every((denomination) => snapshot[denomination] === null))
    return null;
  return Object.fromEntries(
    DENOMINATIONS.map((denomination) => [
      denomination,
      snapshot[denomination] ?? 0,
    ]),
  ) as Coins;
}
function compactValue(value: any): any {
  if (value == null || ["string", "number", "boolean"].includes(typeof value))
    return value ?? null;
  if (typeof value.toObject === "function") return value.toObject();
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, compactValue(entry)]),
    );
  }
  if (
    typeof value.toString === "function" &&
    value.toString !== Object.prototype.toString
  )
    return value.toString();
  return null;
}
function wealthCopper(actor: any): number | null {
  const wealth = actor.inventory?.wealth ?? actor.inventory?.totalWealth;
  return safeNumber(wealth?.copperValue) ?? safeNumber(wealth);
}
function bulkSummary(actor: any): unknown {
  const bulk = actor.inventory?.bulk;
  if (bulk == null) return null;
  const value = compactValue(bulk.value);
  const total = compactValue(bulk.total);
  const bulkNumber = compactValue(bulk.bulk);
  const light = compactValue(bulk.light);
  const encumbered = compactValue(bulk.encumbered);
  const max = compactValue(bulk.max);
  const result = { value, total, bulkNumber, light, encumbered, max };
  return Object.values(result).some(
    (entry) => entry !== null && entry !== undefined,
  )
    ? result
    : null;
}
function inventoryPage(actor: any, args: Record<string, unknown>): unknown {
  const items = inventoryItems(actor);
  const offset = Number(args.offset ?? 0);
  const limit = Math.min(100, Number(args.limit ?? 25));
  return {
    actorUuid: actor.uuid,
    total: items.length,
    offset,
    limit,
    items: items.slice(offset, offset + limit).map((item) => ({
      uuid: item.uuid,
      id: item.id,
      name: item.name,
      type: item.type,
      quantity: item.quantity,
      container: item.container
        ? { uuid: item.container.uuid, name: item.container.name }
        : null,
      carryType: item.system?.equipped?.carryType ?? null,
      identification: item.system?.identification?.status ?? null,
      price: compactValue(item.price ?? item.system?.price?.value),
      assetValue: compactValue(item.assetValue),
      bulk: compactValue(item.bulk),
    })),
    coins: coinsSnapshot(actor),
    wealthCopper: wealthCopper(actor),
    bulk: bulkSummary(actor),
  };
}
function rootCompendiumId(uuid: string): {
  packId: string;
  documentId: string;
} {
  const parts = uuid.split(".");
  if (parts[0] !== "Compendium" || parts.length < 4) {
    throw codedError(
      "PF2E_INVALID_SOURCE",
      "Provide a root item UUID from an installed compendium.",
    );
  }
  return { packId: parts.slice(1, -2).join("."), documentId: parts.at(-1)! };
}
async function physicalCompendiumSource(
  uuid: string,
  ctx: PF2eContext,
): Promise<PhysicalSource> {
  const { packId, documentId } = rootCompendiumId(uuid);
  const pack = ctx.game.packs?.get(packId);
  if (!pack)
    throw codedError(
      "PF2E_SOURCE_NOT_FOUND",
      "The requested item compendium is not installed.",
    );
  if (pack.metadata?.system && pack.metadata.system !== "pf2e") {
    throw codedError(
      "PF2E_SOURCE_SYSTEM_MISMATCH",
      "The item compendium does not belong to PF2e.",
    );
  }
  const document = await ctx.resolve(uuid);
  if (
    !document ||
    document.documentName !== "Item" ||
    document.id !== documentId ||
    document.pack !== pack.collection ||
    !document.compendium ||
    document.parent != null ||
    document.isEmbedded
  ) {
    throw codedError(
      "PF2E_SOURCE_NOT_FOUND",
      "The requested root compendium item was not found.",
    );
  }
  assertPhysical(document);
  if (typeof ctx.game.items?.fromCompendium !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Foundry compendium item import API is unavailable.",
    );
  }
  const data = ctx.game.items.fromCompendium(document, {
    keepId: false,
    clearOwnership: true,
    clearFolder: true,
    clearSort: true,
    clearState: true,
  });
  const clone = structuredClone(data);
  delete clone._id;
  delete clone.id;
  delete clone.root_id;
  delete clone.ownership;
  delete clone.permission;
  delete clone.folder;
  delete clone.sort;
  clone.system ??= {};
  clone.system.quantity = 1;
  delete clone.system.containerId;
  return { uuid, document, data: clone };
}
function requireInventory(actor: any): any {
  if (!actor.inventory || typeof actor.inventory.add !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "PF2e native inventory add API is unavailable for this Actor.",
    );
  }
  return actor.inventory;
}
function resultItem(result: any): any {
  const items = Array.isArray(result) ? result : result ? [result] : [];
  if (!items[0]?.uuid)
    throw codedError(
      "PF2E_ADD_UNCONFIRMED",
      "PF2e did not confirm the inventory item result.",
    );
  return items[0];
}
function assertItemMutable(item: any, actor: any): void {
  assertPhysical(item);
  if (item.parent !== actor)
    throw codedError(
      "PF2E_ITEM_OWNERSHIP",
      "The item is not owned by the selected Actor.",
    );
  const pf2eFlags = item.flags?.pf2e ?? item._source?.flags?.pf2e;
  const granter = item.actor?.itemGrants?.[item.id];
  if (
    item.isLocked ||
    item.system?.locked ||
    item.isGranted ||
    item.system?.grantedBy ||
    pf2eFlags?.grantedBy ||
    granter?.onDelete
  ) {
    throw codedError(
      "PF2E_ITEM_LOCKED",
      "This item is locked or granted by PF2e and cannot be changed directly.",
    );
  }
  if (item.type === "backpack" && array(item.contents).length > 0) {
    throw codedError(
      "PF2E_NONEMPTY_CONTAINER",
      "A non-empty backpack cannot be changed or transferred as a single item.",
    );
  }
}
async function addPhysical(
  actor: any,
  source: PhysicalSource,
  quantity: number,
  newStack: boolean,
  ctx: PF2eContext,
): Promise<{
  affected: any;
  created: boolean;
  previousQuantity: number | null;
}> {
  const inventory = requireInventory(actor);
  const data = structuredClone(source.data);
  data.system.quantity = quantity;
  delete data.system.containerId;
  const previous =
    !newStack && typeof inventory.findStackableItem === "function"
      ? inventory.findStackableItem(data, { containerId: null })
      : inventoryItems(actor).find(
          (item) =>
            !newStack &&
            typeof item.isStackableWith === "function" &&
            item.isStackableWith(data),
        );
  const idsBefore = new Set(inventoryItems(actor).map((item) => item.id));
  const previousQuantity = previous ? safeNumber(previous.quantity) : null;
  ctx.assertWrite();
  let result: any;
  try {
    result = await inventory.add(data, { stack: !newStack, render: false });
  } catch {
    throw partialError(
      "PF2e inventory add was interrupted. Inspect the target inventory before retrying.",
      {
        createdActors: [],
        createdItems: [],
        createdTokens: [],
        outcomeUnknown: true,
        actorUuid: actor.uuid,
        sourceUuid: source.uuid,
        quantity,
      },
    );
  }
  let affected: any;
  try {
    affected = resultItem(result);
  } catch {
    throw partialError(
      "PF2e did not confirm the inventory add result. Inspect the target inventory before retrying.",
      {
        createdActors: [],
        createdItems: [],
        createdTokens: [],
        outcomeUnknown: true,
        actorUuid: actor.uuid,
        sourceUuid: source.uuid,
        quantity,
      },
    );
  }
  return {
    affected,
    created: !idsBefore.has(affected.id),
    previousQuantity,
  };
}
async function createLootActor(
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  const name = String(args.name);
  const folderUuid = args.folderUuid as string | undefined;
  const folder = folderUuid ? await ctx.resolve(folderUuid) : null;
  if (
    folderUuid &&
    (!folder ||
      folder.documentName !== "Folder" ||
      folder.compendium ||
      folder.uuid !== folderUuid ||
      folder.type !== "Actor")
  ) {
    throw codedError(
      "PF2E_INVALID_FOLDER",
      "Select a world Actor folder for the new loot Actor.",
    );
  }
  const entries = args.items as Array<{ uuid: string; quantity: number }>;
  const prepared: PhysicalSource[] = [];
  for (const entry of entries)
    prepared.push(await physicalCompendiumSource(entry.uuid, ctx));
  const actorClass = ctx.game.actors?.documentClass;
  if (typeof actorClass?.create !== "function") {
    throw codedError(
      "PF2E_API_UNAVAILABLE",
      "Foundry Actor creation API is unavailable.",
    );
  }
  const coins = args.coins as Partial<Coins> | undefined;
  const created: PartialFailure = {
    createdActors: [],
    createdItems: [],
    createdTokens: [],
  };
  ctx.assertWrite();
  let loot: any;
  try {
    loot = await actorClass.create(
      {
        name,
        type: "loot",
        ...(folder ? { folder: folder.id } : {}),
        system: { lootSheetType: "Loot" },
      },
      { keepId: false, renderSheet: false },
    );
  } catch {
    throw partialError(
      "Foundry did not confirm loot Actor creation. Check the world before retrying.",
      {
        ...created,
        outcomeUnknown: true,
        requestedName: name,
      },
    );
  }
  if (!loot?.uuid) {
    throw partialError(
      "Foundry did not confirm loot Actor creation. Check the world before retrying.",
      {
        ...created,
        outcomeUnknown: true,
        requestedName: name,
      },
    );
  }
  created.createdActors.push(loot.uuid);
  const completedItems: string[] = [];
  let coinsStarted = false;
  let coinsCompleted = false;
  try {
    for (let index = 0; index < entries.length; index++) {
      const added = await addPhysical(
        loot,
        prepared[index],
        entries[index].quantity,
        true,
        ctx,
      );
      created.createdItems.push(added.affected.uuid);
      completedItems.push(added.affected.uuid);
    }
    if (coins && Object.values(coins).some((value) => Number(value) > 0)) {
      const addCurrency =
        loot.inventory?.addCurrency ?? loot.inventory?.addCoins;
      if (typeof addCurrency !== "function") {
        throw codedError(
          "PF2E_API_UNAVAILABLE",
          "PF2e native currency addition API is unavailable for the new loot Actor.",
        );
      }
      ctx.assertWrite();
      coinsStarted = true;
      await addCurrency.call(loot.inventory, coins);
      coinsCompleted = true;
    }
    return {
      actor: ctx.serialize(loot),
      items: completedItems,
      coins: coins ?? null,
    };
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
          : "Loot Actor creation only partially completed.",
        {
          ...created,
          ...existing,
          createdActors: existing.createdActors?.length
            ? existing.createdActors
            : created.createdActors,
          createdItems: [
            ...created.createdItems,
            ...(existing.createdItems ?? []),
          ],
          completedItems,
          coinsApplied: coinsCompleted,
          ...(coinsStarted && !coinsCompleted
            ? { coinsOutcomeUnknown: true, coinsRequested: coins }
            : {}),
        },
      );
    }
    throw partialError(
      error instanceof Error
        ? error.message
        : "Loot Actor creation only partially completed.",
      {
        ...created,
        completedItems,
        coinsApplied: coinsCompleted,
        ...(coinsStarted && !coinsCompleted
          ? { coinsOutcomeUnknown: true, coinsRequested: coins }
          : {}),
      },
    );
  }
}

export async function handlePF2eInventory(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_create_loot") return createLootActor(args, ctx);
  if (tool === "pf2e_inventory") {
    const actor = await resolvePF2eActor(ctx, String(args.actorUuid));
    return inventoryPage(actor, args);
  }
  if (tool === "pf2e_add_inventory_item") {
    const actor = await resolvePF2eActor(ctx, String(args.actorUuid));
    assertWritableActor(actor, ctx);
    const source = await physicalCompendiumSource(String(args.uuid), ctx);
    const result = await addPhysical(
      actor,
      source,
      Number(args.quantity),
      Boolean(args.newStack),
      ctx,
    );
    return {
      actorUuid: actor.uuid,
      itemUuid: result.affected.uuid,
      itemName: result.affected.name,
      quantity: result.affected.quantity,
      addedQuantity: Number(args.quantity),
      stacked: !result.created,
      previousQuantity: result.previousQuantity,
    };
  }
  if (tool === "pf2e_set_item_quantity") {
    const actor = await resolvePF2eActor(ctx, String(args.actorUuid));
    assertWritableActor(actor, ctx);
    const item = await ctx.resolve(String(args.itemUuid));
    if (
      !item ||
      item.parent !== actor ||
      actor.inventory?.get?.(item.id) !== item
    ) {
      throw codedError(
        "PF2E_ITEM_OWNERSHIP",
        "The item must be a root inventory item on the selected Actor.",
      );
    }
    assertItemMutable(item, actor);
    const quantity = Number(args.quantity);
    if (typeof item.update !== "function")
      throw codedError(
        "PF2E_API_UNAVAILABLE",
        "PF2e item update API is unavailable.",
      );
    const previousQuantity = item.quantity;
    ctx.assertWrite();
    let updated: any;
    try {
      updated = await item.update({ "system.quantity": quantity });
    } catch {
      throw partialError(
        "PF2e quantity update was interrupted. Inspect the Actor inventory before retrying.",
        {
          createdActors: [],
          createdItems: [],
          createdTokens: [],
          outcomeUnknown: true,
          actorUuid: actor.uuid,
          itemUuid: item.uuid,
          quantityBefore: previousQuantity,
          quantityRequested: quantity,
        },
      );
    }
    if (!updated) {
      throw partialError(
        "PF2e did not confirm the quantity update. Inspect the Actor inventory before retrying.",
        {
          createdActors: [],
          createdItems: [],
          createdTokens: [],
          outcomeUnknown: true,
          actorUuid: actor.uuid,
          itemUuid: item.uuid,
          quantityBefore: previousQuantity,
          quantityRequested: quantity,
        },
      );
    }
    return {
      actorUuid: actor.uuid,
      itemUuid: item.uuid,
      previousQuantity,
      quantity: item.quantity,
    };
  }
  if (tool === "pf2e_transfer_item") {
    const source = await resolvePF2eActor(ctx, String(args.sourceActorUuid));
    const target = await resolvePF2eActor(ctx, String(args.targetActorUuid));
    assertWritableActor(source, ctx);
    assertWritableActor(target, ctx);
    if (
      source === target ||
      source.uuid === target.uuid ||
      (source.token?.uuid &&
        target.token?.uuid &&
        source.token.uuid === target.token.uuid) ||
      (source.id === target.id && source.token?.id === target.token?.id)
    ) {
      throw codedError(
        "PF2E_INVALID_TRANSFER",
        "Source and target must be different Actors.",
      );
    }
    if (typeof source.transferItemToActor !== "function") {
      throw codedError(
        "PF2E_API_UNAVAILABLE",
        "PF2e native Actor transfer API is unavailable.",
      );
    }
    const item = await ctx.resolve(String(args.itemUuid));
    if (
      !item ||
      item.parent !== source ||
      source.inventory?.get?.(item.id) !== item
    ) {
      throw codedError(
        "PF2E_ITEM_OWNERSHIP",
        "The item must be owned by the source Actor.",
      );
    }
    assertItemMutable(item, source);
    const quantity = Number(args.quantity);
    if (!Number.isInteger(item.quantity) || quantity > item.quantity) {
      throw codedError(
        "PF2E_INVALID_QUANTITY",
        "Requested quantity exceeds the available item quantity.",
      );
    }
    const sourceBefore = item.quantity;
    const targetIdsBefore = new Set(
      inventoryItems(target).map((entry) => entry.id),
    );
    ctx.assertWrite();
    if (quantity > item.quantity || item.parent !== source) {
      throw codedError(
        "PF2E_INVALID_QUANTITY",
        "Source inventory changed before transfer; refresh inventory and retry.",
      );
    }
    let transferred: any;
    try {
      transferred = await source.transferItemToActor(
        target,
        item,
        quantity,
        undefined,
        Boolean(args.newStack),
        false,
      );
    } catch (error) {
      throw partialError(
        "PF2e transfer failed or was interrupted. Inspect both inventories before retrying.",
        {
          createdActors: [],
          createdItems: [],
          createdTokens: [],
          outcomeUnknown: true,
          sourceActorUuid: source.uuid,
          targetActorUuid: target.uuid,
          sourceItemUuid: item.uuid,
          requestedQuantity: quantity,
          sourceQuantityBefore: sourceBefore,
        },
      );
    }
    if (!transferred?.uuid) {
      throw partialError(
        "PF2e did not confirm the transfer result. Inspect both inventories before retrying.",
        {
          createdActors: [],
          createdItems: [],
          createdTokens: [],
          outcomeUnknown: true,
          sourceActorUuid: source.uuid,
          targetActorUuid: target.uuid,
          sourceItemUuid: item.uuid,
          requestedQuantity: quantity,
          sourceQuantityBefore: sourceBefore,
        },
      );
    }
    return {
      sourceActorUuid: source.uuid,
      targetActorUuid: target.uuid,
      sourceItemUuid: item.uuid,
      transferredItemUuid: transferred.uuid,
      transferredQuantity: quantity,
      sourceQuantity: source.inventory.get(item.id)?.quantity ?? 0,
      stacked: targetIdsBefore.has(transferred.id),
    };
  }
  if (tool === "pf2e_add_coins") {
    const actor = await resolvePF2eActor(ctx, String(args.actorUuid));
    assertWritableActor(actor, ctx);
    const inventory = actor.inventory;
    const addCurrency = inventory?.addCurrency ?? inventory?.addCoins;
    if (typeof addCurrency !== "function")
      throw codedError(
        "PF2E_API_UNAVAILABLE",
        "PF2e native currency addition API is unavailable.",
      );
    const before = coinsSnapshot(actor);
    const coins = args.coins as Coins;
    ctx.assertWrite();
    try {
      await addCurrency.call(inventory, coins);
    } catch {
      throw partialError(
        "Currency update was interrupted. Inspect the Actor inventory before retrying.",
        {
          createdActors: [],
          createdItems: [],
          createdTokens: [],
          outcomeUnknown: true,
          actorUuid: actor.uuid,
          coinsRequested: coins,
          coinsBefore: before,
        },
      );
    }
    return {
      actorUuid: actor.uuid,
      coinsBefore: before,
      coinsAdded: coins,
      coinsAfter: coinsSnapshot(actor),
    };
  }
  throw codedError(
    "PF2E_UNKNOWN_INVENTORY_TOOL",
    `PF2e inventory adapter does not implement ${tool}.`,
  );
}
