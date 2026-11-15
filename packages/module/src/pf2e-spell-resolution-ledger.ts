import type { BridgeContext } from "./bridge-context.js";
import { withSpellAuditLock } from "./pf2e-spell-audit-lock.js";

const MODULE_ID = "foundry-vtt-mcp";
const SETTING = "spellResolutions";
const VERSION = 1;
const MAX_RECORDS = 5000;

export type ResolutionAction = "attack" | "save" | "damage";
export type ResolutionStatus = "reserved" | "confirmed" | "uncertain";
export type SpellResolutionRecord = {
  resolutionId: string;
  operationKey: string;
  worldId: string;
  userId: string;
  sessionId: string;
  castId: string;
  castMessageUuid: string;
  action: ResolutionAction;
  messageMode: "public" | "gm" | "blind" | "self";
  casterActorUuid: string;
  targetActorUuid: string;
  casterTokenUuid: string;
  targetTokenUuid: string;
  attackNumber: number | null;
  reviewToken: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  status: ResolutionStatus;
  messageUuid: string | null;
  rollType: "check" | "damage" | null;
  rollTotal: number | null;
};
export type SpellResolutionReservation = Omit<
  SpellResolutionRecord,
  | "worldId"
  | "userId"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "messageUuid"
  | "rollType"
  | "rollTotal"
>;

function fail(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function bounded(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}
function recordKeys(): string[] {
  return [
    "resolutionId",
    "operationKey",
    "worldId",
    "userId",
    "sessionId",
    "castId",
    "castMessageUuid",
    "action",
    "messageMode",
    "casterActorUuid",
    "targetActorUuid",
    "casterTokenUuid",
    "targetTokenUuid",
    "attackNumber",
    "reviewToken",
    "fingerprint",
    "createdAt",
    "updatedAt",
    "status",
    "messageUuid",
    "rollType",
    "rollTotal",
  ];
}
function validRecord(
  value: unknown,
  key?: string,
): value is SpellResolutionRecord {
  const record = value as any;
  return Boolean(
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    exactKeys(record, recordKeys()) &&
    bounded(record.resolutionId, 128) &&
    record.resolutionId.startsWith("spell-resolution-") &&
    (key === undefined || key === record.resolutionId) &&
    bounded(record.operationKey, 2048) &&
    bounded(record.worldId, 128) &&
    bounded(record.userId, 128) &&
    bounded(record.sessionId, 256) &&
    bounded(record.castId, 128) &&
    bounded(record.castMessageUuid) &&
    ["attack", "save", "damage"].includes(record.action) &&
    ["public", "gm", "blind", "self"].includes(record.messageMode) &&
    bounded(record.casterActorUuid) &&
    bounded(record.targetActorUuid) &&
    bounded(record.casterTokenUuid) &&
    bounded(record.targetTokenUuid) &&
    (record.action === "attack"
      ? Number.isInteger(record.attackNumber) &&
        record.attackNumber >= 1 &&
        record.attackNumber <= 3
      : record.attackNumber === null) &&
    bounded(record.reviewToken, 128) &&
    bounded(record.fingerprint, 128) &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    Number.isFinite(Date.parse(record.updatedAt)) &&
    ["reserved", "confirmed", "uncertain"].includes(record.status) &&
    (record.messageUuid === null || bounded(record.messageUuid)) &&
    (record.rollType === null ||
      record.rollType === "check" ||
      record.rollType === "damage") &&
    (record.rollTotal === null || Number.isFinite(record.rollTotal)) &&
    (record.status !== "reserved" ||
      (record.messageUuid === null &&
        record.rollType === null &&
        record.rollTotal === null)) &&
    (record.rollType === null ||
      (record.action === "damage"
        ? record.rollType === "damage"
        : record.rollType === "check")) &&
    (record.status !== "confirmed" ||
      (record.messageUuid !== null &&
        record.rollType !== null &&
        record.rollTotal !== null &&
        (record.action === "damage"
          ? record.rollType === "damage"
          : record.rollType === "check"))),
  );
}
function worldId(ctx: BridgeContext): string {
  const id = ctx.game?.world?.id;
  if (!bounded(id, 128))
    throw fail(
      "WORLD_UNAVAILABLE",
      "The active world identity is unavailable.",
    );
  return id;
}
function userId(ctx: BridgeContext): string {
  const id = ctx.game?.user?.id;
  if (!bounded(id, 128))
    throw fail("SESSION_CHANGED", "The active user identity is unavailable.");
  return id;
}
function sameWorld(ctx: BridgeContext, id: string) {
  if (worldId(ctx) !== id)
    throw fail(
      "WORLD_CHANGED",
      "The world changed during spell-resolution audit access.",
    );
}
function read(ctx: BridgeContext) {
  let value: any;
  if (typeof ctx.game?.settings?.get !== "function")
    throw fail(
      "SPELL_RESOLUTION_LEDGER_API_UNAVAILABLE",
      "Foundry settings reads are unavailable.",
    );
  try {
    value = ctx.game.settings.get(MODULE_ID, SETTING);
  } catch (cause) {
    throw fail(
      "SPELL_RESOLUTION_LEDGER_READ_FAILED",
      "The spell-resolution ledger could not be read.",
      {
        cause: cause instanceof Error ? cause.message.slice(0, 200) : "unknown",
      },
    );
  }
  if (value === undefined)
    return {
      version: VERSION,
      entries: {} as Record<string, SpellResolutionRecord>,
    };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, ["version", "entries"]) ||
    value.version !== VERSION ||
    !value.entries ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries)
  )
    throw fail(
      "SPELL_RESOLUTION_LEDGER_INVALID",
      "The spell-resolution ledger is malformed or unsupported.",
    );
  const entries = Object.entries(value.entries);
  const operations = new Set<string>();
  if (
    entries.length > MAX_RECORDS ||
    entries.some(([key, record]) => {
      if (
        !validRecord(record, key) ||
        (record as SpellResolutionRecord).worldId !== ctx.game?.world?.id
      )
        return true;
      const semantic = (record as SpellResolutionRecord).operationKey;
      if (operations.has(semantic)) return true;
      operations.add(semantic);
      return false;
    })
  )
    throw fail(
      "SPELL_RESOLUTION_LEDGER_INVALID",
      "The spell-resolution ledger contains invalid, duplicate, cross-world records or exceeds its capacity.",
    );
  return clone(value) as {
    version: 1;
    entries: Record<string, SpellResolutionRecord>;
  };
}
function statusById(
  ctx: BridgeContext,
  id: string,
  resolutionId: string,
): { status: ResolutionStatus | null; known: boolean } {
  try {
    sameWorld(ctx, id);
    const entries = read(ctx).entries;
    return {
      status: Object.hasOwn(entries, resolutionId) ? entries[resolutionId].status : null,
      known: true,
    };
  } catch {
    return { status: null, known: false };
  }
}
function bindingMatches(ctx: BridgeContext, record: SpellResolutionRecord) {
  if (
    userId(ctx) !== record.userId ||
    ctx.sessionId !== record.sessionId ||
    ctx.game?.user?.isGM !== true
  )
    throw fail(
      "SESSION_CHANGED",
      "The GM or paired bridge session changed during spell-resolution audit access.",
    );
}
async function persist(
  ctx: BridgeContext,
  id: string,
  next: { version: 1; entries: Record<string, SpellResolutionRecord> },
  record: SpellResolutionRecord,
) {
  sameWorld(ctx, id);
  bindingMatches(ctx, record);
  if (ctx.game?.user?.isGM !== true || typeof ctx.assertWrite !== "function")
    throw fail(
      "AUTHORIZATION_REQUIRED",
      "Current GM authorization is required for the spell-resolution ledger.",
    );
  ctx.assertWrite();
  sameWorld(ctx, id);
  bindingMatches(ctx, record);
  if (typeof ctx.game?.settings?.set !== "function")
    throw fail(
      "SPELL_RESOLUTION_LEDGER_API_UNAVAILABLE",
      "Foundry settings writes are unavailable.",
    );
  await ctx.game.settings.set(MODULE_ID, SETTING, clone(next));
  sameWorld(ctx, id);
  bindingMatches(ctx, record);
}
function timestamp() {
  return new Date().toISOString();
}

export function inspectSpellResolutionLedger(
  ctx: BridgeContext,
  operationKey: string,
) {
  const ledger = read(ctx);
  const existing = Object.values(ledger.entries).find(
    (entry) => entry.operationKey === operationKey,
  );
  return {
    capacityRemaining: MAX_RECORDS - Object.keys(ledger.entries).length,
    blocked: Boolean(existing),
    status: existing?.status ?? null,
    resolutionId: existing?.resolutionId ?? null,
  };
}
export async function reserveSpellResolution(
  ctx: BridgeContext,
  input: SpellResolutionReservation,
): Promise<SpellResolutionRecord> {
  return withSpellAuditLock(ctx, async (id) => {
    if (
      !input ||
      !bounded(input.resolutionId, 128) ||
      !input.resolutionId.startsWith("spell-resolution-") ||
      !bounded(input.operationKey, 2048) ||
      !bounded(input.sessionId, 256) ||
      input.sessionId !== ctx.sessionId ||
      !bounded(input.castId, 128) ||
      !bounded(input.castMessageUuid) ||
      !["attack", "save", "damage"].includes(input.action) ||
      !["public", "gm", "blind", "self"].includes(input.messageMode) ||
      !bounded(input.casterActorUuid) ||
      !bounded(input.targetActorUuid) ||
      !bounded(input.casterTokenUuid) ||
      !bounded(input.targetTokenUuid) ||
      (input.action === "attack"
        ? !Number.isInteger(input.attackNumber) ||
          input.attackNumber! < 1 ||
          input.attackNumber! > 3
        : input.attackNumber !== null) ||
      !bounded(input.reviewToken, 128) ||
      !bounded(input.fingerprint, 128)
    )
      throw fail(
        "INVALID_RESOLUTION_RESERVATION",
        "The resolution reservation is invalid or unbounded.",
      );
    const current = read(ctx);
    if (Object.hasOwn(current.entries, input.resolutionId))
      throw fail(
        "SPELL_RESOLUTION_ID_COLLISION",
        "The resolution identifier is already recorded.",
      );
    const duplicate = Object.values(current.entries).find(
      (entry) => entry.operationKey === input.operationKey,
    );
    if (duplicate)
      throw fail(
        "SPELL_RESOLUTION_ALREADY_RECORDED",
        "This cast/action/target operation is already reserved or recorded; native rolls are not replayed.",
        { resolutionId: duplicate.resolutionId, status: duplicate.status },
      );
    if (Object.keys(current.entries).length >= MAX_RECORDS)
      throw fail(
        "SPELL_RESOLUTION_LEDGER_FULL",
        "The spell-resolution ledger is full; records are never evicted.",
      );
    const now = timestamp();
    const record: SpellResolutionRecord = {
      ...clone(input),
      worldId: id,
      userId: userId(ctx),
      createdAt: now,
      updatedAt: now,
      status: "reserved",
      messageUuid: null,
      rollType: null,
      rollTotal: null,
    };
    const next = {
      version: 1 as const,
      entries: { ...current.entries, [record.resolutionId]: record },
    };
    try {
      await persist(ctx, id, next, record);
      bindingMatches(ctx, record);
      const observedEntries = read(ctx).entries;
      const observed = Object.hasOwn(observedEntries, record.resolutionId)
        ? observedEntries[record.resolutionId]
        : undefined;
      if (!observed || JSON.stringify(observed) !== JSON.stringify(record))
        throw fail(
          "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
          "Resolution reservation readback did not match.",
        );
      return clone(record);
    } catch (cause) {
      throw fail(
        "SPELL_RESOLUTION_RESERVATION_UNCONFIRMED",
        "The resolution reservation may or may not be stored; no native roll may proceed.",
        {
          resolutionId: record.resolutionId,
          ...statusById(ctx, id, record.resolutionId),
          causeCode: (cause as any)?.code ?? null,
        },
      );
    }
  });
}
export async function finalizeSpellResolution(
  ctx: BridgeContext,
  resolutionId: string,
  status: "confirmed" | "uncertain",
  outcome: {
    messageUuid: string | null;
    rollType: "check" | "damage" | null;
    rollTotal: number | null;
  },
): Promise<SpellResolutionRecord> {
  return withSpellAuditLock(ctx, async (id) => {
    if (
      !bounded(resolutionId, 128) ||
      !["confirmed", "uncertain"].includes(status) ||
      !outcome ||
      (outcome.messageUuid !== null && !bounded(outcome.messageUuid)) ||
      (outcome.rollType !== null &&
        !["check", "damage"].includes(outcome.rollType)) ||
      (outcome.rollTotal !== null && !Number.isFinite(outcome.rollTotal)) ||
      (status === "confirmed" &&
        (!outcome.messageUuid ||
          !outcome.rollType ||
          outcome.rollTotal === null))
    )
      throw fail(
        "INVALID_RESOLUTION_FINALIZATION",
        "Resolution outcome is invalid.",
      );
    const current = read(ctx);
    const reserved = Object.hasOwn(current.entries, resolutionId)
      ? current.entries[resolutionId]
      : undefined;
    if (!reserved || reserved.status !== "reserved")
      throw fail(
        "SPELL_RESOLUTION_RESERVATION_LOST",
        "Only a durable reserved operation can be finalized.",
      );
    bindingMatches(ctx, reserved);
    if (
      outcome.rollType !== null &&
      (reserved.action === "damage"
        ? outcome.rollType !== "damage"
        : outcome.rollType !== "check")
    )
      throw fail(
        "INVALID_RESOLUTION_FINALIZATION",
        "Roll type must match the reviewed action.",
      );
    const record = {
      ...reserved,
      updatedAt: timestamp(),
      status,
      ...clone(outcome),
    } as SpellResolutionRecord;
    const next = {
      version: 1 as const,
      entries: { ...current.entries, [resolutionId]: record },
    };
    try {
      await persist(ctx, id, next, reserved);
      bindingMatches(ctx, reserved);
      const observedEntries = read(ctx).entries;
      const observed = Object.hasOwn(observedEntries, resolutionId)
        ? observedEntries[resolutionId]
        : undefined;
      if (!observed || JSON.stringify(observed) !== JSON.stringify(record))
        throw fail(
          "SPELL_RESOLUTION_FINALIZATION_UNCONFIRMED",
          "Resolution outcome readback did not match.",
        );
      return clone(record);
    } catch (cause) {
      throw fail(
        "SPELL_RESOLUTION_FINALIZATION_UNCONFIRMED",
        "Resolution finalization was not confirmed; the settings store was not written again.",
        {
          resolutionId,
          ...statusById(ctx, id, resolutionId),
          messageUuid: outcome.messageUuid,
          causeCode: (cause as any)?.code ?? null,
        },
      );
    }
  });
}
export function readSpellResolutionRecords(ctx: BridgeContext) {
  return clone(read(ctx));
}
