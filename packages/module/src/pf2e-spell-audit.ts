import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";
import { inspectCurrentSpellCastResource } from "./pf2e-spell-cast";
import { readSpellCastRecords, type SpellCastRecord, type SpellCastResourceSnapshot } from "./pf2e-spell-ledger";
import { readSpellResolutionRecords, type SpellResolutionRecord } from "./pf2e-spell-resolution-ledger";
import {
  appendSpellReconciliation,
  readSpellReconciliationLedger, spellAuditSourceSnapshot, type SpellReconciliationDecision,
} from "./pf2e-spell-reconciliation-ledger";
import { withSpellAuditLock } from "./pf2e-spell-audit-lock";

const MODULE_ID = "foundry-vtt-mcp";
const TTL = 5 * 60_000;
const MAX_INTENTS = 500;
type AuditTool = Extract<ToolName,
  "pf2e_inspect_spell_history" | "pf2e_inspect_spell_reconciliation" | "pf2e_reconcile_spell_audit">;
type ReconciliationIntent = {
  id: string; token: string; worldId: string; userId: string; sessionId: string;
  expiresAt: number; sourceKind: "cast" | "resolution"; sourceId: string;
  sourceSnapshot: string; sourceFingerprint: string; actorUuid: string;
  decision: SpellReconciliationDecision; evidenceMessageUuid: string | null;
  resourceBefore: SpellCastResourceSnapshot | null;
  resourceAfter: SpellCastResourceSnapshot | null;
  rollType: "check" | "damage" | null; rollTotal: number | null;
  evidenceFingerprint: string;
};
const intents = new Map<string, ReconciliationIntent>();

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
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
async function digest(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw fail("CRYPTO_UNAVAILABLE", "Secure spell audit review fingerprints are unavailable.");
  const result = await subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function nonce(prefix: string): string {
  const api = globalThis.crypto;
  if (!api?.getRandomValues) throw fail("CRYPTO_UNAVAILABLE", "Secure spell audit identifiers are unavailable.");
  return `${prefix}-${Array.from(api.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function identity(ctx: PF2eContext) {
  const worldId = ctx.game?.world?.id, userId = ctx.game?.user?.id, sessionId = ctx.sessionId;
  if (!bounded(worldId, 128) || !bounded(userId, 128) || !bounded(sessionId, 256) || ctx.game?.user?.isGM !== true)
    throw fail("SESSION_CHANGED", "A current paired GM world and session are required for spell audit reconciliation.");
  return { worldId, userId, sessionId };
}
function messageByUuid(ctx: PF2eContext, uuid: string): any | null {
  return values(ctx.game?.messages).find((message) => message?.uuid === uuid) ?? null;
}
function messageSource(message: any): any {
  try {
    if (typeof message?.toObject === "function") return message.toObject();
    if (message?._source) return structuredClone(message._source);
  } catch { /* malformed native messages fail below */ }
  return null;
}
function visibilityMatches(message: any, mode: SpellCastRecord["messageMode"], ctx: PF2eContext): boolean {
  const whisper = Array.isArray(message?.whisper) ? [...message.whisper].sort() : [];
  const gms = values(ctx.game?.users).filter((user) => user?.isGM === true).map((user) => user.id).sort();
  const self = bounded(ctx.game?.user?.id) ? [ctx.game.user.id] : [];
  if (mode === "public") return message?.blind !== true && whisper.length === 0;
  if (mode === "gm") return message?.blind !== true && canonical(whisper) === canonical(gms);
  if (mode === "blind") return message?.blind === true && canonical(whisper) === canonical(gms);
  return mode === "self" && message?.blind !== true && canonical(whisper) === canonical(self);
}
function resourceTransition(before: SpellCastResourceSnapshot, after: SpellCastResourceSnapshot): boolean {
  if (before.kind !== after.kind || before.slotId !== after.slotId) return false;
  if (before.kind === "none") return canonical(before) === canonical(after);
  if (before.kind === "preparedSlot") return before.expended === false && after.expended === true;
  return before.value !== null && after.value === before.value - before.cost && after.max === before.max;
}
function currentResourceEqual(left: SpellCastResourceSnapshot, right: SpellCastResourceSnapshot): boolean {
  return canonical(left) === canonical(right);
}
function scanActualCastMessages(ctx: PF2eContext, castId: string): { complete: boolean; matches: any[] } {
  const messages = values(ctx.game?.messages);
  if (messages.length > 2000) return { complete: false, matches: [] };
  return {
    complete: true,
    matches: messages.filter((message) => message?.flags?.[MODULE_ID]?.spellCast?.castId === castId &&
      Array.isArray(message?.flags?.pf2e?.origin?.rollOptions) &&
      message.flags.pf2e.origin.rollOptions.includes("origin:action:slug:cast-a-spell")),
  };
}
function exactCastMessage(message: any, record: SpellCastRecord, ctx: PF2eContext): { ok: boolean; reason?: string; evidence?: any } {
  if (!message || !values(ctx.game?.messages).includes(message)) return { ok: false, reason: "No current world chat document identifies the cast." };
  const source = messageSource(message), flags = source?.flags?.pf2e;
  const moduleCast = source?.flags?.[MODULE_ID]?.spellCast;
  const tokenParts = record.casterTokenUuid.split(".");
  const actorId = record.actorUuid.split(".").pop();
  if (!source || (record.chatMessageUuid && record.chatMessageUuid !== message.uuid) ||
    source.speaker?.scene !== tokenParts.at(-3) || source.speaker?.token !== tokenParts.at(-1) ||
    source.speaker?.actor !== actorId ||
    moduleCast?.castId !== record.castId || canonical(moduleCast.targetTokenUuids) !== canonical(record.targetTokenUuids) ||
    flags?.origin?.uuid !== record.spellUuid || flags?.casting?.id !== record.entryUuid.split(".").pop() ||
    flags?.origin?.castRank !== record.rank ||
    !Array.isArray(flags?.origin?.variant?.overlays) || flags.origin.variant.overlays.length !== 0 ||
    !Array.isArray(flags?.origin?.rollOptions) || !flags.origin.rollOptions.includes("origin:action:slug:cast-a-spell") ||
    !visibilityMatches(source, record.messageMode, ctx)) return { ok: false, reason: "The native actual-cast card identity, origin, targets, speaker, or visibility does not match the durable cast record." };
  const evidence = moduleCast.resourceEvidence;
  return { ok: true, evidence: { source, evidence } };
}
function sourceRecord(ctx: PF2eContext, kind: "cast" | "resolution", sourceId: string): SpellCastRecord | SpellResolutionRecord {
  if (kind === "cast") {
    const value = readSpellCastRecords(ctx);
    if (!Object.hasOwn(value.entries, sourceId))
      throw fail("SPELL_AUDIT_SOURCE_NOT_FOUND", "The selected spell-cast audit record was not found.");
    return structuredClone(value.entries[sourceId]) as SpellCastRecord;
  }
  const value = readSpellResolutionRecords(ctx).entries[sourceId];
  if (!value) throw fail("SPELL_AUDIT_SOURCE_NOT_FOUND", "The selected spell-resolution audit record was not found.");
  return value;
}
function sourceKindId(kind: "cast" | "resolution", record: SpellCastRecord | SpellResolutionRecord): string {
  return kind === "cast" ? (record as SpellCastRecord).castId : (record as SpellResolutionRecord).resolutionId;
}
function castHistoryRecord(record: SpellCastRecord, overlay: any) {
  return {
    kind: "cast", id: record.castId, actorUuid: record.actorUuid, spellUuid: record.spellUuid,
    rank: record.rank, slotId: record.slotId, targetTokenUuids: [...record.targetTokenUuids],
    createdAt: record.createdAt, updatedAt: record.updatedAt, originalStatus: record.status,
    effectiveStatus: overlay ? "reconciled" : record.status, reconciliationId: overlay?.reconciliationId ?? null,
    reconciliationDecision: overlay?.decision ?? null,
    evidenceMessageUuid: overlay?.evidenceMessageUuid ?? null,
    evidenceResourceBefore: overlay?.resourceBefore ?? null,
    evidenceResourceAfter: overlay?.resourceAfter ?? null,
    evidenceRollType: overlay?.rollType ?? null,
    evidenceRollTotal: overlay?.rollTotal ?? null,
    nativeConsumed: record.nativeConsumed, resourceBefore: record.resourceBefore,
    resourceAfter: record.resourceAfter, chatMessageUuid: record.chatMessageUuid,
  };
}
function resolutionHistoryRecord(record: SpellResolutionRecord, overlay: any) {
  return {
    kind: "resolution", id: record.resolutionId, actorUuid: record.casterActorUuid,
    castId: record.castId, action: record.action, targetActorUuid: record.targetActorUuid,
    createdAt: record.createdAt, updatedAt: record.updatedAt, originalStatus: record.status,
    effectiveStatus: overlay ? "reconciled" : record.status, reconciliationId: overlay?.reconciliationId ?? null,
    reconciliationDecision: overlay?.decision ?? null,
    evidenceMessageUuid: overlay?.evidenceMessageUuid ?? null,
    evidenceResourceBefore: overlay?.resourceBefore ?? null,
    evidenceResourceAfter: overlay?.resourceAfter ?? null,
    evidenceRollType: overlay?.rollType ?? null,
    evidenceRollTotal: overlay?.rollTotal ?? null,
    messageMode: record.messageMode, messageUuid: record.messageUuid,
    rollType: record.rollType, rollTotal: record.rollTotal,
  };
}
function history(ctx: PF2eContext, args: Record<string, unknown>) {
  const casts = Object.values(readSpellCastRecords(ctx).entries) as SpellCastRecord[];
  const resolutions = Object.values(readSpellResolutionRecords(ctx).entries);
  const reconciliations = readSpellReconciliationLedger(ctx);
  const rows = [
    ...casts.map((record) => castHistoryRecord(record, Object.values(reconciliations.entries).find((entry) => entry.sourceKind === "cast" && entry.sourceId === record.castId && entry.sourceSnapshot === spellAuditSourceSnapshot("cast", record)))),
    ...resolutions.map((record) => resolutionHistoryRecord(record, Object.values(reconciliations.entries).find((entry) => entry.sourceKind === "resolution" && entry.sourceId === record.resolutionId && entry.sourceSnapshot === spellAuditSourceSnapshot("resolution", record)))),
  ].filter((row) => (!args.actorUuid || row.actorUuid === args.actorUuid) &&
    (!args.kind || row.kind === args.kind) &&
    (!args.originalStatus || row.originalStatus === args.originalStatus) &&
    (!args.effectiveStatus || row.effectiveStatus === args.effectiveStatus))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 25);
  return { offset, limit, total: rows.length, truncated: offset + limit < rows.length, entries: rows.slice(offset, offset + limit) };
}
function prune(now = Date.now()) { for (const [key, value] of intents) if (value.expiresAt <= now) intents.delete(key); }
function sameIdentity(intent: ReconciliationIntent, ctx: PF2eContext) {
  const now = identity(ctx);
  if (now.worldId !== intent.worldId || now.userId !== intent.userId || now.sessionId !== intent.sessionId)
    throw fail("SESSION_CHANGED", "The spell audit review belongs to a different world, GM, or session.");
  if (intent.expiresAt <= Date.now()) throw fail("SPELL_RECONCILIATION_EXPIRED", "The spell audit review expired.");
}

async function inspectReconciliation(args: Record<string, unknown>, ctx: PF2eContext, createIntent = true, includeRecheck = false) {
  const kind = args.kind as "cast" | "resolution", sourceId = String(args.sourceId ?? "");
  if (!bounded(sourceId, 128)) throw fail("INVALID_INPUT", "A bounded spell audit sourceId is required.");
  const identityNow = identity(ctx);
  const record = sourceRecord(ctx, kind, sourceId);
  if (!(record.status === "reserved" || record.status === "uncertain"))
    return { supported: false, sourceKind: kind, sourceId, originalStatus: record.status,
      decision: null, reasons: ["Only unresolved reserved or uncertain source records can be reconciled."], readOnly: true };
  const snapshot = spellAuditSourceSnapshot(kind, record);
  const reconciliationLedger = readSpellReconciliationLedger(ctx);
  const prior = Object.values(reconciliationLedger.entries).find((entry) => entry.sourceKind === kind && entry.sourceId === sourceId);
  if (prior) throw fail("SPELL_AUDIT_ALREADY_RECONCILED", "This source already has a durable reconciliation record; inspect history for its effective status.", { reconciliationId: prior.reconciliationId });
  let decision: SpellReconciliationDecision | null = null, messageUuid: string | null = null;
  let before: SpellCastResourceSnapshot | null = null, after: SpellCastResourceSnapshot | null = null;
  let rollType: "check" | "damage" | null = null, rollTotal: number | null = null;
  const reasons: string[] = [];
  let evidence: any = null;
  let evidenceRecheck: (() => void) | undefined;
  let initialResourceRecheck: (() => void) | undefined;
  if (kind === "cast") {
    const cast = record as SpellCastRecord;
    const candidateUuid = bounded(args.candidateMessageUuid, 512) ? args.candidateMessageUuid : cast.chatMessageUuid;
    let current: Awaited<ReturnType<typeof inspectCurrentSpellCastResource>> | null = null;
    try { current = await inspectCurrentSpellCastResource(ctx, cast); }
    catch { reasons.push("Current owned caster, entry, spell, or native resource facts could not be resolved exactly."); }
    initialResourceRecheck = current?.recheck;
    const currentResource = current?.resource ?? null;
    if (candidateUuid) {
      const message = messageByUuid(ctx, candidateUuid);
      const card = exactCastMessage(message, cast, ctx);
      if (!card.ok) reasons.push(card.reason!);
      else {
        messageUuid = candidateUuid;
        const moduleEvidence = card.evidence.evidence;
        const ledgerEvidence = cast.resourceAfter;
        const proof = moduleEvidence && moduleEvidence.version === 1 && moduleEvidence.nativeConsumed === true &&
          moduleEvidence.castId === cast.castId && moduleEvidence.worldId === cast.worldId &&
          moduleEvidence.actorUuid === cast.actorUuid && moduleEvidence.casterTokenUuid === cast.casterTokenUuid &&
          moduleEvidence.entryUuid === cast.entryUuid && moduleEvidence.spellUuid === cast.spellUuid &&
          moduleEvidence.rank === cast.rank && moduleEvidence.slotId === cast.slotId &&
          canonical(moduleEvidence.targetTokenUuids) === canonical(cast.targetTokenUuids) &&
          moduleEvidence.messageMode === cast.messageMode &&
          canonical(moduleEvidence.resourceBefore) === canonical(cast.resourceBefore) &&
          (cast.resourceAfter === null || canonical(moduleEvidence.resourceAfter) === canonical(cast.resourceAfter)) &&
          moduleEvidence.fingerprint === cast.fingerprint;
        const afterCandidate = ledgerEvidence ?? (proof ? moduleEvidence.resourceAfter : null);
        if ((moduleEvidence !== undefined && !proof) ||
          (cast.nativeConsumed !== true && !proof) || !afterCandidate || !resourceTransition(cast.resourceBefore, afterCandidate) ||
          !currentResource || !currentResourceEqual(currentResource, afterCandidate) || (!proof && !ledgerEvidence))
          reasons.push("The actual-cast card and current native resource do not prove one exact consumed transition.");
        else {
          decision = "confirmed-observed"; before = cast.resourceBefore; after = afterCandidate; evidence = card.evidence;
          evidenceRecheck = () => {
            if (messageByUuid(ctx, candidateUuid) !== message || !values(ctx.game?.messages).includes(message))
              throw fail("SPELL_RECONCILIATION_STALE", "The reviewed cast card is no longer current in this world.");
            const latest = exactCastMessage(message, cast, ctx);
            if (!latest.ok || canonical(latest.evidence) !== canonical(evidence))
              throw fail("SPELL_RECONCILIATION_STALE", "The reviewed actual-cast card changed.");
          };
        }
      }
    } else reasons.push("No exact current-world actual-cast message UUID is available.");
    if (!decision && cast.status === "uncertain" && cast.nativeConsumed === false && cast.chatMessageUuid === null &&
      cast.resourceAfter && canonical(cast.resourceAfter) === canonical(cast.resourceBefore) && currentResource &&
      currentResourceEqual(currentResource, cast.resourceBefore)) {
      const scan = scanActualCastMessages(ctx, cast.castId);
      if (!scan.complete) reasons.push("The world message scan exceeded its safe bound; absence cannot be established.");
      else if (scan.matches.length > 0) reasons.push("A matching actual-cast card exists despite the stored refused outcome.");
      else {
        decision = "refused-unchanged"; before = cast.resourceBefore; after = cast.resourceAfter;
        evidence = { resource: currentResource, exhaustiveMessageScan: true };
        evidenceRecheck = () => {
          const latestScan = scanActualCastMessages(ctx, cast.castId);
          if (!latestScan.complete || latestScan.matches.length !== 0)
            throw fail("SPELL_RECONCILIATION_STALE", "The exhaustive actual-cast message scan changed during review.");
        };
      }
    }
  } else {
    const resolution = record as SpellResolutionRecord;
    let sourceCast: SpellCastRecord | undefined;
    try { sourceCast = readSpellCastRecords(ctx).entries[resolution.castId]; }
    catch { reasons.push("The source cast ledger is unreadable or malformed."); }
    const castMessage = sourceCast?.chatMessageUuid ? messageByUuid(ctx, sourceCast.chatMessageUuid) : null;
    const castCard = sourceCast && castMessage ? exactCastMessage(castMessage, sourceCast, ctx) : null;
    const sourceCastValid = !!sourceCast && sourceCast.worldId === resolution.worldId &&
      sourceCast.status === "confirmed" && sourceCast.nativeConsumed === true &&
      !!sourceCast.chatMessageUuid && sourceCast.chatMessageUuid === resolution.castMessageUuid &&
      sourceCast.actorUuid === resolution.casterActorUuid && sourceCast.casterTokenUuid === resolution.casterTokenUuid &&
      !!castCard?.ok;
    if (!sourceCastValid)
      reasons.push("The source actual-cast record is not confirmed and identity-bound.");
    const candidateUuid = bounded(args.candidateMessageUuid, 512) ? args.candidateMessageUuid : resolution.messageUuid;
    const message = candidateUuid ? messageByUuid(ctx, candidateUuid) : null;
    const source = messageSource(message), bridge = source?.flags?.[MODULE_ID]?.spellResolution;
    const pf2e = source?.flags?.pf2e;
    const context = pf2e?.context;
    const marker = `foundry-vtt-mcp:spell-resolution:${resolution.resolutionId}`;
    const casterToken = resolution.casterTokenUuid.split(".");
    const speakerToken = resolution.action === "save" ? resolution.targetTokenUuid.split(".") : casterToken;
    const speakerActor = resolution.action === "save" ? resolution.targetActorUuid : resolution.casterActorUuid;
    const options = pf2e?.context?.options ?? pf2e?.origin?.rollOptions;
    const expectedContextType = resolution.action === "damage" ? "damage-roll" :
      resolution.action === "save" ? "saving-throw" : "attack-roll";
    const configuredRolls = ctx.game?.CONFIG?.Dice?.rolls ?? (globalThis as any).CONFIG?.Dice?.rolls;
    const expectedRollName = resolution.action === "damage" ? "DamageRoll" : "CheckRoll";
    const rollClass = Array.isArray(configuredRolls) ? configuredRolls.find((item: any) => item?.name === expectedRollName) : null;
    const nativeRoll = message?.rolls?.length === 1 ? message.rolls[0] : null;
    const originContext = context?.origin;
    const targetContext = context?.target;
    const targetContextMatches = targetContext === null && resolution.action === "damage" ||
      targetContext?.actor === resolution.targetActorUuid && targetContext?.token === resolution.targetTokenUuid;
    const checkContextMatches = context?.action === "cast-a-spell" &&
      context?.actor === speakerActor.split(".").pop() && context?.token === speakerToken.at(-1) &&
      originContext?.actor === resolution.casterActorUuid && originContext?.token === resolution.casterTokenUuid &&
      targetContext?.actor === resolution.targetActorUuid && targetContext?.token === resolution.targetTokenUuid &&
      (resolution.action !== "save" || Number.isFinite(context?.dc?.value));
    const damageContextMatches = context?.actor === resolution.casterActorUuid.split(".").pop() &&
      context?.token === casterToken.at(-1) && targetContextMatches;
    if (!sourceCastValid || !message || !values(ctx.game?.messages).includes(message) || bridge?.resolutionId !== resolution.resolutionId ||
      bridge?.castMessageUuid !== resolution.castMessageUuid || bridge?.action !== resolution.action ||
      bridge?.targetTokenUuid !== resolution.targetTokenUuid ||
      source?.speaker?.scene !== speakerToken.at(-3) || source?.speaker?.token !== speakerToken.at(-1) ||
      source?.speaker?.actor !== speakerActor.split(".").pop() ||
      pf2e?.origin?.uuid !== sourceCast?.spellUuid || pf2e?.origin?.castRank !== sourceCast?.rank ||
      !Array.isArray(options) || !options.includes(marker) || context?.type !== expectedContextType ||
      !(resolution.action === "damage" ? damageContextMatches : checkContextMatches) ||
      (resolution.action !== "damage" && context?.messageMode !== resolution.messageMode) || !rollClass ||
      !(nativeRoll instanceof rollClass) ||
      (nativeRoll?.evaluated !== true && nativeRoll?._evaluated !== true) ||
      !visibilityMatches(source, resolution.messageMode, ctx) ||
      !Number.isFinite(nativeRoll?.total)) {
      reasons.push("No exact current native evaluated roll message matches the source resolution record.");
    } else if ((resolution.messageUuid !== null && resolution.messageUuid !== candidateUuid) ||
      (resolution.rollTotal !== null && resolution.rollTotal !== nativeRoll.total) ||
      (resolution.rollType !== null && resolution.rollType !== (resolution.action === "damage" ? "damage" : "check")) ||
      !["reserved", "uncertain"].includes(resolution.status) ||
      nativeRoll.constructor?.name !== expectedRollName) {
      reasons.push("The native roll contradicts the durable resolution facts or is not an unresolved record.");
    } else {
      decision = "confirmed-observed"; messageUuid = candidateUuid;
      rollType = resolution.action === "damage" ? "damage" : "check";
      rollTotal = nativeRoll.total;
      evidence = { source, messageUuid, rollType, rollTotal, action: resolution.action, castId: resolution.castId };
      const reviewedMessage = message;
      const reviewedRoll = nativeRoll;
      const reviewedSourceCast = sourceCast!;
      const reviewedCastMessage = castMessage;
      evidenceRecheck = () => {
        const liveCast = readSpellCastRecords(ctx).entries[resolution.castId];
        const liveCastMessage = liveCast?.chatMessageUuid ? messageByUuid(ctx, liveCast.chatMessageUuid) : null;
        const liveCastCard = liveCast && liveCastMessage ? exactCastMessage(liveCastMessage, liveCast, ctx) : null;
        if (!liveCast || spellAuditSourceSnapshot("cast", liveCast) !== spellAuditSourceSnapshot("cast", reviewedSourceCast) ||
          liveCast.status !== "confirmed" || liveCast.nativeConsumed !== true || liveCastMessage !== reviewedCastMessage || !liveCastCard?.ok ||
          messageByUuid(ctx, candidateUuid!) !== reviewedMessage || !values(ctx.game?.messages).includes(reviewedMessage) ||
          reviewedMessage.rolls?.length !== 1 || reviewedMessage.rolls[0] !== reviewedRoll ||
          !(reviewedRoll instanceof rollClass) || reviewedRoll.constructor?.name !== expectedRollName ||
          (reviewedRoll.evaluated !== true && reviewedRoll._evaluated !== true) || reviewedRoll.total !== rollTotal ||
          canonical(messageSource(reviewedMessage)) !== canonical(source))
          throw fail("SPELL_RECONCILIATION_STALE", "The reviewed native resolution, roll, or source cast changed.");
      };
    }
  }
  if (!decision) return {
    supported: false, sourceKind: kind, sourceId, originalStatus: (record as any).status,
    decision: null, reasons: [...new Set(reasons)].slice(0, 10), readOnly: true,
  };
  prune();
  if (intents.size >= MAX_INTENTS) throw fail("SPELL_RECONCILIATION_INTENTS_FULL", "Too many unexpired spell audit reviews are pending.");
  const sourceCanonical = snapshot;
  const reviewFacts = { sourceKind: kind, sourceId, sourceCanonical, evidence, decision, messageUuid, before, after, rollType, rollTotal };
  const fingerprint = await digest(reviewFacts);
  const immutableFingerprint = await digest({ kind, sourceId, record });
  const sourceAfterHash = sourceRecord(ctx, kind, sourceId);
  const identityAfterHash = identity(ctx);
  if (identityAfterHash.worldId !== identityNow.worldId || identityAfterHash.userId !== identityNow.userId ||
    identityAfterHash.sessionId !== identityNow.sessionId || spellAuditSourceSnapshot(kind, sourceAfterHash) !== snapshot)
    throw fail("SPELL_RECONCILIATION_STALE", "The spell audit source changed while its evidence was reviewed.");
  if (kind === "cast") {
    const cast = record as SpellCastRecord;
    const refreshedResource = await inspectCurrentSpellCastResource(ctx, cast);
    refreshedResource.recheck();
    const priorEvidenceRecheck = evidenceRecheck;
    evidenceRecheck = () => { initialResourceRecheck?.(); refreshedResource.recheck(); priorEvidenceRecheck?.(); };
    const latestMessage = messageUuid ? messageByUuid(ctx, messageUuid) : null;
    const latestCard = latestMessage ? exactCastMessage(latestMessage, cast, ctx) : null;
    if (!currentResourceEqual(refreshedResource.resource, after ?? before!) ||
      (messageUuid && (!latestCard?.ok || canonical(latestCard.evidence) !== canonical(evidence))))
      throw fail("SPELL_RECONCILIATION_STALE", "The native cast evidence changed while its review fingerprint was computed.");
  } else if (messageUuid) {
    const latestMessage = messageByUuid(ctx, messageUuid);
    const refreshedSource = messageSource(latestMessage);
    if (!refreshedSource || canonical(refreshedSource) !== canonical(evidence.source))
      throw fail("SPELL_RECONCILIATION_STALE", "The native roll message changed while its review fingerprint was computed.");
  }
  evidenceRecheck?.();
  const identityAfterEvidence = identity(ctx);
  const sourceAfterEvidence = sourceRecord(ctx, kind, sourceId);
  if (identityAfterEvidence.worldId !== identityNow.worldId || identityAfterEvidence.userId !== identityNow.userId ||
    identityAfterEvidence.sessionId !== identityNow.sessionId || spellAuditSourceSnapshot(kind, sourceAfterEvidence) !== snapshot)
    throw fail("SPELL_RECONCILIATION_STALE", "The source or paired identity changed during final evidence refresh.");
  if (!createIntent) return { supported: true, decision, evidenceMessageUuid: messageUuid,
    resourceBefore: before, resourceAfter: after, rollType, rollTotal, evidenceFingerprint: fingerprint,
    ...(includeRecheck ? { recheck: evidenceRecheck } : {}) };
  const id = nonce("spell-reconciliation"), token = nonce("review");
  const expiresAt = Date.now() + TTL;
  const intent: ReconciliationIntent = {
    id, token, ...identityNow, expiresAt, sourceKind: kind, sourceId, sourceSnapshot: snapshot,
    sourceFingerprint: immutableFingerprint, actorUuid: kind === "cast" ? (record as SpellCastRecord).actorUuid : (record as SpellResolutionRecord).casterActorUuid,
    decision, evidenceMessageUuid: messageUuid, resourceBefore: before, resourceAfter: after,
    rollType, rollTotal, evidenceFingerprint: fingerprint,
  };
  intents.set(id, intent);
  return { supported: true, sourceKind: kind, sourceId, originalStatus: (record as any).status,
    decision, reconciliationId: id, reviewToken: token, expiresAt: new Date(expiresAt).toISOString(),
    evidenceMessageUuid: messageUuid, resourceBefore: before, resourceAfter: after, rollType, rollTotal,
    note: "Execution rechecks the source and native evidence before one append-only audit write." };
}

async function executeReconciliation(args: Record<string, unknown>, ctx: PF2eContext) {
  const id = String(args.reconciliationId ?? ""), token = String(args.reviewToken ?? "");
  const intent = intents.get(id);
  if (!intent || intent.token !== token) throw fail("SPELL_RECONCILIATION_REVIEW_MISMATCH", "The reconciliation ID and review token do not identify a current review.");
  sameIdentity(intent, ctx);
  const record = sourceRecord(ctx, intent.sourceKind, intent.sourceId);
  if (spellAuditSourceSnapshot(intent.sourceKind, record) !== intent.sourceSnapshot) throw fail("SPELL_RECONCILIATION_STALE", "The source audit record changed after inspection.");
  // Re-run the same evidence review after the shared lock has been acquired; this callback performs no writes.
  await appendSpellReconciliation(ctx, {
    reconciliationId: intent.id, sourceKind: intent.sourceKind, sourceId: intent.sourceId,
    sourceFingerprint: intent.sourceFingerprint, sourceSnapshot: intent.sourceSnapshot,
    actorUuid: intent.actorUuid, decision: intent.decision, evidenceVersion: 1,
    evidenceMessageUuid: intent.evidenceMessageUuid, resourceBefore: intent.resourceBefore,
    resourceAfter: intent.resourceAfter, rollType: intent.rollType, rollTotal: intent.rollTotal,
  }, async () => {
    sameIdentity(intent, ctx);
    const current = sourceRecord(ctx, intent.sourceKind, intent.sourceId);
    if (spellAuditSourceSnapshot(intent.sourceKind, current) !== intent.sourceSnapshot)
      throw fail("SPELL_RECONCILIATION_STALE", "The source audit record changed while waiting for the audit lock.");
    const refreshed = await inspectReconciliation({ kind: intent.sourceKind, sourceId: intent.sourceId,
      ...(intent.evidenceMessageUuid ? { candidateMessageUuid: intent.evidenceMessageUuid } : {}) }, ctx, false, true);
    if (!refreshed.supported || refreshed.decision !== intent.decision || refreshed.evidenceMessageUuid !== intent.evidenceMessageUuid)
      throw fail("SPELL_RECONCILIATION_STALE", "The reviewed native evidence changed before append.");
    if (refreshed.decision !== intent.decision ||
      canonical(refreshed.resourceBefore) !== canonical(intent.resourceBefore) ||
      canonical(refreshed.resourceAfter) !== canonical(intent.resourceAfter) ||
      refreshed.rollType !== intent.rollType || refreshed.rollTotal !== intent.rollTotal ||
      (refreshed as any).evidenceFingerprint !== intent.evidenceFingerprint)
      throw fail("SPELL_RECONCILIATION_STALE", "The evidence facts differ from the inspected review.");
    // appendSpellReconciliation calls this synchronously after its final await
    // and immediately before assertWrite()/the one setting append.
    return () => {
      sameIdentity(intent, ctx);
      (refreshed as any).recheck?.();
      const afterRefresh = sourceRecord(ctx, intent.sourceKind, intent.sourceId);
      if (spellAuditSourceSnapshot(intent.sourceKind, afterRefresh) !== intent.sourceSnapshot)
        throw fail("SPELL_RECONCILIATION_STALE", "The source audit record changed during the final evidence refresh.");
    };
  });
  intent.expiresAt = 0; intents.delete(id);
  return { reconciled: true, reconciliationId: id, sourceKind: intent.sourceKind, sourceId: intent.sourceId,
    originalStatus: (sourceRecord(ctx, intent.sourceKind, intent.sourceId) as any).status,
    effectiveStatus: "reconciled", decision: intent.decision, evidenceMessageUuid: intent.evidenceMessageUuid,
    auditStatus: "confirmed", effectsApplied: false, note: "The original spell audit record remains unchanged." };
}

export async function handlePF2eSpellAudit(tool: AuditTool, args: Record<string, unknown>, ctx: PF2eContext): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_inspect_spell_history") return history(ctx, args);
  if (tool === "pf2e_inspect_spell_reconciliation") return inspectReconciliation(args, ctx);
  if (tool === "pf2e_reconcile_spell_audit") return executeReconciliation(args, ctx);
  throw fail("UNKNOWN_TOOL", "Unsupported spell audit operation.");
}

export const __spellAuditTest = { exactCastMessage, resourceTransition, scanActualCastMessages, visibilityMatches, intents, history };
