import { describe, expect, it, vi } from "vitest";
import { handlePF2eInventory } from "../src/pf2e-inventory.js";
import type { PF2eContext } from "../src/pf2e-context.js";

function makeItem(actor: any, values: any = {}) {
  return {
    id: values.id ?? "sword",
    uuid: values.uuid ?? `Actor.${actor.id}.Item.${values.id ?? "sword"}`,
    name: values.name ?? "Shortsword",
    type: values.type ?? "weapon",
    quantity: values.quantity ?? 3,
    parent: actor,
    system: values.system ?? {
      quantity: values.quantity ?? 3,
      equipped: { carryType: "held" },
    },
    contents: values.contents ?? [],
    isLocked: values.isLocked ?? false,
    isGranted: values.isGranted ?? false,
    isOfType(type: string) {
      return type === "physical";
    },
    isStackableWith: values.isStackableWith ?? (() => true),
    update:
      values.update ??
      vi.fn(async function (this: any, data: any) {
        this.system.quantity = data["system.quantity"];
        this.quantity = data["system.quantity"];
        return this;
      }),
    toObject:
      values.toObject ??
      (() =>
        structuredClone(
          values.sourceData ?? {
            _id: values.id ?? "sword",
            name: "Shortsword",
            type: "weapon",
            system: structuredClone(values.system ?? { quantity: 3 }),
          },
        )),
  };
}

function makeAmmoItem(actor: any, id: string, quantity: number, uuid?: string) {
  const sourceData = {
    _id: id,
    img: "icons/weapons/ammunition/arrows-broadhead-white.webp",
    name: "Arrows",
    type: "ammo",
    system: {
      baseItem: "arrows",
      bulk: { value: 0.1 },
      craftableAs: null,
      description: { value: "Bow ammunition." },
      level: { value: 0 },
      price: { per: 10, value: { sp: 1 } },
      publication: { license: "ORC", remaster: true, title: "Player Core" },
      quantity,
      rules: [],
      size: "med",
      slug: "arrows",
      traits: { rarity: "common", value: ["consumable"] },
      uses: { autoDestroy: true, max: 1, value: 1 },
    },
  };
  const item = makeItem(actor, {
    id,
    uuid: uuid ?? `${actor.uuid}.Item.${id}`,
    name: "Arrows",
    type: "ammo",
    quantity,
    system: structuredClone(sourceData.system),
  });
  item.toObject = () => ({
    ...structuredClone(sourceData),
    _stats: {
      compendiumSource: "Compendium.pf2e.equipment-srd.Item.arrows",
    },
    system: structuredClone(item.system),
  });
  return item;
}

function makeActor(id: string, items: any[] = [], overrides: any = {}) {
  const actor: any = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type: overrides.type ?? "character",
    name: overrides.name ?? id,
    isOwner: true,
    inventory: {
      contents: items,
      currency: overrides.currency ?? { pp: 0, gp: 0, sp: 0, cp: 0 },
      bulk: overrides.bulk ?? { toString: () => "1" },
      wealth: overrides.wealth ?? 50,
      get(itemId: string) {
        return this.contents.find((item: any) => item.id === itemId) ?? null;
      },
      add:
        overrides.add ??
        vi.fn(async (data: any, opts: any) => {
          const rows = Array.isArray(data) ? data : [data];
          return rows.map((row: any, index: number) => {
            const item = makeItem(actor, {
              ...row,
              id: "created-" + index,
              uuid: `${actor.uuid}.Item.created-${index}`,
              quantity: row.system.quantity,
              sourceData: row,
            });
            actor.inventory.contents.push(item);
            return item;
          });
        }),
      findStackableItem: overrides.findStackableItem,
      addCurrency:
        overrides.addCurrency ??
        vi.fn(async (coins: any) => {
          for (const key of ["pp", "gp", "sp", "cp"])
            actor.inventory.currency[key] += coins[key] ?? 0;
        }),
    },
    canUserModify: () => true,
    ...overrides,
  };
  for (const item of items) item.parent = actor;
  return actor;
}

function makeEnv() {
  const existing = makeActor("existing", []);
  const sourceActor = makeActor("source", []);
  const targetActor = makeActor("target", []);
  const pack = {
    collection: "pf2e.equipment-srd",
    metadata: { system: "pf2e" },
  };
  const sourceData = {
    _id: "source-item-id",
    name: "Sturdy Shield",
    type: "shield",
    system: {
      quantity: 1,
      containerId: "foreign-container",
      equipped: { carryType: "worn" },
      hardness: 5,
    },
    flags: { pf2e: { runes: { potency: 1 } } },
    ownership: { default: 0 },
  };
  const ammoSourceData = {
    _id: "arrow-source-id",
    _stats: {
      compendiumSource: "Compendium.pf2e.equipment-srd.Item.arrows",
    },
    img: "icons/weapons/ammunition/arrows-broadhead-white.webp",
    name: "Arrows",
    type: "ammo",
    system: {
      baseItem: "arrows",
      bulk: { value: 0.1 },
      containerId: null,
      craftableAs: null,
      description: { value: "Bow ammunition." },
      level: { value: 0 },
      price: { per: 10, value: { sp: 1 } },
      publication: { license: "ORC", remaster: true, title: "Player Core" },
      quantity: 10,
      rules: [],
      size: "med",
      slug: "arrows",
      traits: { rarity: "common", value: ["consumable"] },
      uses: { autoDestroy: true, max: 1, value: 1 },
    },
  };
  const compendiumItem: any = {
    id: "shield",
    uuid: "Compendium.pf2e.equipment-srd.Item.shield",
    name: sourceData.name,
    type: "shield",
    documentName: "Item",
    pack: pack.collection,
    parent: null,
    compendium: {},
    isEmbedded: false,
    isOfType: (type: string) => type === "physical",
    toObject: () => structuredClone(sourceData),
  };
  const compendiumAmmo: any = {
    id: "arrows",
    uuid: "Compendium.pf2e.equipment-srd.Item.arrows",
    name: ammoSourceData.name,
    type: ammoSourceData.type,
    documentName: "Item",
    pack: pack.collection,
    parent: null,
    compendium: {},
    isEmbedded: false,
    isOfType: (type: string) => type === "physical",
    toObject: () => structuredClone(ammoSourceData),
  };
  const resolved = new Map<string, any>([
    [existing.uuid, existing],
    [sourceActor.uuid, sourceActor],
    [targetActor.uuid, targetActor],
    [compendiumItem.uuid, compendiumItem],
    [compendiumAmmo.uuid, compendiumAmmo],
  ]);
  const calls: any = {
    fromCompendium: vi.fn((document: any) =>
      structuredClone(
        document === compendiumAmmo ? ammoSourceData : sourceData,
      ),
    ),
    actorCreates: [],
  };
  const ctx: PF2eContext = {
    game: {
      system: { id: "pf2e", version: "6.0.0" },
      pf2e: {},
      settings: { get: () => true },
      user: { id: "gm" },
      packs: {
        get: (id: string) => (id === pack.collection ? pack : undefined),
      },
      items: { fromCompendium: calls.fromCompendium },
      actors: {
        get: (id: string) =>
          [existing, sourceActor, targetActor].find((actor) => actor.id === id),
        documentClass: {
          create: vi.fn(async (data: any, options: any) => {
            calls.actorCreates.push({ data, options });
            const actor = makeActor("loot-" + calls.actorCreates.length, [], {
              type: data.type,
              name: data.name,
            });
            actor.system = data.system;
            resolved.set(actor.uuid, actor);
            return actor;
          }),
        },
      },
      folders: { get: () => null },
    },
    resolve: async (uuid) => resolved.get(uuid),
    assertWrite: vi.fn(),
    serialize: (doc) => ({ uuid: doc.uuid, name: doc.name }),
  };
  return {
    ctx,
    existing,
    sourceActor,
    targetActor,
    compendiumItem,
    compendiumAmmo,
    sourceData,
    ammoSourceData,
    calls,
    resolved,
  };
}

describe("PF2e inventory adapter", () => {
  it("returns bounded physical inventory with null-safe metrics and currency", async () => {
    const env = makeEnv();
    const sword = makeItem(env.existing, {
      id: "sword",
      quantity: 4,
      system: {
        quantity: 4,
        equipped: { carryType: "held" },
        identification: { status: "identified" },
      },
    });
    env.existing.inventory.contents.push(sword);
    const result: any = await handlePF2eInventory(
      "pf2e_inventory",
      { actorUuid: env.existing.uuid, offset: 0, limit: 10 },
      env.ctx,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      uuid: sword.uuid,
      quantity: 4,
      carryType: "held",
      identification: "identified",
    });
    expect(result.coins).toEqual({ pp: 0, gp: 0, sp: 0, cp: 0 });
  });

  it("inspects native ammunition and legacy consumables while filtering nonphysical Items", async () => {
    const env = makeEnv();
    const arrows = makeAmmoItem(env.existing, "arrows", 10);
    const potion: any = makeItem(env.existing, {
      id: "potion",
      name: "Healing Potion",
      type: "consumable",
      quantity: 2,
    });
    // Older Item data may not expose the newer physical-type predicate.
    delete potion.isOfType;
    const unsupported = ["effect", "spell", "action"].map((type) =>
      makeItem(env.existing, { id: type, type, name: type }),
    );
    env.existing.inventory.contents.push(arrows, potion, ...unsupported);

    const result: any = await handlePF2eInventory(
      "pf2e_inventory",
      { actorUuid: env.existing.uuid, offset: 0, limit: 10 },
      env.ctx,
    );
    expect(result.total).toBe(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uuid: arrows.uuid,
          type: "ammo",
          quantity: 10,
        }),
        expect.objectContaining({
          uuid: potion.uuid,
          type: "consumable",
          quantity: 2,
        }),
      ]),
    );
  });

  it("adds native ammunition through PF2e inventory.add and preserves ammunition metadata", async () => {
    const env = makeEnv();
    const result: any = await handlePF2eInventory(
      "pf2e_add_inventory_item",
      {
        actorUuid: env.existing.uuid,
        uuid: env.compendiumAmmo.uuid,
        quantity: 4,
        newStack: true,
      },
      env.ctx,
    );
    expect(env.calls.fromCompendium).toHaveBeenCalledWith(
      env.compendiumAmmo,
      expect.objectContaining({ keepId: false, clearOwnership: true }),
    );
    const addedData = env.existing.inventory.add.mock.calls[0][0];
    expect(addedData).toMatchObject({
      type: "ammo",
      system: {
        quantity: 4,
        baseItem: "arrows",
        uses: { autoDestroy: true, max: 1, value: 1 },
        size: "med",
        slug: "arrows",
        price: { per: 10, value: { sp: 1 } },
        traits: { rarity: "common", value: ["consumable"] },
        publication: { remaster: true, title: "Player Core" },
      },
    });
    expect(addedData._id).toBeUndefined();
    expect(addedData.system.containerId).toBeUndefined();
    expect(env.ammoSourceData.system.quantity).toBe(10);
    const created = env.existing.inventory.get("created-0");
    expect(created.type).toBe("ammo");
    expect(created.toObject()).toMatchObject({
      _stats: {
        compendiumSource: "Compendium.pf2e.equipment-srd.Item.arrows",
      },
      system: {
        quantity: 4,
        baseItem: "arrows",
        uses: { autoDestroy: true, max: 1, value: 1 },
        bulk: { value: 0.1 },
        price: { per: 10, value: { sp: 1 } },
        publication: { remaster: true, title: "Player Core" },
      },
    });
    expect(result).toMatchObject({
      actorUuid: env.existing.uuid,
      itemName: "Arrows",
      quantity: 4,
      stacked: false,
    });
  });

  it("rejects effects, spells, and actions as physical inventory sources", async () => {
    const env = makeEnv();
    for (const type of ["effect", "spell", "action"]) {
      const uuid = `Compendium.pf2e.equipment-srd.Item.${type}`;
      const document = {
        ...env.compendiumAmmo,
        id: type,
        uuid,
        type,
        isOfType: vi.fn(() => false),
      };
      env.resolved.set(uuid, document);
      await expect(
        handlePF2eInventory(
          "pf2e_add_inventory_item",
          {
            actorUuid: env.existing.uuid,
            uuid,
            quantity: 1,
            newStack: true,
          },
          env.ctx,
        ),
      ).rejects.toMatchObject({ code: "PF2E_UNSUPPORTED_ITEM" });
    }
    expect(env.existing.inventory.add).not.toHaveBeenCalled();
    expect(env.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("stacks native ammunition into a compatible PF2e stack and confirms both quantities", async () => {
    const env = makeEnv();
    const stacked = makeAmmoItem(env.existing, "existing-arrows", 6);
    env.existing.inventory.contents.push(stacked);
    env.existing.inventory.findStackableItem = vi.fn(() => stacked);
    env.existing.inventory.add = vi.fn(async (data: any, options: any) => {
      expect(options).toEqual({ stack: true, render: false });
      expect(data.type).toBe("ammo");
      stacked.quantity += data.system.quantity;
      stacked.system.quantity = stacked.quantity;
      return [stacked];
    });
    const result: any = await handlePF2eInventory(
      "pf2e_add_inventory_item",
      {
        actorUuid: env.existing.uuid,
        uuid: env.compendiumAmmo.uuid,
        quantity: 4,
        newStack: false,
      },
      env.ctx,
    );
    expect(result).toMatchObject({
      itemUuid: stacked.uuid,
      quantity: 10,
      addedQuantity: 4,
      previousQuantity: 6,
      stacked: true,
    });
    expect(stacked.system.uses).toEqual({
      autoDestroy: true,
      max: 1,
      value: 1,
    });
    expect(stacked.system.baseItem).toBe("arrows");
  });

  it("imports physical compendium items through native inventory.add and retains PF2e source fields", async () => {
    const env = makeEnv();
    const result: any = await handlePF2eInventory(
      "pf2e_add_inventory_item",
      {
        actorUuid: env.existing.uuid,
        uuid: env.compendiumItem.uuid,
        quantity: 2,
        newStack: true,
      },
      env.ctx,
    );
    expect(env.calls.fromCompendium).toHaveBeenCalledWith(
      env.compendiumItem,
      expect.objectContaining({ keepId: false, clearOwnership: true }),
    );
    expect(env.existing.inventory.add).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: { pf2e: { runes: { potency: 1 } } },
        system: expect.objectContaining({ quantity: 2, hardness: 5 }),
      }),
      { stack: false, render: false },
    );
    expect(env.sourceData.system.containerId).toBe("foreign-container");
    expect(result).toMatchObject({
      actorUuid: env.existing.uuid,
      itemName: "Sturdy Shield",
      quantity: 2,
      stacked: false,
    });
  });

  it("returns the existing UUID when the native add stacks an item", async () => {
    const env = makeEnv();
    const stacked = makeItem(env.existing, {
      id: "existing-stack",
      quantity: 7,
    });
    env.existing.inventory.contents.push(stacked);
    env.existing.inventory.findStackableItem = vi.fn(() => stacked);
    env.existing.inventory.add = vi.fn(async () => [stacked]);
    const result: any = await handlePF2eInventory(
      "pf2e_add_inventory_item",
      {
        actorUuid: env.existing.uuid,
        uuid: env.compendiumItem.uuid,
        quantity: 2,
        newStack: false,
      },
      env.ctx,
    );
    expect(result.itemUuid).toBe(stacked.uuid);
    expect(result.stacked).toBe(true);
  });

  it("rejects foreign items and nonempty backpacks before writes", async () => {
    const env = makeEnv();
    const foreign = makeItem(env.sourceActor, { id: "foreign" });
    env.resolved.set(foreign.uuid, foreign);
    await expect(
      handlePF2eInventory(
        "pf2e_set_item_quantity",
        {
          actorUuid: env.existing.uuid,
          itemUuid: foreign.uuid,
          quantity: 2,
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_ITEM_OWNERSHIP" });
    const backpack = makeItem(env.existing, {
      id: "bag",
      type: "backpack",
      contents: [{ id: "inside" }],
    });
    env.existing.inventory.contents.push(backpack);
    env.resolved.set(backpack.uuid, backpack);
    await expect(
      handlePF2eInventory(
        "pf2e_set_item_quantity",
        {
          actorUuid: env.existing.uuid,
          itemUuid: backpack.uuid,
          quantity: 2,
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_NONEMPTY_CONTAINER" });
    expect(env.ctx.assertWrite).not.toHaveBeenCalled();
  });

  it("sets a positive quantity through the native item update", async () => {
    const env = makeEnv();
    const item = makeAmmoItem(env.existing, "arrows", 6);
    env.existing.inventory.contents.push(item);
    env.resolved.set(item.uuid, item);
    const result: any = await handlePF2eInventory(
      "pf2e_set_item_quantity",
      {
        actorUuid: env.existing.uuid,
        itemUuid: item.uuid,
        quantity: 3,
      },
      env.ctx,
    );
    expect(item.update).toHaveBeenCalledWith({ "system.quantity": 3 });
    expect(result).toMatchObject({ previousQuantity: 6, quantity: 3 });
    expect(item.system.quantity).toBe(3);
    expect(item.system.baseItem).toBe("arrows");
    expect(item.system.uses.autoDestroy).toBe(true);
  });

  it("allows setting quantity above the current stack size", async () => {
    const env = makeEnv();
    const item = makeAmmoItem(env.existing, "bolts", 2);
    env.existing.inventory.contents.push(item);
    env.resolved.set(item.uuid, item);
    const result: any = await handlePF2eInventory(
      "pf2e_set_item_quantity",
      {
        actorUuid: env.existing.uuid,
        itemUuid: item.uuid,
        quantity: 7,
      },
      env.ctx,
    );
    expect(result).toMatchObject({ previousQuantity: 2, quantity: 7 });
  });

  it("transfers ammunition partially and fully with native API and preserved metadata", async () => {
    const env = makeEnv();
    const item = makeAmmoItem(env.sourceActor, "arrows", 8);
    item.system.uses.value = 0;
    item.system.description.value = "Marked test arrows retain this metadata.";
    env.sourceActor.inventory.contents.push(item);
    env.resolved.set(item.uuid, item);
    let newStackId = 0;
    env.sourceActor.transferItemToActor = vi.fn(async (...args: any[]) => {
      const [target, sourceItem, quantity, _containerId, newStack, purchase] =
        args;
      expect(purchase).toBe(false);
      expect(sourceItem).toBe(item);
      expect(sourceItem.type).toBe("ammo");
      expect(sourceItem.toObject()._stats.compendiumSource).toBe(
        "Compendium.pf2e.equipment-srd.Item.arrows",
      );
      const id = `received-${++newStackId}`;
      const transferredData = sourceItem.toObject();
      transferredData._id = id;
      transferredData.system = structuredClone(sourceItem.system);
      transferredData.system.quantity = quantity;
      const transferred = makeItem(target, {
        id,
        uuid: `${target.uuid}.Item.${id}`,
        name: sourceItem.name,
        type: sourceItem.type,
        quantity,
        system: transferredData.system,
        sourceData: transferredData,
      });
      target.inventory.contents.push(transferred);
      sourceItem.quantity -= quantity;
      sourceItem.system.quantity = sourceItem.quantity;
      if (sourceItem.quantity === 0) {
        env.sourceActor.inventory.contents =
          env.sourceActor.inventory.contents.filter(
            (entry: any) => entry !== sourceItem,
          );
      }
      return transferred;
    });
    const partial: any = await handlePF2eInventory(
      "pf2e_transfer_item",
      {
        sourceActorUuid: env.sourceActor.uuid,
        targetActorUuid: env.targetActor.uuid,
        itemUuid: item.uuid,
        quantity: 3,
        newStack: true,
      },
      env.ctx,
    );
    expect(partial).toMatchObject({
      sourceQuantity: 5,
      transferredQuantity: 3,
      stacked: false,
    });
    const partialStack = env.targetActor.inventory.get("received-1");
    expect(item.quantity).toBe(5);
    expect(partialStack.quantity).toBe(3);
    expect(partialStack.toObject()).toMatchObject({
      _stats: {
        compendiumSource: "Compendium.pf2e.equipment-srd.Item.arrows",
      },
      system: {
        uses: { autoDestroy: true, max: 1, value: 0 },
        description: {
          value: "Marked test arrows retain this metadata.",
        },
      },
    });

    const full: any = await handlePF2eInventory(
      "pf2e_transfer_item",
      {
        sourceActorUuid: env.sourceActor.uuid,
        targetActorUuid: env.targetActor.uuid,
        itemUuid: item.uuid,
        quantity: 5,
        newStack: true,
      },
      env.ctx,
    );
    const newStack = env.targetActor.inventory.get("received-2");
    expect(full).toMatchObject({
      sourceQuantity: 0,
      transferredItemUuid: newStack.uuid,
      transferredQuantity: 5,
      stacked: false,
    });
    expect(env.sourceActor.inventory.get(item.id)).toBeNull();
    expect(newStack.type).toBe("ammo");
    expect(newStack.system.baseItem).toBe("arrows");
    expect(newStack.system.quantity).toBe(5);
    expect(newStack.system.uses).toEqual({
      autoDestroy: true,
      max: 1,
      value: 0,
    });
    expect(newStack.toObject()._stats.compendiumSource).toBe(
      "Compendium.pf2e.equipment-srd.Item.arrows",
    );
    expect(newStack.system.description.value).toBe(
      "Marked test arrows retain this metadata.",
    );
  });

  it("rejects a transfer back into the same Actor before calling PF2e", async () => {
    const env = makeEnv();
    const item = makeItem(env.sourceActor, {
      id: "same-actor-item",
      quantity: 2,
    });
    env.sourceActor.inventory.contents.push(item);
    env.resolved.set(item.uuid, item);
    env.sourceActor.transferItemToActor = vi.fn();
    await expect(
      handlePF2eInventory(
        "pf2e_transfer_item",
        {
          sourceActorUuid: env.sourceActor.uuid,
          targetActorUuid: env.sourceActor.uuid,
          itemUuid: item.uuid,
          quantity: 1,
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({ code: "PF2E_INVALID_TRANSFER" });
    expect(env.sourceActor.transferItemToActor).not.toHaveBeenCalled();
  });

  it("reports uncertain partial transfer when native operation rejects", async () => {
    const env = makeEnv();
    const item = makeItem(env.sourceActor, { id: "coins", quantity: 5 });
    env.sourceActor.inventory.contents.push(item);
    env.resolved.set(item.uuid, item);
    env.sourceActor.transferItemToActor = vi.fn(async () => {
      throw new Error("native interrupted");
    });
    await expect(
      handlePF2eInventory(
        "pf2e_transfer_item",
        {
          sourceActorUuid: env.sourceActor.uuid,
          targetActorUuid: env.targetActor.uuid,
          itemUuid: item.uuid,
          quantity: 2,
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: { outcomeUnknown: true, sourceItemUuid: item.uuid },
    });
  });

  it("adds coins using native PF2e currency API and reports snapshots", async () => {
    const env = makeEnv();
    const result: any = await handlePF2eInventory(
      "pf2e_add_coins",
      {
        actorUuid: env.existing.uuid,
        coins: { pp: 1, gp: 2, sp: 0, cp: 0 },
      },
      env.ctx,
    );
    expect(result.coinsBefore).toEqual({ pp: 0, gp: 0, sp: 0, cp: 0 });
    expect(result.coinsAfter).toEqual({ pp: 1, gp: 2, sp: 0, cp: 0 });
  });

  it("retains zero-valued denominations from native Coins properties", async () => {
    const env = makeEnv();
    env.existing.inventory.currency = {
      pp: 0,
      gp: 0,
      sp: 0,
      cp: 0,
      toObject: () => ({
        pp: undefined,
        gp: undefined,
        sp: undefined,
        cp: undefined,
      }),
    };
    const result: any = await handlePF2eInventory(
      "pf2e_add_coins",
      {
        actorUuid: env.existing.uuid,
        coins: { pp: 0, gp: 0, sp: 1, cp: 0 },
      },
      env.ctx,
    );
    expect(result.coinsBefore).toEqual({ pp: 0, gp: 0, sp: 0, cp: 0 });
    expect(result.coinsAfter).toEqual({ pp: 0, gp: 0, sp: 1, cp: 0 });
  });

  it("reports uncertain currency outcome when native addition rejects", async () => {
    const env = makeEnv();
    env.existing.inventory.addCurrency = vi.fn(async () => {
      throw new Error("partial actor update");
    });
    await expect(
      handlePF2eInventory(
        "pf2e_add_coins",
        {
          actorUuid: env.existing.uuid,
          coins: { pp: 0, gp: 1, sp: 0, cp: 0 },
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: { outcomeUnknown: true, actorUuid: env.existing.uuid },
    });
  });

  it("creates loot and populates it with native inventory and currency operations", async () => {
    const env = makeEnv();
    const result: any = await handlePF2eInventory(
      "pf2e_create_loot",
      {
        name: "Bandit cache",
        items: [{ uuid: env.compendiumItem.uuid, quantity: 3 }],
        coins: { pp: 0, gp: 4, sp: 0, cp: 0 },
      },
      env.ctx,
    );
    expect(env.calls.actorCreates[0].data).toMatchObject({
      type: "loot",
      system: { lootSheetType: "Loot" },
    });
    expect(result.actor.name).toBe("Bandit cache");
    expect(result.items).toHaveLength(1);
  });

  it("reports loot actor and coin uncertainty when native coin addition fails", async () => {
    const env = makeEnv();
    const addCurrency = vi.fn(async () => {
      throw new Error("interrupted");
    });
    const actorClass = env.ctx.game.actors.documentClass;
    const create = actorClass.create;
    actorClass.create = vi.fn(async (...args: any[]) => {
      const actor = await create(...args);
      actor.inventory.addCurrency = addCurrency;
      return actor;
    });
    await expect(
      handlePF2eInventory(
        "pf2e_create_loot",
        {
          name: "Coin cache",
          items: [],
          coins: { pp: 0, gp: 1, sp: 0, cp: 0 },
        },
        env.ctx,
      ),
    ).rejects.toMatchObject({
      code: "PF2E_PARTIAL_FAILURE",
      partial: {
        createdActors: ["Actor.loot-1"],
        coinsApplied: false,
        coinsOutcomeUnknown: true,
      },
    });
  });
});
