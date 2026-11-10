import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";
import { withCombatLock } from "./encounters";
import {
  readSpellCastActorSummary,
  withSpellCastLedger,
  type SpellCastResourceSnapshot,
} from "./pf2e-spell-ledger";
import {
  entriesFor,
  isCurrentNativeEntry,
  optionRow,
} from "./pf2e-spellcasting";

const INTENT_TTL_MS = 5 * 60 * 1000;
const MAX_INTENTS = 500;
const intents = new Map<string, CastIntent>();

type Selection = {
  casterTokenUuid: string;
  entryUuid: string;
  spellUuid: string;
  rank: number;
  slotId: number | null;
  targetTokenUuids: string[];
  messageMode: "public" | "gm" | "blind" | "self";
};
type CombatSnapshot = {
  encounterUuid: string;
  round: number;
  turn: number;
  combatantUuid: string;
};
type CastIntent = {
  castId: string;
  reviewToken: string;
  selection: Selection;
  worldId: string;
  userId: string;
  sessionId: string;
  expectedCombat: CombatSnapshot | null;
  resourceBefore: SpellCastResourceSnapshot;
  resourceCost: number;
  nativeGroupNumber: number;
  fingerprint: string;
  expiresAt: number;
  used: boolean;
};
type Resolved = {
  scene: any;
  token: any;
  actor: any;
  entry: any;
  spell: any;
  group: any;
  active: any;
  row: any;
  nativeGroupNumber: number;
  resource: SpellCastResourceSnapshot;
  expectedCombat: CombatSnapshot | null;
  sourceFacts: unknown;
  targetDocs: any[];
};

function fail(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function values(collection: any): any[] {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (collection && typeof collection.values === "function")
    return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function")
    return Array.from(collection);
  return [];
}
function owns(collection: any, document: any): boolean {
  return Boolean(
    collection &&
    document &&
    (typeof collection.get === "function"
      ? collection.get(document.id) === document
      : values(collection).includes(document)),
  );
}
function boundedText(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function finiteInt(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}
function plainClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
function sourceOf(document: any): unknown {
  if (typeof document?.toObject === "function") return document.toObject();
  if (document?._source && typeof document._source === "object")
    return plainClone(document._source);
  return null;
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
async function digest(value: unknown): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof TextEncoder === "undefined")
    throw fail(
      "CRYPTO_UNAVAILABLE",
      "Secure spell-cast review fingerprints are unavailable in this runtime.",
    );
  const bytes = new TextEncoder().encode(canonical(value));
  const hash = await cryptoApi.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function nonce(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues)
    throw fail(
      "CRYPTO_UNAVAILABLE",
      "Secure spell-cast intent identifiers are unavailable in this runtime.",
    );
  const bytes = new Uint8Array(18);
  cryptoApi.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function currentIdentity(ctx: PF2eContext): {
  worldId: string;
  userId: string;
  sessionId: string;
} {
  const worldId = ctx.game?.world?.id;
  const userId = ctx.game?.user?.id;
  const sessionId = ctx.sessionId;
  if (
    !boundedText(worldId, 128) ||
    !boundedText(userId, 128) ||
    !boundedText(sessionId, 256)
  )
    throw fail(
      "SESSION_CHANGED",
      "A current paired Foundry world, user, and bridge session are required for spell casting.",
    );
  if (ctx.game?.user?.isGM !== true)
    throw fail(
      "AUTHORIZATION_REQUIRED",
      "Spell casting requires a GM session.",
    );
  return { worldId, userId, sessionId };
}
function activeCombatFor(scene: any, ctx: PF2eContext): any | null {
  const combat = ctx.game?.combat;
  if (!combat || combat.started !== true) return null;
  if (!owns(ctx.game?.combats, combat) || combat.isActive !== true)
    throw fail(
      "INVALID_COMBAT",
      "The current started world Combat is no longer active or owned by this world.",
    );
  const combatScene =
    typeof combat.scene === "object"
      ? combat.scene
      : ctx.game?.scenes?.get?.(combat.sceneId ?? combat.scene);
  if (!combatScene || !owns(ctx.game?.scenes, combatScene))
    throw fail(
      "INVALID_COMBAT",
      "Current started Combat has no valid world Scene.",
    );
  if (combatScene !== scene) return null;
  return combat;
}
function chatMessageClass(ctx: PF2eContext): any {
  return ctx.game?.messages?.documentClass ?? (globalThis as any).ChatMessage;
}
function currentCombatant(combat: any): any | null {
  if (combat?.combatant) return combat.combatant;
  const collection = values(combat?.combatants);
  const turn = finiteInt(combat?.turn);
  return turn === null ? null : (collection[turn] ?? null);
}
function combatSnapshot(
  scene: any,
  token: any,
  ctx: PF2eContext,
): CombatSnapshot | null {
  const combat = activeCombatFor(scene, ctx);
  if (!combat) return null;
  const combatant = currentCombatant(combat);
  if (
    !combatant ||
    !boundedText(combatant.uuid) ||
    (combatant.token?.uuid ?? combatant.tokenUuid) !== token.uuid
  )
    throw fail(
      "STALE_TURN",
      "The explicit caster token is not the current combatant.",
    );
  const round = finiteInt(combat.round);
  const turn = finiteInt(combat.turn);
  if (round === null || round < 1 || turn === null)
    throw fail("STALE_TURN", "Current encounter tracker state is unavailable.");
  return {
    encounterUuid: String(combat.uuid),
    round,
    turn,
    combatantUuid: combatant.uuid,
  };
}
function sameValue(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
function validateSelection(args: Record<string, unknown>): Selection {
  const selection: Selection = {
    casterTokenUuid: String(args.casterTokenUuid ?? ""),
    entryUuid: String(args.entryUuid ?? ""),
    spellUuid: String(args.spellUuid ?? ""),
    rank: Number(args.rank),
    slotId: args.slotId === null ? null : Number(args.slotId),
    targetTokenUuids: Array.isArray(args.targetTokenUuids)
      ? args.targetTokenUuids.map(String)
      : [],
    messageMode: (args.messageMode ?? "gm") as Selection["messageMode"],
  };
  if (
    !boundedText(selection.casterTokenUuid) ||
    !boundedText(selection.entryUuid) ||
    !boundedText(selection.spellUuid) ||
    !Number.isInteger(selection.rank) ||
    selection.rank < 1 ||
    selection.rank > 10 ||
    (selection.slotId !== null &&
      (!Number.isInteger(selection.slotId) ||
        selection.slotId < 0 ||
        selection.slotId > 9999)) ||
    selection.targetTokenUuids.length > 20 ||
    selection.targetTokenUuids.some((uuid) => !boundedText(uuid)) ||
    new Set(selection.targetTokenUuids).size !==
      selection.targetTokenUuids.length ||
    !["public", "gm", "blind", "self"].includes(selection.messageMode)
  )
    throw fail(
      "INVALID_INPUT",
      "Spell-cast selection is invalid or unbounded.",
    );
  return selection;
}
function entryKind(entry: any): string {
  return String(entry.category ?? entry.system?.prepared?.value ?? "");
}
function resourceSnapshot(
  entry: any,
  actor: any,
  spell: any,
  group: any,
  active: any,
  groupNumber: number,
  slotId: number | null,
  allowConsumed = false,
): { snapshot: SpellCastResourceSnapshot; cost: number } {
  const focusCost = spell.system?.cast?.focusPoints;
  if (!Number.isFinite(focusCost))
    throw fail(
      "UNSUPPORTED_CAST",
      "Native spell resource cost is unavailable.",
    );
  let kind: SpellCastResourceSnapshot["kind"];
  let source: any = null;
  let expended: boolean | null = null;
  let cost: number;
  if (focusCost > 0) {
    kind = "actorFocus";
    source = actor.system?.resources?.focus;
    cost = focusCost;
  } else if (focusCost === 0 && (spell.isCantrip || spell.isFocusSpell)) {
    kind = "none";
    cost = 0;
    if (slotId !== null) {
      source = entry.system?.slots?.[`slot${groupNumber}`]?.prepared?.[slotId];
      expended = source ? source.expended === true : null;
    }
  } else if (entryKind(entry) === "innate") {
    kind = "innateUse";
    source = spell.system?.location?.uses;
    cost = 1;
  } else if (entryKind(entry) === "prepared" && !entry.isFlexible) {
    if (slotId === null)
      throw fail("INVALID_INPUT", "Ordinary prepared spells require a slotId.");
    kind = "preparedSlot";
    source = entry.system?.slots?.[`slot${groupNumber}`]?.prepared?.[slotId];
    expended = source ? source.expended === true : null;
    cost = 1;
  } else if (
    entryKind(entry) === "spontaneous" ||
    (entryKind(entry) === "prepared" && entry.isFlexible)
  ) {
    if (slotId !== null)
      throw fail(
        "INVALID_INPUT",
        "Flexible and spontaneous casts require slotId=null.",
      );
    kind = "rankPool";
    source = entry.system?.slots?.[`slot${groupNumber}`];
    cost = 1;
  } else {
    throw fail(
      "UNSUPPORTED_CAST",
      "This native entry has no supported resource-cost path.",
    );
  }
  const value = finiteInt(source?.value);
  const max = finiteInt(source?.max);
  if (kind === "none") {
    return {
      cost,
      snapshot: {
        kind,
        cost,
        value,
        max,
        expended,
        groupNumber,
        slotId,
      },
    };
  }
  if (kind === "preparedSlot") {
    if (
      !source ||
      source.id !== spell.id ||
      (!allowConsumed && source.expended === true) ||
      (!allowConsumed && active.expended === true)
    )
      throw fail(
        "RESOURCE_UNAVAILABLE",
        "The selected prepared slot is empty, expended, or no longer contains this spell.",
      );
    return {
      cost,
      snapshot: {
        kind,
        cost,
        value: null,
        max: null,
        expended: source.expended === true,
        groupNumber,
        slotId,
      },
    };
  }
  if (value === null || max === null)
    throw fail(
      "UNSUPPORTED_CAST",
      `Native ${kind} resource data is unavailable.`,
    );
  if (!allowConsumed && value < cost) {
    throw fail(
      "RESOURCE_UNAVAILABLE",
      `Insufficient ${kind} resource remains.`,
    );
  }
  return {
    cost,
    snapshot: {
      kind,
      cost,
      value,
      max,
      expended,
      groupNumber,
      slotId,
    },
  };
}
function currentResource(resolved: Resolved): SpellCastResourceSnapshot {
  const { entry, actor, spell, group, active, nativeGroupNumber, resource } =
    resolved;
  const slotId = resource.slotId;
  const kind = resource.kind;
  let source: any = null;
  let expended: boolean | null = null;
  if (kind === "actorFocus") source = actor.system?.resources?.focus;
  else if (kind === "rankPool")
    source = entry.system?.slots?.[`slot${nativeGroupNumber}`];
  else if (kind === "innateUse") source = spell.system?.location?.uses;
  else if (kind === "preparedSlot" || (kind === "none" && slotId !== null)) {
    source =
      entry.system?.slots?.[`slot${nativeGroupNumber}`]?.prepared?.[slotId!];
    expended = source ? source.expended === true : null;
  }
  return {
    kind,
    cost: resource.cost,
    value: finiteInt(source?.value),
    max: finiteInt(source?.max),
    expended,
    groupNumber: resource.groupNumber,
    slotId,
  };
}
function transitionConfirmed(
  before: SpellCastResourceSnapshot,
  after: SpellCastResourceSnapshot,
): boolean {
  if (before.kind !== after.kind || before.slotId !== after.slotId)
    return false;
  if (before.kind === "none") return sameValue(before, after);
  if (before.kind === "preparedSlot")
    return before.expended === false && after.expended === true;
  return (
    before.value !== null &&
    after.value === before.value - before.cost &&
    after.max === before.max
  );
}
function tokenDocument(token: any): any {
  return token?.documentName === "Token" ? token : token?.document;
}
function validateTargets(selection: Selection, scene: any): any[] {
  const tokens: any[] = [];
  for (const uuid of selection.targetTokenUuids) {
    const token = values(scene.tokens).find(
      (candidate) => candidate.uuid === uuid,
    );
    if (!token || token.parent !== scene || !owns(scene.tokens, token))
      throw fail(
        "INVALID_TARGET",
        "Each target must be an explicit token in the caster's current scene.",
      );
    tokens.push(token);
  }
  return tokens;
}
function currentEntry(
  entry: any,
  actor: any,
  uuid: string,
  ctx: PF2eContext,
): boolean {
  void ctx;
  return entry?.uuid === uuid && isCurrentNativeEntry(actor, entry);
}
function castingTimeSupported(spell: any, combatApplies: boolean): boolean {
  const raw = spell.system?.time?.value;
  const time = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (/^(reaction|free|free action|free-action)$/.test(time)) return false;
  if (/^[1-3](?:(?: to | or )[1-3])?$/.test(time)) return true;
  if (combatApplies) return false;
  return /^\d+(?: to \d+)? (?:rounds?|minutes?|hours?)$/.test(time);
}
async function resolveSelection(
  selection: Selection,
  ctx: PF2eContext,
  allowConsumed = false,
): Promise<Resolved> {
  requirePF2e(ctx);
  currentIdentity(ctx);
  const token = await ctx.resolve(selection.casterTokenUuid);
  const scene = token?.parent;
  const actor = token?.actor;
  if (
    !token ||
    token.documentName !== "Token" ||
    token.uuid !== selection.casterTokenUuid ||
    !scene ||
    scene.documentName !== "Scene" ||
    scene.compendium ||
    scene.parent ||
    !owns(ctx.game?.scenes, scene) ||
    !owns(scene.tokens, token) ||
    actor?.documentName !== "Actor" ||
    (actor.type !== "character" && actor.type !== "npc") ||
    actor.compendium
  )
    throw fail(
      "INVALID_CASTER",
      "casterTokenUuid must identify an explicit current world Scene token with a PF2e character or NPC Actor.",
    );
  const entry = await ctx.resolve(selection.entryUuid);
  if (
    !entry ||
    entry.uuid !== selection.entryUuid ||
    entry.type !== "spellcastingEntry" ||
    !currentEntry(entry, actor, selection.entryUuid, ctx) ||
    entry.isRitual ||
    entry.isEphemeral ||
    !["prepared", "spontaneous", "innate", "focus"].includes(entryKind(entry))
  )
    throw fail(
      "INVALID_ENTRY",
      "entryUuid must identify a supported regular spellcasting entry owned by the selected Actor.",
    );
  if (
    typeof entry.spells?.getSpellData !== "function" ||
    typeof entry.consume !== "function"
  )
    throw fail(
      "API_UNAVAILABLE",
      "Native PF2e spell consumption APIs are unavailable.",
    );
  const spell = await ctx.resolve(selection.spellUuid);
  if (
    !spell ||
    spell.uuid !== selection.spellUuid ||
    spell.type !== "spell" ||
    spell.actor !== actor ||
    !owns(actor.items, spell) ||
    entry.spells?.get?.(spell.id) !== spell ||
    spell.system?.location?.value !== entry.id ||
    spell.original ||
    spell.isVariant === true ||
    spell.parentItem
  )
    throw fail(
      "INVALID_SPELL",
      "spellUuid must identify a real owned spell in the selected entry; variants and parent-item spells are unsupported.",
    );
  const data = await entry.spells.getSpellData();
  if (!data || !Array.isArray(data.groups))
    throw fail(
      "NATIVE_DATA_UNAVAILABLE",
      "Native PF2e cast-option data has an unsupported shape.",
    );
  const candidates: Array<{
    group: any;
    active: any;
    row: any;
    groupNumber: number;
  }> = [];
  for (const group of data.groups) {
    const groupNumber =
      typeof group.number === "number"
        ? group.number
        : group.id === "cantrips"
          ? 0
          : Number(group.id);
    if (
      !Number.isSafeInteger(groupNumber) ||
      groupNumber < 0 ||
      (groupNumber > 10 && entryKind(entry) !== "focus")
    )
      continue;
    const preparedCantrip =
      entryKind(entry) === "prepared" && groupNumber === 0;
    const slotBased =
      entryKind(entry) === "prepared" && (!entry.isFlexible || preparedCantrip);
    for (
      let index = 0;
      index < (Array.isArray(group.active) ? group.active.length : 0);
      index++
    ) {
      const active = group.active[index];
      if (active?.spell !== spell) continue;
      const slotId = slotBased ? index : null;
      const row = optionRow(entry, actor, group, active, slotId);
      if (row.rank === selection.rank && row.slotId === selection.slotId)
        candidates.push({ group, active, row, groupNumber });
    }
  }
  if (candidates.length !== 1)
    throw fail(
      "INVALID_CAST_OPTION",
      "The exact spell, computed rank, and prepared slot do not identify one current native PF2e cast option.",
    );
  const selected = candidates[0];
  if (!selected.row.available && !allowConsumed)
    throw fail(
      "RESOURCE_UNAVAILABLE",
      selected.row.unsupportedReason ??
        "The selected native cast option is unavailable.",
    );
  const computedResource = resourceSnapshot(
    entry,
    actor,
    spell,
    selected.group,
    selected.active,
    selected.groupNumber,
    selection.slotId,
    allowConsumed,
  );
  const expectedCombat = combatSnapshot(scene, token, ctx);
  if (!castingTimeSupported(spell, expectedCombat !== null))
    throw fail(
      "UNSUPPORTED_CASTING_TIME",
      "Reaction, free-action, or multi-round casting in combat is unsupported.",
    );
  const targets = validateTargets(selection, scene);
  const nativeMessageAPIs = chatMessageClass(ctx);
  if (
    typeof spell.toMessage !== "function" ||
    typeof nativeMessageAPIs?.getSpeaker !== "function" ||
    typeof nativeMessageAPIs?.create !== "function"
  )
    throw fail(
      "API_UNAVAILABLE",
      "Native PF2e spell card APIs are unavailable.",
    );
  const sourceFacts = {
    actor: sourceOf(actor),
    entry: sourceOf(entry),
    spell: sourceOf(spell),
    casterToken: {
      uuid: token.uuid,
      id: token.id,
      sceneUuid: scene.uuid,
      actorUuid: actor.uuid,
      actorId: token.actorId ?? token._source?.actorId ?? null,
      actorLink: token.actorLink ?? token._source?.actorLink ?? null,
      source: sourceOf(token),
    },
    targets: targets.map((target) => ({
      uuid: target.uuid,
      id: target.id,
      actorUuid: target.actor?.uuid ?? null,
      actorId: target.actorId ?? target._source?.actorId ?? null,
      actorLink: target.actorLink ?? target._source?.actorLink ?? null,
      source: sourceOf(target),
    })),
    option: {
      groupId: selected.group.id ?? null,
      groupNumber: selected.groupNumber,
      rank: selected.row.rank,
      slotId: selected.row.slotId,
      signature: selected.active.signature === true,
      virtual: selected.active.virtual === true,
      expended: selected.active.expended === true,
      resource: computedResource.snapshot,
      dc: selected.row.dc,
      attackModifier: selected.row.attackModifier,
      actorLevel: finiteInt(actor.level),
      time: selected.row.time,
      computedRank: selected.row.rank,
    },
  };
  return {
    scene,
    token,
    actor,
    entry,
    spell,
    group: selected.group,
    active: selected.active,
    row: selected.row,
    nativeGroupNumber: selected.groupNumber,
    resource: computedResource.snapshot,
    expectedCombat,
    sourceFacts,
    targetDocs: targets,
  };
}
async function fingerprint(
  selection: Selection,
  resolved: Resolved,
): Promise<string> {
  return digest({
    selection,
    sourceFacts: resolved.sourceFacts,
    expectedCombat: resolved.expectedCombat,
  });
}
function assertResolvedSnapshotCurrent(
  resolved: Resolved,
  selection: Selection,
  ctx: PF2eContext,
  expectedIdentity?: { worldId: string; userId: string; sessionId: string },
): void {
  const identity = currentIdentity(ctx);
  if (
    expectedIdentity &&
    (identity.worldId !== expectedIdentity.worldId ||
      identity.userId !== expectedIdentity.userId ||
      identity.sessionId !== expectedIdentity.sessionId)
  )
    throw fail(
      "SESSION_CHANGED",
      "World, GM, or paired session changed while reviewing spell state.",
    );
  const { scene, token, actor, entry, spell, group, active } = resolved;
  if (
    !owns(ctx.game?.scenes, scene) ||
    !owns(scene.tokens, token) ||
    token.parent !== scene ||
    token.uuid !== selection.casterTokenUuid ||
    token.actor !== actor ||
    !owns(actor.items, entry) ||
    !owns(actor.items, spell) ||
    entry.actor !== actor ||
    entry.parent !== actor ||
    entry.uuid !== selection.entryUuid ||
    entry.spells?.get?.(spell.id) !== spell ||
    spell.uuid !== selection.spellUuid ||
    spell.actor !== actor ||
    group.active?.includes(active) !== true ||
    active.spell !== spell
  )
    throw fail(
      "STALE_CAST_INTENT",
      "Caster, Actor, entry, spell, or native option membership changed during review.",
    );
  const facts: any = resolved.sourceFacts;
  if (!isCurrentNativeEntry(actor, entry))
    throw fail(
      "STALE_CAST_INTENT",
      "Spellcasting entry is no longer a current regular entry.",
    );
  const groupNumber =
    typeof group.number === "number"
      ? group.number
      : group.id === "cantrips"
        ? 0
        : Number(group.id);
  const isPreparedCantrip =
    entryKind(entry) === "prepared" && groupNumber === 0;
  const slotBased =
    entryKind(entry) === "prepared" && (!entry.isFlexible || isPreparedCantrip);
  const activeIndex = Array.isArray(group.active)
    ? group.active.indexOf(active)
    : -1;
  const freshSlotId = slotBased ? activeIndex : null;
  const freshRow = optionRow(entry, actor, group, active, freshSlotId);
  const optionFacts = {
    groupId: group.id ?? null,
    groupNumber,
    rank: freshRow.rank,
    slotId: freshRow.slotId,
    signature: active.signature === true,
    virtual: active.virtual === true,
    expended: active.expended === true,
    resource: resolved.resource,
    dc: freshRow.dc,
    attackModifier: freshRow.attackModifier,
    actorLevel: finiteInt(actor.level),
    time: freshRow.time,
    computedRank: freshRow.rank,
  };
  if (!sameValue(optionFacts, facts.option) || !freshRow.available)
    throw fail(
      "STALE_CAST_INTENT",
      "Derived native cast options changed during review.",
    );
  const casterTokenFacts = facts.casterToken;
  if (
    canonical(facts.actor) !== canonical(sourceOf(actor)) ||
    canonical(facts.entry) !== canonical(sourceOf(entry)) ||
    canonical(facts.spell) !== canonical(sourceOf(spell)) ||
    canonical(facts.casterToken?.source) !== canonical(sourceOf(token)) ||
    casterTokenFacts?.uuid !== token.uuid ||
    casterTokenFacts?.id !== token.id ||
    casterTokenFacts?.sceneUuid !== scene.uuid ||
    casterTokenFacts?.actorUuid !== actor.uuid ||
    casterTokenFacts?.actorId !==
      (token.actorId ?? token._source?.actorId ?? null) ||
    casterTokenFacts?.actorLink !==
      (token.actorLink ?? token._source?.actorLink ?? null) ||
    facts.targets?.length !== resolved.targetDocs.length
  )
    throw fail(
      "STALE_CAST_INTENT",
      "Native source data changed while computing the review fingerprint.",
    );
  for (let index = 0; index < resolved.targetDocs.length; index += 1) {
    const target = resolved.targetDocs[index];
    const current = values(scene.tokens).find(
      (candidate) => candidate.uuid === selection.targetTokenUuids[index],
    );
    const targetFacts = facts.targets[index];
    if (
      current !== target ||
      !owns(scene.tokens, target) ||
      target.parent !== scene ||
      targetFacts?.uuid !== target.uuid ||
      targetFacts?.id !== target.id ||
      targetFacts?.actorUuid !== (target.actor?.uuid ?? null) ||
      targetFacts?.actorId !==
        (target.actorId ?? target._source?.actorId ?? null) ||
      targetFacts?.actorLink !==
        (target.actorLink ?? target._source?.actorLink ?? null) ||
      canonical(targetFacts?.source) !== canonical(sourceOf(target))
    )
      throw fail(
        "STALE_CAST_INTENT",
        "A selected target changed during review.",
      );
  }
  if (!sameValue(currentResource(resolved), resolved.resource))
    throw fail(
      "STALE_CAST_INTENT",
      "The selected native resource changed while computing the review fingerprint.",
    );
  if (!sameValue(combatSnapshot(scene, token, ctx), resolved.expectedCombat))
    throw fail(
      "STALE_TURN",
      "Combat state changed while computing the review fingerprint.",
    );
}
function pruneIntents(now = Date.now()): void {
  for (const [id, intent] of intents)
    if (intent.expiresAt <= now) intents.delete(id);
}
function ensureSameSelection(intent: CastIntent, selection: Selection): void {
  if (!sameValue(intent.selection, selection))
    throw fail(
      "CAST_INTENT_MISMATCH",
      "Execution selection differs from its inspected intent.",
    );
}
function verifyIntentContext(intent: CastIntent, ctx: PF2eContext): void {
  const identity = currentIdentity(ctx);
  if (
    identity.worldId !== intent.worldId ||
    identity.userId !== intent.userId ||
    identity.sessionId !== intent.sessionId
  )
    throw fail(
      "SESSION_CHANGED",
      "The cast intent belongs to a different world, GM, or paired bridge session.",
    );
}
async function inspectCast(selection: Selection, ctx: PF2eContext) {
  const identity = currentIdentity(ctx);
  pruneIntents();
  if (intents.size >= MAX_INTENTS)
    throw fail(
      "CAST_INTENTS_FULL",
      "Too many unexpired spell-cast intents are pending.",
    );
  const resolved = await resolveSelection(selection, ctx);
  const fingerprintValue = await fingerprint(selection, resolved);
  assertResolvedSnapshotCurrent(resolved, selection, ctx, identity);
  let audit: ReturnType<typeof readSpellCastActorSummary>;
  try {
    audit = readSpellCastActorSummary(ctx, String(resolved.actor.uuid));
  } catch (cause) {
    throw fail(
      "SPELL_LEDGER_UNAVAILABLE",
      "The spell-cast ledger could not be validated; a new cast intent cannot be created.",
      { causeCode: (cause as any)?.code ?? null },
    );
  }
  if (audit.blockedCount > 0)
    throw fail(
      "SPELL_CAST_RECONCILIATION_REQUIRED",
      "An unresolved spell-cast ledger record blocks this Actor from creating another cast intent.",
      { blockedCount: audit.blockedCount },
    );
  if (audit.capacityRemaining < 1)
    throw fail("SPELL_LEDGER_FULL", "The durable spell-cast ledger is full.");
  currentIdentity(ctx);
  const castId = nonce("cast");
  const reviewToken = nonce("review");
  const expiresAt = Date.now() + INTENT_TTL_MS;
  const intent: CastIntent = {
    castId,
    reviewToken,
    selection: plainClone(selection),
    worldId: identity.worldId,
    userId: identity.userId,
    sessionId: identity.sessionId,
    expectedCombat: resolved.expectedCombat
      ? plainClone(resolved.expectedCombat)
      : null,
    resourceBefore: plainClone(resolved.resource),
    resourceCost: resolved.resource.cost,
    nativeGroupNumber: resolved.nativeGroupNumber,
    fingerprint: fingerprintValue,
    expiresAt,
    used: false,
  };
  intents.set(castId, intent);
  return {
    supported: true,
    executable: true,
    selection: plainClone(selection),
    expectedCombat: intent.expectedCombat,
    resourceBefore: intent.resourceBefore,
    resourceCost: intent.resourceCost,
    nativeGroupNumber: intent.nativeGroupNumber,
    castId,
    reviewToken,
    fingerprint: fingerprintValue,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresInMs: INTENT_TTL_MS,
    readOnly: true,
    note: "Casting requires the exact selection and review token. Targets are recorded context only; this tool does not resolve spell effects.",
  };
}
function resourceAfter(resolved: Resolved): SpellCastResourceSnapshot {
  return currentResource(resolved);
}
function validateCombatSnapshot(
  expected: CombatSnapshot | null,
  resolved: Resolved,
): void {
  if (!sameValue(expected, resolved.expectedCombat))
    throw fail(
      "STALE_TURN",
      "Current combat state differs from the inspected cast intent.",
    );
}
async function verifyFreshSelection(
  intent: CastIntent,
  ctx: PF2eContext,
): Promise<Resolved> {
  if (intent.expiresAt <= Date.now())
    throw fail(
      "CAST_INTENT_EXPIRED",
      "The inspected spell-cast intent expired before native execution.",
    );
  verifyIntentContext(intent, ctx);
  const resolved = await resolveSelection(intent.selection, ctx);
  validateCombatSnapshot(intent.expectedCombat, resolved);
  const currentFingerprint = await fingerprint(intent.selection, resolved);
  if (intent.expiresAt <= Date.now())
    throw fail(
      "CAST_INTENT_EXPIRED",
      "The inspected spell-cast intent expired while revalidating native state.",
    );
  assertResolvedSnapshotCurrent(resolved, intent.selection, ctx, {
    worldId: intent.worldId,
    userId: intent.userId,
    sessionId: intent.sessionId,
  });
  if (currentFingerprint !== intent.fingerprint)
    throw fail(
      "STALE_CAST_INTENT",
      "Actor, spell, native option, resource, target, or combat state changed after inspection.",
    );
  return resolved;
}
function verifyIdentityAfterConsume(
  intent: CastIntent,
  resolved: Resolved,
  ctx: PF2eContext,
): void {
  verifyIntentContext(intent, ctx);
  const { token, scene, actor, entry, spell } = resolved;
  if (
    token.uuid !== intent.selection.casterTokenUuid ||
    token.parent !== scene ||
    !owns(ctx.game?.scenes, scene) ||
    !owns(scene.tokens, token) ||
    token.actor !== actor ||
    !owns(actor.items, entry) ||
    !owns(actor.items, spell) ||
    entry.spells?.get?.(spell.id) !== spell ||
    entry.uuid !== intent.selection.entryUuid ||
    spell.uuid !== intent.selection.spellUuid
  )
    throw fail(
      "STALE_CAST_INTENT",
      "Caster, Actor, entry, or spell identity changed during native consumption.",
    );
  validateCombatSnapshot(intent.expectedCombat, {
    ...resolved,
    expectedCombat: combatSnapshot(scene, token, ctx),
  });
  validateTargets(intent.selection, scene);
}
function nativeMessageSource(
  message: any,
  resolved: Resolved,
  intent: CastIntent,
  ctx: PF2eContext,
): any {
  const source =
    typeof message?.toObject === "function"
      ? message.toObject()
      : plainClone(message);
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw fail(
      "NATIVE_CHAT_UNCONFIRMED",
      "PF2e did not return a native chat message source.",
    );
  const originOptions = source.flags?.pf2e?.origin?.rollOptions;
  const nativeCastMarker =
    Array.isArray(originOptions) &&
    originOptions.includes("origin:action:slug:cast-a-spell");
  if (
    !nativeCastMarker ||
    source.flags?.pf2e?.casting?.id !== resolved.entry.id ||
    source.flags?.pf2e?.origin?.uuid !== resolved.spell.uuid
  )
    throw fail(
      "NATIVE_CHAT_UNCONFIRMED",
      "The native PF2e message lacks expected actual-cast identity flags.",
    );
  const ChatMessageClass = chatMessageClass(ctx);
  const speaker = ChatMessageClass?.getSpeaker?.({
    actor: resolved.actor,
    token: tokenDocument(resolved.token),
  });
  if (
    !speaker ||
    typeof speaker !== "object" ||
    speaker.scene !== resolved.scene.id ||
    speaker.token !== resolved.token.id ||
    speaker.actor !== resolved.actor.id
  )
    throw fail(
      "API_UNAVAILABLE",
      "Foundry could not produce a speaker for the explicit caster token.",
    );
  source.speaker = speaker;
  source.flags ??= {};
  const previousModuleFlags =
    source.flags["foundry-vtt-mcp"] &&
    typeof source.flags["foundry-vtt-mcp"] === "object"
      ? plainClone(source.flags["foundry-vtt-mcp"])
      : {};
  source.flags["foundry-vtt-mcp"] = {
    ...previousModuleFlags,
    spellCast: {
      castId: intent.castId,
      targetTokenUuids: [...intent.selection.targetTokenUuids],
    },
  };
  const whisper = Array.isArray(source.whisper) ? source.whisper : [];
  if (
    (intent.selection.messageMode === "public" &&
      (whisper.length > 0 || source.blind === true)) ||
    ((intent.selection.messageMode === "gm" ||
      intent.selection.messageMode === "self") &&
      (!whisper.includes(String(ctx.game?.user?.id)) ||
        source.blind === true)) ||
    (intent.selection.messageMode === "blind" &&
      (!whisper.includes(String(ctx.game?.user?.id)) || source.blind !== true))
  )
    throw fail(
      "NATIVE_CHAT_UNCONFIRMED",
      "PF2e native message visibility does not match the reviewed message mode.",
    );
  return source;
}
function verifyCreatedMessage(
  message: any,
  resolved: Resolved,
  intent: CastIntent,
  ctx: PF2eContext,
  source: any,
): string {
  const collection = ctx.game?.messages;
  const uuid = message?.uuid;
  const identity =
    message &&
    typeof message.id === "string" &&
    boundedText(uuid) &&
    typeof collection?.get === "function" &&
    collection.get(message.id) === message;
  const marker = message?.flags?.pf2e?.origin?.rollOptions;
  const nativeCastMarker =
    Array.isArray(marker) && marker.includes("origin:action:slug:cast-a-spell");
  if (
    !identity ||
    !nativeCastMarker ||
    message.flags?.pf2e?.casting?.id !== resolved.entry.id ||
    message.flags?.pf2e?.origin?.uuid !== resolved.spell.uuid ||
    message.speaker?.token !== resolved.token.id ||
    message.speaker?.actor !== resolved.actor.id ||
    message.speaker?.scene !== resolved.scene.id ||
    message.flags?.["foundry-vtt-mcp"]?.spellCast?.castId !== intent.castId ||
    !sameValue(
      message.flags?.["foundry-vtt-mcp"]?.spellCast?.targetTokenUuids,
      intent.selection.targetTokenUuids,
    ) ||
    !sameValue(message.whisper ?? [], source.whisper ?? []) ||
    message.blind !== source.blind
  )
    throw fail(
      "NATIVE_CHAT_UNCONFIRMED",
      "Foundry did not confirm the native spell card and explicit caster identity.",
    );
  return uuid;
}
async function executeCast(args: Record<string, unknown>, ctx: PF2eContext) {
  const selection = validateSelection(args);
  const castId = String(args.castId ?? "");
  const reviewToken = String(args.reviewToken ?? "");
  if (!boundedText(castId, 128) || !boundedText(reviewToken, 128))
    throw fail("INVALID_INPUT", "castId and reviewToken are required.");
  const expectedCombat = (args.expectedCombat ?? null) as CombatSnapshot | null;
  pruneIntents();
  const intent = intents.get(castId);
  if (!intent || intent.expiresAt <= Date.now())
    throw fail(
      "CAST_INTENT_UNKNOWN",
      "Spell-cast intent is unknown, expired, or was lost on reload.",
    );
  if (intent.reviewToken !== reviewToken)
    throw fail(
      "CAST_REVIEW_MISMATCH",
      "reviewToken does not match the inspected cast intent.",
    );
  ensureSameSelection(intent, selection);
  if (intent.used)
    throw fail(
      "CAST_INTENT_USED",
      "This spell-cast intent has already been attempted.",
    );
  if (!sameValue(intent.expectedCombat, expectedCombat))
    throw fail(
      "CAST_INTENT_MISMATCH",
      "expectedCombat differs from the inspected cast intent.",
    );
  verifyIntentContext(intent, ctx);
  ctx.assertWrite();
  return withSpellCastLedger(ctx, async (ledger) => {
    const initial = await verifyFreshSelection(intent, ctx);
    const run = async () => {
      let reserved = false;
      let finalizationAttempted = false;
      let nativeConsumed: boolean | null = null;
      let after: SpellCastResourceSnapshot | null = null;
      let chatMessageUuid: string | null = null;
      try {
        const beforeReservation = await verifyFreshSelection(intent, ctx);
        if (!sameValue(beforeReservation.resource, intent.resourceBefore))
          throw fail(
            "STALE_CAST_INTENT",
            "The selected native resource changed before reservation.",
          );
        ctx.assertWrite();
        if (intent.used)
          throw fail(
            "CAST_INTENT_USED",
            "This spell-cast intent has already been attempted.",
          );
        intent.used = true;
        await ledger.reserve({
          castId: intent.castId,
          sessionId: intent.sessionId,
          actorUuid: beforeReservation.actor.uuid,
          casterTokenUuid: beforeReservation.token.uuid,
          entryUuid: beforeReservation.entry.uuid,
          spellUuid: beforeReservation.spell.uuid,
          rank: intent.selection.rank,
          slotId: intent.selection.slotId,
          targetTokenUuids: [...intent.selection.targetTokenUuids],
          messageMode: intent.selection.messageMode,
          reviewToken: intent.reviewToken,
          fingerprint: intent.fingerprint,
          resourceBefore: plainClone(intent.resourceBefore),
        });
        reserved = true;
        const beforeConsume = await verifyFreshSelection(intent, ctx);
        if (!sameValue(beforeConsume.resource, intent.resourceBefore))
          throw fail(
            "STALE_CAST_INTENT",
            "The native resource changed after the durable reservation.",
          );
        ctx.assertWrite();
        const consumed = await beforeConsume.entry.consume(
          beforeConsume.spell,
          intent.nativeGroupNumber,
          intent.selection.slotId ?? undefined,
        );
        nativeConsumed =
          consumed === true ? true : consumed === false ? false : null;
        ctx.assertWrite();
        if (consumed !== true) {
          after = resourceAfter(beforeConsume);
          finalizationAttempted = true;
          await ledger.finalize(intent.castId, "uncertain", {
            nativeConsumed,
            resourceAfter: after,
            chatMessageUuid: null,
          });
          throw fail(
            "NATIVE_CONSUMPTION_REFUSED",
            "PF2e did not confirm spell resource consumption; no spell card was created.",
            {
              nativeConsumed,
              resourceBefore: intent.resourceBefore,
              resourceAfter: after,
            },
          );
        }
        let refreshed = await resolveSelection(intent.selection, ctx, true);
        verifyIdentityAfterConsume(intent, refreshed, ctx);
        after = resourceAfter(refreshed);
        if (!transitionConfirmed(intent.resourceBefore, after))
          throw fail(
            "RESOURCE_TRANSITION_UNCONFIRMED",
            "Native spell consumption did not produce the expected resource transition.",
          );
        ctx.assertWrite();
        verifyIdentityAfterConsume(intent, refreshed, ctx);
        const postConsumeFacts = {
          refs: {
            scene: refreshed.scene,
            token: refreshed.token,
            actor: refreshed.actor,
            entry: refreshed.entry,
            spell: refreshed.spell,
          },
          actor: sourceOf(refreshed.actor),
          entry: sourceOf(refreshed.entry),
          spell: sourceOf(refreshed.spell),
          option:
            refreshed.sourceFacts && (refreshed.sourceFacts as any).option,
          caster: sourceOf(refreshed.token),
          targets: refreshed.targetDocs.map((target) => ({
            source: sourceOf(target),
            actor: target.actor?.uuid ?? null,
          })),
        };
        const nativeMessage = await refreshed.spell.toMessage(null, {
          actualCast: true,
          create: false,
          data: { castRank: intent.selection.rank },
          mode: intent.selection.messageMode,
        });
        ctx.assertWrite();
        refreshed = await resolveSelection(intent.selection, ctx, true);
        verifyIdentityAfterConsume(intent, refreshed, ctx);
        const currentPostConsumeFacts = {
          refs: {
            scene: refreshed.scene,
            token: refreshed.token,
            actor: refreshed.actor,
            entry: refreshed.entry,
            spell: refreshed.spell,
          },
          actor: sourceOf(refreshed.actor),
          entry: sourceOf(refreshed.entry),
          spell: sourceOf(refreshed.spell),
          option:
            refreshed.sourceFacts && (refreshed.sourceFacts as any).option,
          caster: sourceOf(refreshed.token),
          targets: refreshed.targetDocs.map((target) => ({
            source: sourceOf(target),
            actor: target.actor?.uuid ?? null,
          })),
        };
        if (
          postConsumeFacts.refs.scene !== currentPostConsumeFacts.refs.scene ||
          postConsumeFacts.refs.token !== currentPostConsumeFacts.refs.token ||
          postConsumeFacts.refs.actor !== currentPostConsumeFacts.refs.actor ||
          postConsumeFacts.refs.entry !== currentPostConsumeFacts.refs.entry ||
          postConsumeFacts.refs.spell !== currentPostConsumeFacts.refs.spell ||
          !sameValue(
            { ...postConsumeFacts, refs: undefined },
            { ...currentPostConsumeFacts, refs: undefined },
          ) ||
          refreshed.targetDocs.some(
            (target, index) => target !== initial.targetDocs[index],
          ) ||
          !isCurrentNativeEntry(refreshed.actor, refreshed.entry)
        )
          throw fail(
            "STALE_CAST_INTENT",
            "Caster, entry, spell, or target identity changed while building the native card.",
          );
        after = resourceAfter(refreshed);
        if (!transitionConfirmed(intent.resourceBefore, after))
          throw fail(
            "RESOURCE_TRANSITION_UNCONFIRMED",
            "Native resource state changed while building the spell card.",
          );
        const source = nativeMessageSource(
          nativeMessage,
          refreshed,
          intent,
          ctx,
        );
        const ChatMessageClass = chatMessageClass(ctx);
        if (typeof ChatMessageClass?.create !== "function")
          throw fail(
            "API_UNAVAILABLE",
            "Foundry ChatMessage.create is unavailable.",
          );
        ctx.assertWrite();
        verifyIdentityAfterConsume(intent, refreshed, ctx);
        const created = await ChatMessageClass.create(source, {
          renderSheet: false,
        });
        if (boundedText(created?.uuid)) chatMessageUuid = created.uuid;
        chatMessageUuid = verifyCreatedMessage(
          created,
          refreshed,
          intent,
          ctx,
          source,
        );
        const afterChat = await resolveSelection(intent.selection, ctx, true);
        verifyIdentityAfterConsume(intent, afterChat, ctx);
        after = resourceAfter(afterChat);
        if (!transitionConfirmed(intent.resourceBefore, after))
          throw fail(
            "RESOURCE_TRANSITION_UNCONFIRMED",
            "Native resource state changed while creating the spell card.",
          );
        finalizationAttempted = true;
        const confirmed = await ledger.finalize(intent.castId, "confirmed", {
          nativeConsumed: true,
          resourceAfter: after,
          chatMessageUuid,
        });
        return {
          cast: "confirmed",
          castId: intent.castId,
          actorUuid: afterChat.actor.uuid,
          casterTokenUuid: afterChat.token.uuid,
          entryUuid: afterChat.entry.uuid,
          spellUuid: afterChat.spell.uuid,
          rank: intent.selection.rank,
          slotId: intent.selection.slotId,
          targetTokenUuids: [...intent.selection.targetTokenUuids],
          messageMode: intent.selection.messageMode,
          expectedCombat: intent.expectedCombat,
          resourceBefore: intent.resourceBefore,
          resourceAfter: confirmed.resourceAfter,
          chatMessageUuid,
          effectsApplied: false,
          targetRollsResolved: false,
        };
      } catch (cause) {
        if (reserved && !finalizationAttempted) {
          finalizationAttempted = true;
          try {
            let knownAfter = after;
            if (knownAfter === null && nativeConsumed !== null) {
              try {
                knownAfter = resourceAfter(initial);
              } catch {
                knownAfter = null;
              }
            }
            await ledger.finalize(intent.castId, "uncertain", {
              nativeConsumed,
              resourceAfter: knownAfter,
              chatMessageUuid,
            });
          } catch (auditError) {
            throw fail(
              "PARTIAL_FAILURE",
              "Spell casting was interrupted after its durable reservation; inspect native resources, chat, and the reported ledger status before any retry.",
              {
                castId: intent.castId,
                outcomeUnknown: true,
                nativeConsumed,
                resourceBefore: intent.resourceBefore,
                resourceAfter: after,
                chatMessageUuid,
                auditErrorCode: (auditError as any)?.code ?? null,
                auditPartial: (auditError as any)?.partial ?? null,
                causeCode: (cause as any)?.code ?? null,
              },
            );
          }
        }
        if ((cause as any)?.code === "NATIVE_CONSUMPTION_REFUSED") throw cause;
        if ((cause as any)?.code === "PARTIAL_FAILURE") throw cause;
        throw fail(
          reserved
            ? "PARTIAL_FAILURE"
            : ((cause as any)?.code ?? "CAST_FAILED"),
          reserved
            ? "Spell casting failed after reservation; inspect resources and chat before any retry."
            : cause instanceof Error
              ? cause.message.slice(0, 240)
              : "Spell casting failed.",
          reserved
            ? {
                castId: intent.castId,
                outcomeUnknown: true,
                nativeConsumed,
                resourceBefore: intent.resourceBefore,
                resourceAfter: after,
                chatMessageUuid,
                causeCode: (cause as any)?.code ?? null,
                causePartial: (cause as any)?.partial ?? null,
              }
            : (cause as any)?.partial,
        );
      }
    };
    if (initial.expectedCombat) {
      const combat =
        ctx.game?.combats?.get?.(
          initial.expectedCombat.encounterUuid.split(".").pop() ?? "",
        ) ??
        values(ctx.game?.combats).find(
          (candidate) =>
            candidate.uuid === initial.expectedCombat!.encounterUuid,
        );
      if (!combat)
        throw fail("STALE_TURN", "The inspected encounter no longer exists.");
      return withCombatLock(combat, ctx, run);
    }
    return run();
  });
}

export async function handlePF2eSpellCast(
  tool: Extract<ToolName, "pf2e_inspect_spell_cast" | "pf2e_cast_spell">,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  const selection = validateSelection(args);
  if (tool === "pf2e_inspect_spell_cast") return inspectCast(selection, ctx);
  return executeCast(args, ctx);
}
