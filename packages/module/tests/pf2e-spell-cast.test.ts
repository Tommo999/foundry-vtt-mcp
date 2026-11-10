import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePF2eSpellCast } from "../src/pf2e-spell-cast";
import { withSpellCastLedger } from "../src/pf2e-spell-ledger";

let ctx: any;
let actor: any;
let scene: any;
let token: any;
let entry: any;
let spell: any;
let messages: Map<string, any>;
let store: any;
let assertWrite: any;
let consume: any;
let toMessage: any;
let globalChatMessage: any;
let targetToken: any;

function makeSpell({
  id = "spell",
  rank = 1,
  cantrip = false,
  focus = false,
  focusCost = 0,
  time = "1",
  signature = false,
  uses,
}: {
  id?: string;
  rank?: number;
  cantrip?: boolean;
  focus?: boolean;
  focusCost?: number;
  time?: string;
  signature?: boolean;
  uses?: { value: number; max: number };
} = {}) {
  const source = {
    _id: id,
    name: id,
    type: "spell",
    system: {
      level: { value: rank },
      cast: { focusPoints: focusCost },
      location: {
        value: "entry",
        uses: uses ? structuredClone(uses) : null,
        original: null,
        signature,
      },
      time: { value: time },
      overlays: { heightened: {} },
    },
  };
  return {
    id,
    uuid: `Actor.caster.Item.${id}`,
    name: id,
    type: "spell",
    actor: null as any,
    isCantrip: cantrip,
    isFocusSpell: focus,
    rank,
    system: structuredClone(source.system),
    toObject: () => structuredClone(source),
    computeCastRank(groupNumber?: number) {
      return cantrip || focus ? rank : Math.max(rank, groupNumber ?? rank);
    },
    toMessage: vi.fn(),
  };
}

function makeEntry({
  category = "prepared",
  flexible = false,
  prepared,
  spells,
  slots = {},
  groupNumber,
}: {
  category?: string;
  flexible?: boolean;
  prepared?: Array<{ id: string | null; expended?: boolean } | null>;
  spells: any[];
  slots?: Record<string, any>;
  groupNumber?: number;
}) {
  const byId = new Map(spells.map((item) => [item.id, item]));
  const native = {
    id: "entry",
    uuid: "Actor.caster.Item.entry",
    name: "Arcane",
    type: "spellcastingEntry",
    actor,
    parent: actor,
    category,
    isPrepared: category === "prepared",
    isFlexible: flexible,
    isRitual: false,
    isEphemeral: false,
    statistic: { dc: { value: 21 }, check: { mod: 11 } },
    system: {
      prepared: { value: category, flexible },
      slots: structuredClone(slots),
    },
    spells: Object.assign(new Map(spells.map((item) => [item.id, item])), {
      async getSpellData() {
        if (category === "prepared") {
          const ranks = new Set([
            ...spells.map((item) => item.rank),
            ...Object.keys(native.system.slots)
              .filter((key) => /^slot\d+$/.test(key))
              .map((key) => Number(key.slice(4))),
          ]);
          const rows: any[] = [];
          for (let rank = 0; rank <= 10; rank += 1) {
            const slotData = native.system.slots[`slot${rank}`];
            if (!slotData && rank !== groupNumber && !ranks.has(rank)) continue;
            const positions =
              rank === 0 && prepared
                ? prepared
                : native.isFlexible && rank > 0
                  ? []
                  : (slotData?.prepared ?? []);
            rows.push({
              id: rank === 0 ? "cantrips" : rank,
              number: rank,
              active: positions.map((position: any) =>
                position?.id
                  ? {
                      spell: byId.get(position.id),
                      expended: position.expended === true,
                    }
                  : null,
              ),
              uses:
                native.isFlexible && rank > 0
                  ? { value: slotData?.value, max: slotData?.max }
                  : { max: slotData?.max },
            });
          }
          if (native.isFlexible) {
            for (const item of spells.filter(
              (candidate) => candidate.system.location.signature,
            )) {
              for (const group of rows) {
                const pool = native.system.slots[`slot${group.number}`];
                if (group.number >= item.rank && Number(pool?.max) > 0)
                  group.active.push({
                    spell: item,
                    castRank: group.number,
                    signature: true,
                    virtual: group.number > item.rank,
                  });
              }
            }
          }
          return { groups: rows };
        }
        if (category === "focus") {
          const autoGroup =
            groupNumber ?? Math.max(1, Math.ceil((actor.level ?? 0) / 2));
          return {
            groups: [
              {
                id: autoGroup,
                maxRank: Math.min(10, autoGroup),
                active: spells.map((item) => ({ spell: item })),
              },
            ],
          };
        }
        const ranks = new Set([
          ...spells.map((item) => item.rank),
          ...Object.keys(native.system.slots)
            .filter((key) => /^slot\d+$/.test(key))
            .map((key) => Number(key.slice(4))),
        ]);
        const rows: any[] = [...ranks].map((rank) => ({
          id: rank,
          number: rank,
          active: spells
            .filter((item) => item.rank === rank)
            .map((item) => ({
              spell: item,
              expended:
                category === "innate" &&
                Number(item.system.location.uses?.value ?? 0) <= 0,
            })),
          uses: native.system.slots[`slot${rank}`],
        }));
        if (category === "spontaneous") {
          for (const item of spells.filter(
            (candidate) => candidate.system.location.signature,
          )) {
            for (const group of rows) {
              if (group.number > item.rank && Number(group.uses?.max) > 0)
                group.active.push({
                  spell: item,
                  castRank: group.number,
                  signature: true,
                  virtual: true,
                });
            }
          }
        }
        return {
          groups: rows,
        };
      },
    }),
    async consume(selectedSpell: any, rank: number, slotId?: number) {
      return consume(selectedSpell, rank, slotId, native);
    },
    toObject: () => ({
      _id: "entry",
      name: "Arcane",
      type: "spellcastingEntry",
      system: structuredClone(native.system),
    }),
  };
  for (const item of spells) {
    item.actor = actor;
    item.system.location.value = native.id;
  }
  return native;
}

function setup(
  options: {
    category?: string;
    flexible?: boolean;
    spellOptions?: Parameters<typeof makeSpell>[0];
    prepared?: Array<{ id: string | null; expended?: boolean } | null>;
    slots?: Record<string, any>;
    groupNumber?: number;
  } = {},
) {
  store = undefined;
  messages = new Map();
  assertWrite = vi.fn();
  consume = vi.fn(async (selectedSpell, rank, slotId, nativeEntry) => {
    const focusCost = selectedSpell.system.cast.focusPoints;
    if (focusCost > 0) {
      if (actor.system.resources.focus.value < focusCost) return false;
      actor.system.resources.focus.value -= focusCost;
    } else if (
      focusCost === 0 &&
      (selectedSpell.isCantrip || selectedSpell.isFocusSpell)
    ) {
      // Native free cantrips are not charged or expended.
    } else if (options.category === "prepared" || !options.category) {
      if (slotId !== undefined) {
        const list = nativeEntry.system.slots[`slot${rank}`]?.prepared;
        if (!list?.[slotId] || list[slotId].expended === true) return false;
        list[slotId].expended = true;
      } else if (nativeEntry.isFlexible) {
        const pool = nativeEntry.system.slots[`slot${rank}`];
        if (!pool || pool.value <= 0) return false;
        pool.value -= 1;
      }
    } else if (options.category === "innate") {
      if (
        !selectedSpell.system.location.uses ||
        selectedSpell.system.location.uses.value <= 0
      )
        return false;
      selectedSpell.system.location.uses.value -= 1;
    } else {
      const pool = nativeEntry.system.slots[`slot${rank}`];
      if (!pool || pool.value <= 0) return false;
      pool.value -= 1;
    }
    return true;
  });
  spell = makeSpell(options.spellOptions);
  actor = {
    documentName: "Actor",
    type: "character",
    id: "caster",
    uuid: "Actor.caster",
    level: 5,
    system: {
      resources: {
        focus: { value: 3, max: 3 },
        heroPoints: { value: 0, max: 3 },
      },
    },
    items: new Map(),
    spellcasting: Object.assign(new Map(), {
      regular: [],
      collections: new Map(),
    }),
    toObject: () => ({
      _id: "caster",
      type: "character",
      system: structuredClone(actor.system),
    }),
  };
  entry = makeEntry({
    category: options.category ?? "prepared",
    flexible: options.flexible,
    prepared: options.prepared,
    spells: [spell],
    slots: options.slots ?? {
      slot1: { max: 1, prepared: [{ id: spell.id, expended: false }] },
    },
    groupNumber: options.groupNumber,
  });
  actor.items.set(entry.id, entry);
  actor.items.set(spell.id, spell);
  actor.spellcasting.regular.push(entry);
  scene = {
    documentName: "Scene",
    id: "scene",
    uuid: "Scene.scene",
    compendium: false,
    parent: null,
    tokens: new Map(),
  };
  token = {
    documentName: "Token",
    id: "caster-token",
    uuid: "Scene.scene.Token.caster-token",
    parent: scene,
    actor,
  };
  targetToken = {
    documentName: "Token",
    id: "target-token",
    uuid: "Scene.scene.Token.target-token",
    parent: scene,
    actor: { documentName: "Actor", id: "target", uuid: "Actor.target" },
  };
  scene.tokens.set(token.id, token);
  scene.tokens.set(targetToken.id, targetToken);
  const docs = new Map([
    [scene.uuid, scene],
    [token.uuid, token],
    [targetToken.uuid, targetToken],
    [actor.uuid, actor],
    [entry.uuid, entry],
    [spell.uuid, spell],
  ]);
  ctx = {
    sessionId: "session-current",
    game: {
      system: { id: "pf2e", version: "8.7.0" },
      pf2e: {},
      user: { id: "gm", isGM: true, targets: new Set(["unchanged"]) },
      world: { id: "world" },
      actors: new Map([[actor.id, actor]]),
      scenes: new Map([[scene.id, scene]]),
      combats: new Map(),
      messages,
      settings: {
        get: (_namespace: string, key: string) =>
          key === "pf2eEnabled"
            ? true
            : key === "spellCasts"
              ? store
              : undefined,
        set: vi.fn(async (_namespace: string, _key: string, value: unknown) => {
          store = structuredClone(value);
          return value;
        }),
      },
    },
    resolve: vi.fn(async (uuid: string) => docs.get(uuid) ?? null),
    assertWrite,
    serialize: (document: any) => document,
  };
  spell.toMessage = vi.fn(async (_roll: unknown, parameters: any) => {
    toMessage(parameters);
    return {
      content: `<p>Native card ${spell.name}</p>`,
      whisper: parameters.mode === "gm" ? ["gm"] : [],
      blind: parameters.mode === "blind",
      speaker: { alias: "Wrong first active token" },
      flags: {
        pf2e: {
          origin: {
            uuid: spell.uuid,
            rollOptions: ["origin:action:slug:cast-a-spell"],
          },
          casting: { id: entry.id },
          nativeMarker: "preserve-me",
        },
      },
    };
  });
  const messageClass = {
    getSpeaker: vi.fn(({ actor: speakerActor, token: speakerToken }) => ({
      actor: speakerActor.id,
      token: speakerToken.id,
      scene: scene.id,
      alias: "Explicit caster",
    })),
    create: vi.fn(async (source: any) => {
      const created = {
        id: `message-${messages.size + 1}`,
        uuid: `ChatMessage.message-${messages.size + 1}`,
        speaker: source.speaker,
        flags: structuredClone(source.flags),
        content: source.content,
        whisper: source.whisper,
        blind: source.blind,
      };
      messages.set(created.id, created);
      return created;
    }),
  };
  globalChatMessage = (globalThis as any).ChatMessage;
  (globalThis as any).ChatMessage = messageClass;
  toMessage = vi.fn();
  return messageClass;
}

function selection(overrides: Record<string, unknown> = {}) {
  return {
    casterTokenUuid: "Scene.scene.Token.caster-token",
    entryUuid: "Actor.caster.Item.entry",
    spellUuid: "Actor.caster.Item.spell",
    rank: 1,
    slotId: 0,
    targetTokenUuids: ["Scene.scene.Token.target-token"],
    messageMode: "gm",
    ...overrides,
  };
}
async function inspect(overrides: Record<string, unknown> = {}) {
  return (await handlePF2eSpellCast(
    "pf2e_inspect_spell_cast",
    selection(overrides),
    ctx,
  )) as any;
}
async function cast(intent: any, overrides: Record<string, unknown> = {}) {
  return handlePF2eSpellCast(
    "pf2e_cast_spell",
    {
      ...selection(overrides),
      castId: intent.castId,
      reviewToken: intent.reviewToken,
      expectedCombat: intent.expectedCombat,
    },
    ctx,
  );
}

beforeEach(() => {
  setup();
});
afterEach(() => {
  (globalThis as any).ChatMessage = globalChatMessage;
});

describe("PF2e native inspected spell casts", () => {
  it("previews without world writes and creates a native card with explicit speaker and preserved mode", async () => {
    const messageClass = (globalThis as any).ChatMessage;
    const intent = await inspect();
    expect(intent).toMatchObject({
      supported: true,
      readOnly: true,
      resourceBefore: { kind: "preparedSlot", expended: false },
    });
    expect(ctx.game.settings.set).not.toHaveBeenCalled();
    const result: any = await cast(intent);
    expect(result).toMatchObject({
      cast: "confirmed",
      rank: 1,
      resourceBefore: { kind: "preparedSlot", expended: false },
      resourceAfter: { kind: "preparedSlot", expended: true },
      effectsApplied: false,
      targetRollsResolved: false,
    });
    expect(consume).toHaveBeenCalledWith(spell, 1, 0, entry);
    expect(toMessage).toHaveBeenCalledWith({
      actualCast: true,
      create: false,
      data: { castRank: 1 },
      mode: "gm",
    });
    expect(messageClass.getSpeaker).toHaveBeenCalled();
    const created = messages.get("message-1");
    expect(created.speaker).toEqual({
      actor: actor.id,
      token: token.id,
      scene: scene.id,
      alias: "Explicit caster",
    });
    expect(created.whisper).toEqual(["gm"]);
    expect(created.flags.pf2e.nativeMarker).toBe("preserve-me");
    expect(created.flags["foundry-vtt-mcp"].spellCast.targetTokenUuids).toEqual(
      [targetToken.uuid],
    );
    expect(ctx.game.user.targets).toEqual(new Set(["unchanged"]));
    expect(store.entries[intent.castId].status).toBe("confirmed");
  });

  it("posts a no-charge cantrip and requires a fresh one-use intent each time", async () => {
    setup({
      spellOptions: { cantrip: true, rank: 3 },
      prepared: [{ id: "spell", expended: false }],
      slots: {
        slot0: { max: 1, prepared: [{ id: "spell", expended: false }] },
      },
    });
    const first = await inspect({ rank: 3 });
    expect(first).toMatchObject({
      nativeGroupNumber: 0,
      resourceBefore: { kind: "none", groupNumber: 0, slotId: 0 },
    });
    await cast(first, { rank: 3 });
    expect(toMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { castRank: 3 } }),
    );
    await expect(cast(first, { rank: 3 })).rejects.toMatchObject({
      code: "CAST_INTENT_USED",
    });
    const second = await inspect({ rank: 3 });
    await cast(second, { rank: 3 });
    expect(messages.size).toBe(2);
  });

  it("rejects stale selection, resource changes, and cross-session reuse before consuming", async () => {
    const intent = await inspect();
    await expect(cast(intent, { targetTokenUuids: [] })).rejects.toMatchObject({
      code: "CAST_INTENT_MISMATCH",
    });
    ctx.sessionId = "rotated-session";
    await expect(cast(intent)).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    expect(consume).not.toHaveBeenCalled();
    expect(ctx.game.settings.set).not.toHaveBeenCalled();
  });

  it("leaves an uncertain blocking record and posts no card when native consume refuses", async () => {
    consume.mockResolvedValueOnce(false);
    const intent = await inspect();
    await expect(cast(intent)).rejects.toMatchObject({
      code: "NATIVE_CONSUMPTION_REFUSED",
      partial: { nativeConsumed: false },
    });
    expect(messages.size).toBe(0);
    expect(store.entries[intent.castId].status).toBe("uncertain");
    await expect(inspect()).rejects.toMatchObject({
      code: "SPELL_CAST_RECONCILIATION_REQUIRED",
    });
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("does not consume if reservation persistence fails", async () => {
    const intent = await inspect();
    ctx.game.settings.set.mockRejectedValueOnce(new Error("settings failed"));
    await expect(cast(intent)).rejects.toMatchObject({
      code: "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
    });
    expect(consume).not.toHaveBeenCalled();
    expect(messages.size).toBe(0);
  });

  it("uses focus-point cost and preserves native group 13 with an NPC card rank of 10", async () => {
    setup({
      category: "focus",
      groupNumber: 13,
      spellOptions: { focus: true, focusCost: 2, rank: 10 },
      slots: {},
    });
    actor.type = "npc";
    actor.level = 25;
    const intent = await inspect({
      rank: 10,
      slotId: null,
      targetTokenUuids: [],
    });
    expect(intent).toMatchObject({
      nativeGroupNumber: 13,
      resourceBefore: {
        kind: "actorFocus",
        value: 3,
        cost: 2,
        groupNumber: 13,
      },
    });
    await cast(intent, { rank: 10, slotId: null, targetTokenUuids: [] });
    expect(consume).toHaveBeenCalledWith(spell, 13, undefined, entry);
    expect(toMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { castRank: 10 } }),
    );
    expect(actor.system.resources.focus.value).toBe(1);
  });

  it("casts a free focus spell without charging focus points", async () => {
    setup({
      category: "focus",
      spellOptions: { focus: true, focusCost: 0, rank: 1 },
      slots: {},
    });
    const intent = await inspect({ slotId: null, targetTokenUuids: [] });
    expect(intent.resourceBefore.kind).toBe("none");
    await cast(intent, { slotId: null, targetTokenUuids: [] });
    expect(actor.system.resources.focus.value).toBe(3);
  });

  it("leaves an uncertain ledger outcome if created message identity is corrupt", async () => {
    const intent = await inspect();
    const messageClass = (globalThis as any).ChatMessage;
    messageClass.create = vi.fn(async (source: any) => ({
      id: "wrong",
      uuid: "ChatMessage.wrong",
      ...source,
    }));
    await expect(cast(intent)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
    });
    expect(store.entries[intent.castId].status).toBe("uncertain");
  });

  it("consumes a spontaneous signature spell from the selected virtual rank pool", async () => {
    setup({
      category: "spontaneous",
      spellOptions: { rank: 1, signature: true },
      slots: {
        slot1: { value: 2, max: 2 },
        slot2: { value: 1, max: 2 },
      },
    });
    const intent = await inspect({
      rank: 2,
      slotId: null,
      targetTokenUuids: [],
    });
    expect(intent).toMatchObject({
      nativeGroupNumber: 2,
      resourceBefore: { kind: "rankPool", groupNumber: 2, value: 1 },
    });
    await cast(intent, { rank: 2, slotId: null, targetTokenUuids: [] });
    expect(consume).toHaveBeenCalledWith(spell, 2, undefined, entry);
    expect(entry.system.slots.slot2.value).toBe(0);
    expect(toMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: { castRank: 2 } }),
    );
  });

  it("uses flexible prepared rank pools instead of prepared slot IDs", async () => {
    setup({
      flexible: true,
      spellOptions: { rank: 1, signature: true },
      slots: {
        slot1: { value: 1, max: 1, prepared: [] },
        slot2: { value: 1, max: 2, prepared: [] },
      },
    });
    const intent = await inspect({
      rank: 2,
      slotId: null,
      targetTokenUuids: [],
    });
    expect(intent).toMatchObject({
      nativeGroupNumber: 2,
      resourceBefore: { kind: "rankPool", groupNumber: 2, value: 1 },
    });
    await cast(intent, { rank: 2, slotId: null, targetTokenUuids: [] });
    expect(consume).toHaveBeenCalledWith(spell, 2, undefined, entry);
    expect(entry.system.slots.slot2.value).toBe(0);
  });

  it("requires a positive finite innate use and records its native decrement", async () => {
    setup({
      category: "innate",
      spellOptions: { rank: 2, uses: { value: 1, max: 1 } },
      slots: {},
    });
    const intent = await inspect({
      rank: 2,
      slotId: null,
      targetTokenUuids: [],
    });
    expect(intent.resourceBefore).toMatchObject({
      kind: "innateUse",
      value: 1,
    });
    await cast(intent, { rank: 2, slotId: null, targetTokenUuids: [] });
    expect(spell.system.location.uses.value).toBe(0);
    await expect(
      inspect({ rank: 2, slotId: null, targetTokenUuids: [] }),
    ).rejects.toMatchObject({
      code: "RESOURCE_UNAVAILABLE",
    });
  });

  it("uses positive focus cost even when the native entry is not a focus category", async () => {
    setup({
      category: "spontaneous",
      spellOptions: { focus: true, focusCost: 1, rank: 1 },
      slots: { slot1: { value: 1, max: 1 } },
    });
    const intent = await inspect({
      rank: 1,
      slotId: null,
      targetTokenUuids: [],
    });
    expect(intent.resourceBefore).toMatchObject({
      kind: "actorFocus",
      cost: 1,
    });
    await cast(intent, { rank: 1, slotId: null, targetTokenUuids: [] });
    expect(actor.system.resources.focus.value).toBe(2);
    expect(entry.system.slots.slot1.value).toBe(1);
  });

  it("binds casts to current combat state and explicit current caster", async () => {
    const combatant = {
      id: "cb",
      uuid: "Combat.combat.Combatant.cb",
      token,
    };
    const combat = {
      documentName: "Combat",
      id: "combat",
      uuid: "Combat.combat",
      started: true,
      isActive: true,
      scene,
      round: 1,
      turn: 0,
      combatant,
      combatants: new Map([[combatant.id, combatant]]),
    };
    ctx.game.combats.set(combat.id, combat);
    ctx.game.combat = combat;
    const intent = await inspect();
    expect(intent.expectedCombat).toEqual({
      encounterUuid: combat.uuid,
      round: 1,
      turn: 0,
      combatantUuid: combatant.uuid,
    });
    combat.turn = 1;
    await expect(cast(intent)).rejects.toMatchObject({ code: "STALE_TURN" });
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects reaction-time casting and empty or mismatched prepared slots", async () => {
    setup({ spellOptions: { time: "reaction" } });
    await expect(inspect()).rejects.toMatchObject({
      code: "UNSUPPORTED_CASTING_TIME",
    });
    setup({ spellOptions: { time: "free" } });
    await expect(inspect()).rejects.toMatchObject({
      code: "UNSUPPORTED_CASTING_TIME",
    });
    setup({ spellOptions: { time: "1 or 2" } });
    const variable = await inspect();
    expect(variable.supported).toBe(true);
    setup({ spellOptions: { time: "1 to 3" } });
    expect((await inspect()).supported).toBe(true);
    setup({ spellOptions: { time: "free" } });
    await expect(inspect()).rejects.toMatchObject({
      code: "UNSUPPORTED_CASTING_TIME",
    });
    setup({
      prepared: [null],
      slots: { slot1: { max: 1, prepared: [null] } },
    });
    await expect(inspect()).rejects.toMatchObject({
      code: "INVALID_CAST_OPTION",
    });
  });

  it("allows ordinary heightened spells and rejects alternate variant workflows", async () => {
    spell.system.location.heightenedLevel = 3;
    expect((await inspect()).supported).toBe(true);
    for (const mutate of [
      () => (spell.original = {}),
      () => (spell.isVariant = true),
      () => (spell.parentItem = {}),
    ]) {
      setup();
      mutate();
      await expect(inspect()).rejects.toMatchObject({ code: "INVALID_SPELL" });
    }
  });

  it("rejects target actor identity changes while native card construction awaits", async () => {
    const intent = await inspect();
    spell.toMessage.mockImplementationOnce(
      async (_roll: unknown, params: any) => {
        targetToken.actor = {
          documentName: "Actor",
          id: "replacement",
          uuid: "Actor.replacement",
        };
        return {
          content: "card",
          whisper: ["gm"],
          blind: false,
          flags: {
            pf2e: {
              origin: {
                uuid: spell.uuid,
                rollOptions: ["origin:action:slug:cast-a-spell"],
              },
              casting: { id: entry.id },
            },
          },
        };
      },
    );
    await expect(cast(intent)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
    });
    expect(messages.size).toBe(0);
  });

  it("rejects a wrong prepared slot before calling native consume", async () => {
    setup({
      prepared: [{ id: "other-spell", expended: false }],
      slots: {
        slot1: { max: 1, prepared: [{ id: "other-spell", expended: false }] },
      },
    });
    await expect(inspect()).rejects.toMatchObject({
      code: "INVALID_CAST_OPTION",
    });
    expect(consume).not.toHaveBeenCalled();
    expect(ctx.game.settings.set).not.toHaveBeenCalled();
  });

  it("detects a resource mutation while an async review fingerprint is pending", async () => {
    const originalDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    let changed = false;
    const spy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(async (...args: any[]) => {
        if (!changed) {
          changed = true;
          entry.system.slots.slot1.prepared[0].expended = true;
        }
        return originalDigest(args[0], args[1]);
      });
    try {
      await expect(inspect()).rejects.toMatchObject({
        code: "STALE_CAST_INTENT",
      });
      expect(ctx.game.settings.set).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("detects a derived rank mutation during hashing and honors the configured chat class", async () => {
    const originalDigest = globalThis.crypto.subtle.digest.bind(
      globalThis.crypto.subtle,
    );
    const spy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation(async (...args: any[]) => {
        spell.computeCastRank = () => 2;
        return originalDigest(args[0], args[1]);
      });
    try {
      await expect(inspect()).rejects.toMatchObject({
        code: "STALE_CAST_INTENT",
      });
    } finally {
      spy.mockRestore();
    }
    setup();
    const configured = (ctx.game.messages.documentClass = {
      getSpeaker: vi.fn(() => ({
        actor: actor.id,
        token: token.id,
        scene: scene.id,
      })),
      create: vi.fn(async (source: any) => {
        const created = {
          id: "configured-message",
          uuid: "ChatMessage.configured-message",
          ...source,
        };
        messages.set(created.id, created);
        return created;
      }),
    });
    (globalThis as any).ChatMessage = { getSpeaker: vi.fn(), create: vi.fn() };
    const intent = await inspect();
    await cast(intent);
    expect(configured.getSpeaker).toHaveBeenCalled();
    expect(configured.create).toHaveBeenCalled();
    expect((globalThis as any).ChatMessage.create).not.toHaveBeenCalled();
  });

  it("invalidates an outside-combat intent when a started combat begins in that scene", async () => {
    const intent = await inspect();
    const combatant = { id: "cb", uuid: "Combat.combat.Combatant.cb", token };
    const combat = {
      documentName: "Combat",
      id: "combat",
      uuid: "Combat.combat",
      started: true,
      isActive: true,
      scene,
      round: 1,
      turn: 0,
      combatant,
      combatants: new Map([[combatant.id, combatant]]),
    };
    ctx.game.combats.set(combat.id, combat);
    ctx.game.combat = combat;
    await expect(cast(intent)).rejects.toMatchObject({ code: "STALE_TURN" });
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects an intent that expires while queued on the world ledger lock", async () => {
    const intent = await inspect();
    let release!: () => void;
    let entered!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (entered = resolve));
    const lock = withSpellCastLedger(ctx, async () => {
      entered();
      await wait;
    });
    await started;
    const pending = cast(intent);
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse(intent.expiresAt) + 1);
    release();
    await lock;
    await expect(pending).rejects.toMatchObject({
      code: "CAST_INTENT_EXPIRED",
    });
    expect(consume).not.toHaveBeenCalled();
    expect(messages.size).toBe(0);
    clock.mockRestore();
  });

  it("records confirmed native chat uncertainty once without retrying ledger persistence", async () => {
    const intent = await inspect();
    const originalSet = ctx.game.settings.set;
    let writes = 0;
    ctx.game.settings.set = vi.fn(
      async (_module: string, _key: string, value: any) => {
        writes += 1;
        if (writes === 2) {
          store = structuredClone(value);
          throw new Error("lost terminal acknowledgement");
        }
        store = structuredClone(value);
        return value;
      },
    );
    await expect(cast(intent)).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
    });
    expect(writes).toBe(2);
    expect(store.entries[intent.castId]).toMatchObject({
      status: "confirmed",
      nativeConsumed: true,
      chatMessageUuid: "ChatMessage.message-1",
    });
    ctx.game.settings.set = originalSet;
  });
});
