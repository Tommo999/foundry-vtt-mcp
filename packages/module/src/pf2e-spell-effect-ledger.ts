import type { BridgeContext } from "./bridge-context.js";
import { withSpellAuditLock } from "./pf2e-spell-audit-lock.js";

const MODULE_ID = "foundry-vtt-mcp";
const SETTING = "spellEffectOutcomes";
const VERSION = 1;
const MAX_RECORDS = 5000;

export type SpellEffectChoice =
  | { kind: "effect"; uuid: string }
  | { kind: "condition"; slug: string; value: number | null };
export type SpellEffectOutcome = {
  kind: "effect-created" | "condition-created" | "condition-increased" | "already-satisfied";
  documentUuids: string[];
  observedValue: number | null;
};
export type SpellEffectStatus = "reserved" | "confirmed" | "uncertain";
export type SpellEffectExpectedOperation =
  | "create-effect"
  | "create-condition"
  | "increase-condition"
  | "already-satisfied";
export type SpellEffectRecord = {
  applicationId: string;
  semanticKey: string;
  worldId: string;
  userId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  castMessageUuid: string;
  castId: string;
  casterActorUuid: string;
  casterTokenUuid: string;
  targetActorUuid: string;
  targetTokenUuid: string;
  choice: SpellEffectChoice;
  reviewFingerprint: string;
  expectedOperation: SpellEffectExpectedOperation;
  beforeConditionUuid: string | null;
  beforeConditionValue: number | null;
  status: SpellEffectStatus;
  outcome: SpellEffectOutcome | null;
};
export type SpellEffectLedger = {
  version: 1;
  entries: Record<string, SpellEffectRecord>;
};
export type SpellEffectReservation = Omit<
  SpellEffectRecord,
  "worldId" | "userId" | "createdAt" | "updatedAt" | "status" | "outcome"
>;

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
function keysForChoice(choice: unknown): string[] {
  if (!plain(choice)) return [];
  return choice.kind === "effect"
    ? ["kind", "uuid"]
    : ["kind", "slug", "value"];
}
function validChoice(value: unknown): value is SpellEffectChoice {
  if (!plain(value) || !exact(value, keysForChoice(value))) return false;
  if (value.kind === "effect")
    return bounded(value.uuid, 512) && value.uuid.startsWith("Compendium.");
  return (
    value.kind === "condition" &&
    bounded(value.slug, 80) &&
    /^[a-z][a-z0-9-]*$/.test(value.slug) &&
    (value.value === null ||
      Number.isSafeInteger(value.value) &&
      value.value >= 1 &&
      value.value <= 100)
  );
}
function validOutcome(value: unknown): value is SpellEffectOutcome {
  return Boolean(
    plain(value) &&
      exact(value, ["kind", "documentUuids", "observedValue"]) &&
      ["effect-created", "condition-created", "condition-increased", "already-satisfied"].includes(
        value.kind,
      ) &&
      Array.isArray(value.documentUuids) &&
      value.documentUuids.length > 0 &&
      value.documentUuids.length <= 30 &&
      value.documentUuids.every((uuid: unknown) => bounded(uuid, 512)) &&
      new Set(value.documentUuids).size === value.documentUuids.length &&
      (value.observedValue === null || Number.isSafeInteger(value.observedValue) && value.observedValue >= 0) &&
      (value.kind !== "effect-created" || value.observedValue === null) &&
      (value.kind !== "condition-increased" || value.observedValue !== null),
  );
}
function compatibleOutcome(choice: SpellEffectChoice, operation: SpellEffectExpectedOperation, outcome: SpellEffectOutcome): boolean {
  return choice.kind === "effect" ? outcome.kind === "effect-created" && outcome.observedValue === null :
    operation === "already-satisfied" ? outcome.kind === "already-satisfied" && outcome.observedValue === choice.value :
      operation === "create-condition" ? outcome.kind === "condition-created" && outcome.observedValue === choice.value :
        operation === "increase-condition" && outcome.kind === "condition-increased" && outcome.observedValue === choice.value;
}
const AUDIT_PROJECTION_KEYS = ["sourceKind", "sourceId", "worldId", "actorUuid", "casterTokenUuid", "targetActorUuid", "targetTokenUuid", "castMessageUuid", "castId", "semanticKey", "choice", "reviewFingerprint", "expectedOperation", "beforeConditionUuid", "beforeConditionValue", "status", "outcome"];
export function spellEffectAuditProjection(record: SpellEffectRecord): Record<string, unknown> {
  return {
    sourceKind: "effect", sourceId: record.applicationId, worldId: record.worldId,
    actorUuid: record.casterActorUuid, casterTokenUuid: record.casterTokenUuid,
    targetActorUuid: record.targetActorUuid, targetTokenUuid: record.targetTokenUuid,
    castMessageUuid: record.castMessageUuid, castId: record.castId,
    semanticKey: record.semanticKey, choice: structuredClone(record.choice),
    reviewFingerprint: record.reviewFingerprint, expectedOperation: record.expectedOperation,
    beforeConditionUuid: record.beforeConditionUuid, beforeConditionValue: record.beforeConditionValue,
    status: record.status, outcome: record.outcome ? structuredClone(record.outcome) : null,
  };
}
export function validSpellEffectAuditProjection(value: unknown): boolean {
  if (!plain(value) || !exact(value, AUDIT_PROJECTION_KEYS) || value.sourceKind !== "effect" ||
    !bounded(value.sourceId, 128) || !value.sourceId.startsWith("spell-effect-") ||
    !bounded(value.worldId, 128) || !bounded(value.actorUuid, 512) || !bounded(value.casterTokenUuid, 512) ||
    !bounded(value.targetActorUuid, 512) || !bounded(value.targetTokenUuid, 512) ||
    !bounded(value.castMessageUuid, 512) || !bounded(value.castId, 128) || !bounded(value.semanticKey, 2048) ||
    !validChoice(value.choice) || !/^[a-f0-9]{64}$/.test(value.reviewFingerprint) ||
    !["create-effect", "create-condition", "increase-condition", "already-satisfied"].includes(value.expectedOperation) ||
    !["reserved", "uncertain"].includes(value.status) ||
    !(value.beforeConditionUuid === null || bounded(value.beforeConditionUuid, 512)) ||
    !(value.beforeConditionValue === null || Number.isSafeInteger(value.beforeConditionValue) && value.beforeConditionValue >= 0) ||
    value.semanticKey !== spellEffectSemanticKey(value.castMessageUuid, value.targetActorUuid, value.choice)) return false;
  if (value.choice.kind === "effect") {
    if (value.expectedOperation !== "create-effect" || value.beforeConditionUuid !== null || value.beforeConditionValue !== null) return false;
  } else if (value.expectedOperation === "create-effect" ||
    value.expectedOperation === "create-condition" && (value.beforeConditionUuid !== null || value.beforeConditionValue !== null) ||
    value.expectedOperation === "increase-condition" && (!bounded(value.beforeConditionUuid, 512) || value.beforeConditionValue === null || value.choice.value === null || value.choice.value <= value.beforeConditionValue) ||
    value.expectedOperation === "already-satisfied" && (value.choice.value !== value.beforeConditionValue || !bounded(value.beforeConditionUuid, 512))) return false;
  if (value.outcome === null) return value.choice.kind === "effect";
  return validOutcome(value.outcome) && compatibleOutcome(value.choice, value.expectedOperation, value.outcome);
}
const RECORD_KEYS = [
  "applicationId",
  "semanticKey",
  "worldId",
  "userId",
  "sessionId",
  "createdAt",
  "updatedAt",
  "castMessageUuid",
  "castId",
  "casterActorUuid",
  "casterTokenUuid",
  "targetActorUuid",
  "targetTokenUuid",
  "choice",
  "reviewFingerprint",
  "expectedOperation",
  "beforeConditionUuid",
  "beforeConditionValue",
  "status",
  "outcome",
];
function validRecord(value: unknown, key?: string): value is SpellEffectRecord {
  if (!plain(value) || !exact(value, RECORD_KEYS)) return false;
  const valid =
    bounded(value.applicationId, 128) &&
    value.applicationId.startsWith("spell-effect-") &&
    bounded(value.semanticKey, 2048) &&
    (key === undefined || key === value.semanticKey) &&
    bounded(value.worldId, 128) &&
    bounded(value.userId, 128) &&
    bounded(value.sessionId, 256) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    bounded(value.castMessageUuid, 512) &&
    bounded(value.castId, 128) &&
    bounded(value.casterActorUuid, 512) &&
    bounded(value.casterTokenUuid, 512) &&
    bounded(value.targetActorUuid, 512) &&
    bounded(value.targetTokenUuid, 512) &&
    validChoice(value.choice) &&
    /^[a-f0-9]{64}$/.test(value.reviewFingerprint) &&
    ["create-effect", "create-condition", "increase-condition", "already-satisfied"].includes(value.expectedOperation) &&
    (value.beforeConditionUuid === null || bounded(value.beforeConditionUuid, 512)) &&
    (value.beforeConditionValue === null || Number.isSafeInteger(value.beforeConditionValue) && value.beforeConditionValue >= 0) &&
    (value.choice.kind === "effect"
      ? value.expectedOperation === "create-effect" && value.beforeConditionUuid === null && value.beforeConditionValue === null
      : value.expectedOperation !== "create-effect" &&
        (value.expectedOperation === "create-condition"
          ? value.beforeConditionUuid === null && value.beforeConditionValue === null
          : bounded(value.beforeConditionUuid, 512)) &&
        (value.expectedOperation === "already-satisfied"
          ? value.choice.value === value.beforeConditionValue
          : value.expectedOperation !== "increase-condition" || value.choice.value !== null && value.beforeConditionValue !== null && value.choice.value > value.beforeConditionValue)) &&
    value.semanticKey === spellEffectSemanticKey(value.castMessageUuid, value.targetActorUuid, value.choice) &&
    ["reserved", "confirmed", "uncertain"].includes(value.status) &&
    (value.outcome === null || validOutcome(value.outcome)) &&
    (value.status === "reserved"
      ? value.outcome === null
      : value.status === "confirmed"
        ? value.outcome !== null
        : true) &&
    (value.outcome === null || compatibleOutcome(value.choice, value.expectedOperation, value.outcome));
  return valid;
}
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function world(ctx: BridgeContext): string {
  const id = ctx.game?.world?.id;
  if (!bounded(id, 128))
    throw fail("WORLD_UNAVAILABLE", "The active world identity is unavailable.");
  return id;
}
function readRaw(ctx: BridgeContext): unknown {
  if (typeof ctx.game?.settings?.get !== "function")
    throw fail("SPELL_EFFECT_LEDGER_API_UNAVAILABLE", "Foundry settings reads are unavailable.");
  try {
    return ctx.game.settings.get(MODULE_ID, SETTING);
  } catch {
    throw fail("SPELL_EFFECT_LEDGER_READ_FAILED", "The spell-effect outcome ledger could not be read.");
  }
}
export function readSpellEffectLedger(ctx: BridgeContext): SpellEffectLedger {
  const currentWorld = world(ctx);
  const value = readRaw(ctx);
  if (value === undefined) return { version: VERSION, entries: {} };
  if (!plain(value) || !exact(value, ["version", "entries"]) || value.version !== VERSION || !plain(value.entries))
    throw fail("SPELL_EFFECT_LEDGER_INVALID", "The spell-effect outcome ledger is malformed or unsupported.");
  const pairs = Object.entries(value.entries);
  const applications = new Set<string>();
  if (
    pairs.length > MAX_RECORDS ||
    pairs.some(([key, record]) => {
      if (!validRecord(record, key) || record.worldId !== currentWorld || applications.has(record.applicationId)) return true;
      applications.add(record.applicationId);
      return false;
    })
  )
    throw fail("SPELL_EFFECT_LEDGER_INVALID", "The spell-effect outcome ledger contains invalid, cross-world records or exceeds its capacity.");
  return structuredClone(value) as SpellEffectLedger;
}
export function spellEffectSemanticKey(
  castMessageUuid: string,
  targetActorUuid: string,
  choice: SpellEffectChoice,
): string {
  const selected = choice.kind === "effect" ? `effect:${choice.uuid}` : `condition:${choice.slug}`;
  return JSON.stringify([castMessageUuid, targetActorUuid, selected]);
}
export function spellEffectLedgerAvailability(
  ledger: SpellEffectLedger,
  semanticKey: string,
): { available: boolean; blockedStatus: SpellEffectStatus | null; count: number; remaining: number } {
  const existing = ledger.entries[semanticKey];
  return {
    available: !existing && Object.keys(ledger.entries).length < MAX_RECORDS,
    blockedStatus: existing?.status ?? null,
    count: Object.keys(ledger.entries).length,
    remaining: Math.max(0, MAX_RECORDS - Object.keys(ledger.entries).length),
  };
}
function identity(ctx: BridgeContext) {
  const worldId = world(ctx), userId = ctx.game?.user?.id, sessionId = ctx.sessionId;
  if (ctx.game?.user?.isGM !== true || !bounded(userId, 128) || !bounded(sessionId, 256) || typeof ctx.assertWrite !== "function")
    throw fail("AUTHORIZATION_REQUIRED", "A current paired GM session is required for the spell-effect ledger.");
  return { worldId, userId, sessionId };
}
function stillCurrent(ctx: BridgeContext, expected: ReturnType<typeof identity>) {
  if (ctx.game?.world?.id !== expected.worldId)
    throw fail("WORLD_CHANGED", "The active world changed during spell-effect ledger access.");
  if (ctx.game?.user?.id !== expected.userId || ctx.game?.user?.isGM !== true || ctx.sessionId !== expected.sessionId)
    throw fail("SESSION_CHANGED", "The GM or paired session changed during spell-effect ledger access.");
}
async function persistOnce(ctx: BridgeContext, expected: ReturnType<typeof identity>, next: SpellEffectLedger, record: SpellEffectRecord, operation: string, revalidate?: () => void | (() => void) | Promise<void | (() => void)>): Promise<SpellEffectRecord> {
  let attempted = false;
  try {
    const finalCheck = revalidate ? await revalidate() : undefined;
    stillCurrent(ctx, expected);
    finalCheck?.();
    if (typeof ctx.game?.settings?.set !== "function")
      throw fail("SPELL_EFFECT_LEDGER_API_UNAVAILABLE", "Foundry settings writes are unavailable.");
    ctx.assertWrite();
    attempted = true;
    await ctx.game.settings.set(MODULE_ID, SETTING, structuredClone(next));
    stillCurrent(ctx, expected);
    const observed = readSpellEffectLedger(ctx).entries[record.semanticKey];
    if (!observed || !same(observed, record))
      throw fail("SPELL_EFFECT_LEDGER_READBACK_MISMATCH", `The ${operation} ledger write did not match readback.`);
    return structuredClone(record);
  } catch (cause) {
    if (!attempted) throw cause;
    let state: "committed" | "absent" | "unknown" = "unknown";
    try {
      const observed = readSpellEffectLedger(ctx).entries[record.semanticKey];
      if (!observed) state = "absent";
      else if (same(observed, record)) state = "committed";
    } catch { state = "unknown"; }
    if (state === "committed") return structuredClone(record);
    throw fail("SPELL_EFFECT_LEDGER_WRITE_UNCONFIRMED", `The ${operation} ledger write was attempted once; inspect its stored state before any further action.`, {
      applicationId: record.applicationId,
      semanticKey: record.semanticKey,
      auditStatus: state,
      causeCode: (cause as any)?.code ?? null,
    });
  }
}
export async function reserveSpellEffect(
  ctx: BridgeContext,
  reservation: SpellEffectReservation,
  revalidate?: () => void | (() => void) | Promise<void | (() => void)>,
): Promise<SpellEffectRecord> {
  return withSpellAuditLock(ctx, async (worldId) => {
    const expected = identity(ctx);
    if (worldId !== expected.worldId) throw fail("WORLD_CHANGED", "The active world changed before spell-effect reservation.");
    const current = readSpellEffectLedger(ctx);
    if (Object.hasOwn(current.entries, reservation.semanticKey))
      throw fail("SPELL_EFFECT_ALREADY_RESERVED", "This cast, target Actor, and selected effect or condition are already reserved or recorded.");
    if (Object.values(current.entries).some((record) => record.applicationId === reservation.applicationId))
      throw fail("SPELL_EFFECT_APPLICATION_ID_COLLISION", "The spell-effect application identifier is already recorded.");
    if (reservation.sessionId !== expected.sessionId)
      throw fail("SESSION_CHANGED", "The spell-effect preview belongs to a different paired session.");
    if (Object.keys(current.entries).length >= MAX_RECORDS)
      throw fail("SPELL_EFFECT_LEDGER_FULL", "The spell-effect outcome ledger is full; records are never evicted.");
    const now = new Date().toISOString();
    const record: SpellEffectRecord = {
      ...structuredClone(reservation),
      worldId,
      userId: expected.userId,
      sessionId: reservation.sessionId,
      createdAt: now,
      updatedAt: now,
      status: "reserved",
      outcome: null,
    };
    if (!validRecord(record, record.semanticKey))
      throw fail("INVALID_SPELL_EFFECT_RESERVATION", "The spell-effect reservation is invalid or unbounded.");
    const next: SpellEffectLedger = { version: VERSION, entries: { ...current.entries, [record.semanticKey]: record } };
    return persistOnce(ctx, expected, next, record, "reservation", revalidate);
  });
}
export async function finalizeSpellEffect(
  ctx: BridgeContext,
  semanticKey: string,
  applicationId: string,
  status: "confirmed" | "uncertain",
  outcome: SpellEffectOutcome | null,
): Promise<SpellEffectRecord> {
  return withSpellAuditLock(ctx, async (worldId) => {
    const expected = identity(ctx);
    if (worldId !== expected.worldId) throw fail("WORLD_CHANGED", "The active world changed before spell-effect finalization.");
    const current = readSpellEffectLedger(ctx);
    const previous = current.entries[semanticKey];
    if (!previous || previous.applicationId !== applicationId)
      throw fail("SPELL_EFFECT_RESERVATION_NOT_FOUND", "The exact spell-effect reservation was not found.");
    if (previous.status !== "reserved")
      throw fail("SPELL_EFFECT_ALREADY_FINAL", "The spell-effect reservation already has a terminal status.");
    if (previous.userId !== expected.userId || previous.sessionId !== expected.sessionId)
      throw fail("SESSION_CHANGED", "The reservation belongs to a different GM or paired session.");
    const record: SpellEffectRecord = {
      ...previous,
      status,
      outcome: outcome ? structuredClone(outcome) : null,
      updatedAt: new Date().toISOString(),
    };
    if (!validRecord(record, semanticKey))
      throw fail("INVALID_SPELL_EFFECT_OUTCOME", "The spell-effect terminal outcome is invalid.");
    const next: SpellEffectLedger = { version: VERSION, entries: { ...current.entries, [semanticKey]: record } };
    return persistOnce(ctx, expected, next, record, "finalization");
  });
}
export const __spellEffectLedgerTest = { validRecord, MAX_RECORDS };
