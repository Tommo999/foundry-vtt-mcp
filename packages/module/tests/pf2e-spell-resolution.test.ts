import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePF2eSpellResolution } from "../src/pf2e-spell-resolution.js";

class CheckRoll {
  evaluated = true;
  constructor(public total: number) {}
  toJSON() {
    return { class: "CheckRoll", total: this.total };
  }
}
class DamageRoll {
  evaluated = true;
  constructor(public total: number) {}
  toJSON() {
    return { class: "DamageRoll", total: this.total };
  }
}
const savedDocument = (globalThis as any).document;
afterEach(() => {
  if (savedDocument === undefined) delete (globalThis as any).document;
  else (globalThis as any).document = savedDocument;
});

function fixture(
  action: "attack" | "save" | "damage" = "attack",
  options: { heightened?: boolean; attackDamage?: boolean } = {},
) {
  (globalThis as any).document = {
    createElement: () => ({
      dataset: {},
      closest() {
        return this;
      },
    }),
  };
  const worldId = "world-a",
    userId = "gm-a",
    sessionId = "session-a";
  const castRank = options.heightened ? 2 : 1;
  const actor: any = {
    id: "caster",
    uuid: "Actor.caster",
    documentName: "Actor",
    type: "character",
    system: { level: { value: 5 } },
    items: new Map(),
    toObject: () => ({
      _id: "caster",
      type: "character",
      system: { level: { value: 5 } },
    }),
  };
  const targetActor: any = {
    id: "target",
    uuid: "Actor.target",
    documentName: "Actor",
    type: "npc",
    system: {},
    items: new Map(),
    toObject() {
      return {
        _id: "target",
        type: "npc",
        system: structuredClone(this.system),
      };
    },
    saves: { reflex: { check: { mod: 8, roll: vi.fn() } } },
  };
  const scene: any = {
    id: "scene",
    uuid: "Scene.scene",
    documentName: "Scene",
    tokens: new Map(),
    toObject: () => ({ _id: "scene", tokens: {} }),
  };
  const token: any = {
    id: "caster-token",
    uuid: "Scene.scene.Token.caster-token",
    documentName: "Token",
    parent: scene,
    actor,
    toObject: () => ({ _id: "caster-token", actorId: actor.id }),
  };
  const targetToken: any = {
    id: "target-token",
    uuid: "Scene.scene.Token.target-token",
    documentName: "Token",
    parent: scene,
    actor: targetActor,
    toObject: () => ({ _id: "target-token", actorId: targetActor.id }),
  };
  actor.getActiveTokens = () => [{ document: token }];
  targetActor.getActiveTokens = () => [{ document: targetToken }];
  scene.tokens.set(token.id, token);
  scene.tokens.set(targetToken.id, targetToken);
  const entry: any = {
    id: "entry",
    uuid: "Actor.caster.Item.entry",
    type: "spellcastingEntry",
    actor,
    parent: actor,
    isRitual: false,
    isEphemeral: false,
    spells: new Map(),
    statistic: { dc: { value: 22 }, check: { mod: 12, roll: vi.fn() } },
    toObject: () => ({ _id: "entry", type: "spellcastingEntry", system: {} }),
  };
  actor.spellcasting = { regular: [entry] };
  const spell: any = {
    id: "spell",
    uuid: "Actor.caster.Item.spell",
    type: "spell",
    actor,
    rank: 1,
    parentItem: null,
    isVariant: false,
    original: null,
    isAttack:
      action === "attack" ||
      (action === "damage" && options.attackDamage === true),
    damageKinds: new Set(["damage"]),
    system: {
      level: { value: 1 },
      location: { value: entry.id },
      defense: action === "save" ? { save: { statistic: "reflex" } } : null,
      damage:
        action === "damage"
          ? { value: { 0: { damage: "1d6", damageType: "fire" } } }
          : {},
    },
    spellcasting: {
      statistic: {
        check: { mod: 13 },
        getChatData: vi.fn(() => ({ dc: { value: 22 } })),
      },
    },
    loadVariant: vi.fn(({ castRank: requestedRank }: any) =>
      options.heightened
        ? {
            ...spell,
            original: spell,
            uuid: spell.uuid,
            parentItem: null,
            rank: requestedRank,
            isVariant: true,
            rollDamage: async function (event: any) {
              const prepared = await this.getDamage({
                target: event.target ? targetToken : null,
              });
              const roll = new DamageRoll(6);
              post("damage", [...prepared.context.options][0], roll);
              return roll;
            },
          }
        : spell,
    ),
    toObject: () => ({
      _id: "spell",
      type: "spell",
      system: structuredClone(spell.system),
    }),
  };
  entry.spells.set(spell.id, spell);
  actor.items.set(entry.id, entry);
  actor.items.set(spell.id, spell);
  const castRecord: any = {
    castId: "cast-a",
    worldId,
    userId,
    sessionId,
    actorUuid: actor.uuid,
    casterTokenUuid: token.uuid,
    entryUuid: entry.uuid,
    spellUuid: spell.uuid,
    rank: castRank,
    slotId: null,
    targetTokenUuids: [targetToken.uuid],
    messageMode: "gm",
    reviewToken: "cast-review",
    fingerprint: "a".repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "confirmed",
    nativeConsumed: true,
    resourceBefore: {
      kind: "none",
      cost: 0,
      value: null,
      max: null,
      expended: null,
      groupNumber: null,
      slotId: null,
    },
    resourceAfter: {
      kind: "none",
      cost: 0,
      value: null,
      max: null,
      expended: null,
      groupNumber: null,
      slotId: null,
    },
    chatMessageUuid: "ChatMessage.cast",
  };
  const castMessage: any = {
    id: "cast",
    uuid: castRecord.chatMessageUuid,
    documentName: "ChatMessage",
    speaker: { scene: scene.id, token: token.id, actor: actor.id },
    whisper: [userId],
    blind: false,
    flags: {
      pf2e: {
        origin: {
          uuid: spell.uuid,
          castRank,
          rollOptions: ["origin:action:slug:cast-a-spell"],
          variant: { overlays: [] },
        },
        casting: { id: entry.id },
      },
      "foundry-vtt-mcp": {
        spellCast: { castId: "cast-a", targetTokenUuids: [targetToken.uuid] },
      },
    },
    toObject() {
      return structuredClone({
        speaker: this.speaker,
        whisper: this.whisper,
        blind: this.blind,
        flags: this.flags,
      });
    },
  };
  const messages = new Map([[castMessage.id, castMessage]]);
  let ledger: any = {
    version: 1,
    entries: { [castRecord.castId]: castRecord },
  };
  let resolutions: any = undefined;
  const hooks = new Map<string, Map<number, Function>>();
  let hookId = 0;
  const HookApi = {
    on(name: string, fn: Function) {
      const rows = hooks.get(name) ?? new Map();
      hooks.set(name, rows);
      rows.set(++hookId, fn);
      return hookId;
    },
    off(name: string, id: number) {
      hooks.get(name)?.delete(id);
    },
  };
  let rollIndex = 0;
  function post(
    actionType: "attack" | "save" | "damage",
    marker: string,
    roll: any,
  ) {
    const id = `roll-${++rollIndex}`;
    const source: any = {
      speaker:
        actionType === "save"
          ? { scene: scene.id, token: targetToken.id, actor: targetActor.id }
          : { scene: scene.id, token: token.id, actor: actor.id },
      whisper: [userId],
      blind: false,
      rolls: [roll],
      flags: {
        pf2e: {
          origin: { uuid: spell.uuid, castRank, rollOptions: [marker] },
          context: {
            options: [marker],
            messageMode: "gm",
            type:
              actionType === "damage"
                ? "damage-roll"
                : actionType === "save"
                  ? "saving-throw"
                  : "attack-roll",
            action: "cast-a-spell",
            actor: actionType === "save" ? targetActor.id : actor.id,
            token: actionType === "save" ? targetToken.id : token.id,
            origin: { actor: actor.uuid, token: token.uuid },
            target:
              actionType === "damage" && !spell.isAttack
                ? null
                : { actor: targetActor.uuid, token: targetToken.uuid },
            ...(actionType === "save" ? { dc: { value: 22 } } : {}),
          },
        },
      },
    };
    const doc: any = {
      id,
      uuid: `ChatMessage.${id}`,
      documentName: "ChatMessage",
      flags: source.flags,
      speaker: source.speaker,
      whisper: source.whisper,
      blind: source.blind,
      rolls: source.rolls,
      toObject: () => structuredClone(source),
      updateSource(update: any) {
        this.flags = { ...this.flags, ...update.flags };
        source.flags = this.flags;
      },
    };
    for (const fn of hooks.get("preCreateChatMessage")?.values() ?? [])
      if (fn(doc, source) === false) return null;
    messages.set(doc.id, doc);
    for (const fn of hooks.get("createChatMessage")?.values() ?? []) fn(doc);
    return doc;
  }
  const savesRoll = vi.fn(async (options: any) => {
    const roll = new CheckRoll(17);
    const msg = post("save", options.extraRollOptions[0], roll);
    options.callback?.(roll, "success", msg);
    return roll;
  });
  targetActor.saves.reflex.check.roll = savesRoll;
  const nativeGetDamage = vi.fn(async (options: any) => ({
    context: {
      self: { token, actor: { uuid: actor.uuid }, item: spell },
      target: options.target
        ? { token: options.target, actor: { uuid: targetActor.uuid } }
        : null,
      options: new Set(),
    },
  }));
  Object.assign(spell, {
    getDamage: nativeGetDamage,
    clone: vi.fn(() => ({
      ...spell,
      uuid: spell.uuid,
      original: null,
      parentItem: null,
      rank: spell.rank,
      system: structuredClone(spell.system),
      getDamage: nativeGetDamage,
      rollDamage: async function (event: any) {
        const prepared = await this.getDamage({
          target: event.target ? null : null,
        });
        const roll = new DamageRoll(6);
        post("damage", [...prepared.context.options][0], roll);
        return roll;
      },
    })),
    rollAttack: vi.fn(async (_event: any, _number: number, options: any) => {
      const roll = new CheckRoll(19);
      const msg = post("attack", options.extraRollOptions[0], roll);
      options.callback(roll, "criticalSuccess", msg);
      return roll;
    }),
    rollDamage: vi.fn(),
  });
  const settings = {
    get: vi.fn((_namespace: string, key: string) =>
      key === "spellCasts"
        ? ledger
        : key === "spellResolutions"
          ? resolutions
          : undefined,
    ),
    set: vi.fn(async (_namespace: string, key: string, value: any) => {
      if (key === "spellCasts") ledger = structuredClone(value);
      else resolutions = structuredClone(value);
    }),
  };
  const ctx: any = {
    sessionId,
    game: {
      world: { id: worldId },
      user: { id: userId, isGM: true, targets: new Set() },
      system: { id: "pf2e", version: "8.7.0" },
      pf2e: {},
      CONFIG: { Dice: { rolls: [CheckRoll, DamageRoll] } },
      settings,
      users: new Map([[userId, { id: userId, isGM: true }]]),
      actors: new Map([
        [actor.id, actor],
        [targetActor.id, targetActor],
      ]),
      scenes: new Map([[scene.id, scene]]),
      messages,
      Hooks: HookApi,
    },
    resolve: vi.fn(
      async (uuid: string) =>
        [castMessage, token, targetToken, entry, spell].find(
          (doc: any) => doc.uuid === uuid,
        ) ?? null,
    ),
    assertWrite: vi.fn(),
    serialize: vi.fn((doc: any) => doc.toObject?.() ?? doc),
  };
  const selection = {
    castMessageUuid: castRecord.chatMessageUuid,
    casterTokenUuid: token.uuid,
    targetTokenUuid: targetToken.uuid,
    action,
    attackNumber: 1,
    messageMode: "gm",
  };
  return {
    ctx,
    actor,
    targetActor,
    scene,
    token,
    targetToken,
    entry,
    spell,
    castMessage,
    selection,
    post,
    setCastTargets(value: string[]) {
      castRecord.targetTokenUuids = [...value];
      castMessage.flags["foundry-vtt-mcp"].spellCast.targetTokenUuids = [
        ...value,
      ];
    },
    setResolutions(value: any) {
      resolutions = value;
    },
    get resolutions() {
      return resolutions;
    },
    get messages() {
      return messages;
    },
    get savesRoll() {
      return savesRoll;
    },
  };
}

function resolutionRecord(overrides: Record<string, unknown> = {}) {
  return {
    resolutionId: "spell-resolution-existing",
    operationKey:
      '["ChatMessage.cast","attack","Scene.scene.Token.target-token",1]',
    worldId: "world-a",
    userId: "gm-a",
    sessionId: "session-a",
    castId: "cast-existing",
    castMessageUuid: "ChatMessage.cast",
    action: "attack",
    messageMode: "gm",
    casterActorUuid: "Actor.caster",
    targetActorUuid: "Actor.target",
    casterTokenUuid: "Scene.scene.Token.caster-token",
    targetTokenUuid: "Scene.scene.Token.target-token",
    attackNumber: 1,
    reviewToken: "review-existing",
    fingerprint: "a".repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "reserved",
    messageUuid: null,
    rollType: null,
    rollTotal: null,
    ...overrides,
  };
}

describe("PF2e native spell resolution", () => {
  it.each(["attack", "save", "damage"] as const)(
    "previews %s from exact confirmed native cast evidence without writes",
    async (action) => {
      const f = fixture(action);
      const result: any = await handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        f.selection,
        f.ctx,
      );
      expect(result.readOnly).toBe(true);
      expect(result.executesNothing).toBe(true);
      expect(result.cast.messageUuid).toBe(f.castMessage.uuid);
      expect(result.native.dc).toBe(action === "save" ? 22 : null);
      expect(result.native.targetIndependentDamage).toBe(action === "damage");
      expect(f.ctx.game.settings.set).not.toHaveBeenCalled();
    },
  );

  it.each(["attack", "save", "damage"] as const)(
    "executes one %s through native API and confirms the actual world chat document",
    async (action) => {
      const f = fixture(action);
      const preview: any = await handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        f.selection,
        f.ctx,
      );
      const tool =
        action === "attack"
          ? "pf2e_roll_spell_attack"
          : action === "save"
            ? "pf2e_roll_spell_save"
            : "pf2e_roll_spell_damage";
      const result: any = await handlePF2eSpellResolution(
        tool,
        {
          ...f.selection,
          resolutionId: preview.resolutionId,
          reviewToken: preview.reviewToken,
          expectedCombat: null,
        },
        f.ctx,
      );
      expect(result.resolution).toBe("confirmed");
      expect(f.messages.has(result.messageUuid.split(".").at(-1))).toBe(true);
      expect(f.resolutions.entries[preview.resolutionId].status).toBe(
        "confirmed",
      );
      if (action !== "damage")
        expect(result.degreeOfSuccess).toBe(
          action === "attack" ? "criticalSuccess" : "success",
        );
      if (action === "attack")
        expect(f.spell.rollAttack).toHaveBeenCalledOnce();
      if (action === "save") expect(f.savesRoll).toHaveBeenCalledOnce();
      if (action === "damage") expect(f.spell.clone).toHaveBeenCalledOnce();
    },
  );

  it("rejects duplicate native Actor token resolution and stale/replaced world Actors", async () => {
    const ambiguous = fixture("attack");
    ambiguous.targetActor.getActiveTokens = () => [
      { document: ambiguous.targetToken },
      { document: { ...ambiguous.targetToken } },
    ];
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        ambiguous.selection,
        ambiguous.ctx,
      ),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_TARGET_TOKEN" });
    const replaced = fixture("attack");
    replaced.ctx.game.actors.set(replaced.targetActor.id, {
      ...replaced.targetActor,
      uuid: replaced.targetActor.uuid,
    });
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        replaced.selection,
        replaced.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });

  it("rejects a card with a non-native cast marker before creating an intent", async () => {
    const f = fixture("attack");
    f.castMessage.flags.pf2e.origin.rollOptions = ["action:cast-a-spell"];
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        f.selection,
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CAST_CARD" });
    f.castMessage.flags.pf2e.origin.rollOptions = [
      "origin:action:slug:cast-a-spell",
    ];
    f.castMessage.flags.pf2e.origin.variant = {};
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        f.selection,
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CAST_CARD" });
  });

  it("requires explicit preview targets and respects nonempty targets captured by casting", async () => {
    const noCastTargets = fixture("attack");
    noCastTargets.setCastTargets([]);
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      noCastTargets.selection,
      noCastTargets.ctx,
    );
    expect(preview.target.tokenUuid).toBe(noCastTargets.targetToken.uuid);

    const excluded = fixture("attack");
    excluded.setCastTargets(["Scene.scene.Token.other"]);
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        excluded.selection,
        excluded.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TARGET" });
  });

  it("rejects unknown tool names without dispatching or writing", async () => {
    const f = fixture("attack");
    await expect(
      handlePF2eSpellResolution("pf2e_roll_damage" as any, f.selection, f.ctx),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TOOL" });
    expect(f.ctx.game.settings.set).not.toHaveBeenCalled();
    expect(f.messages.size).toBe(1);
  });

  it("fails before reserving if the configured native roll constructor changes after preview", async () => {
    const f = fixture("attack");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    const ReplacementCheckRoll = class CheckRoll {};
    f.ctx.game.CONFIG.Dice.rolls[0] = ReplacementCheckRoll;
    await expect(
      handlePF2eSpellResolution(
        "pf2e_roll_spell_attack",
        {
          ...f.selection,
          resolutionId: preview.resolutionId,
          reviewToken: preview.reviewToken,
          expectedCombat: null,
        },
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "STALE_SPELL_RESOLUTION" });
    expect(f.ctx.game.settings.set).not.toHaveBeenCalled();
    expect(f.messages.size).toBe(1);
  });

  it("refuses duplicate, full and malformed resolution ledgers during preview", async () => {
    const duplicate = fixture("attack");
    duplicate.setResolutions({
      version: 1,
      entries: { "spell-resolution-existing": resolutionRecord() },
    });
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        duplicate.selection,
        duplicate.ctx,
      ),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_ALREADY_RECORDED" });

    const full = fixture("attack");
    const entries: Record<string, any> = {};
    for (let i = 0; i < 5000; i += 1)
      entries[`spell-resolution-${i}`] = resolutionRecord({
        resolutionId: `spell-resolution-${i}`,
        operationKey: `operation-${i}`,
        castId: `cast-${i}`,
      });
    full.setResolutions({ version: 1, entries });
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        full.selection,
        full.ctx,
      ),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_LEDGER_FULL" });

    const invalid = fixture("attack");
    invalid.setResolutions({ version: 2, entries: {} });
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        invalid.selection,
        invalid.ctx,
      ),
    ).rejects.toMatchObject({ code: "SPELL_RESOLUTION_LEDGER_INVALID" });
  });

  it("ignores a valid started Combat on another scene but rejects malformed current combat", async () => {
    const otherScene: any = {
      id: "other",
      uuid: "Scene.other",
      documentName: "Scene",
      tokens: new Map(),
    };
    const otherToken: any = {
      id: "other-token",
      uuid: "Scene.other.Token.other-token",
    };
    const otherCombatant = {
      id: "combatant",
      uuid: "Combat.other.Combatant.c",
      token: otherToken,
    };
    const otherCombat: any = {
      id: "other-combat",
      uuid: "Combat.other",
      documentName: "Combat",
      started: true,
      isActive: true,
      scene: otherScene,
      round: 1,
      turn: 0,
      combatant: otherCombatant,
      combatants: [otherCombatant],
    };
    const valid = fixture("attack");
    valid.ctx.game.scenes.set(otherScene.id, otherScene);
    valid.ctx.game.combats = new Map([[otherCombat.id, otherCombat]]);
    valid.ctx.game.combat = otherCombat;
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      valid.selection,
      valid.ctx,
    );
    expect(preview.expectedCombat).toBeNull();

    const invalid = fixture("attack");
    invalid.ctx.game.combat = {
      ...otherCombat,
      id: "missing-scene",
      uuid: "Combat.missing-scene",
      scene: null,
    };
    invalid.ctx.game.combats = new Map([
      [invalid.ctx.game.combat.id, invalid.ctx.game.combat],
    ]);
    await expect(
      handlePF2eSpellResolution(
        "pf2e_inspect_spell_resolution",
        invalid.selection,
        invalid.ctx,
      ),
    ).rejects.toMatchObject({ code: "INVALID_COMBAT" });
  });

  it("vetoes native chat creation when the paired session changes during the awaited native roll", async () => {
    const f = fixture("attack");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    f.spell.rollAttack.mockImplementationOnce(
      async (_event: any, _number: number, options: any) => {
        f.ctx.sessionId = "replacement-session";
        const roll = new CheckRoll(20);
        f.post("attack", options.extraRollOptions[0], roll);
        options.callback(roll, "success", null);
        return roll;
      },
    );
    await expect(
      handlePF2eSpellResolution(
        "pf2e_roll_spell_attack",
        {
          ...f.selection,
          resolutionId: preview.resolutionId,
          reviewToken: preview.reviewToken,
          expectedCombat: null,
        },
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
    expect(f.messages.size).toBe(1);
    expect(f.resolutions.entries[preview.resolutionId].status).toBe("reserved");
  });

  it("vetoes an awaited native roll when reviewed target source changes before chat creation", async () => {
    const f = fixture("attack");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    f.spell.rollAttack.mockImplementationOnce(
      async (_event: any, _number: number, options: any) => {
        f.targetActor.system.changed = true;
        const roll = new CheckRoll(20);
        f.post("attack", options.extraRollOptions[0], roll);
        options.callback(roll, "success", null);
        return roll;
      },
    );
    await expect(
      handlePF2eSpellResolution(
        "pf2e_roll_spell_attack",
        {
          ...f.selection,
          resolutionId: preview.resolutionId,
          reviewToken: preview.reviewToken,
          expectedCombat: null,
        },
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
    expect(f.messages.size).toBe(1);
    expect(f.resolutions.entries[preview.resolutionId].status).toBe(
      "uncertain",
    );
  });

  it("vetoes the native message if the five-minute intent expires during the awaited roll", async () => {
    const f = fixture("attack");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    const initial = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(initial);
    f.spell.rollAttack.mockImplementationOnce(
      async (_event: any, _number: number, options: any) => {
        clock.mockReturnValue(initial + 6 * 60_000);
        const roll = new CheckRoll(20);
        f.post("attack", options.extraRollOptions[0], roll);
        options.callback(roll, "success", null);
        return roll;
      },
    );
    try {
      await expect(
        handlePF2eSpellResolution(
          "pf2e_roll_spell_attack",
          {
            ...f.selection,
            resolutionId: preview.resolutionId,
            reviewToken: preview.reviewToken,
            expectedCombat: null,
          },
          f.ctx,
        ),
      ).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
    } finally {
      clock.mockRestore();
    }
    expect(f.messages.size).toBe(1);
    expect(f.resolutions.entries[preview.resolutionId].status).toBe(
      "uncertain",
    );
  });

  it("rechecks derived target save modifiers synchronously before native chat creation", async () => {
    const f = fixture("save");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    f.savesRoll.mockImplementationOnce(async (rollArgs: any) => {
      f.targetActor.saves.reflex.check.mod = 9;
      const roll = new CheckRoll(17);
      const msg = f.post("save", rollArgs.extraRollOptions[0], roll);
      rollArgs.callback?.(roll, "success", msg);
      return roll;
    });
    await expect(
      handlePF2eSpellResolution(
        "pf2e_roll_spell_save",
        {
          ...f.selection,
          resolutionId: preview.resolutionId,
          reviewToken: preview.reviewToken,
          expectedCombat: null,
        },
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
    expect(f.messages.size).toBe(1);
    expect(f.resolutions.entries[preview.resolutionId].status).toBe(
      "uncertain",
    );
  });

  it("reports a committed confirmed ledger row after the terminal acknowledgement is lost without retrying", async () => {
    const f = fixture("attack");
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    f.ctx.game.settings.set.mockImplementation(
      async (_namespace: string, key: string, value: any) => {
        if (key === "spellResolutions") {
          f.setResolutions(structuredClone(value));
          if (value.entries[preview.resolutionId]?.status === "confirmed")
            throw new Error("terminal acknowledgement lost");
        }
      },
    );
    const toolArgs = {
      ...f.selection,
      resolutionId: preview.resolutionId,
      reviewToken: preview.reviewToken,
      expectedCombat: null,
    };
    await expect(
      handlePF2eSpellResolution("pf2e_roll_spell_attack", toolArgs, f.ctx),
    ).rejects.toMatchObject({
      code: "PARTIAL_FAILURE",
      partial: {
        auditStatus: "confirmed",
        auditStateKnown: true,
        messageUuid: "ChatMessage.roll-1",
      },
    });
    expect(f.spell.rollAttack).toHaveBeenCalledOnce();
    expect(f.ctx.game.settings.set).toHaveBeenCalledTimes(2);
    expect(f.resolutions.entries[preview.resolutionId].status).toBe(
      "confirmed",
    );
  });

  it("uses an isolated heightened native variant and posts attack damage against the reviewed full target UUID", async () => {
    const f = fixture("damage", { heightened: true, attackDamage: true });
    const originalGetDamage = f.spell.getDamage;
    const targetsBefore = f.ctx.game.user.targets;
    const preview: any = await handlePF2eSpellResolution(
      "pf2e_inspect_spell_resolution",
      f.selection,
      f.ctx,
    );
    expect(preview.cast.rank).toBe(2);
    expect(preview.native.targetIndependentDamage).toBe(false);
    const result: any = await handlePF2eSpellResolution(
      "pf2e_roll_spell_damage",
      {
        ...f.selection,
        resolutionId: preview.resolutionId,
        reviewToken: preview.reviewToken,
        expectedCombat: null,
      },
      f.ctx,
    );
    expect(result.resolution).toBe("confirmed");
    expect(result.rank).toBe(2);
    expect(f.spell.getDamage).toBe(originalGetDamage);
    expect(f.ctx.game.user.targets).toBe(targetsBefore);
    expect(f.spell.getDamage).toHaveBeenCalledWith(
      expect.objectContaining({ target: f.targetToken }),
    );
  });
});
