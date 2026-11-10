import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eSpellcasting } from "../src/pf2e-spellcasting";
import type { PF2eContext } from "../src/pf2e-context";

let ctx: PF2eContext;
let actor: any;
let scene: any;
let token: any;
let assertWrite: any;

function spell(id: string, options: any = {}) {
  const baseRank = options.baseRank ?? 1;
  return {
    id,
    uuid: "Actor.pc.Item." + id,
    name: options.name ?? id,
    type: "spell",
    isCantrip: options.cantrip === true,
    isFocusSpell: options.focusSpell === true,
    atWill: options.atWill === true,
    rank: options.rank ?? baseRank,
    baseRank,
    system: {
      level: { value: baseRank },
      cast: { focusPoints: options.focusCost ?? 0 },
      location: { signature: options.signature === true, uses: options.uses },
      time: { value: options.time ?? "1" },
      range: { value: "30 feet" },
      target: { value: "1 creature" },
      requirements: { value: "" },
      cost: { value: "" },
    },
    computeCastRank(slot: number | undefined) {
      return this.isCantrip || options.focusSpell
        ? this.rank
        : Math.max(baseRank, slot ?? this.rank);
    },
  };
}
function entry(id: string, category: string, options: any = {}) {
  const spells = (options.spells ?? []).map((item: any) => item);
  const byId = new Map(spells.map((item: any) => [item.id, item]));
  const native = {
    id,
    uuid: category === "ritual" ? null : "Actor.pc.Item." + id,
    name: options.name ?? id,
    actor: null as any,
    category,
    isPrepared: category === "prepared",
    isFlexible: options.flexible === true,
    isFocusPool: category === "focus",
    isInnate: category === "innate",
    isRitual: category === "ritual",
    isEphemeral: options.ephemeral === true,
    tradition: options.tradition ?? "arcane",
    statistic: {
      dc: { value: options.dc ?? 21 },
      check: { mod: options.mod ?? 11 },
    },
    system: {
      prepared: { value: category, flexible: options.flexible === true },
      tradition: { value: options.tradition ?? "arcane" },
      slots: options.slots ?? {},
    },
    spells: new Map(spells.map((item: any) => [item.id, item])) as any,
    async getSpellData() {
      const groups: any[] = [];
      const slotData = this.system.slots;
      if (category === "prepared") {
        for (let rank = 0; rank <= 10; rank++) {
          const slots = slotData["slot" + rank];
          if (!slots) continue;
          const prepared = Array.isArray(slots.prepared) ? slots.prepared : [];
          groups.push({
            id: rank === 0 ? "cantrips" : rank,
            number: rank,
            maxRank: rank === 0 ? 5 : rank,
            uses:
              rank > 0 && this.isFlexible
                ? { value: slots.value ?? 0, max: slots.max ?? 0 }
                : { max: slots.max ?? 0 },
            active:
              rank === 0 || !this.isFlexible
                ? prepared.map((slot: any) => {
                    if (!slot) return null;
                    const preparedSpell: any = byId.get(slot.id ?? "");
                    return preparedSpell
                      ? {
                          spell: preparedSpell,
                          expended: slot.expended === true,
                        }
                      : null;
                  })
                : [],
          });
        }
        if (this.isFlexible) {
          for (const item of spells.filter(
            (s: any) => s.system.location.signature,
          )) {
            for (const group of groups) {
              if (group.number >= item.baseRank && group.uses?.max > 0) {
                const existing = group.active.find(
                  (option: any) => option?.spell === item,
                );
                if (existing) existing.signature = true;
                else
                  group.active.push({
                    spell: item,
                    castRank: group.number,
                    signature: true,
                    virtual: true,
                  });
              }
            }
          }
        }
      } else if (category === "focus") {
        const cantrips = spells.filter((item: any) => item.isCantrip);
        const normal = spells.filter((item: any) => !item.isCantrip);
        const autoRank = Math.max(1, Math.ceil((actor.level ?? 0) / 2));
        if (cantrips.length)
          groups.push({
            id: "cantrips",
            maxRank: autoRank,
            active: cantrips.map((item: any) => ({ spell: item })),
          });
        if (normal.length)
          groups.push({
            id: autoRank,
            maxRank: autoRank,
            uses: actor.system.resources.focus ?? { value: 0, max: 0 },
            active: normal.map((item: any) => ({ spell: item })),
          });
      } else {
        const ranks = new Set(
          spells.map((item: any) => (item.isCantrip ? 0 : item.rank)),
        );
        for (let rank = 0; rank <= 10; rank++) {
          const slots = slotData["slot" + rank];
          if (!ranks.has(rank) && !slots) continue;
          const active = spells
            .filter((item: any) => (item.isCantrip ? 0 : item.rank) === rank)
            .map((item: any) => ({
              spell: item,
              expended:
                category === "innate" &&
                (item.system.location.uses?.value ?? 0) <= 0,
              uses: item.system.location.uses,
            }));
          groups.push({
            id: rank === 0 ? "cantrips" : rank,
            number: rank,
            maxRank: rank === 0 ? 5 : rank,
            uses:
              category === "spontaneous" && rank > 0
                ? { value: slots?.value, max: slots?.max }
                : undefined,
            active,
          });
        }
        if (category === "spontaneous") {
          for (const item of spells.filter(
            (s: any) => s.system.location.signature,
          )) {
            for (const group of groups) {
              if (group.number >= item.baseRank && group.uses?.max > 0) {
                const existing = group.active.find(
                  (a: any) => a.spell === item,
                );
                if (existing) existing.signature = true;
                else
                  group.active.push({
                    spell: item,
                    castRank: group.number,
                    signature: true,
                    virtual: true,
                  });
              }
            }
          }
        }
      }
      return { groups };
    },
  };
  native.spells.getSpellData = native.getSpellData.bind(native);
  return native;
}
function installEntry(item: any) {
  item.actor = actor;
  item.parent = actor;
  for (const ownedSpell of item.spells.values()) {
    ownedSpell.actor = actor;
    ownedSpell.system.location.value = item.id;
  }
  actor.items.set(item.id, item);
  actor.spellcasting.regular.push(item);
  actor.spellcasting.set(item.id, item);
  return item;
}

beforeEach(() => {
  assertWrite = vi.fn();
  actor = {
    documentName: "Actor",
    type: "character",
    id: "pc",
    uuid: "Actor.pc",
    name: "Mira",
    level: 5,
    system: {
      resources: {
        focus: { value: 0, max: 3, cap: 3 },
        heroPoints: { value: 0, max: 3 },
      },
    },
    items: new Map(),
    spellcasting: Object.assign(new Map(), {
      regular: [],
      collections: new Map(),
    }),
  };
  scene = {
    documentName: "Scene",
    id: "scene",
    uuid: "Scene.scene",
    parent: null,
    compendium: false,
    tokens: new Map(),
  };
  token = {
    documentName: "Token",
    id: "token",
    uuid: "Scene.scene.Token.token",
    actor,
    parent: scene,
  };
  scene.tokens.set(token.id, token);
  ctx = {
    game: {
      system: { id: "pf2e", version: "8.7.0" },
      settings: { get: () => true },
      pf2e: {},
      actors: new Map([[actor.id, actor]]),
      scenes: new Map([[scene.id, scene]]),
    },
    resolve: vi.fn(async (uuid: string) =>
      uuid === actor.uuid
        ? actor
        : uuid === token.uuid
          ? token
          : ([...actor.items.values()].find(
              (item: any) => item.uuid === uuid,
            ) ?? null),
    ),
    assertWrite,
    serialize: (doc: any) => doc,
  };
});

describe("PF2e native spellcasting inspection", () => {
  it("preserves prepared holes, explicit slot indices, expended state, and zero-rank group identity", async () => {
    const cantrip = spell("cantrip", { cantrip: true, rank: 3 });
    const expended = spell("shield");
    const prepared = installEntry(
      entry("prepared", "prepared", {
        spells: [cantrip, expended],
        slots: {
          slot0: {
            max: 3,
            prepared: [
              { id: cantrip.id, expended: false },
              null,
              { id: expended.id, expended: true },
            ],
          },
          slot1: { max: 0, prepared: [] },
        },
      }),
    );
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.total).toBe(2);
    expect(result.options.items).toMatchObject([
      {
        spellId: "cantrip",
        groupId: "cantrips",
        groupNumber: 0,
        rank: 3,
        slotId: 0,
        resource: { kind: "none", cost: 0 },
        available: true,
      },
      {
        spellId: "shield",
        groupNumber: 0,
        slotId: 2,
        expended: true,
        available: false,
      },
    ]);
    expect(result.entries.items[0]).toMatchObject({
      uuid: prepared.uuid,
      dc: 21,
      attackModifier: 11,
      supported: true,
    });
    expect(assertWrite).not.toHaveBeenCalled();
  });

  it("uses native spontaneous signature options and slot pools for virtual heightened ranks", async () => {
    const signature = spell("heal", { baseRank: 1, signature: true });
    const spontaneous = installEntry(
      entry("spontaneous", "spontaneous", {
        spells: [signature],
        slots: { slot1: { max: 2, value: 1 }, slot2: { max: 2, value: 1 } },
      }),
    );
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      {
        spellId: "heal",
        groupNumber: 1,
        rank: 1,
        slotId: null,
        signature: true,
        virtual: false,
      },
      {
        spellId: "heal",
        groupNumber: 2,
        rank: 2,
        slotId: null,
        signature: true,
        virtual: true,
      },
    ]);
    expect(
      result.options.items.every(
        (row: any) => row.entryUuid === spontaneous.uuid,
      ),
    ).toBe(true);
  });

  it("keeps flexible cantrip slots indexed while flexible leveled spells use rank pools", async () => {
    const cantrip = spell("guidance", { cantrip: true, rank: 2 });
    const signature = spell("heal", { baseRank: 1, signature: true });
    installEntry(
      entry("flex", "prepared", {
        flexible: true,
        spells: [cantrip, signature],
        slots: {
          slot0: {
            max: 2,
            prepared: [{ id: cantrip.id, expended: false }, null],
          },
          slot1: { max: 2, value: 2, prepared: [] },
          slot2: { max: 2, value: 1, prepared: [] },
        },
      }),
    );
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      { spellId: "guidance", groupNumber: 0, rank: 2, slotId: 0 },
      { spellId: "heal", groupNumber: 1, slotId: null },
      {
        spellId: "heal",
        groupNumber: 2,
        slotId: null,
        signature: true,
        virtual: true,
      },
    ]);
  });

  it("reports focus cost, auto-heightened ranks, and free cantrips without charging", async () => {
    const focusSpell = spell("focus", {
      cantrip: false,
      focusSpell: true,
      focusCost: 1,
      rank: 4,
    });
    const freeCantrip = spell("ray", { cantrip: true, focusCost: 0, rank: 3 });
    installEntry(
      entry("focus-entry", "focus", { spells: [focusSpell, freeCantrip] }),
    );
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      {
        spellId: "ray",
        groupId: "cantrips",
        groupNumber: 0,
        rank: 3,
        resource: { kind: "none", cost: 0 },
        available: true,
      },
      {
        spellId: "focus",
        groupNumber: 3,
        rank: 4,
        resource: { kind: "actorFocus", cost: 1, value: 0, max: 3 },
        available: false,
      },
    ]);
  });

  it("reports exhausted innate uses and missing use data as unsupported rather than unlimited", async () => {
    const empty = spell("empty", { uses: { value: 0, max: 1 } });
    const missing = spell("missing", { uses: undefined, atWill: true });
    installEntry(entry("innate", "innate", { spells: [empty, missing] }));
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      {
        spellId: "empty",
        expended: true,
        available: false,
        resource: { kind: "innateUse", value: 0, max: 1 },
      },
      {
        spellId: "missing",
        available: false,
        unsupportedReason:
          "Native innate-use data is unavailable; unlimited use is not assumed.",
      },
    ]);
  });

  it("uses native heightened rank groups for innate spells without signature status", async () => {
    const heightened = spell("gentle-landing", {
      baseRank: 1,
      rank: 3,
      uses: { value: 1, max: 1 },
    });
    installEntry(entry("innate", "innate", { spells: [heightened] }));
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      {
        spellId: "gentle-landing",
        rank: 3,
        groupNumber: 3,
        slotId: null,
        signature: false,
        resource: { kind: "innateUse", value: 1, max: 1 },
      },
    ]);
  });

  it("reports resources with zero distinct from absent, and paginates item/slot rows", async () => {
    const prepared = installEntry(
      entry("prepared", "prepared", {
        spells: [spell("shield")],
        slots: {
          slot1: {
            max: 2,
            prepared: [
              { id: "shield", expended: true },
              { id: null, expended: false },
            ],
          },
        },
      }),
    );
    actor.items.set("wand", {
      id: "wand",
      uuid: "Actor.pc.Item.wand",
      type: "consumable",
      name: "Wand",
      system: {
        uses: { value: 0, max: 1 },
        frequency: { value: 0, max: 1, per: "day" },
      },
    });
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_resources",
      { targetUuid: actor.uuid, limit: 1 },
      ctx,
    );
    expect(result.resources).toMatchObject({
      focus: { value: 0, max: 3, available: true },
      heroPoints: { value: 0, max: 3, available: true },
    });
    expect(result.entries).toMatchObject({
      total: 3,
      offset: 0,
      limit: 1,
      hasMore: true,
      items: [
        {
          kind: "preparedSlots",
          entryUuid: prepared.uuid,
          rank: 1,
          readyCount: 0,
          max: 2,
          slotsTotal: 2,
          slotsTruncated: false,
          slots: [
            { slotId: 0, spellId: "shield", expended: true },
            { slotId: 1, spellId: null, expended: false },
          ],
        },
      ],
    });
    delete actor.system.resources.heroPoints;
    const absent: any = await handlePF2eSpellcasting(
      "pf2e_inspect_resources",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(absent.resources.heroPoints).toEqual({
      value: null,
      max: null,
      available: false,
      reason: "Native hero-point resource data is unavailable or incomplete.",
    });
    expect(assertWrite).not.toHaveBeenCalled();
  });

  it("keeps good entry options when another native entry fails and reports unsupported rituals", async () => {
    installEntry(
      entry("good", "prepared", {
        spells: [spell("shield")],
        slots: { slot1: { max: 1, prepared: [{ id: "shield" }] } },
      }),
    );
    const broken = installEntry(entry("broken", "prepared"));
    broken.spells.getSpellData = async () => {
      throw new Error("broken native data");
    };
    installEntry(entry("ritual", "ritual", { ephemeral: true }));
    installEntry(entry("item-entry", "items"));
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([{ spellId: "shield" }]);
    expect(result.entries.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uuid: broken.uuid, supported: false }),
        expect.objectContaining({
          uuid: null,
          supported: false,
          unsupportedReason: expect.stringContaining("Ritual"),
        }),
        expect.objectContaining({
          uuid: "Actor.pc.Item.item-entry",
          supported: false,
          unsupportedReason: expect.stringContaining("category"),
        }),
      ]),
    );
    expect(result.warnings).toHaveLength(3);
  });

  it("marks a malformed native active spell as unsupported instead of available", async () => {
    const prepared = installEntry(entry("prepared", "prepared"));
    const foreign: any = spell("foreign");
    foreign.actor = { uuid: "Actor.other" };
    foreign.system.location.value = prepared.id;
    prepared.spells.getSpellData = async () => ({
      groups: [
        { id: 1, number: 1, active: [{ spell: foreign, expended: false }] },
      ],
    });
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.options.items).toMatchObject([
      {
        spellId: "foreign",
        available: false,
        unsupportedReason:
          "Native spell does not belong to this Actor and spellcasting entry.",
      },
    ]);
  });

  it("validates explicit entry ownership and actor/token membership", async () => {
    const owned = installEntry(entry("prepared", "prepared"));
    const valid: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid, entryUuid: owned.uuid },
      ctx,
    );
    expect(valid.entries.items).toHaveLength(1);
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid, entryUuid: "Actor.other.Item.e" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const foreignActor: any = {
      ...actor,
      id: "foreign",
      uuid: "Actor.foreign",
      items: new Map(),
      spellcasting: Object.assign(new Map(), {
        regular: [],
        collections: new Map(),
      }),
    };
    const foreignEntry: any = entry("foreign-entry", "prepared");
    foreignEntry.actor = foreignActor;
    foreignEntry.parent = foreignActor;
    foreignActor.items.set(foreignEntry.id, foreignEntry);
    foreignActor.spellcasting.regular.push(foreignEntry);
    foreignActor.spellcasting.set(foreignEntry.id, foreignEntry);
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid, entryUuid: foreignEntry.uuid },
        {
          ...ctx,
          resolve: async (uuid: string) =>
            uuid === foreignEntry.uuid ? foreignEntry : actor,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const staleReplacement = { ...owned, uuid: owned.uuid };
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid, entryUuid: owned.uuid },
        {
          ...ctx,
          resolve: async (uuid: string) =>
            uuid === owned.uuid ? staleReplacement : actor,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: "Actor.synthetic" },
        {
          ...ctx,
          resolve: async () => ({ ...actor, isEmbedded: true, parent: token }),
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const otherToken = {
      ...token,
      id: "stale",
      uuid: "Scene.scene.Token.stale",
    };
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: otherToken.uuid },
        { ...ctx, resolve: async () => otherToken },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const tokenResult: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: token.uuid },
      ctx,
    );
    expect(tokenResult.actorUuid).toBe(actor.uuid);
  });

  it("rejects other systems, disabled support, and non-character/NPC actors", async () => {
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid },
        { ...ctx, game: { ...ctx.game, system: { id: "dnd5e" } } },
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid },
        { ...ctx, game: { ...ctx.game, settings: { get: () => false } } },
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
    const loot = { ...actor, type: "loot" };
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid },
        { ...ctx, resolve: async () => loot },
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ACTOR" });
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_spellcasting",
        { targetUuid: actor.uuid },
        { ...ctx, game: { ...ctx.game, pf2e: undefined } },
      ),
    ).rejects.toMatchObject({ code: "PF2E_UNAVAILABLE" });
  });

  it("accepts a root NPC and an explicit scene token backed by a synthetic NPC", async () => {
    actor.type = "npc";
    await expect(
      handlePF2eSpellcasting(
        "pf2e_inspect_resources",
        { targetUuid: actor.uuid },
        ctx,
      ),
    ).resolves.toMatchObject({ actorUuid: actor.uuid });
    const synthetic: any = {
      ...actor,
      id: "synthetic",
      uuid: "Actor.synthetic",
      isEmbedded: true,
      parent: token,
      items: new Map(),
      spellcasting: Object.assign(new Map(), {
        regular: [],
        collections: new Map(),
      }),
    };
    const embeddedEntry: any = entry("npc-entry", "prepared", { slots: {} });
    embeddedEntry.actor = synthetic;
    embeddedEntry.parent = synthetic;
    synthetic.items.set(embeddedEntry.id, embeddedEntry);
    synthetic.spellcasting.regular.push(embeddedEntry);
    synthetic.spellcasting.set(embeddedEntry.id, embeddedEntry);
    const explicitToken = { ...token, actor: synthetic };
    scene.tokens.set(explicitToken.id, explicitToken);
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_resources",
      { targetUuid: explicitToken.uuid },
      { ...ctx, resolve: async () => explicitToken },
    );
    expect(result.actorUuid).toBe(synthetic.uuid);
  });

  it("bounds and paginates options for large Actors", async () => {
    const many = Array.from({ length: 120 }, (_, index) =>
      spell("spell" + index),
    );
    installEntry(
      entry("spontaneous", "spontaneous", {
        spells: many,
        slots: { slot1: { value: 1, max: 1 } },
      }),
    );
    const first: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(first.options).toMatchObject({
      total: 120,
      offset: 0,
      limit: 25,
      hasMore: true,
    });
    expect(first.options.items).toHaveLength(25);
    const next: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid, offset: 100, limit: 100 },
      ctx,
    );
    expect(next.options).toMatchObject({
      total: 120,
      offset: 100,
      limit: 100,
      hasMore: false,
    });
    expect(next.options.items).toHaveLength(20);
  });

  it("reports a missing native spellcasting API instead of an ordinary empty result", async () => {
    delete actor.spellcasting;
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.available).toBe(false);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("API is unavailable"),
      }),
    ]);
  });

  it("reports unresolved native spell data shapes instead of a false empty result", async () => {
    const broken = installEntry(entry("broken-shape", "prepared"));
    broken.spells.getSpellData = async () => undefined;
    installEntry(entry("empty-valid", "prepared", { slots: {} }));
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_spellcasting",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.entries.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uuid: broken.uuid, supported: false }),
        expect.objectContaining({
          uuid: "Actor.pc.Item.empty-valid",
          supported: true,
        }),
      ]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("unsupported shape"),
        }),
      ]),
    );
  });

  it("counts only owned, unexpended prepared selections and bounds long slot lists", async () => {
    const ready = spell("ready");
    const slots = [
      { id: ready.id, expended: false },
      { id: null, expended: false },
      ...Array.from({ length: 105 }, () => ({ id: null, expended: false })),
    ];
    const prepared = installEntry(
      entry("prepared", "prepared", {
        spells: [ready],
        slots: { slot1: { max: slots.length, prepared: slots } },
      }),
    );
    const result: any = await handlePF2eSpellcasting(
      "pf2e_inspect_resources",
      { targetUuid: actor.uuid },
      ctx,
    );
    expect(result.entries.items[0]).toMatchObject({
      kind: "preparedSlots",
      entryUuid: prepared.uuid,
      readyCount: 1,
      slotsTotal: 107,
      slotsTruncated: true,
      slots: expect.arrayContaining([
        { slotId: 0, spellId: "ready", expended: false },
      ]),
    });
    expect(result.entries.items[0].slots).toHaveLength(100);
  });
});
