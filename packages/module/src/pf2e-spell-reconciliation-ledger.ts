import type { BridgeContext } from "./bridge-context.js";
import { withSpellAuditLock } from "./pf2e-spell-audit-lock.js";
import { spellEffectAuditProjection, validSpellEffectAuditProjection } from "./pf2e-spell-effect-ledger.js";

const MODULE_ID = "foundry-vtt-mcp";
const SETTING = "spellReconciliations";
const VERSION = 1;
const MAX_RECORDS = 5000;

export type SpellReconciliationDecision = "confirmed-observed" | "refused-unchanged";
export type SpellReconciliationRecord = {
  reconciliationId: string;
  worldId: string;
  userId: string;
  createdAt: string;
  sourceKind: "cast" | "resolution" | "effect";
  sourceId: string;
  sourceFingerprint: string;
  sourceSnapshot: string;
  actorUuid: string;
  decision: SpellReconciliationDecision;
  evidenceVersion: 1;
  evidenceMessageUuid: string | null;
  resourceBefore: unknown | null;
  resourceAfter: unknown | null;
  rollType: "check" | "damage" | null;
  rollTotal: number | null;
  targetActorUuid?: string;
  targetTokenUuid?: string;
  semanticKey?: string;
  choice?: unknown;
  expectedOperation?: string;
  beforeConditionUuid?: string | null;
  beforeConditionValue?: number | null;
  outcomeKind?: string;
  observedValue?: number | null;
  documentUuids?: string[];
};

export type SpellReconciliationLedger = {
  version: 1;
  entries: Record<string, SpellReconciliationRecord>;
};

function fail(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function plain(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}
export function spellAuditSourceSnapshot(kind: "cast" | "resolution" | "effect", source: any): string {
  if (kind === "effect") return JSON.stringify(spellEffectAuditProjection(source));
  const projection = kind === "cast" ? {
    sourceKind: kind, sourceId: source.castId, worldId: source.worldId, actorUuid: source.actorUuid,
    casterTokenUuid: source.casterTokenUuid, entryUuid: source.entryUuid, spellUuid: source.spellUuid,
    rank: source.rank, slotId: source.slotId, targetTokenUuids: source.targetTokenUuids,
    messageMode: source.messageMode, createdAt: source.createdAt, updatedAt: source.updatedAt,
    status: source.status, nativeConsumed: source.nativeConsumed, resourceBefore: source.resourceBefore,
    resourceAfter: source.resourceAfter, chatMessageUuid: source.chatMessageUuid,
  } : {
    sourceKind: kind, sourceId: source.resolutionId, worldId: source.worldId,
    actorUuid: source.casterActorUuid, operationKey: source.operationKey, castId: source.castId,
    castMessageUuid: source.castMessageUuid, action: source.action, messageMode: source.messageMode,
    casterActorUuid: source.casterActorUuid, targetActorUuid: source.targetActorUuid,
    casterTokenUuid: source.casterTokenUuid, targetTokenUuid: source.targetTokenUuid,
    attackNumber: source.attackNumber, createdAt: source.createdAt, updatedAt: source.updatedAt,
    status: source.status, messageUuid: source.messageUuid, rollType: source.rollType, rollTotal: source.rollTotal,
  };
  return JSON.stringify(projection);
}
function validResource(value: unknown): boolean {
  if (!plain(value) || !exact(value, ["kind", "cost", "value", "max", "expended", "groupNumber", "slotId"]) ||
    !["none", "actorFocus", "preparedSlot", "rankPool", "innateUse"].includes(value.kind) ||
    !Number.isInteger(value.cost) || value.cost < 0 || value.cost > 3 ||
    !(value.value === null || Number.isSafeInteger(value.value) && value.value >= 0) ||
    !(value.max === null || Number.isSafeInteger(value.max) && value.max >= 0) ||
    !(value.expended === null || typeof value.expended === "boolean") ||
    !(value.groupNumber === null || Number.isSafeInteger(value.groupNumber) && value.groupNumber >= 0) ||
    !(value.slotId === null || Number.isInteger(value.slotId) && value.slotId >= 0 && value.slotId <= 9999)) return false;
  if (value.kind === "none") return value.cost === 0;
  if (value.kind === "actorFocus") return value.cost >= 1;
  return value.cost === 1;
}
function validSourceSnapshot(overlay: any): boolean {
  let source: any;
  try { source = JSON.parse(overlay.sourceSnapshot); } catch { return false; }
  const castKeys = ["sourceKind", "sourceId", "worldId", "actorUuid", "casterTokenUuid", "entryUuid", "spellUuid", "rank", "slotId", "targetTokenUuids", "messageMode", "createdAt", "updatedAt", "status", "nativeConsumed", "resourceBefore", "resourceAfter", "chatMessageUuid"];
  const resolutionKeys = ["sourceKind", "sourceId", "worldId", "actorUuid", "operationKey", "castId", "castMessageUuid", "action", "messageMode", "casterActorUuid", "targetActorUuid", "casterTokenUuid", "targetTokenUuid", "attackNumber", "createdAt", "updatedAt", "status", "messageUuid", "rollType", "rollTotal"];
  const effectKeys = ["sourceKind", "sourceId", "worldId", "actorUuid", "casterTokenUuid", "targetActorUuid", "targetTokenUuid", "castMessageUuid", "castId", "semanticKey", "choice", "reviewFingerprint", "expectedOperation", "beforeConditionUuid", "beforeConditionValue", "status", "outcome"];
  if (!plain(source) || !exact(source, overlay.sourceKind === "cast" ? castKeys : overlay.sourceKind === "resolution" ? resolutionKeys : effectKeys) ||
    JSON.stringify(source) !== overlay.sourceSnapshot || source.worldId !== overlay.worldId ||
    source.sourceKind !== overlay.sourceKind || source.sourceId !== overlay.sourceId || source.actorUuid !== overlay.actorUuid) return false;
  if (overlay.sourceKind === "cast") {
    if (!["reserved", "uncertain"].includes(source.status) || !Array.isArray(source.targetTokenUuids) ||
      source.targetTokenUuids.length > 100 || source.targetTokenUuids.some((uuid: unknown) => !bounded(uuid, 512)) ||
      !bounded(source.sourceId, 128) || !bounded(source.worldId, 128) || !bounded(source.actorUuid, 512) ||
      !bounded(source.casterTokenUuid, 512) || !bounded(source.entryUuid, 512) || !bounded(source.spellUuid, 512) ||
      !Number.isSafeInteger(source.rank) || source.rank < 0 || source.rank > 10 ||
      !(source.slotId === null || Number.isSafeInteger(source.slotId) && source.slotId >= 0) ||
      !["public", "gm", "self", "blind"].includes(source.messageMode) ||
      !Number.isFinite(Date.parse(source.createdAt)) || !Number.isFinite(Date.parse(source.updatedAt)) ||
      !(source.nativeConsumed === null || typeof source.nativeConsumed === "boolean") ||
      !(source.chatMessageUuid === null || bounded(source.chatMessageUuid, 512)) ||
      !validResource(overlay.resourceBefore) ||
      JSON.stringify(source.resourceBefore) !== JSON.stringify(overlay.resourceBefore)) return false;
    if (overlay.decision === "refused-unchanged")
      return source.status === "uncertain" && source.nativeConsumed === false && source.chatMessageUuid === null &&
        validResource(overlay.resourceAfter) && JSON.stringify(overlay.resourceBefore) === JSON.stringify(overlay.resourceAfter) &&
        source.resourceAfter !== null && JSON.stringify(source.resourceAfter) === JSON.stringify(overlay.resourceAfter) &&
        overlay.evidenceMessageUuid === null && overlay.rollType === null && overlay.rollTotal === null;
    return overlay.decision === "confirmed-observed" && bounded(overlay.evidenceMessageUuid, 512) &&
      JSON.stringify(source.resourceBefore) === JSON.stringify(overlay.resourceBefore) &&
      source.nativeConsumed !== false &&
      (source.resourceAfter === null || JSON.stringify(source.resourceAfter) === JSON.stringify(overlay.resourceAfter)) &&
      validResource(overlay.resourceAfter) && overlay.resourceBefore.kind === overlay.resourceAfter.kind &&
      (overlay.resourceBefore.kind === "preparedSlot"
        ? overlay.resourceBefore.expended === false && overlay.resourceAfter.expended === true
        : overlay.resourceBefore.kind === "none"
          ? JSON.stringify(overlay.resourceBefore) === JSON.stringify(overlay.resourceAfter)
          : overlay.resourceBefore.value !== null && overlay.resourceAfter.value === overlay.resourceBefore.value - overlay.resourceBefore.cost && overlay.resourceAfter.max === overlay.resourceBefore.max) &&
      overlay.rollType === null && overlay.rollTotal === null;
  }
  if (overlay.sourceKind === "effect") {
    const outcome = source.outcome;
    const knownOutcomeDocs = outcome?.documentUuids ?? [];
    const expectedOutcomeKind = source.choice?.kind === "effect" ? "effect-created" :
      source.expectedOperation === "already-satisfied" ? "already-satisfied" :
        source.expectedOperation === "create-condition" ? "condition-created" : "condition-increased";
    const expectedValue = source.choice?.kind === "effect" ? null : source.choice?.value;
    return overlay.decision === "confirmed-observed" && validSpellEffectAuditProjection(source) &&
      overlay.outcomeKind === expectedOutcomeKind && overlay.observedValue === expectedValue && Array.isArray(overlay.documentUuids) &&
      overlay.documentUuids.length > 0 && overlay.documentUuids.length <= 30 &&
      overlay.documentUuids.every((uuid: unknown) => bounded(uuid, 512)) && new Set(overlay.documentUuids).size === overlay.documentUuids.length &&
      (outcome === null ? source.choice.kind === "effect" && source.expectedOperation === "create-effect" && overlay.documentUuids.length === 1 :
        JSON.stringify(overlay.documentUuids) === JSON.stringify(knownOutcomeDocs) && outcome.kind === expectedOutcomeKind && outcome.observedValue === expectedValue) &&
      overlay.evidenceMessageUuid === null && overlay.resourceBefore === null && overlay.resourceAfter === null && overlay.rollType === null && overlay.rollTotal === null &&
      overlay.targetActorUuid === source.targetActorUuid && overlay.targetTokenUuid === source.targetTokenUuid &&
      overlay.semanticKey === source.semanticKey && JSON.stringify(overlay.choice) === JSON.stringify(source.choice) &&
      overlay.expectedOperation === source.expectedOperation && overlay.beforeConditionUuid === source.beforeConditionUuid &&
      overlay.beforeConditionValue === source.beforeConditionValue && overlay.actorUuid === source.actorUuid;
  }
  return overlay.decision === "confirmed-observed" && ["reserved", "uncertain"].includes(source.status) &&
    bounded(source.operationKey, 256) && bounded(source.castId, 128) && bounded(source.castMessageUuid, 512) &&
    bounded(source.sourceId, 128) && bounded(source.worldId, 128) && bounded(source.actorUuid, 512) &&
    ["attack", "save", "damage"].includes(source.action) &&
    ["public", "gm", "self", "blind"].includes(source.messageMode) &&
    bounded(source.casterActorUuid, 512) && bounded(source.targetActorUuid, 512) &&
    bounded(source.casterTokenUuid, 512) && bounded(source.targetTokenUuid, 512) &&
    Number.isFinite(Date.parse(source.createdAt)) && Number.isFinite(Date.parse(source.updatedAt)) &&
    (source.attackNumber === null || Number.isSafeInteger(source.attackNumber) && source.attackNumber >= 0) &&
    (source.action === "damage" ? overlay.rollType === "damage" : overlay.rollType === "check") &&
    bounded(overlay.evidenceMessageUuid, 512) && overlay.resourceBefore === null && overlay.resourceAfter === null &&
    ["check", "damage"].includes(overlay.rollType) && Number.isFinite(overlay.rollTotal) &&
    (source.messageUuid === null || source.messageUuid === overlay.evidenceMessageUuid) &&
    (source.rollType === null || source.rollType === overlay.rollType) &&
    (source.rollTotal === null || source.rollTotal === overlay.rollTotal);
}
const keys = [
  "reconciliationId", "worldId", "userId", "createdAt", "sourceKind", "sourceId",
  "sourceFingerprint", "sourceSnapshot", "actorUuid", "decision", "evidenceVersion",
  "evidenceMessageUuid", "resourceBefore", "resourceAfter", "rollType", "rollTotal",
];
function validRecord(value: unknown, key?: string): value is SpellReconciliationRecord {
  const effectKeys = [...keys, "targetActorUuid", "targetTokenUuid", "semanticKey", "choice", "expectedOperation", "beforeConditionUuid", "beforeConditionValue", "outcomeKind", "observedValue", "documentUuids"];
  if (!plain(value) || !exact(value, value.sourceKind === "effect" ? effectKeys : keys)) return false;
  const valid = bounded(value.reconciliationId, 128) &&
    (key === undefined || key === value.reconciliationId) &&
    bounded(value.worldId, 128) && bounded(value.userId, 128) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    ["cast", "resolution", "effect"].includes(value.sourceKind) && bounded(value.sourceId, 128) &&
    /^[a-f0-9]{64}$/.test(value.sourceFingerprint) &&
    bounded(value.sourceSnapshot, 65536) && bounded(value.actorUuid, 512) &&
    ["confirmed-observed", "refused-unchanged"].includes(value.decision) &&
    value.evidenceVersion === VERSION &&
    (value.evidenceMessageUuid === null || bounded(value.evidenceMessageUuid, 512)) &&
    (value.resourceBefore === null || validResource(value.resourceBefore)) &&
    (value.resourceAfter === null || validResource(value.resourceAfter)) &&
    (value.rollType === null || ["check", "damage"].includes(value.rollType)) &&
    (value.rollTotal === null || Number.isFinite(value.rollTotal)) &&
    (value.sourceKind === "effect"
      ? value.resourceBefore === null && value.resourceAfter === null && value.rollType === null && value.rollTotal === null &&
        bounded(value.targetActorUuid, 512) && bounded(value.targetTokenUuid, 512) && bounded(value.semanticKey, 2048) &&
        (value.beforeConditionUuid === null || bounded(value.beforeConditionUuid, 512)) &&
        (value.beforeConditionValue === null || Number.isSafeInteger(value.beforeConditionValue) && value.beforeConditionValue >= 0) &&
        Array.isArray(value.documentUuids) && value.documentUuids.every((uuid: unknown) => bounded(uuid, 512))
      : value.sourceKind === "cast"
      ? value.rollType === null && value.rollTotal === null
      : value.decision === "confirmed-observed" && value.rollType !== null && value.rollTotal !== null);
  return valid && validSourceSnapshot(value);
}

export function readSpellReconciliationLedger(ctx: BridgeContext): SpellReconciliationLedger {
  if (typeof ctx.game?.settings?.get !== "function")
    throw fail("SPELL_RECONCILIATION_LEDGER_API_UNAVAILABLE", "Foundry settings reads are unavailable.");
  let value: unknown;
  try { value = ctx.game.settings.get(MODULE_ID, SETTING); }
  catch (cause) {
    throw fail("SPELL_RECONCILIATION_LEDGER_READ_FAILED", "The spell reconciliation ledger could not be read.", {
      cause: cause instanceof Error ? cause.message.slice(0, 200) : "unknown",
    });
  }
  if (value === undefined) return { version: VERSION, entries: {} };
  if (!plain(value) || !exact(value, ["version", "entries"]) || value.version !== VERSION || !plain(value.entries))
    throw fail("SPELL_RECONCILIATION_LEDGER_INVALID", "The spell reconciliation ledger is malformed or unsupported.");
  const entries = Object.entries(value.entries);
  const sources = new Set<string>();
  if (entries.length > MAX_RECORDS || entries.some(([id, record]) => {
    if (!validRecord(record, id) || record.worldId !== ctx.game?.world?.id) return true;
    const source = `${record.sourceKind}\0${record.sourceId}\0${record.sourceFingerprint}`;
    if (sources.has(source)) return true;
    sources.add(source);
    return false;
  })) throw fail("SPELL_RECONCILIATION_LEDGER_INVALID", "The spell reconciliation ledger contains invalid, duplicate, cross-world records or exceeds capacity.");
  return structuredClone(value) as SpellReconciliationLedger;
}

export function matchingSpellReconciliation(
  ledger: SpellReconciliationLedger,
  sourceKind: "cast" | "resolution",
  sourceId: string,
  sourceFingerprint: string,
  sourceSnapshot: string,
): SpellReconciliationRecord | null {
  const matches = Object.values(ledger.entries).filter((entry) =>
    entry.sourceKind === sourceKind && entry.sourceId === sourceId &&
    entry.sourceFingerprint === sourceFingerprint && entry.sourceSnapshot === sourceSnapshot);
  if (matches.length > 1) throw fail("SPELL_RECONCILIATION_LEDGER_INVALID", "Multiple reconciliation overlays match one source record.");
  return matches[0] ? structuredClone(matches[0]) : null;
}

export async function appendSpellReconciliation(
  ctx: BridgeContext,
  input: Omit<SpellReconciliationRecord, "worldId" | "userId" | "createdAt">,
  revalidate?: () => Promise<void | (() => void)>,
): Promise<SpellReconciliationRecord> {
  return withSpellAuditLock(ctx, async (world) => {
    const userId = ctx.game?.user?.id;
    const sessionId = ctx.sessionId;
    if (ctx.game?.user?.isGM !== true || typeof userId !== "string" || !userId || userId.length > 128 ||
      typeof sessionId !== "string" || !sessionId || sessionId.length > 256 || typeof ctx.assertWrite !== "function")
      throw fail("AUTHORIZATION_REQUIRED", "Current GM and paired session are required to append spell reconciliation evidence.");
    const current = readSpellReconciliationLedger(ctx);
    if (typeof ctx.game?.settings?.set !== "function")
      throw fail("SPELL_RECONCILIATION_LEDGER_API_UNAVAILABLE", "Foundry settings writes are unavailable.");
    if (Object.hasOwn(current.entries, input.reconciliationId))
      throw fail("SPELL_RECONCILIATION_ID_COLLISION", "The reconciliation identifier is already recorded.");
    if (Object.keys(current.entries).length >= MAX_RECORDS)
      throw fail("SPELL_RECONCILIATION_LEDGER_FULL", "The spell reconciliation ledger is full; entries are never evicted.");
    const sourceKey = `${input.sourceKind}\0${input.sourceId}\0${input.sourceFingerprint}`;
    if (Object.values(current.entries).some((entry) => `${entry.sourceKind}\0${entry.sourceId}\0${entry.sourceFingerprint}` === sourceKey))
      throw fail("SPELL_RECONCILIATION_ALREADY_RECORDED", "This source evidence already has a reconciliation record.");
    const record: SpellReconciliationRecord = {
      ...structuredClone(input), worldId: world, userId,
      createdAt: new Date().toISOString(),
    };
    if (!validRecord(record, record.reconciliationId))
      throw fail("INVALID_SPELL_RECONCILIATION", "The reconciliation evidence is invalid or unbounded.");
    const next = { version: VERSION as 1, entries: { ...current.entries, [record.reconciliationId]: record } };
    let writeAttempted = false;
    try {
      const finalCheck = revalidate ? await revalidate() : undefined;
      if (ctx.game?.world?.id !== world) throw fail("WORLD_CHANGED", "The active world changed before reconciliation append.");
      if (ctx.game?.user?.id !== userId || ctx.game?.user?.isGM !== true || ctx.sessionId !== sessionId)
        throw fail("SESSION_CHANGED", "GM or bridge session changed before reconciliation append.");
      finalCheck?.();
      ctx.assertWrite();
      writeAttempted = true;
      await ctx.game.settings.set(MODULE_ID, SETTING, structuredClone(next));
      if (ctx.game?.world?.id !== world || ctx.game?.user?.id !== userId || ctx.game?.user?.isGM !== true || ctx.sessionId !== sessionId)
        throw fail("SESSION_CHANGED", "GM or world changed during reconciliation append.");
      const observedEntries = readSpellReconciliationLedger(ctx).entries;
      const observed = Object.hasOwn(observedEntries, record.reconciliationId) ? observedEntries[record.reconciliationId] : undefined;
      if (!observed || JSON.stringify(observed) !== JSON.stringify(record))
        throw fail("SPELL_RECONCILIATION_READBACK_MISMATCH", "The appended reconciliation could not be confirmed by readback.");
      return structuredClone(record);
    } catch (cause) {
      if (!writeAttempted) throw cause;
      let status: "confirmed" | "absent" | "unknown" = "unknown";
      try {
        const entries = readSpellReconciliationLedger(ctx).entries;
        if (!Object.hasOwn(entries, record.reconciliationId)) status = "absent";
        else status = JSON.stringify(entries[record.reconciliationId]) === JSON.stringify(record) ? "confirmed" : "unknown";
      } catch { status = "unknown"; }
      if (status === "confirmed") return structuredClone(record);
      throw fail("SPELL_RECONCILIATION_APPEND_UNCONFIRMED", "The reconciliation append was attempted once; inspect the audit record before any further action.", {
        reconciliationId: record.reconciliationId, auditStatus: status,
        causeCode: (cause as any)?.code ?? null,
      });
    }
  });
}

export const __spellReconciliationStoreTest = { validRecord };
