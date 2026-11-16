import { canonicalSpellFingerprintValue, digestSpellFingerprint } from "./pf2e-spell-fingerprint";
import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";
import { withCombatLock } from "./encounters";
import { entriesFor, isCurrentNativeEntry } from "./pf2e-spellcasting";
import {
  readConfirmedSpellCastByMessage,
  type SpellCastRecord,
} from "./pf2e-spell-ledger";
import {
  finalizeSpellResolution,
  inspectSpellResolutionLedger,
  reserveSpellResolution,
  type ResolutionAction,
  type SpellResolutionReservation,
} from "./pf2e-spell-resolution-ledger";

const MODULE_ID = "foundry-vtt-mcp";
const INTENT_TTL_MS = 5 * 60_000;
const MAX_INTENTS = 500;
const intents = new Map<string, ResolutionIntent>();
type Selection = {
  castMessageUuid: string;
  casterTokenUuid: string;
  targetTokenUuid: string;
  action: ResolutionAction;
  attackNumber: number;
  messageMode: "public" | "gm" | "blind" | "self";
};
type ResolutionTool =
  | "pf2e_inspect_spell_resolution"
  | "pf2e_roll_spell_attack"
  | "pf2e_roll_spell_save"
  | "pf2e_roll_spell_damage";
type CombatSnapshot = {
  encounterUuid: string;
  round: number;
  turn: number;
  combatantUuid: string;
};
type ResolutionSourceFacts = {
  castRecord: SpellCastRecord;
  message: unknown;
  sceneUuid: unknown;
  scene: unknown;
  caster: unknown;
  actor: unknown;
  entry: unknown;
  spell: unknown;
  rankSpell: unknown;
  nativeRank: unknown;
  isAttack: unknown;
  damageKinds: unknown[];
  damage: unknown;
  entryDc: unknown;
  entryAttackModifier: unknown;
  spellcastingCheckModifier: unknown;
  targetSaveModifier: unknown;
  casterLevel: unknown;
  targetLevel: unknown;
  nativeDc: unknown;
  targetUuid: unknown;
  target: unknown;
  targetActorUuid: unknown;
  targetActor: unknown;
  rank: number;
  saveStatistic: string | null;
  dc: number | null;
  expectedCombat: CombatSnapshot | null;
  targetIndependentDamage: boolean;
  rollClassName: string;
};
type ResolutionPreview = {
  resolutionId: string;
  reviewToken: string;
  expiresAt: string;
  selection: Selection;
  expectedCombat: CombatSnapshot | null;
  caster: { tokenUuid: string; actorUuid: string };
  target: { tokenUuid: string; actorUuid: string };
  cast: {
    castId: string;
    messageUuid: string | null;
    spellUuid: string;
    entryUuid: string;
    rank: number;
  };
  native: {
    attackNumber: number | null;
    saveStatistic: string | null;
    dc: number | null;
    spellcastingCheckModifier: unknown;
    targetSaveModifier: unknown;
    targetIndependentDamage: boolean;
    outcomeScaling: false;
  };
  ledger: { capacityRemaining: number };
  readOnly: true;
  executesNothing: true;
};
type DegreeOfSuccess =
  | "criticalFailure"
  | "failure"
  | "success"
  | "criticalSuccess";
type ConfirmedResolutionAuditOutcome = {
  messageUuid: string;
  rollType: "check" | "damage";
  rollTotal: number;
};
type ConfirmedResolutionResponse = {
  resolution: "confirmed";
  resolutionId: string;
  action: ResolutionAction;
  castMessageUuid: string;
  messageUuid: string;
  rollType: "check" | "damage";
  total: number;
  degreeOfSuccess: DegreeOfSuccess | null;
  casterTokenUuid: string;
  targetTokenUuid: string;
  rank: number;
  attackNumber: number | null;
  saveStatistic: string | null;
  dc: number | null;
  targetIndependentDamage: boolean;
  outcomeScaling: false;
};
type ConfirmedResolutionExecution = ConfirmedResolutionResponse & {
  __auditOutcome: ConfirmedResolutionAuditOutcome;
};
type ResolutionUncertainPartial = {
  resolutionId: string;
  messageUuid: string | null;
  rollType: "check" | "damage" | null;
  rollTotal: number | null;
  causeCode: unknown;
};
type ResolutionAuditFailurePartial = {
  resolutionId: string;
  messageUuid: unknown;
  rollType: unknown;
  rollTotal: unknown;
  auditStatus: unknown;
  auditStateKnown: boolean;
  causeCode: unknown;
};
type ResolutionIntent = {
  resolutionId: string;
  reviewToken: string;
  selection: Selection;
  worldId: string;
  userId: string;
  sessionId: string;
  expectedCombat: CombatSnapshot | null;
  operationKey: string;
  fingerprint: string;
  marker: string;
  expiresAt: number;
  rollClass: any;
  used: boolean;
};
type Resolved = {
  scene: any;
  message: any;
  castRecord: SpellCastRecord;
  token: any;
  actor: any;
  targetToken: any;
  targetActor: any;
  entry: any;
  spell: any;
  rankSpell: any;
  expectedCombat: CombatSnapshot | null;
  saveStatistic: string | null;
  dc: number | null;
  targetIndependentDamage: boolean;
  rollClass: any;
  sourceFacts: ResolutionSourceFacts;
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
function owns(collection: any, doc: any): boolean {
  return Boolean(
    collection &&
    doc &&
    (typeof collection.get === "function"
      ? collection.get(doc.id) === doc
      : values(collection).includes(doc)),
  );
}
function bounded(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}
function sourceOf(doc: any): unknown {
  if (typeof doc?.toObject === "function") return doc.toObject();
  if (doc?._source) return clone(doc._source);
  return null;
}
function canonical(value: any): string {
  return canonicalSpellFingerprintValue(value);
}
async function digest(value: unknown): Promise<string> {
  return digestSpellFingerprint(
    value,
    "Secure spell-resolution review fingerprints are unavailable.",
  );
}
function nonce(prefix: string): string {
  const api = globalThis.crypto;
  if (!api?.getRandomValues)
    throw fail(
      "CRYPTO_UNAVAILABLE",
      "Secure spell-resolution identifiers are unavailable.",
    );
  const bytes = api.getRandomValues(new Uint8Array(18));
  return `${prefix}-${Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
function identity(ctx: PF2eContext) {
  const worldId = ctx.game?.world?.id,
    userId = ctx.game?.user?.id,
    sessionId = ctx.sessionId;
  if (
    !bounded(worldId, 128) ||
    !bounded(userId, 128) ||
    !bounded(sessionId, 256) ||
    ctx.game?.user?.isGM !== true
  )
    throw fail(
      "SESSION_CHANGED",
      "A current paired GM world and bridge session are required.",
    );
  return { worldId, userId, sessionId };
}
function validateSelection(
  args: Record<string, unknown>,
  actionOverride?: ResolutionAction,
): Selection {
  const action = actionOverride ?? args.action;
  const result: Selection = {
    castMessageUuid: String(args.castMessageUuid ?? ""),
    casterTokenUuid: String(args.casterTokenUuid ?? ""),
    targetTokenUuid: String(args.targetTokenUuid ?? ""),
    action: action as ResolutionAction,
    attackNumber: Number(args.attackNumber ?? 1),
    messageMode: (args.messageMode ?? "gm") as Selection["messageMode"],
  };
  if (
    !bounded(result.castMessageUuid) ||
    !bounded(result.casterTokenUuid) ||
    !bounded(result.targetTokenUuid) ||
    !["attack", "save", "damage"].includes(result.action) ||
    !Number.isInteger(result.attackNumber) ||
    result.attackNumber < 1 ||
    result.attackNumber > 3 ||
    (result.action !== "attack" && result.attackNumber !== 1) ||
    !["public", "gm", "blind", "self"].includes(result.messageMode)
  )
    throw fail(
      "INVALID_INPUT",
      "Spell-resolution selection is invalid or unbounded.",
    );
  return result;
}
function chatSource(message: any): any {
  if (typeof message?.toObject === "function") return clone(message.toObject());
  return clone(message?._source ?? message);
}
function visibilityMatches(message: any, mode: string, ctx: PF2eContext) {
  const whisper = Array.isArray(message?.whisper)
    ? [...message.whisper].sort()
    : [];
  const gms = values(ctx.game?.users)
    .filter((user) => user?.isGM === true)
    .map((user) => user.id)
    .sort();
  const self = bounded(ctx.game?.user?.id) ? [ctx.game.user.id] : [];
  if (mode === "public") return message?.blind !== true && whisper.length === 0;
  if (mode === "gm")
    return message?.blind !== true && canonical(whisper) === canonical(gms);
  if (mode === "blind")
    return message?.blind === true && canonical(whisper) === canonical(gms);
  return (
    mode === "self" &&
    message?.blind !== true &&
    canonical(whisper) === canonical(self)
  );
}
function currentCombat(
  scene: any,
  casterToken: any,
  ctx: PF2eContext,
): CombatSnapshot | null {
  const combat = ctx.game?.combat;
  if (!combat || combat.started !== true) return null;
  if (!owns(ctx.game?.combats, combat) || combat.isActive !== true)
    throw fail(
      "INVALID_COMBAT",
      "Current started Combat is invalid or no longer active.",
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
  const combatants = values(combat.combatants);
  const current = combat.combatant ?? combatants[combat.turn];
  if (
    !current ||
    (current.token?.uuid ?? current.tokenUuid) !== casterToken.uuid
  )
    throw fail(
      "STALE_TURN",
      "The explicit spell caster must be the current combatant.",
    );
  if (
    !Number.isSafeInteger(combat.round) ||
    combat.round < 1 ||
    !Number.isSafeInteger(combat.turn) ||
    !bounded(current.uuid)
  )
    throw fail(
      "INVALID_COMBAT",
      "Current encounter tracker state is unavailable.",
    );
  return {
    encounterUuid: combat.uuid,
    round: combat.round,
    turn: combat.turn,
    combatantUuid: current.uuid,
  };
}
function exactActiveToken(actor: any, requested: any): boolean {
  let active: any[] = [];
  try {
    active =
      typeof actor.getActiveTokens === "function"
        ? actor.getActiveTokens(true, true)
        : [];
  } catch {
    return false;
  }
  const tokens = active.map((x) => x?.document ?? x).filter(Boolean);
  return tokens.length === 1 && tokens[0] === requested;
}
function configuredRollClass(ctx: PF2eContext, action: ResolutionAction): any {
  const rolls =
    ctx.game?.CONFIG?.Dice?.rolls ?? (globalThis as any).CONFIG?.Dice?.rolls;
  const name = action === "damage" ? "DamageRoll" : "CheckRoll";
  const matches = Array.isArray(rolls)
    ? rolls.filter(
        (candidate: any) =>
          typeof candidate === "function" && candidate.name === name,
      )
    : [];
  if (matches.length !== 1)
    throw fail(
      "NATIVE_ROLL_CLASS_UNAVAILABLE",
      `Foundry's configured native ${name} class is unavailable or ambiguous.`,
    );
  return matches[0];
}
function actorIsCurrentWorldOrToken(
  actor: any,
  token: any,
  ctx: PF2eContext,
): boolean {
  if (!actor || actor.documentName !== "Actor" || actor.compendium)
    return false;
  if (!actor.parent && actor.isEmbedded !== true)
    return owns(ctx.game?.actors, actor);
  return (
    token?.actor === actor &&
    (actor.parent === token ||
      actor.token === token ||
      actor.token?.document === token)
  );
}
function rankSpell(spell: any, rank: number): any {
  if (!Number.isInteger(rank) || rank < 1 || rank > 10)
    throw fail("INVALID_CAST_RANK", "Confirmed cast rank is invalid.");
  if (typeof spell.loadVariant !== "function")
    throw fail(
      "NATIVE_VARIANT_UNAVAILABLE",
      "Native spell heightening API is unavailable.",
    );
  const variant = spell.loadVariant({ castRank: rank });
  const result = variant ?? spell;
  if (
    result !== spell &&
    (result.original !== spell ||
      result.uuid !== spell.uuid ||
      result.parentItem)
  )
    throw fail(
      "NATIVE_VARIANT_INVALID",
      "Native rank-specific spell variant did not preserve the owned spell identity.",
    );
  if (Number(result.rank) !== rank)
    throw fail(
      "NATIVE_VARIANT_INVALID",
      "Native rank-specific spell representation does not match the confirmed cast rank.",
    );
  return result;
}
async function resolveSelection(
  selection: Selection,
  ctx: PF2eContext,
): Promise<Resolved> {
  requirePF2e(ctx);
  identity(ctx);
  const castRecord = readConfirmedSpellCastByMessage(
    ctx,
    selection.castMessageUuid,
  );
  const message = await ctx.resolve(selection.castMessageUuid);
  const messageSource = chatSource(message);
  if (
    !message ||
    message.uuid !== selection.castMessageUuid ||
    !owns(ctx.game?.messages, message) ||
    message.documentName !== "ChatMessage"
  )
    throw fail(
      "INVALID_CAST_CARD",
      "castMessageUuid must identify a current world ChatMessage.",
    );
  const pf2e = messageSource?.flags?.pf2e;
  const origin = pf2e?.origin;
  const rollOptions = origin?.rollOptions;
  const variant = origin?.variant;
  const validOverlays =
    variant == null ||
    (typeof variant === "object" &&
      Array.isArray(variant.overlays) &&
      variant.overlays.length === 0);
  if (
    !Array.isArray(rollOptions) ||
    !rollOptions.includes("origin:action:slug:cast-a-spell") ||
    origin.uuid !== castRecord.spellUuid ||
    origin.castRank !== castRecord.rank ||
    !validOverlays ||
    pf2e?.casting?.id !== castRecord.entryUuid.split(".").at(-1) ||
    messageSource?.flags?.[MODULE_ID]?.spellCast?.castId !==
      castRecord.castId ||
    canonical(
      messageSource?.flags?.[MODULE_ID]?.spellCast?.targetTokenUuids ?? [],
    ) !== canonical(castRecord.targetTokenUuids) ||
    !visibilityMatches(message, castRecord.messageMode, ctx)
  )
    throw fail(
      "INVALID_CAST_CARD",
      "The native message origin, actual-cast marker, rank, visibility, or bridge cast metadata does not match the confirmed cast record.",
    );
  if (castRecord.casterTokenUuid !== selection.casterTokenUuid)
    throw fail(
      "INVALID_CASTER",
      "The selected caster must match the bridge-confirmed caster token.",
    );
  if (
    castRecord.targetTokenUuids.length > 0 &&
    !castRecord.targetTokenUuids.includes(selection.targetTokenUuid)
  )
    throw fail(
      "INVALID_TARGET",
      "When the cast recorded targets, the selected target must be one of those bridge-confirmed tokens.",
    );
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
    !actorIsCurrentWorldOrToken(actor, token, ctx) ||
    !["character", "npc"].includes(actor.type) ||
    actor.uuid !== castRecord.actorUuid
  )
    throw fail(
      "INVALID_CASTER",
      "casterTokenUuid must identify the bridge-confirmed current world caster token.",
    );
  if (
    message.speaker?.scene !== scene.id ||
    message.speaker?.token !== token.id ||
    message.speaker?.actor !== actor.id
  )
    throw fail(
      "INVALID_CAST_CARD",
      "The confirmed actual-cast card speaker does not match the bridge-confirmed caster token.",
    );
  const targetToken = await ctx.resolve(selection.targetTokenUuid);
  const targetActor = targetToken?.actor;
  if (
    !targetToken ||
    targetToken.documentName !== "Token" ||
    targetToken.uuid !== selection.targetTokenUuid ||
    targetToken.parent !== scene ||
    !owns(scene.tokens, targetToken) ||
    !actorIsCurrentWorldOrToken(targetActor, targetToken, ctx) ||
    !["character", "npc", "familiar", "hazard", "vehicle"].includes(
      targetActor.type,
    )
  )
    throw fail(
      "INVALID_TARGET",
      "targetTokenUuid must identify one explicit token in the same current scene.",
    );
  if (!exactActiveToken(targetActor, targetToken))
    throw fail(
      "AMBIGUOUS_TARGET_TOKEN",
      "PF2e cannot prove that its Actor-valued target resolves to the explicit token; linked duplicate tokens are unsupported.",
    );
  const entry = await ctx.resolve(castRecord.entryUuid);
  const spell = await ctx.resolve(castRecord.spellUuid);
  if (
    !entry ||
    entry.uuid !== castRecord.entryUuid ||
    entry.type !== "spellcastingEntry" ||
    !isCurrentNativeEntry(actor, entry) ||
    entry.isRitual ||
    entry.isEphemeral ||
    !entriesFor(actor).includes(entry)
  )
    throw fail(
      "INVALID_ENTRY",
      "The confirmed cast entry must remain a current regular Actor-owned entry.",
    );
  if (
    !spell ||
    spell.uuid !== castRecord.spellUuid ||
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
      "The confirmed spell must remain the exact owned regular spell in its entry.",
    );
  const expectedCombat = currentCombat(scene, token, ctx);
  const rankItem = rankSpell(spell, castRecord.rank);
  let saveStatistic: string | null = null,
    dc: number | null = null;
  let targetIndependentDamage = false;
  if (selection.action === "attack") {
    if (
      !rankItem.isAttack ||
      typeof rankItem.rollAttack !== "function" ||
      typeof entry.statistic?.check?.roll !== "function"
    )
      throw fail(
        "UNSUPPORTED_SPELL_ATTACK",
        "This spell does not expose a native attack roll.",
      );
  } else if (selection.action === "save") {
    saveStatistic = rankItem.system?.defense?.save?.statistic;
    if (
      !rankItem.system?.defense?.save ||
      !["fortitude", "reflex", "will"].includes(saveStatistic ?? "") ||
      typeof targetActor.saves?.[saveStatistic!]?.check?.roll !== "function"
    )
      throw fail(
        "UNSUPPORTED_SPELL_SAVE",
        "This spell does not expose one supported native saving throw.",
      );
    const nativeStatistic = rankItem.spellcasting?.statistic;
    dc = Number(nativeStatistic?.getChatData?.({ item: rankItem })?.dc?.value);
    if (!Number.isFinite(dc) || dc < 0 || dc > 100)
      throw fail(
        "NATIVE_SPELL_DC_UNAVAILABLE",
        "Current native spell DC is unavailable or out of bounds.",
      );
    if (!exactActiveToken(actor, token))
      throw fail(
        "AMBIGUOUS_CASTER_TOKEN",
        "PF2e cannot prove its Actor-valued origin resolves to the explicit caster token.",
      );
  } else {
    const damage = rankItem.system?.damage;
    const keys =
      damage && typeof damage === "object" ? Object.keys(damage) : [];
    const kinds = rankItem.damageKinds;
    if (
      !keys.length ||
      keys.length > 10 ||
      typeof kinds?.has !== "function" ||
      !kinds.has("damage") ||
      kinds.has("healing") ||
      kinds.size !== 1 ||
      typeof rankItem.rollDamage !== "function" ||
      typeof rankItem.clone !== "function"
    )
      throw fail(
        "UNSUPPORTED_SPELL_DAMAGE",
        "Only bounded damage-only native spell bases are supported.",
      );
    targetIndependentDamage = rankItem.isAttack !== true;
    if (!exactActiveToken(actor, token))
      throw fail(
        "AMBIGUOUS_CASTER_TOKEN",
        "PF2e cannot prove its Actor-valued damage origin resolves to the explicit caster token.",
      );
  }
  const itemStatistic = rankItem.spellcasting?.statistic;
  const rollClass = configuredRollClass(ctx, selection.action);
  const sourceFacts = {
    castRecord,
    message: messageSource,
    sceneUuid: scene.uuid,
    scene: sourceOf(scene),
    caster: sourceOf(token),
    actor: sourceOf(actor),
    entry: sourceOf(entry),
    spell: sourceOf(spell),
    rankSpell: sourceOf(rankItem),
    nativeRank: rankItem.rank,
    isAttack: rankItem.isAttack,
    damageKinds: Array.from(rankItem.damageKinds ?? []),
    damage: clone(rankItem.system?.damage ?? null),
    entryDc: entry.statistic?.dc?.value ?? null,
    entryAttackModifier: entry.statistic?.check?.mod ?? null,
    spellcastingCheckModifier: itemStatistic?.check?.mod ?? null,
    targetSaveModifier: saveStatistic
      ? (targetActor.saves?.[saveStatistic]?.check?.mod ?? null)
      : null,
    casterLevel: actor.level ?? null,
    targetLevel: targetActor.level ?? null,
    nativeDc:
      itemStatistic?.getChatData?.({ item: rankItem })?.dc?.value ?? null,
    targetUuid: targetToken.uuid,
    target: sourceOf(targetToken),
    targetActorUuid: targetActor.uuid,
    targetActor: sourceOf(targetActor),
    rank: castRecord.rank,
    saveStatistic,
    dc,
    expectedCombat,
    targetIndependentDamage,
    rollClassName: rollClass.name,
  };
  return {
    scene,
    message,
    castRecord,
    token,
    actor,
    targetToken,
    targetActor,
    entry,
    spell,
    rankSpell: rankItem,
    expectedCombat,
    saveStatistic,
    dc,
    targetIndependentDamage,
    rollClass,
    sourceFacts,
  };
}
function operationKey(selection: Selection) {
  return JSON.stringify([
    selection.castMessageUuid,
    selection.action,
    selection.targetTokenUuid,
    selection.action === "attack" ? selection.attackNumber : 1,
  ]);
}
async function fingerprint(selection: Selection, resolved: Resolved) {
  return digest({ selection, facts: resolved.sourceFacts });
}
function pruneIntents() {
  const now = Date.now();
  for (const [id, intent] of intents)
    if (intent.expiresAt <= now) intents.delete(id);
  while (intents.size >= MAX_INTENTS) {
    const oldest = intents.keys().next().value;
    if (!oldest) break;
    intents.delete(oldest);
  }
}
function recheckIntent(intent: ResolutionIntent, ctx: PF2eContext) {
  const current = identity(ctx);
  if (intent.expiresAt <= Date.now())
    throw fail("SPELL_RESOLUTION_EXPIRED", "Spell-resolution preview expired.");
  if (
    current.worldId !== intent.worldId ||
    current.userId !== intent.userId ||
    current.sessionId !== intent.sessionId
  )
    throw fail(
      "SESSION_CHANGED",
      "World, GM, or bridge session changed after preview.",
    );
}
async function resolveFresh(intent: ResolutionIntent, ctx: PF2eContext) {
  recheckIntent(intent, ctx);
  const current = await resolveSelection(intent.selection, ctx);
  recheckIntent(intent, ctx);
  if (
    canonical(current.expectedCombat) !== canonical(intent.expectedCombat) ||
    (await fingerprint(intent.selection, current)) !== intent.fingerprint
  )
    throw fail(
      "STALE_SPELL_RESOLUTION",
      "Cast card, caster, target, native spell facts, or combat state changed after preview.",
    );
  assertResolvedCurrent(current, intent, ctx);
  return current;
}
function sameMessageMode(message: any, expected: string) {
  return (
    message?.flags?.pf2e?.context?.messageMode === expected ||
    message?.flags?.core?.messageMode === expected
  );
}
function messageUuid(message: any): string | null {
  return bounded(message?.uuid) ? message.uuid : null;
}
function finiteRoll(roll: any): number | null {
  return Number.isFinite(roll?.total) ? Number(roll.total) : null;
}
function speakerMatches(message: any, token: any, actor: any) {
  const speaker = message?.speaker;
  return (
    speaker?.scene === token.parent.id &&
    speaker?.token === token.id &&
    speaker?.actor === actor.id
  );
}
function currentFacts(
  resolved: Resolved,
  ctx: PF2eContext,
): ResolutionSourceFacts {
  const statistic = resolved.rankSpell.spellcasting?.statistic;
  return {
    castRecord: readConfirmedSpellCastByMessage(ctx, resolved.message.uuid),
    message: chatSource(resolved.message),
    sceneUuid: resolved.scene.uuid,
    scene: sourceOf(resolved.scene),
    caster: sourceOf(resolved.token),
    actor: sourceOf(resolved.actor),
    entry: sourceOf(resolved.entry),
    spell: sourceOf(resolved.spell),
    rankSpell: sourceOf(resolved.rankSpell),
    nativeRank: resolved.rankSpell.rank,
    isAttack: resolved.rankSpell.isAttack,
    damageKinds: Array.from(resolved.rankSpell.damageKinds ?? []),
    damage: clone(resolved.rankSpell.system?.damage ?? null),
    entryDc: resolved.entry.statistic?.dc?.value ?? null,
    entryAttackModifier: resolved.entry.statistic?.check?.mod ?? null,
    spellcastingCheckModifier: statistic?.check?.mod ?? null,
    targetSaveModifier: resolved.saveStatistic
      ? (resolved.targetActor.saves?.[resolved.saveStatistic]?.check?.mod ??
        null)
      : null,
    casterLevel: resolved.actor.level ?? null,
    targetLevel: resolved.targetActor.level ?? null,
    nativeDc:
      statistic?.getChatData?.({ item: resolved.rankSpell })?.dc?.value ?? null,
    targetUuid: resolved.targetToken.uuid,
    target: sourceOf(resolved.targetToken),
    targetActorUuid: resolved.targetActor.uuid,
    targetActor: sourceOf(resolved.targetActor),
    rank: resolved.castRecord.rank,
    saveStatistic: resolved.saveStatistic,
    dc: resolved.dc,
    expectedCombat: resolved.expectedCombat,
    targetIndependentDamage: resolved.targetIndependentDamage,
    rollClassName: resolved.rollClass.name,
  } satisfies ResolutionSourceFacts;
}
function assertResolvedCurrent(
  resolved: Resolved,
  intent: ResolutionIntent,
  ctx: PF2eContext,
) {
  recheckIntent(intent, ctx);
  if (intent.expiresAt <= Date.now())
    throw fail(
      "SPELL_RESOLUTION_EXPIRED",
      "Spell-resolution preview expired before the native roll.",
    );
  if (
    !owns(ctx.game?.messages, resolved.message) ||
    !owns(ctx.game?.scenes, resolved.scene) ||
    !owns(resolved.scene.tokens, resolved.token) ||
    !owns(resolved.scene.tokens, resolved.targetToken) ||
    !owns(resolved.actor.items, resolved.entry) ||
    !owns(resolved.actor.items, resolved.spell) ||
    !isCurrentNativeEntry(resolved.actor, resolved.entry) ||
    resolved.token.actor !== resolved.actor ||
    resolved.targetToken.actor !== resolved.targetActor ||
    !actorIsCurrentWorldOrToken(resolved.actor, resolved.token, ctx) ||
    !actorIsCurrentWorldOrToken(
      resolved.targetActor,
      resolved.targetToken,
      ctx,
    ) ||
    resolved.targetToken.parent !== resolved.scene ||
    !exactActiveToken(resolved.targetActor, resolved.targetToken) ||
    (intent.selection.action !== "attack" &&
      !exactActiveToken(resolved.actor, resolved.token)) ||
    configuredRollClass(ctx, intent.selection.action) !== resolved.rollClass ||
    intent.rollClass !== resolved.rollClass
  )
    throw fail(
      "STALE_SPELL_RESOLUTION",
      "A reviewed message, caster, entry, spell, target, or native roll class is no longer the same current world document.",
    );
  const combat = currentCombat(resolved.scene, resolved.token, ctx);
  if (
    canonical(combat) !== canonical(intent.expectedCombat) ||
    canonical(currentFacts(resolved, ctx)) !== canonical(resolved.sourceFacts)
  )
    throw fail(
      "STALE_SPELL_RESOLUTION",
      "Reviewed source, derived spell facts, token state, or combat context changed during an asynchronous native operation.",
    );
}
function hookMessage(
  ctx: PF2eContext,
  intent: ResolutionIntent,
  resolved: Resolved,
  onMessage: (message: any) => void,
) {
  const hooks = (ctx.game as any)?.Hooks ?? (globalThis as any).Hooks;
  if (!hooks?.on || !hooks?.off)
    throw fail(
      "NATIVE_HOOKS_UNAVAILABLE",
      "Foundry chat pre-create hooks are unavailable for safe spell-roll correlation.",
    );
  let abortCause: unknown;
  const preCreate = (document: any, data: any) => {
    const source = data && typeof data === "object" ? data : document?._source;
    const pf2e = source?.flags?.pf2e;
    const options = pf2e?.context?.options ?? pf2e?.origin?.rollOptions ?? [];
    if (!Array.isArray(options) || !options.includes(intent.marker)) return;
    try {
      recheckIntent(intent, ctx);
      assertResolvedCurrent(resolved, intent, ctx);
      ctx.assertWrite();
    } catch (cause) {
      abortCause = cause;
      return false;
    }
    const flags = (source.flags ??= {});
    const moduleFlags =
      flags[MODULE_ID] && typeof flags[MODULE_ID] === "object"
        ? flags[MODULE_ID]
        : (flags[MODULE_ID] = {});
    moduleFlags.spellResolution = {
      resolutionId: intent.resolutionId,
      castMessageUuid: intent.selection.castMessageUuid,
      action: intent.selection.action,
      targetTokenUuid: intent.selection.targetTokenUuid,
    };
    if (typeof document?.updateSource === "function")
      document.updateSource({ flags: { [MODULE_ID]: moduleFlags } });
    return;
  };
  let createdCount = 0;
  const created = (document: any) => {
    const source = chatSource(document);
    const pf2e = source?.flags?.pf2e;
    const options = pf2e?.context?.options ?? pf2e?.origin?.rollOptions ?? [];
    if (
      Array.isArray(options) &&
      options.includes(intent.marker) &&
      document?.flags?.[MODULE_ID]?.spellResolution?.resolutionId ===
        intent.resolutionId
    ) {
      createdCount += 1;
      if (createdCount === 1 && owns(ctx.game?.messages, document))
        onMessage(document);
    }
  };
  const preId = hooks.on("preCreateChatMessage", preCreate);
  const createId = hooks.on("createChatMessage", created);
  return {
    remove: () => {
      hooks.off("preCreateChatMessage", preId ?? preCreate);
      hooks.off("createChatMessage", createId ?? created);
    },
    get abortCause() {
      return abortCause;
    },
    get createdCount() {
      return createdCount;
    },
  };
}

async function inspectResolution(
  selection: Selection,
  ctx: PF2eContext,
): Promise<ResolutionPreview> {
  const session = identity(ctx);
  const resolved = await resolveSelection(selection, ctx);
  const hash = await fingerprint(selection, resolved);
  const now = identity(ctx);
  if (
    now.worldId !== session.worldId ||
    now.userId !== session.userId ||
    now.sessionId !== session.sessionId ||
    canonical(currentFacts(resolved, ctx)) !== canonical(resolved.sourceFacts)
  )
    throw fail(
      "STALE_SPELL_RESOLUTION",
      "Native spell-resolution inputs changed during preview.",
    );
  const key = operationKey(selection);
  const ledger = inspectSpellResolutionLedger(ctx, key);
  if (ledger.blocked)
    throw fail(
      "SPELL_RESOLUTION_ALREADY_RECORDED",
      "This cast/action/target has already been attempted or recorded; native rolls cannot be repeated.",
      { status: ledger.status, resolutionId: ledger.resolutionId },
    );
  if (ledger.capacityRemaining <= 0)
    throw fail(
      "SPELL_RESOLUTION_LEDGER_FULL",
      "The spell-resolution ledger is full; records are never evicted.",
    );
  pruneIntents();
  const resolutionId = nonce("spell-resolution");
  const reviewToken = nonce("review");
  const marker = `foundry-vtt-mcp:spell-resolution:${resolutionId}`;
  const intent: ResolutionIntent = {
    resolutionId,
    reviewToken,
    selection,
    ...session,
    expectedCombat: resolved.expectedCombat,
    operationKey: key,
    fingerprint: hash,
    marker,
    expiresAt: Date.now() + INTENT_TTL_MS,
    rollClass: resolved.rollClass,
    used: false,
  };
  assertResolvedCurrent(resolved, intent, ctx);
  intents.set(resolutionId, intent);
  return {
    resolutionId,
    reviewToken,
    expiresAt: new Date(intent.expiresAt).toISOString(),
    selection: clone(selection),
    expectedCombat: resolved.expectedCombat,
    caster: { tokenUuid: resolved.token.uuid, actorUuid: resolved.actor.uuid },
    target: {
      tokenUuid: resolved.targetToken.uuid,
      actorUuid: resolved.targetActor.uuid,
    },
    cast: {
      castId: resolved.castRecord.castId,
      messageUuid: resolved.castRecord.chatMessageUuid,
      spellUuid: resolved.spell.uuid,
      entryUuid: resolved.entry.uuid,
      rank: resolved.castRecord.rank,
    },
    native: {
      attackNumber:
        selection.action === "attack" ? selection.attackNumber : null,
      saveStatistic: resolved.saveStatistic,
      dc: resolved.dc,
      spellcastingCheckModifier:
        resolved.rankSpell.spellcasting?.statistic?.check?.mod ?? null,
      targetSaveModifier: resolved.saveStatistic
        ? (resolved.targetActor.saves?.[resolved.saveStatistic]?.check?.mod ??
          null)
        : null,
      targetIndependentDamage: resolved.targetIndependentDamage,
      outcomeScaling: false,
    },
    ledger: { capacityRemaining: ledger.capacityRemaining },
    readOnly: true,
    executesNothing: true,
  };
}

function validateCreatedMessage(
  message: any,
  resolved: Resolved,
  intent: ResolutionIntent,
  roll: any,
  ctx: PF2eContext,
) {
  if (
    !message ||
    !owns(ctx.game?.messages, message) ||
    !bounded(message.uuid) ||
    !speakerMatches(
      message,
      intent.selection.action === "save"
        ? resolved.targetToken
        : resolved.token,
      intent.selection.action === "save"
        ? resolved.targetActor
        : resolved.actor,
    ) ||
    !sameMessageMode(message, intent.selection.messageMode) ||
    !visibilityMatches(message, intent.selection.messageMode, ctx)
  )
    throw fail(
      "NATIVE_ROLL_UNCONFIRMED",
      "Native spell resolution did not produce a current world message with the reviewed speaker and visibility.",
    );
  const flags = message.flags?.pf2e;
  const origin = flags?.origin;
  const markerInMessage =
    flags?.context?.options?.includes?.(intent.marker) ||
    origin?.rollOptions?.includes?.(intent.marker);
  if (
    !markerInMessage ||
    origin?.uuid !== resolved.spell.uuid ||
    origin?.castRank !== resolved.castRecord.rank ||
    message.flags?.[MODULE_ID]?.spellResolution?.resolutionId !==
      intent.resolutionId
  )
    throw fail(
      "NATIVE_ROLL_UNCONFIRMED",
      "Native roll message origin, rank, or bridge correlation does not match the reviewed spell operation.",
    );
  const total = finiteRoll(roll);
  const type = intent.selection.action === "damage" ? "damage" : "check";
  if (
    resolved.rollClass.name !==
      (type === "damage" ? "DamageRoll" : "CheckRoll") ||
    !(roll instanceof resolved.rollClass) ||
    (roll?.evaluated !== true && roll?._evaluated !== true)
  )
    throw fail(
      "NATIVE_ROLL_UNCONFIRMED",
      "PF2e did not return the configured, evaluated native roll class.",
    );
  const rollData = (value: any) => {
    try {
      return typeof value?.toJSON === "function"
        ? canonical(value.toJSON())
        : canonical({
            formula: value?.formula,
            total: value?.total,
            terms: value?.terms,
          });
    } catch {
      return null;
    }
  };
  if (
    total === null ||
    !Array.isArray(message.rolls) ||
    !message.rolls.some(
      (candidate: any) =>
        Number.isFinite(candidate?.total) &&
        candidate.total === total &&
        candidate.constructor?.name === roll.constructor?.name &&
        rollData(candidate) === rollData(roll),
    )
  )
    throw fail(
      "NATIVE_ROLL_UNCONFIRMED",
      "The native spell roll or created message has no matching serialized evaluated roll.",
    );
  const context = flags?.context;
  if (type === "check") {
    const expectedType =
      intent.selection.action === "save" ? "saving-throw" : "attack-roll";
    const expectedAction = "cast-a-spell";
    const rollerToken =
      intent.selection.action === "save"
        ? resolved.targetToken
        : resolved.token;
    const rollerActor =
      intent.selection.action === "save"
        ? resolved.targetActor
        : resolved.actor;
    if (
      context?.type !== expectedType ||
      context?.action !== expectedAction ||
      context?.actor !== rollerActor.id ||
      context?.token !== rollerToken.id ||
      context?.origin?.actor !== resolved.actor.uuid ||
      context?.origin?.token !== resolved.token.uuid ||
      context?.target?.actor !== resolved.targetActor.uuid ||
      context?.target?.token !== resolved.targetToken.uuid
    )
      throw fail(
        "NATIVE_ROLL_UNCONFIRMED",
        "Native check type, action, origin and target flags do not match the reviewed tokens.",
      );
    if (
      intent.selection.action === "save" &&
      context?.dc?.value !== resolved.dc
    )
      throw fail(
        "NATIVE_ROLL_UNCONFIRMED",
        "Native save card DC does not match the reviewed current spell DC.",
      );
  } else if (
    context?.type !== "damage-roll" ||
    context?.actor !== resolved.actor.id ||
    context?.token !== resolved.token.id ||
    (resolved.targetIndependentDamage
      ? context?.target !== null
      : context?.target?.actor !== resolved.targetActor.uuid ||
        context?.target?.token !== resolved.targetToken.uuid)
  )
    throw fail(
      "NATIVE_ROLL_UNCONFIRMED",
      "Native damage origin and target context do not match the explicit target or target-independent base-damage workflow.",
    );
  return {
    messageUuid: message.uuid,
    rollType: type as "check" | "damage",
    rollTotal: total,
  };
}

async function makeDamageSpell(
  resolved: Resolved,
  intent: ResolutionIntent,
  ctx: PF2eContext,
  validate: () => Promise<Resolved>,
) {
  let ephemeral: any = null;
  if (resolved.rankSpell !== resolved.spell) ephemeral = resolved.rankSpell;
  else {
    try {
      ephemeral = resolved.spell.clone({}, { keepId: true });
    } catch {
      ephemeral = null;
    }
    if (ephemeral && ephemeral !== resolved.spell)
      ephemeral.original = resolved.spell;
  }
  if (
    !ephemeral ||
    ephemeral === resolved.spell ||
    ephemeral.uuid !== resolved.spell.uuid ||
    ephemeral.original !== resolved.spell ||
    ephemeral.parentItem ||
    Number(ephemeral.rank) !== resolved.castRecord.rank
  )
    throw fail(
      "NATIVE_VARIANT_INVALID",
      "Could not create an isolated native spell representation for damage rolling.",
    );
  const nativeGetDamage = ephemeral.getDamage;
  if (typeof nativeGetDamage !== "function")
    throw fail(
      "NATIVE_DAMAGE_UNAVAILABLE",
      "Native spell damage preparation is unavailable.",
    );
  ephemeral.getDamage = async (options: any = {}) => {
    const result = await nativeGetDamage.call(ephemeral, {
      ...options,
      target: resolved.targetIndependentDamage ? null : resolved.targetToken,
      messageMode: intent.selection.messageMode,
      skipDialog: true,
    });
    const current = await validate();
    const nativeOriginItemUuid = result?.context?.self?.item?.uuid;
    if (
      !result?.context ||
      result.context.self?.token !== current.token ||
      result.context.self?.actor?.uuid !== current.actor.uuid ||
      nativeOriginItemUuid !== current.rankSpell.uuid ||
      (current.targetIndependentDamage
        ? result.context.target !== null
        : result.context.target?.token?.uuid !== current.targetToken.uuid ||
          result.context.target?.actor?.uuid !== current.targetActor.uuid)
    )
      throw fail(
        "NATIVE_DAMAGE_CONTEXT_MISMATCH",
        "PF2e native damage preparation resolved a different origin or target.",
      );
    if (
      !result.context.options ||
      typeof result.context.options.add !== "function"
    )
      throw fail(
        "NATIVE_DAMAGE_CONTEXT_MISMATCH",
        "PF2e native damage context cannot preserve the correlation option.",
      );
    result.context.options.add(intent.marker);
    assertResolvedCurrent(current, intent, ctx);
    return result;
  };
  return ephemeral;
}

async function executeResolution(
  tool: Exclude<ResolutionTool, "pf2e_inspect_spell_resolution">,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<ConfirmedResolutionResponse> {
  const action =
    tool === "pf2e_roll_spell_attack"
      ? "attack"
      : tool === "pf2e_roll_spell_save"
        ? "save"
        : "damage";
  const selection = validateSelection(args, action);
  const resolutionId = String(args.resolutionId ?? ""),
    reviewToken = String(args.reviewToken ?? "");
  if (!bounded(resolutionId, 128) || !bounded(reviewToken, 128))
    throw fail("INVALID_INPUT", "resolutionId and reviewToken are required.");
  const intent = intents.get(resolutionId);
  if (!intent || intent.expiresAt <= Date.now())
    throw fail(
      "SPELL_RESOLUTION_UNKNOWN",
      "Spell-resolution intent is unknown, expired, or lost on reload.",
    );
  if (
    intent.reviewToken !== reviewToken ||
    intent.operationKey !== operationKey(selection) ||
    canonical(intent.selection) !== canonical(selection)
  )
    throw fail(
      "SPELL_RESOLUTION_MISMATCH",
      "The exact previewed selection, action, or review token is required.",
    );
  if (
    canonical(intent.expectedCombat) !== canonical(args.expectedCombat ?? null)
  )
    throw fail(
      "SPELL_RESOLUTION_MISMATCH",
      "expectedCombat differs from the preview.",
    );
  if (intent.used)
    throw fail(
      "SPELL_RESOLUTION_USED",
      "This spell-resolution intent has already been attempted.",
    );
  recheckIntent(intent, ctx);
  ctx.assertWrite();
  intent.used = true;
  const preview = await resolveFresh(intent, ctx);
  recheckIntent(intent, ctx);
  assertResolvedCurrent(preview, intent, ctx);
  ctx.assertWrite();
  const reservation: SpellResolutionReservation = {
    resolutionId,
    operationKey: intent.operationKey,
    sessionId: intent.sessionId,
    castId: preview.castRecord.castId,
    castMessageUuid: selection.castMessageUuid,
    action,
    messageMode: selection.messageMode,
    casterActorUuid: preview.actor.uuid,
    targetActorUuid: preview.targetActor.uuid,
    casterTokenUuid: preview.token.uuid,
    targetTokenUuid: preview.targetToken.uuid,
    attackNumber: action === "attack" ? selection.attackNumber : null,
    reviewToken: intent.reviewToken,
    fingerprint: intent.fingerprint,
  };
  await reserveSpellResolution(ctx, reservation);
  const run = async (): Promise<ConfirmedResolutionExecution> => {
    let message: any = null,
      callbackMessage: any = null,
      nativeOutcome: unknown = null,
      roll: any = null,
      hookHandle: ReturnType<typeof hookMessage> | null = null;
    try {
      let current = await resolveFresh(intent, ctx);
      ctx.assertWrite();
      hookHandle = hookMessage(ctx, intent, current, (candidate: any) => {
        message = candidate;
      });
      const callback = (_roll: any, _outcome: unknown, nativeMessage: any) => {
        if (_outcome !== undefined) nativeOutcome = _outcome;
        if (nativeMessage) callbackMessage = nativeMessage;
      };
      if (action === "attack") {
        assertResolvedCurrent(current, intent, ctx);
        ctx.assertWrite();
        roll = await current.rankSpell.rollAttack(
          null,
          selection.attackNumber,
          {
            token: current.token,
            target: current.targetActor,
            messageMode: selection.messageMode,
            skipDialog: true,
            createMessage: true,
            extraRollOptions: [intent.marker],
            identifier: intent.resolutionId,
            callback,
          } as any,
        );
      } else if (action === "save") {
        assertResolvedCurrent(current, intent, ctx);
        ctx.assertWrite();
        roll = await current.targetActor.saves[
          current.saveStatistic!
        ].check.roll({
          type: "saving-throw",
          action: "cast-a-spell",
          actor: current.targetActor,
          token: current.targetToken,
          origin: current.actor,
          item: current.rankSpell,
          dc: { value: current.dc },
          messageMode: selection.messageMode,
          skipDialog: true,
          createMessage: true,
          extraRollOptions: [intent.marker],
          identifier: intent.resolutionId,
          callback,
        } as any);
      } else {
        const scoped = await makeDamageSpell(current, intent, ctx, () =>
          resolveFresh(intent, ctx),
        );
        current = await resolveFresh(intent, ctx);
        assertResolvedCurrent(current, intent, ctx);
        ctx.assertWrite();
        const element = (globalThis as any).document?.createElement?.("span");
        if (!element)
          throw fail(
            "NATIVE_DAMAGE_UNAVAILABLE",
            "A native spell-roll context could not be created.",
          );
        element.dataset.castRank = String(current.castRecord.rank);
        const event = { target: element, currentTarget: element } as any;
        assertResolvedCurrent(current, intent, ctx);
        ctx.assertWrite();
        roll = await scoped.rollDamage(event, undefined);
      }
      hookHandle?.remove();
      current = await resolveFresh(intent, ctx);
      if (
        !message ||
        !roll ||
        hookHandle?.createdCount !== 1 ||
        (callbackMessage && callbackMessage !== message)
      )
        throw fail(
          "NATIVE_ROLL_UNCONFIRMED",
          "PF2e did not return one actual correlated world message and the expected native roll.",
        );
      const outcome = validateCreatedMessage(
        message,
        current,
        intent,
        roll,
        ctx,
      );
      recheckIntent(intent, ctx);
      ctx.assertWrite();
      const degreeOfSuccess: DegreeOfSuccess | null =
        action === "damage"
          ? null
          : typeof nativeOutcome === "string" &&
              (nativeOutcome === "criticalFailure" ||
                nativeOutcome === "failure" ||
                nativeOutcome === "success" ||
                nativeOutcome === "criticalSuccess")
            ? nativeOutcome
            : typeof nativeOutcome === "number" &&
                Number.isInteger(nativeOutcome) &&
                nativeOutcome >= 0 &&
                nativeOutcome <= 3
              ? (["criticalFailure", "failure", "success", "criticalSuccess"] as const)[
                  nativeOutcome
                ]
              : null;
      return {
        __auditOutcome: outcome,
        resolution: "confirmed",
        resolutionId,
        action,
        castMessageUuid: selection.castMessageUuid,
        messageUuid: outcome.messageUuid,
        rollType: outcome.rollType,
        total: outcome.rollTotal,
        degreeOfSuccess,
        casterTokenUuid: current.token.uuid,
        targetTokenUuid: current.targetToken.uuid,
        rank: current.castRecord.rank,
        attackNumber: action === "attack" ? selection.attackNumber : null,
        saveStatistic: current.saveStatistic,
        dc: current.dc,
        targetIndependentDamage: current.targetIndependentDamage,
        outcomeScaling: false,
      };
    } catch (cause) {
      hookHandle?.remove();
      throw fail(
        "SPELL_RESOLUTION_NATIVE_ATTEMPT_FAILED",
        "The native spell-resolution attempt ended without a confirmed result.",
        {
          resolutionId,
          messageUuid: messageUuid(message),
          rollType: roll ? (action === "damage" ? "damage" : "check") : null,
          rollTotal: finiteRoll(roll),
          causeCode: (cause as any)?.code ?? null,
        } satisfies ResolutionUncertainPartial,
      );
    }
  };
  let nativeResult: ConfirmedResolutionExecution;
  if (preview.expectedCombat) {
    const combat =
      ctx.game?.combats?.get?.(
        preview.expectedCombat.encounterUuid.split(".").at(-1) ?? "",
      ) ??
      values(ctx.game?.combats).find(
        (entry) => entry.uuid === preview.expectedCombat!.encounterUuid,
      );
    try {
      if (!combat)
        throw fail("STALE_TURN", "The previewed encounter no longer exists.");
      nativeResult = await withCombatLock(combat, ctx, run);
    } catch (cause) {
      return finalizeResolutionUncertain(ctx, resolutionId, cause);
    }
  } else {
    try {
      nativeResult = await run();
    } catch (cause) {
      return finalizeResolutionUncertain(ctx, resolutionId, cause);
    }
  }
  const { __auditOutcome, ...response } = nativeResult;
  try {
    recheckIntent(intent, ctx);
    await finalizeSpellResolution(ctx, resolutionId, "confirmed", __auditOutcome);
  } catch (cause) {
    throw fail("PARTIAL_FAILURE", "The native resolution result is known, but final audit status must be inspected before continuing.", {
      resolutionId,
      messageUuid: __auditOutcome?.messageUuid ?? null,
      rollType: __auditOutcome?.rollType ?? null,
      rollTotal: __auditOutcome?.rollTotal ?? null,
      auditStatus: (cause as any)?.partial?.status ?? null,
      auditStateKnown: (cause as any)?.partial?.known === true,
      causeCode: (cause as any)?.code ?? null,
    } satisfies ResolutionAuditFailurePartial);
  }
  return response;
}

async function finalizeResolutionUncertain(
  ctx: PF2eContext,
  resolutionId: string,
  cause: unknown,
): Promise<never> {
  const partial = (cause as any)?.partial ?? {};
  try {
    const observed = await finalizeSpellResolution(ctx, resolutionId, "uncertain", {
      messageUuid: partial.messageUuid ?? null,
      rollType: partial.rollType ?? null,
      rollTotal: partial.rollTotal ?? null,
    });
    throw fail("PARTIAL_FAILURE", "Native spell resolution may have occurred; inspect chat and spellResolutions before retrying.", {
      resolutionId, messageUuid: partial.messageUuid ?? null, rollType: observed.rollType,
      rollTotal: observed.rollTotal, auditStatus: observed.status, auditStateKnown: true,
      causeCode: (cause as any)?.code ?? null,
    } satisfies ResolutionAuditFailurePartial);
  } catch (auditError) {
    if ((auditError as any)?.code === "PARTIAL_FAILURE") throw auditError;
    throw fail("PARTIAL_FAILURE", "Native spell resolution may have occurred; inspect chat and spellResolutions before retrying.", {
      resolutionId, messageUuid: partial.messageUuid ?? (auditError as any)?.partial?.messageUuid ?? null,
      rollType: partial.rollType ?? null,
      rollTotal: partial.rollTotal ?? null,
      auditStatus: (auditError as any)?.partial?.status ?? null,
      auditStateKnown: (auditError as any)?.partial?.known === true,
      causeCode: (auditError as any)?.code ?? (cause as any)?.code ?? null,
    } satisfies ResolutionAuditFailurePartial);
  }
}

export async function handlePF2eSpellResolution(
  tool: ResolutionTool,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_inspect_spell_resolution")
    return inspectResolution(validateSelection(args), ctx);
  if (
    tool === "pf2e_roll_spell_attack" ||
    tool === "pf2e_roll_spell_save" ||
    tool === "pf2e_roll_spell_damage"
  )
    return executeResolution(tool, args, ctx);
  throw fail("UNSUPPORTED_TOOL", "Unsupported PF2e spell resolution tool.");
}
