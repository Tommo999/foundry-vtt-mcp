import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";
import { nativeCompendiumSourceUuid } from "./pf2e-native-source";
import { resolvePF2eTarget } from "./pf2e-target";
import { entriesFor, isCurrentNativeEntry } from "./pf2e-spellcasting";
import { readConfirmedSpellCastByMessage } from "./pf2e-spell-ledger";
import { readSpellReconciliationLedger, spellAuditSourceSnapshot } from "./pf2e-spell-reconciliation-ledger";
import { withCombatLock } from "./encounters";
import {
  finalizeSpellEffect,
  readSpellEffectLedger,
  reserveSpellEffect,
  spellEffectLedgerAvailability,
  spellEffectSemanticKey,
  type SpellEffectChoice,
} from "./pf2e-spell-effect-ledger";

const MODULE_ID = "foundry-vtt-mcp";
const INTENT_TTL = 5 * 60_000;
const MAX_INTENTS = 500;
const intents = new Map<string, SpellEffectIntent>();

type CombatSnapshot = {
  encounterUuid: string;
  round: number;
  turn: number;
  combatantUuid: string;
};
type SpellEffectSelection = {
  castMessageUuid: string;
  casterTokenUuid: string;
  targetTokenUuid: string;
  choice: SpellEffectChoice;
};
type SpellEffectIntent = {
  applicationId: string;
  reviewToken: string;
  selection: SpellEffectSelection;
  semanticKey: string;
  fingerprint: string;
  sourceFacts: string;
  expectedOperation: "create-effect" | "create-condition" | "increase-condition" | "already-satisfied";
  beforeConditionUuid: string | null;
  beforeConditionValue: number | null;
  worldId: string;
  userId: string;
  sessionId: string;
  expectedCombat: CombatSnapshot | null;
  expiresAt: number;
  refs: Record<string, any>;
};

function fail(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), { code, ...(partial === undefined ? {} : { partial }) });
}
function bounded(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function values(collection: any): any[] {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (collection && typeof collection.values === "function") return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}
function owns(collection: any, document: any): boolean {
  return Boolean(collection && document && (typeof collection.get === "function"
    ? collection.get(document.id) === document
    : values(collection).includes(document)));
}
function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}
function sourceOf(document: any): any {
  if (typeof document?.toObject === "function") return clone(document.toObject());
  if (document?._source) return clone(document._source);
  return null;
}
function actorPostMutationSource(document: any): any {
  const source = sourceOf(document);
  if (!source || typeof source !== "object") return source;
  // Native Actor embedded-item writes legitimately change this projection and
  // document stats. Keep the Actor's identity, system, flags and other source
  // facts bound while excluding only those expected mutation surfaces.
  delete source.items;
  delete source._stats;
  return source;
}
function tokenPostMutationSource(document: any): any {
  const source = sourceOf(document);
  if (!source || typeof source !== "object") return source;
  // Synthetic Actor item changes are reflected in TokenDocument.delta.items.
  // Preserve the rest of the token source, including actorLink and placement.
  delete source._stats;
  if (source.delta && typeof source.delta === "object") {
    delete source.delta._stats;
    delete source.delta.items;
  }
  return source;
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
async function digest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw fail("CRYPTO_UNAVAILABLE", "Secure spell-effect preview fingerprints are unavailable.");
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function nonce(prefix: string): string {
  if (!globalThis.crypto?.getRandomValues) throw fail("CRYPTO_UNAVAILABLE", "Secure spell-effect review identifiers are unavailable.");
  return `${prefix}-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function identity(ctx: PF2eContext) {
  const worldId = ctx.game?.world?.id, userId = ctx.game?.user?.id, sessionId = ctx.sessionId;
  if (!bounded(worldId, 128) || !bounded(userId, 128) || !bounded(sessionId, 256) || ctx.game?.user?.isGM !== true)
    throw fail("SESSION_CHANGED", "A current paired GM world and session are required for spell-effect inspection.");
  return { worldId, userId, sessionId };
}
function currentActorForToken(actor: any, token: any, ctx: PF2eContext): boolean {
  if (!actor || actor.documentName !== "Actor" || actor.compendium) return false;
  if (token && token.actor !== actor) return false;
  if (!actor.parent && actor.isEmbedded !== true) return owns(ctx.game?.actors, actor);
  return token?.actor === actor && (actor.parent === token || actor.token === token || actor.token?.document === token);
}
function visibilityMatches(message: any, mode: string, ctx: PF2eContext): boolean {
  const whisper = Array.isArray(message?.whisper) ? [...message.whisper].sort() : [];
  const gms = values(ctx.game?.users).filter((user) => user?.isGM === true).map((user) => user.id).sort();
  const self = bounded(ctx.game?.user?.id) ? [ctx.game.user.id] : [];
  if (mode === "public") return message?.blind !== true && whisper.length === 0;
  if (mode === "gm") return message?.blind !== true && canonical(whisper) === canonical(gms);
  if (mode === "blind") return message?.blind === true && canonical(whisper) === canonical(gms);
  return mode === "self" && message?.blind !== true && canonical(whisper) === canonical(self);
}
function currentCombat(scene: any, casterToken: any, ctx: PF2eContext): CombatSnapshot | null {
  const combat = ctx.game?.combat;
  if (!combat || combat.started !== true) return null;
  const combatScene = typeof combat.scene === "object" ? combat.scene : ctx.game?.scenes?.get?.(combat.sceneId ?? combat.scene);
  if (!owns(ctx.game?.combats, combat) || combat.isActive !== true || !combatScene || !owns(ctx.game?.scenes, combatScene) ||
    combatScene.documentName !== "Scene" || combatScene.compendium || combatScene.parent ||
    !Number.isSafeInteger(combat.round) || combat.round < 1 || !Number.isSafeInteger(combat.turn) ||
    combat.turn < 0 || !bounded(combat.uuid))
    throw fail("INVALID_COMBAT", "The current same-scene combat is not a current active world encounter.");
  const combatants = values(combat.combatants);
  const turns = Array.isArray(combat.turns) ? combat.turns : null;
  if (!turns || combat.turn >= turns.length)
    throw fail("INVALID_COMBAT", "The current combat turn is outside the owned combatant list.");
  const active = turns[combat.turn];
  if (!active || combat.combatant !== active || !combatants.includes(active) || !owns(combat.combatants, active) || !bounded(active.uuid) ||
    (active.token?.uuid ?? active.tokenUuid) === undefined)
    throw fail("INVALID_COMBAT", "The current combatant is not the owned tracker row at the active turn.");
  if (combatScene !== scene) return null;
  if ((active.token?.uuid ?? active.tokenUuid) !== casterToken.uuid)
    throw fail("STALE_TURN", "The confirmed caster must be the current combatant while its scene combat is active.");
  return { encounterUuid: combat.uuid, round: combat.round, turn: combat.turn, combatantUuid: active.uuid };
}
function assertCombatSame(expected: CombatSnapshot | null, scene: any, token: any, ctx: PF2eContext): void {
  const current = currentCombat(scene, token, ctx);
  if (canonical(expected) !== canonical(current)) throw fail("STALE_TURN", "The current combat tracker changed after spell-effect preview.");
}
function spellDuration(source: any): any {
  const duration = source?.system?.duration;
  if (!duration || typeof duration !== "object") return null;
  return {
    value: Number.isFinite(duration.value) ? duration.value : null,
    unit: typeof duration.unit === "string" ? duration.unit : null,
    expiry: typeof duration.expiry === "string" ? duration.expiry : null,
    sustained: typeof duration.sustained === "boolean" ? duration.sustained : null,
  };
}
const IMPORT_OPTIONS = { keepId: false, clearOwnership: true, clearFolder: true, clearSort: true, clearState: true };
function convertedEffectFacts(data: any): any {
  const facts = clone(data);
  if (facts && typeof facts === "object") {
    delete facts._id;
    delete facts.folder;
    delete facts.ownership;
    delete facts.sort;
    if (facts._stats && typeof facts._stats === "object") {
      const stats = facts._stats;
      facts._stats = {
        compendiumSource: typeof stats.compendiumSource === "string" ? stats.compendiumSource : null,
        coreVersion: typeof stats.coreVersion === "string" ? stats.coreVersion : null,
        systemId: typeof stats.systemId === "string" ? stats.systemId : null,
        systemVersion: typeof stats.systemVersion === "string" ? stats.systemVersion : null,
      };
    }
  }
  return facts;
}
function nativeEffectData(data: any): any {
  const imported = clone(data);
  if (imported && typeof imported === "object") {
    delete imported._id;
    delete imported.folder;
    delete imported.ownership;
    delete imported.sort;
  }
  return imported;
}
async function effectChoice(ctx: PF2eContext, document: any, choice: Extract<SpellEffectChoice, { kind: "effect" }>): Promise<{ source: any; templateSource: any; importedData: any; convertedFacts: any; summary: any }> {
  const source = ctx.game?.items?.fromCompendium;
  const pack = document?.compendium;
  if (!document || document.documentName !== "Item" || document.type !== "effect" || document.parent ||
    !pack || !document.pack || ctx.game?.packs?.get?.(document.pack) !== pack || pack.get?.(document.id) !== document ||
    pack.metadata?.system !== "pf2e" || typeof source !== "function")
    throw fail("INVALID_EFFECT_CHOICE", "Choose an exact root PF2e compendium Item of type effect.");
  const data = await source.call(ctx.game.items, document, IMPORT_OPTIONS);
  if (!data || data.type !== "effect" || !data.system || typeof data.system !== "object")
    throw fail("INVALID_EFFECT_CHOICE", "The selected compendium effect could not be converted by the native importer.");
  return {
    source: document,
    templateSource: sourceOf(document),
    importedData: nativeEffectData(data),
    convertedFacts: convertedEffectFacts(data),
    summary: {
      kind: "effect", uuid: choice.uuid, name: String(document.name ?? "").slice(0, 160),
      slug: bounded(document.slug, 80) ? document.slug : null,
      duration: spellDuration(data),
      traitCount: Array.isArray(data.system?.traits?.value) ? Math.min(100, data.system.traits.value.length) : null,
      ruleCount: Array.isArray(data.system?.rules) ? Math.min(100, data.system.rules.length) : null,
      grantsCount: data.flags?.pf2e?.itemGrants && typeof data.flags.pf2e.itemGrants === "object"
        ? Math.min(100, Object.keys(data.flags.pf2e.itemGrants).length) : 0,
    },
  };
}
function restrictedGrant(actor: any, item: any): boolean {
  const itemGrants = item?.flags?.pf2e?.itemGrants;
  const ownRestricted = itemGrants && typeof itemGrants === "object" && Object.values(itemGrants).some((grant: any) => grant?.onDelete === "restrict");
  const parentId = item?.flags?.pf2e?.grantedBy?.id ?? item?.system?.references?.parent?.id;
  const parent = parentId ? actor.items?.get?.(parentId) ?? actor.conditions?.get?.(parentId) : null;
  const parentGrants = parent?.flags?.pf2e?.itemGrants;
  const parentRestricted = parentGrants && typeof parentGrants === "object" && Object.values(parentGrants).some((grant: any) => grant?.id === item.id && grant?.onDelete === "restrict");
  return Boolean(ownRestricted || parentRestricted);
}
function conditionChoice(ctx: PF2eContext, actor: any, choice: Extract<SpellEffectChoice, { kind: "condition" }>): any {
  if (choice.slug === "persistent-damage" || choice.slug.startsWith("persistent-damage-"))
    throw fail("UNSUPPORTED_CONDITION", "Persistent damage is not an effect-selection outcome; use the damage workflow.");
  const manager = ctx.game?.pf2e?.ConditionManager;
  if (typeof manager?.getCondition !== "function" || typeof manager?.updateConditionValue !== "function" || typeof actor.increaseCondition !== "function")
    throw fail("NATIVE_CONDITION_API_UNAVAILABLE", "PF2e native condition APIs are unavailable.");
  const definition = manager.getCondition(choice.slug);
  if (!definition || definition.slug !== choice.slug)
    throw fail("INVALID_CONDITION_CHOICE", "The condition slug is not a current native PF2e condition.");
  const definitionSource = sourceOf(definition);
  const definitionValue = definitionSource?.system?.value;
  const valued = definitionValue?.isValued === true;
  if (choice.value === null && valued || choice.value !== null && !valued)
    throw fail("INVALID_CONDITION_VALUE", "The selected value shape does not match the native condition's valued or unvalued schema.");
  const nativeConditions = actor.getCondition?.(choice.slug, { all: true });
  const existingRows = Array.isArray(nativeConditions) ? nativeConditions : nativeConditions ? [nativeConditions] : [];
  if (existingRows.length > 1)
    throw fail("CONDITION_STATE_AMBIGUOUS", "Multiple matching native condition Items prevent an exact spell-effect preview.");
  const existing = existingRows[0] ?? null;
  if (existing && existing.active !== true)
    throw fail("CONDITION_STATE_INACTIVE", "The matching native condition Item is inactive; the preview cannot assume an exact existing or absent outcome.");
  const effective = actor.getCondition?.(choice.slug);
  if (existing && effective !== existing || !existing && effective)
    throw fail("CONDITION_STATE_AMBIGUOUS", "The native effective condition does not identify the exact current matching Item.");
  const currentValue = existing?.value ?? existing?.system?.value?.value ?? null;
  if (existing && valued && typeof currentValue !== "number")
    throw fail("CONDITION_STATE_UNAVAILABLE", "The current value of the selected native condition is unavailable.");
  if (existing && valued && (!Number.isSafeInteger(currentValue) || currentValue < 0))
    throw fail("CONDITION_STATE_UNAVAILABLE", "The current native condition value is malformed.");
  if (existing && choice.value !== null && typeof currentValue === "number" && choice.value < currentValue)
    throw fail("CONDITION_DECREASE_REFUSED", "Spell-effect selection cannot lower an existing condition.");
  const locked = Boolean(existing?.isLocked);
  const readOnly = Boolean(existing?.readonly || existing?.inMemoryOnly || existing?.isInMemory);
  const restricted = existing ? restrictedGrant(actor, existing) : false;
  const nativeMax = Number.isSafeInteger(actor.attributes?.[choice.slug]?.max) ? actor.attributes[choice.slug].max : null;
  if (existing && ((choice.value === null && currentValue === null) || choice.value === currentValue))
    return {
      definitionSource,
      existing,
      existingSource: sourceOf(existing),
      summary: {
        kind: "condition", slug: choice.slug, name: String(definition.name ?? "").slice(0, 160), valued,
        requestedValue: choice.value,
        current: { uuid: existing.uuid ?? null, id: existing.id ?? null, value: currentValue, locked, readOnly, restricted },
        expectedOperation: "already-satisfied", mutationAllowed: false, nativeMax,
      },
    };
  if (existing && (locked || readOnly || restricted))
    throw fail("CONDITION_RESTRICTED", "The selected condition is locked, granted, in-memory, or read-only and cannot be increased directly.");
  if (choice.value !== null && nativeMax !== null && choice.value > nativeMax)
    throw fail("INVALID_CONDITION_VALUE", "The selected value exceeds the current native condition cap.");
  return {
    definitionSource,
    existing,
    existingSource: existing ? sourceOf(existing) : null,
    summary: {
      kind: "condition", slug: choice.slug, name: String(definition.name ?? "").slice(0, 160), valued,
      requestedValue: choice.value,
      current: existing ? { uuid: existing.uuid ?? null, id: existing.id ?? null, value: currentValue, locked, readOnly, restricted } : null,
      expectedOperation: existing ? "updateConditionValue" : "increaseCondition",
      mutationAllowed: true, nativeMax,
    },
  };
}
function cleanExpiredIntents(now = Date.now()): void {
  for (const [id, intent] of intents) if (intent.expiresAt <= now) intents.delete(id);
}
function validateSelection(args: Record<string, unknown>): SpellEffectSelection {
  const choice = args.choice as any;
  const selection = {
    castMessageUuid: String(args.castMessageUuid ?? ""),
    casterTokenUuid: String(args.casterTokenUuid ?? ""),
    targetTokenUuid: String(args.targetTokenUuid ?? ""),
    choice,
  } as SpellEffectSelection;
  if (!bounded(selection.castMessageUuid) || !bounded(selection.casterTokenUuid) || !bounded(selection.targetTokenUuid) ||
    !choice || typeof choice !== "object" || Array.isArray(choice) ||
    (choice.kind === "effect" ? Object.keys(choice).sort().join("\n") !== ["kind", "uuid"].sort().join("\n") || !bounded(choice.uuid) || !choice.uuid.startsWith("Compendium.") :
      choice.kind !== "condition" || Object.keys(choice).sort().join("\n") !== ["kind", "slug", "value"].sort().join("\n") ||
      !bounded(choice.slug, 80) || !/^[a-z][a-z0-9-]*$/.test(choice.slug) || !(choice.value === null || Number.isSafeInteger(choice.value) && choice.value >= 1 && choice.value <= 100)))
    throw fail("INVALID_INPUT", "Spell-effect selection must provide exact cast/token UUIDs and one strict compendium effect or native condition choice.");
  return clone(selection);
}
function sameWorldIdentity(ctx: PF2eContext, intent: SpellEffectIntent): void {
  if (ctx.game?.world?.id !== intent.worldId) throw fail("WORLD_CHANGED", "The active world changed after spell-effect preview.");
  if (ctx.game?.user?.id !== intent.userId || ctx.game?.user?.isGM !== true || ctx.sessionId !== intent.sessionId)
    throw fail("SESSION_CHANGED", "The GM or paired session changed after spell-effect preview.");
}
function sourceRefsStillCurrent(ctx: PF2eContext, intent: SpellEffectIntent): void {
  sameWorldIdentity(ctx, intent);
  const { scene, message, castRecord, casterToken, casterActor, entry, spell, targetToken, targetActor, selectedSource } = intent.refs;
  const currentCastRecord = readConfirmedSpellCastByMessage(ctx, intent.selection.castMessageUuid);
  if (canonical(currentCastRecord) !== canonical(castRecord) ||
    casterToken.parent !== scene || targetToken.parent !== scene ||
    !owns(ctx.game?.scenes, scene) || !owns(scene.tokens, casterToken) || !owns(scene.tokens, targetToken) ||
    !owns(ctx.game?.messages, message) || !currentActorForToken(casterActor, casterToken, ctx) || !currentActorForToken(targetActor, targetToken, ctx) ||
    !entriesFor(casterActor).includes(entry) || !isCurrentNativeEntry(casterActor, entry) || !owns(casterActor.items, spell) ||
    (selectedSource && (!selectedSource.compendium || ctx.game?.packs?.get?.(selectedSource.pack) !== selectedSource.compendium || selectedSource.compendium.get?.(selectedSource.id) !== selectedSource)))
    throw fail("SPELL_EFFECT_SOURCE_CHANGED", "A reviewed spell, Actor, token, compendium or source-card document was replaced or removed.");
  if (canonical(sourceOf(message)) !== intent.refs.messageSource || canonical(sourceOf(casterActor)) !== intent.refs.casterActorSource ||
    canonical(sourceOf(casterToken)) !== intent.refs.casterTokenSource || canonical(sourceOf(entry)) !== intent.refs.entrySource ||
    canonical(sourceOf(spell)) !== intent.refs.spellSource || canonical(sourceOf(targetActor)) !== intent.refs.targetActorSource ||
    canonical(sourceOf(targetToken)) !== intent.refs.targetTokenSource ||
    selectedSource && canonical(sourceOf(selectedSource)) !== intent.refs.selectedSourceSource)
    throw fail("SPELL_EFFECT_SOURCE_CHANGED", "A reviewed native source changed after spell-effect preview.");
  if (castRecord.castId !== intent.refs.castRecord.castId || castRecord.status !== "confirmed")
    throw fail("SPELL_EFFECT_SOURCE_CHANGED", "The confirmed cast record changed after spell-effect preview.");
  if (intent.selection.choice.kind === "condition") {
    const conditionFacts = conditionChoice(ctx, targetActor, intent.selection.choice);
    if (canonical(conditionFacts.summary) !== canonical(intent.refs.choiceSummary) ||
      canonical(conditionFacts.definitionSource) !== canonical(intent.refs.choiceTemplateSource) ||
      conditionFacts.existing !== intent.refs.conditionDocument ||
      canonical(conditionFacts.existingSource) !== canonical(intent.refs.conditionSource))
      throw fail("SPELL_EFFECT_SOURCE_CHANGED", "The selected native condition or its current value/restrictions changed after spell-effect preview.");
  } else {
    const importFunction = ctx.game?.items?.fromCompendium;
    const currentImport = typeof importFunction === "function" ? importFunction.call(ctx.game.items, selectedSource, IMPORT_OPTIONS) : null;
    if (currentImport && typeof currentImport.then === "function")
      throw fail("NATIVE_IMPORT_RECHECK_UNSUPPORTED", "The native compendium converter cannot be synchronously rechecked after fingerprinting.");
    if (!currentImport || canonical(convertedEffectFacts(currentImport)) !== canonical(intent.refs.convertedChoiceSource))
      throw fail("SPELL_EFFECT_SOURCE_CHANGED", "The native compendium conversion changed after spell-effect preview.");
  }
  assertCombatSame(intent.expectedCombat, scene, casterToken, ctx);
}
async function inspectEffect(args: Record<string, unknown>, ctx: PF2eContext): Promise<any> {
  requirePF2e(ctx);
  const current = identity(ctx);
  const selection = validateSelection(args);
  const castRecord = readConfirmedSpellCastByMessage(ctx, selection.castMessageUuid);
  if (castRecord.worldId !== current.worldId || castRecord.actorUuid.split(".").length < 2 || castRecord.casterTokenUuid !== selection.casterTokenUuid)
    throw fail("INVALID_CAST_RECORD", "The selected actual-cast record is not bound to this world and caster token.");
  if (castRecord.targetTokenUuids.length > 0 && !castRecord.targetTokenUuids.includes(selection.targetTokenUuid))
    throw fail("INVALID_TARGET", "The target must be among the tokens recorded on the confirmed cast.");

  const message = await ctx.resolve(selection.castMessageUuid);
  if (!message || message.uuid !== selection.castMessageUuid || message.documentName !== "ChatMessage" || !owns(ctx.game?.messages, message))
    throw fail("INVALID_CAST_CARD", "castMessageUuid must identify a current world ChatMessage.");
  const messageSource = sourceOf(message);
  const origin = messageSource?.flags?.pf2e?.origin;
  const bridgeCast = messageSource?.flags?.[MODULE_ID]?.spellCast;
  const variant = origin?.variant;
  const noVariantOverlay = variant == null || typeof variant === "object" && Array.isArray(variant.overlays) && variant.overlays.length === 0;
  if (!Array.isArray(origin?.rollOptions) || !origin.rollOptions.includes("origin:action:slug:cast-a-spell") ||
    origin.uuid !== castRecord.spellUuid || origin.castRank !== castRecord.rank || !noVariantOverlay ||
    messageSource?.flags?.pf2e?.casting?.id !== castRecord.entryUuid.split(".").at(-1) || bridgeCast?.castId !== castRecord.castId ||
    !Array.isArray(bridgeCast?.targetTokenUuids) || canonical(bridgeCast.targetTokenUuids) !== canonical(castRecord.targetTokenUuids) || !visibilityMatches(message, castRecord.messageMode, ctx))
    throw fail("INVALID_CAST_CARD", "The native actual-cast card origin, rank, casting entry, visibility or Bridge correlation does not match the confirmed cast.");

  const casterToken = await ctx.resolve(selection.casterTokenUuid);
  const scene = casterToken?.parent;
  const casterActor = casterToken?.actor;
  if (!casterToken || casterToken.documentName !== "Token" || casterToken.uuid !== selection.casterTokenUuid ||
    !scene || scene.documentName !== "Scene" || scene.compendium || scene.parent || !owns(ctx.game?.scenes, scene) ||
    !owns(scene.tokens, casterToken) || !currentActorForToken(casterActor, casterToken, ctx) || casterActor.uuid !== castRecord.actorUuid ||
    message.speaker?.scene !== scene.id || message.speaker?.token !== casterToken.id || message.speaker?.actor !== casterActor.id)
    throw fail("INVALID_CASTER", "The confirmed caster token, world Actor, scene and native chat speaker must match exactly.");
  const { target: targetToken, actor: targetActor } = await resolvePF2eTarget(ctx, selection.targetTokenUuid);
  if (targetToken.documentName !== "Token" || targetToken.uuid !== selection.targetTokenUuid || targetToken.parent !== scene ||
    !owns(scene.tokens, targetToken) || !currentActorForToken(targetActor, targetToken, ctx))
    throw fail("INVALID_TARGET", "The selected target must be one explicit current same-scene world token and Actor.");
  if (targetActor.type === "party" || targetActor.type === "loot")
    throw fail("INVALID_TARGET", "This PF2e Actor type does not accept spell effects or conditions.");

  const entry = await ctx.resolve(castRecord.entryUuid);
  const spell = await ctx.resolve(castRecord.spellUuid);
  if (!entry || entry.uuid !== castRecord.entryUuid || entry.type !== "spellcastingEntry" || entry.actor !== casterActor ||
    !isCurrentNativeEntry(casterActor, entry) || entry.isRitual || entry.isEphemeral || !entriesFor(casterActor).includes(entry) ||
    !spell || spell.uuid !== castRecord.spellUuid || spell.type !== "spell" || spell.actor !== casterActor || !owns(casterActor.items, spell) ||
    entry.spells?.get?.(spell.id) !== spell || spell.system?.location?.value !== entry.id || spell.original || spell.isVariant === true || spell.parentItem)
    throw fail("INVALID_CAST_SOURCE", "The confirmed regular spell and casting entry must remain the exact current owned documents.");

  let selectedSource: any = null;
  let choiceSummary: any;
  let choiceTemplateSource: any = null;
  let convertedChoiceSource: any = null;
  let convertedChoiceData: any = null;
  let conditionDocument: any = null;
  let conditionSource: any = null;
  if (selection.choice.kind === "effect") {
    selectedSource = await ctx.resolve(selection.choice.uuid);
    const result = await effectChoice(ctx, selectedSource, selection.choice);
    choiceSummary = result.summary;
    choiceTemplateSource = result.templateSource;
    convertedChoiceData = result.importedData;
    convertedChoiceSource = result.convertedFacts;
  } else {
    const result = conditionChoice(ctx, targetActor, selection.choice);
    choiceSummary = result.summary;
    choiceTemplateSource = result.definitionSource;
    conditionDocument = result.existing;
    conditionSource = result.existingSource;
  }
  const expectedCombat = currentCombat(scene, casterToken, ctx);
  const semanticKey = spellEffectSemanticKey(selection.castMessageUuid, targetActor.uuid, selection.choice);
  const ledger = readSpellEffectLedger(ctx);
  const availability = spellEffectLedgerAvailability(ledger, semanticKey);
  if (availability.remaining <= 0) throw fail("SPELL_EFFECT_LEDGER_FULL", "The spell-effect outcome ledger is full; entries are never evicted.");
  if (!availability.available) throw fail("SPELL_EFFECT_ALREADY_RECORDED", `This cast, target Actor and selected choice are already ${availability.blockedStatus}; that semantic key remains blocked.`);
  cleanExpiredIntents();
  if (intents.size >= MAX_INTENTS) throw fail("SPELL_EFFECT_INTENTS_FULL", "Too many spell-effect previews are awaiting review.");

  const facts = {
    selection, castRecord, messageSource, casterActorSource: sourceOf(casterActor), casterTokenSource: sourceOf(casterToken),
    entrySource: sourceOf(entry), spellSource: sourceOf(spell), targetActorSource: sourceOf(targetActor), targetTokenSource: sourceOf(targetToken),
    selectedSourceSource: selectedSource ? sourceOf(selectedSource) : null,
    choiceTemplateSource, convertedChoiceSource, conditionSource, choiceSummary, expectedCombat,
  };
  const fingerprint = await digest(facts);
  const applicationId = nonce("spell-effect-application");
  const reviewToken = nonce("spell-effect-review");
  const expectedOperation = selection.choice.kind === "effect"
    ? "create-effect"
    : choiceSummary.expectedOperation === "already-satisfied"
      ? "already-satisfied"
      : choiceSummary.current
        ? "increase-condition"
        : "create-condition";
  const beforeConditionUuid = selection.choice.kind === "condition" ? choiceSummary.current?.uuid ?? null : null;
  const beforeConditionValue = selection.choice.kind === "condition" ? choiceSummary.current?.value ?? null : null;
  const expiresAt = Date.now() + INTENT_TTL;
  const intent: SpellEffectIntent = {
    applicationId, reviewToken, selection, semanticKey, fingerprint,
    sourceFacts: canonical(facts), expectedOperation, beforeConditionUuid, beforeConditionValue,
    ...current, expectedCombat, expiresAt,
    refs: {
      scene, message, castRecord: clone(castRecord), casterToken, casterActor, entry, spell, targetToken, targetActor, selectedSource,
      choiceSummary: clone(choiceSummary), choiceTemplateSource: clone(choiceTemplateSource), convertedChoiceSource: clone(convertedChoiceSource),
      convertedChoiceData: clone(convertedChoiceData),
      conditionDocument, conditionSource: clone(conditionSource),
      messageSource: canonical(messageSource), casterActorSource: canonical(facts.casterActorSource), casterTokenSource: canonical(facts.casterTokenSource),
      entrySource: canonical(facts.entrySource), spellSource: canonical(facts.spellSource), targetActorSource: canonical(facts.targetActorSource),
      targetTokenSource: canonical(facts.targetTokenSource), selectedSourceSource: selectedSource ? canonical(facts.selectedSourceSource) : null,
      casterActorPostSource: canonical(actorPostMutationSource(casterActor)),
      targetActorPostSource: canonical(actorPostMutationSource(targetActor)),
      casterTokenPostSource: canonical(tokenPostMutationSource(casterToken)),
      targetTokenPostSource: canonical(tokenPostMutationSource(targetToken)),
    },
  };
  // Hashing is asynchronous. Recheck captured documents, turn, identity and the ledger synchronously after the final await.
  sourceRefsStillCurrent(ctx, intent);
  const currentLedger = readSpellEffectLedger(ctx);
  const currentAvailability = spellEffectLedgerAvailability(currentLedger, semanticKey);
  if (!currentAvailability.available || currentAvailability.remaining <= 0)
    throw fail("SPELL_EFFECT_ALREADY_RECORDED", "This semantic spell-effect key became unavailable during preview.");
  cleanExpiredIntents();
  if (intents.size >= MAX_INTENTS) throw fail("SPELL_EFFECT_INTENTS_FULL", "Too many spell-effect previews are awaiting review.");
  intents.set(applicationId, intent);
  return {
    applicationId,
    reviewToken,
    expiresAt: new Date(expiresAt).toISOString(),
    selection: clone(selection),
    casterActorUuid: casterActor.uuid,
    casterTokenUuid: casterToken.uuid,
    targetActorUuid: targetActor.uuid,
    targetTokenUuid: targetToken.uuid,
    castId: castRecord.castId,
    castRank: castRecord.rank,
    choice: choiceSummary,
    expectedOperation,
    source: { messageUuid: message.uuid, spellUuid: spell.uuid, entryUuid: entry.uuid },
    expectedCombat,
    ledger: { semanticKey, available: true, recordCount: availability.count, remaining: availability.remaining },
    operatorChoiceNotice: "The selected effect or condition is the GM's explicit choice; it is not an inferred PF2e spell-rule result.",
  };
}
function applyArgumentsMatch(args: Record<string, unknown>, intent: SpellEffectIntent): boolean {
  try {
    return canonical(validateSelection(args)) === canonical(intent.selection) &&
      canonical(args.expectedCombat ?? null) === canonical(intent.expectedCombat);
  } catch { return false; }
}
function effectContextMatches(item: any, intent: SpellEffectIntent): boolean {
  const context = item?.system?.context, marker = item?.flags?.[MODULE_ID]?.spellEffectApplication;
  const nativeSourceUuid = nativeCompendiumSourceUuid(item);
  return item?.documentName === "Item" && item.type === "effect" && item.parent === intent.refs.targetActor &&
    intent.refs.targetActor.items?.get?.(item.id) === item && item.uuid &&
    intent.selection.choice.kind === "effect" && nativeSourceUuid === intent.selection.choice.uuid &&
    context?.origin?.actor === intent.refs.casterActor.uuid && context?.origin?.token === intent.refs.casterToken.uuid &&
    context?.origin?.item === intent.refs.spell.uuid && Array.isArray(context?.origin?.rollOptions) &&
    canonical(context.origin.rollOptions) === canonical(sourceOf(intent.refs.message)?.flags?.pf2e?.origin?.rollOptions) &&
    context?.target?.actor === intent.refs.targetActor.uuid && context?.target?.token === intent.refs.targetToken.uuid &&
    context?.roll === null && marker?.applicationId === intent.applicationId &&
    marker?.castMessageUuid === intent.selection.castMessageUuid && marker?.castId === intent.refs.castRecord.castId &&
    marker?.targetActorUuid === intent.refs.targetActor.uuid && marker?.targetTokenUuid === intent.refs.targetToken.uuid &&
    marker?.sourceUuid === intent.selection.choice.uuid && marker?.reviewFingerprint === intent.fingerprint;
}
function observedEffectOutcome(intent: SpellEffectIntent, nativeAttempted: boolean, beforeItemIds?: Set<string>): any | null {
  if (!nativeAttempted) return null;
  if (intent.selection.choice.kind !== "effect") return null;
  const actor = intent.refs.targetActor;
  const docs = values(actor.items).filter((item) => effectContextMatches(item, intent));
  if (docs.length !== 1) return null;
  const changed = values(actor.items).filter((item) => item?.parent === actor && owns(actor.items, item) && bounded(item.uuid) &&
    (!beforeItemIds || !beforeItemIds.has(item.id)));
  const ordered = [docs[0], ...changed.filter((item) => item !== docs[0])];
  const unique = [...new Map(ordered.map((item) => [item.uuid, item])).values()];
  return { kind: "effect-created", documentUuids: unique.slice(0, 30).map((item) => item.uuid), observedValue: null, observedTargetDocumentCount: unique.length };
}
function observedConditionOutcome(intent: SpellEffectIntent, nativeResult?: any, allowLostAcknowledgement = false): any | null {
  if (intent.selection.choice.kind !== "condition") return null;
  const actor = intent.refs.targetActor, choice = intent.selection.choice;
  const found = actor.getCondition?.(choice.slug, { all: true });
  const matches = Array.isArray(found) ? found : found ? [found] : [];
  if (matches.length !== 1 || matches[0].active !== true || !matches[0].uuid ||
    matches[0].parent !== actor || actor.items?.get?.(matches[0].id) !== matches[0]) return null;
  if (intent.expectedOperation === "already-satisfied" || intent.expectedOperation === "increase-condition") {
    if (matches[0] !== intent.refs.conditionDocument || matches[0].uuid !== intent.beforeConditionUuid) return null;
  } else if ((!nativeResult || nativeResult !== matches[0]) && !allowLostAcknowledgement || nativeResult?.uuid === intent.beforeConditionUuid) return null;
  const condition = matches[0], value = condition.value ?? condition.system?.value?.value ?? null;
  if (value !== choice.value) return null;
  const kind = intent.expectedOperation === "already-satisfied" ? "already-satisfied" :
    intent.expectedOperation === "create-condition" ? "condition-created" : "condition-increased";
  return { kind, documentUuids: [condition.uuid], observedValue: value };
}
function liveOutcome(intent: SpellEffectIntent, nativeAttempted: boolean, beforeItemIds?: Set<string>): any | null {
  return intent.selection.choice.kind === "effect" ? observedEffectOutcome(intent, nativeAttempted, beforeItemIds) : observedConditionOutcome(intent, undefined, nativeAttempted);
}
function postNativeRecheck(intent: SpellEffectIntent, ctx: PF2eContext): void {
  sameWorldIdentity(ctx, intent);
  const { scene, message, castRecord, casterToken, casterActor, entry, spell, targetToken, targetActor, selectedSource } = intent.refs;
  const currentCast = readConfirmedSpellCastByMessage(ctx, intent.selection.castMessageUuid);
  if (canonical(currentCast) !== canonical(castRecord) || !owns(ctx.game?.messages, message) ||
    canonical(sourceOf(message)) !== intent.refs.messageSource || casterToken.parent !== scene || targetToken.parent !== scene ||
    !owns(ctx.game?.scenes, scene) || !owns(scene.tokens, casterToken) || !owns(scene.tokens, targetToken) ||
    !currentActorForToken(casterActor, casterToken, ctx) || casterActor.uuid !== currentCast.actorUuid ||
    !currentActorForToken(targetActor, targetToken, ctx) || targetActor.uuid !== intent.refs.targetActor.uuid ||
    !entriesFor(casterActor).includes(entry) || !isCurrentNativeEntry(casterActor, entry) || !owns(casterActor.items, spell) ||
    (targetActor === casterActor
      ? canonical(actorPostMutationSource(casterActor)) !== intent.refs.casterActorPostSource
      : canonical(sourceOf(casterActor)) !== intent.refs.casterActorSource) ||
    (targetToken === casterToken
      ? canonical(tokenPostMutationSource(casterToken)) !== intent.refs.casterTokenPostSource
      : canonical(sourceOf(casterToken)) !== intent.refs.casterTokenSource) ||
    canonical(sourceOf(entry)) !== intent.refs.entrySource || canonical(sourceOf(spell)) !== intent.refs.spellSource ||
    canonical(tokenPostMutationSource(targetToken)) !== intent.refs.targetTokenPostSource ||
    (targetActor !== casterActor && canonical(actorPostMutationSource(targetActor)) !== intent.refs.targetActorPostSource) ||
    selectedSource && (!selectedSource.compendium || ctx.game?.packs?.get?.(selectedSource.pack) !== selectedSource.compendium ||
      selectedSource.compendium.get?.(selectedSource.id) !== selectedSource || canonical(sourceOf(selectedSource)) !== intent.refs.selectedSourceSource))
    throw fail("SPELL_EFFECT_SOURCE_CHANGED", "A reviewed cast, source, scene, token or Actor identity changed during native application.");
  assertCombatSame(intent.expectedCombat, scene, casterToken, ctx);
}
async function applyEffect(args: Record<string, unknown>, ctx: PF2eContext): Promise<any> {
  requirePF2e(ctx);
  const applicationId = String(args.applicationId ?? ""), reviewToken = String(args.reviewToken ?? "");
  const intent = intents.get(applicationId);
  if (!intent || intent.reviewToken !== reviewToken)
    throw fail("SPELL_EFFECT_REVIEW_MISMATCH", "The application ID and review token do not identify a current preview.");
  intents.delete(applicationId); // A matching preview is single-use, including failed native attempts.
  sameWorldIdentity(ctx, intent);
  if (intent.expiresAt <= Date.now()) throw fail("SPELL_EFFECT_REVIEW_EXPIRED", "The spell-effect preview expired.");
  if (!applyArgumentsMatch(args, intent)) throw fail("SPELL_EFFECT_REVIEW_MISMATCH", "The submitted cast, target, choice, or expected combat differs from the reviewed preview.");

  const reserveReviewCheck = () => {
    if (intent.expiresAt <= Date.now()) throw fail("SPELL_EFFECT_REVIEW_EXPIRED", "The spell-effect preview expired before durable reservation.");
    sourceRefsStillCurrent(ctx, intent);
    return () => {
      if (intent.expiresAt <= Date.now()) throw fail("SPELL_EFFECT_REVIEW_EXPIRED", "The spell-effect preview expired before durable reservation.");
      sourceRefsStillCurrent(ctx, intent);
    };
  };
  const reservation = await reserveSpellEffect(ctx, {
    applicationId: intent.applicationId, semanticKey: intent.semanticKey,
    castMessageUuid: intent.selection.castMessageUuid, castId: intent.refs.castRecord.castId,
    casterActorUuid: intent.refs.casterActor.uuid, casterTokenUuid: intent.selection.casterTokenUuid,
    targetActorUuid: intent.refs.targetActor.uuid, targetTokenUuid: intent.selection.targetTokenUuid,
    choice: intent.selection.choice, sessionId: intent.sessionId, reviewFingerprint: intent.fingerprint,
    expectedOperation: intent.expectedOperation, beforeConditionUuid: intent.beforeConditionUuid,
    beforeConditionValue: intent.beforeConditionValue,
  }, reserveReviewCheck);
  let observedTargetDocumentCount: number | null = null, nativeAttempted = false, beforeTargetItemIds: Set<string> | undefined;
  const runNative = async () => {
    if (intent.expiresAt <= Date.now()) throw fail("SPELL_EFFECT_REVIEW_EXPIRED", "The spell-effect preview expired while waiting to apply.");
    sourceRefsStillCurrent(ctx, intent);
    const actor = intent.refs.targetActor;
    if (intent.selection.choice.kind === "effect") {
      if (typeof actor.createEmbeddedDocuments !== "function") throw fail("NATIVE_EFFECT_API_UNAVAILABLE", "The target Actor cannot create embedded Items.");
      const data = clone(intent.refs.convertedChoiceData);
      delete data._id;
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].spellEffectApplication = {
        applicationId: intent.applicationId,
        castId: intent.refs.castRecord.castId,
        castMessageUuid: intent.selection.castMessageUuid,
        targetActorUuid: actor.uuid,
        targetTokenUuid: intent.refs.targetToken.uuid,
        sourceUuid: intent.selection.choice.uuid,
        reviewFingerprint: intent.fingerprint,
      };
      const nativeOrigin = sourceOf(intent.refs.message)?.flags?.pf2e?.origin;
      data.system ??= {};
      data.system.context = {
        origin: {
          actor: intent.refs.casterActor.uuid,
          token: intent.refs.casterToken.uuid,
          item: intent.refs.spell.uuid,
          spellcasting: null,
          rollOptions: clone(nativeOrigin.rollOptions),
        },
        target: { actor: actor.uuid, token: intent.refs.targetToken.uuid },
        roll: null,
      };
      beforeTargetItemIds = new Set(values(actor.items).map((item) => item.id));
      nativeAttempted = true;
      try { ctx.assertWrite(); } catch (error) { nativeAttempted = false; throw error; }
      const created = await actor.createEmbeddedDocuments("Item", [data], { keepId: false, keepEmbeddedIds: true });
      postNativeRecheck(intent, ctx);
      const roots = Array.isArray(created) ? created.filter((item: any) => effectContextMatches(item, intent)) : [];
      if (!Array.isArray(created) || created.length < 1 || roots.length !== 1)
        throw fail("SPELL_EFFECT_NATIVE_OUTCOME_UNCONFIRMED", "PF2e did not confirm the exact native effect and provenance after creation.");
      const observed = observedEffectOutcome(intent, true, beforeTargetItemIds);
      if (!observed) throw fail("SPELL_EFFECT_NATIVE_OUTCOME_UNCONFIRMED", "PF2e did not confirm the exact native effect after creation.");
      observedTargetDocumentCount = observed.observedTargetDocumentCount;
      return { kind: observed.kind, documentUuids: observed.documentUuids, observedValue: observed.observedValue };
    }
    const choice = intent.selection.choice;
    if (intent.expectedOperation === "already-satisfied") {
      sourceRefsStillCurrent(ctx, intent);
      return observedConditionOutcome(intent);
    }
    const manager = ctx.game?.pf2e?.ConditionManager;
    let nativeResult: any;
    if (intent.expectedOperation === "create-condition") {
      const options: Record<string, unknown> = {};
      if (choice.value !== null) {
        options.value = choice.value;
        options.max = intent.refs.choiceSummary.nativeMax ?? choice.value;
      }
      nativeAttempted = true;
      try { ctx.assertWrite(); } catch (error) { nativeAttempted = false; throw error; }
      nativeResult = await actor.increaseCondition(choice.slug, options);
    } else {
      if (!intent.refs.conditionDocument || intent.refs.conditionDocument.uuid !== intent.beforeConditionUuid)
        throw fail("SPELL_EFFECT_SOURCE_CHANGED", "The exact previewed condition changed before its native update.");
      nativeAttempted = true;
      try { ctx.assertWrite(); } catch (error) { nativeAttempted = false; throw error; }
      await manager.updateConditionValue(intent.refs.conditionDocument.id, actor, choice.value);
    }
    postNativeRecheck(intent, ctx);
    const outcome = observedConditionOutcome(intent, nativeResult);
    if (!outcome || outcome.kind === "already-satisfied")
      throw fail("SPELL_EFFECT_NATIVE_OUTCOME_UNCONFIRMED", "PF2e did not confirm the requested native condition value.");
    return outcome;
  };

  let outcome: any | null = null, nativeError: any = null;
  try {
    if (intent.expectedCombat) {
      const combat = values(ctx.game?.combats).find((row) => row?.uuid === intent.expectedCombat!.encounterUuid);
      if (!combat) throw fail("STALE_TURN", "The previewed encounter no longer exists.");
      outcome = await withCombatLock(combat, ctx, runNative);
      postNativeRecheck(intent, ctx);
    } else outcome = await runNative();
  } catch (cause) { nativeError = cause; }
  if (nativeError) {
    outcome = liveOutcome(intent, nativeAttempted, beforeTargetItemIds);
    if (outcome && typeof outcome.observedTargetDocumentCount === "number") {
      observedTargetDocumentCount = outcome.observedTargetDocumentCount;
      outcome = { kind: outcome.kind, documentUuids: outcome.documentUuids, observedValue: outcome.observedValue };
    }
  }

  const terminalStatus = nativeError || !outcome ? "uncertain" : "confirmed";
  try {
    const finalized = await finalizeSpellEffect(ctx, intent.semanticKey, intent.applicationId, terminalStatus, outcome);
    if (terminalStatus === "uncertain")
      throw fail("PARTIAL_FAILURE", "The native spell effect may have changed the Actor; inspect effect history and native state before any retry.", {
        applicationId: intent.applicationId, auditStatus: finalized.status, outcome,
        observedTargetDocumentCount, reportedDocumentCount: outcome?.documentUuids?.length ?? 0,
        observedDocumentsTruncated: (observedTargetDocumentCount ?? 0) > (outcome?.documentUuids?.length ?? 0),
        nativeErrorCode: nativeError?.code ?? "NATIVE_OUTCOME_UNKNOWN",
      });
    return {
      applicationId: intent.applicationId, semanticKey: intent.semanticKey,
      status: finalized.status, outcome, observedTargetDocumentCount: observedTargetDocumentCount ?? outcome.documentUuids.length,
      reportedDocumentCount: outcome.documentUuids.length,
      observedDocumentsTruncated: (observedTargetDocumentCount ?? outcome.documentUuids.length) > outcome.documentUuids.length,
      additionalObservedDocuments: Math.max(0, (observedTargetDocumentCount ?? outcome.documentUuids.length) - 1),
      note: "These are native results and target-owned documents observed during the operation; other clients and native hooks may also change the Actor.",
    };
  } catch (cause) {
    if ((cause as any)?.code === "PARTIAL_FAILURE") throw cause;
    throw fail("PARTIAL_FAILURE", "The native spell effect outcome is known or uncertain, but terminal audit status must be inspected; do not replay.", {
      applicationId: intent.applicationId, semanticKey: intent.semanticKey,
      auditStatus: (cause as any)?.partial?.auditStatus ?? "unknown", outcome,
      nativeErrorCode: nativeError?.code ?? null, auditErrorCode: (cause as any)?.code ?? null,
    });
  }
}
function durationRow(item: any, kind: "effect" | "condition"): any {
  const duration = item?.system?.duration;
  const start = item?.system?.start;
  const expired = typeof item?.isExpired === "boolean" ? item.isExpired : typeof item?.system?.expired === "boolean" ? item.system.expired : null;
  const remaining = item?.remainingDuration?.remaining;
  const moduleLink = item?.flags?.[MODULE_ID]?.spellEffectApplication;
  return {
    kind,
    uuid: bounded(item?.uuid) ? item.uuid : null,
    id: bounded(item?.id) ? item.id : null,
    slug: bounded(item?.slug, 80) ? item.slug : null,
    name: typeof item?.name === "string" ? item.name.slice(0, 200) : null,
    active: typeof item?.active === "boolean" ? item.active : null,
    isExpired: expired,
    remaining: Number.isFinite(remaining) ? remaining : null,
    duration: duration && typeof duration === "object" ? {
      value: Number.isFinite(duration.value) ? duration.value : null,
      unit: typeof duration.unit === "string" ? duration.unit : null,
      expiry: typeof duration.expiry === "string" ? duration.expiry : null,
      sustained: typeof duration.sustained === "boolean" ? duration.sustained : null,
    } : null,
    start: Number.isFinite(start?.value) ? start.value : null,
    startInitiative: Number.isFinite(start?.initiative) ? start.initiative : null,
    originUuid: bounded(item?.origin?.uuid) ? item.origin.uuid : null,
    sourceUuid: nativeCompendiumSourceUuid(item),
    parentGrantId: bounded(item?.system?.references?.parent?.id) ? item.system.references.parent.id : null,
    bridgeApplicationId: bounded(moduleLink?.applicationId, 128) ? moduleLink.applicationId : null,
    bridgeCastMessageUuid: bounded(moduleLink?.castMessageUuid, 512) ? moduleLink.castMessageUuid : null,
  };
}
async function inspectDurations(args: Record<string, unknown>, ctx: PF2eContext): Promise<any> {
  requirePF2e(ctx);
  const current = identity(ctx);
  const targetUuid = String(args.targetUuid ?? "");
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 25);
  const sustainedOnly = args.sustainedOnly === true, includeExpired = args.includeExpired === true;
  if (!bounded(targetUuid) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    (args.sustainedOnly !== undefined && typeof args.sustainedOnly !== "boolean") || (args.includeExpired !== undefined && typeof args.includeExpired !== "boolean"))
    throw fail("INVALID_INPUT", "targetUuid, offset, limit (1–50), sustainedOnly and includeExpired must be valid.");
  const { target, actor } = await resolvePF2eTarget(ctx, targetUuid);
  if (ctx.game?.world?.id !== current.worldId || ctx.game?.user?.id !== current.userId || ctx.game?.user?.isGM !== true || ctx.sessionId !== current.sessionId)
    throw fail("SESSION_CHANGED", "The GM, world or paired session changed during duration inspection.");
  if (target.documentName === "Token" && (!owns(ctx.game?.scenes, target.parent) || !owns(target.parent?.tokens, target)))
    throw fail("INVALID_TARGET", "The explicit target token changed or left the active world during duration inspection.");
  if (target === actor && !owns(ctx.game?.actors, actor))
    throw fail("INVALID_TARGET", "The target Actor changed or left the active world during duration inspection.");
  if (!currentActorForToken(actor, target.documentName === "Token" ? target : null, ctx))
    throw fail("INVALID_TARGET", "The target Actor is no longer a current world Actor or explicit scene-token Actor.");
  if (!["character", "npc", "familiar", "hazard", "vehicle"].includes(actor.type))
    throw fail("INVALID_TARGET", "Duration inspection requires a current PF2e Actor that can own effects and conditions.");
  const effects = values(actor.itemTypes?.effect ?? values(actor.items).filter((item) => item?.type === "effect"));
  const conditions = values(actor.conditions?.contents ?? actor.conditions ?? values(actor.items).filter((item) => item?.type === "condition"));
  let rows = [
    ...effects.map((item) => durationRow(item, "effect")),
    ...conditions.map((item) => durationRow(item, "condition")),
  ];
  if (!includeExpired) rows = rows.filter((row) => row.isExpired !== true);
  if (sustainedOnly) rows = rows.filter((row) => row.duration?.sustained === true);
  const warnings: string[] = [];
  const links = new Map<string, any>();
  try {
    const effectLedger = readSpellEffectLedger(ctx);
    const reconciliationLedger = readSpellReconciliationLedger(ctx);
    for (const record of Object.values(effectLedger.entries)) {
      if (record.targetActorUuid !== actor.uuid) continue;
      const overlay = Object.values(reconciliationLedger.entries).find((entry) => entry.sourceKind === "effect" &&
        entry.sourceId === record.applicationId && entry.sourceSnapshot === spellAuditSourceSnapshot("effect", record));
      const link = {
        applicationId: record.applicationId, castId: record.castId, castMessageUuid: record.castMessageUuid,
        originalStatus: record.status, effectiveStatus: overlay ? "reconciled" : record.status,
        reconciliationId: overlay?.reconciliationId ?? null,
      };
      for (const uuid of record.outcome?.documentUuids ?? []) if (bounded(uuid, 512)) links.set(uuid, link);
      // Native effects carry a Bridge marker; reserved marker-only recovery may not yet have a stored outcome.
      for (const item of values(actor.items)) {
        if (item?.flags?.[MODULE_ID]?.spellEffectApplication?.applicationId === record.applicationId && bounded(item.uuid, 512))
          links.set(item.uuid, link);
      }
    }
  } catch {
    warnings.push("Spell audit linkage is unavailable or malformed; native duration facts remain available, but some application links may be unknown.");
  }
  rows = rows.map((row) => ({ ...row, auditLink: links.get(row.uuid) ?? null }));
  const total = rows.length;
  return {
    targetUuid: target.uuid ?? targetUuid,
    actorUuid: actor.uuid ?? `Actor.${actor.id}`,
    actorName: typeof actor.name === "string" ? actor.name.slice(0, 160) : null,
    offset, limit, total,
    truncated: offset + limit < total,
    filters: { sustainedOnly, includeExpired },
    items: rows.slice(offset, offset + limit),
    auditLinksAvailable: warnings.length === 0,
    warnings,
    notes: ["Duration and expiry values are native observations; null means unavailable or not applicable.", "Sustain reminders are advisory and do not spend actions or extend durations."],
  };
}
export async function handlePF2eSpellEffect(tool: ToolName, args: Record<string, unknown>, ctx: PF2eContext): Promise<unknown> {
  if (tool === "pf2e_inspect_spell_effect") return inspectEffect(args, ctx);
  if (tool === "pf2e_apply_spell_effect") return applyEffect(args, ctx);
  if (tool === "pf2e_inspect_spell_durations") return inspectDurations(args, ctx);
  throw fail("INVALID_TOOL", `Unsupported PF2e spell-effect foundation tool: ${String(tool)}`);
}
