import type { BridgeContext } from "./bridge-context.js";

const MODULE_ID = "foundry-vtt-mcp";
const SETTING = "spellCasts";
const VERSION = 1;
const MAX_RECORDS = 5000;
const MAX_RECENT = 10;
const worldLocks = new Map<string, Promise<void>>();

export type SpellCastResourceKind =
  "none" | "actorFocus" | "preparedSlot" | "rankPool" | "innateUse";

export type SpellCastResourceSnapshot = {
  kind: SpellCastResourceKind;
  cost: number;
  value: number | null;
  max: number | null;
  expended: boolean | null;
  groupNumber: number | null;
  slotId: number | null;
};

export type SpellCastRecord = {
  castId: string;
  worldId: string;
  userId: string;
  sessionId: string;
  actorUuid: string;
  casterTokenUuid: string;
  entryUuid: string;
  spellUuid: string;
  rank: number;
  slotId: number | null;
  targetTokenUuids: string[];
  messageMode: "public" | "gm" | "blind" | "self";
  reviewToken: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  status: "reserved" | "confirmed" | "uncertain";
  nativeConsumed: boolean | null;
  resourceBefore: SpellCastResourceSnapshot;
  resourceAfter: SpellCastResourceSnapshot | null;
  chatMessageUuid: string | null;
};

export type SpellCastReservation = Omit<
  SpellCastRecord,
  | "worldId"
  | "userId"
  | "createdAt"
  | "updatedAt"
  | "status"
  | "nativeConsumed"
  | "resourceAfter"
  | "chatMessageUuid"
>;

export type SpellCastFinalOutcome = {
  nativeConsumed: boolean | null;
  resourceAfter: SpellCastResourceSnapshot | null;
  chatMessageUuid: string | null;
};

export interface SpellCastLedgerTransaction {
  reserve(input: SpellCastReservation): Promise<SpellCastRecord>;
  finalize(
    castId: string,
    status: "confirmed" | "uncertain",
    outcome: SpellCastFinalOutcome,
  ): Promise<SpellCastRecord>;
  get(castId: string): SpellCastRecord | null;
  readActor(actorUuid: string, limit?: number): SpellCastActorSummary;
}

export type SpellCastActorSummary = {
  version: 1;
  actorUuid: string;
  recordCount: number;
  blockedCount: number;
  capacity: number;
  capacityRemaining: number;
  truncated: boolean;
  entries: Array<{
    castId: string;
    status: SpellCastRecord["status"];
    spellUuid: string;
    rank: number;
    slotId: number | null;
    createdAt: string;
    updatedAt: string;
    nativeConsumed: boolean | null;
    resourceBefore: SpellCastResourceSnapshot;
    resourceAfter: SpellCastResourceSnapshot | null;
    chatMessageUuid: string | null;
  }>;
};

function fault(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return actual.join("\n") === [...keys].sort().join("\n");
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function uuid(value: unknown): value is string {
  return boundedString(value, 512);
}
function nullableUuid(value: unknown): value is string | null {
  return value === null || uuid(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= min &&
    (value as number) <= max
  );
}
function nonnegativeValue(value: unknown): value is number | null {
  return (
    value === null || (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}
function nullableSafeNonnegative(value: unknown): value is number | null {
  return (
    value === null || (Number.isSafeInteger(value) && (value as number) >= 0)
  );
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function validResource(value: unknown): value is SpellCastResourceSnapshot {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, [
      "kind",
      "cost",
      "value",
      "max",
      "expended",
      "groupNumber",
      "slotId",
    ]) ||
    !["none", "actorFocus", "preparedSlot", "rankPool", "innateUse"].includes(
      String(value.kind),
    ) ||
    !integer(value.cost, 0, 3) ||
    !nonnegativeValue(value.value) ||
    !nonnegativeValue(value.max) ||
    !(value.expended === null || typeof value.expended === "boolean") ||
    !nullableSafeNonnegative(value.groupNumber) ||
    !(value.slotId === null || integer(value.slotId, 0, 9999))
  )
    return false;
  if (value.kind === "none") return value.cost === 0;
  if (value.kind === "actorFocus") return value.cost >= 1;
  return value.cost === 1;
}
const recordKeys = [
  "castId",
  "worldId",
  "userId",
  "sessionId",
  "actorUuid",
  "casterTokenUuid",
  "entryUuid",
  "spellUuid",
  "rank",
  "slotId",
  "targetTokenUuids",
  "messageMode",
  "reviewToken",
  "fingerprint",
  "createdAt",
  "updatedAt",
  "status",
  "nativeConsumed",
  "resourceBefore",
  "resourceAfter",
  "chatMessageUuid",
] as const;
function validRecord(value: unknown, key?: string): value is SpellCastRecord {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, recordKeys) ||
    !boundedString(value.castId, 128) ||
    (key !== undefined && key !== value.castId) ||
    !boundedString(value.worldId, 128) ||
    !boundedString(value.userId, 128) ||
    !boundedString(value.sessionId, 256) ||
    !uuid(value.actorUuid) ||
    !uuid(value.casterTokenUuid) ||
    !uuid(value.entryUuid) ||
    !uuid(value.spellUuid) ||
    !integer(value.rank, 1, 10) ||
    !(value.slotId === null || integer(value.slotId, 0, 9999)) ||
    !Array.isArray(value.targetTokenUuids) ||
    value.targetTokenUuids.length > 20 ||
    !value.targetTokenUuids.every(uuid) ||
    new Set(value.targetTokenUuids).size !== value.targetTokenUuids.length ||
    !["public", "gm", "blind", "self"].includes(value.messageMode) ||
    !boundedString(value.reviewToken, 256) ||
    !boundedString(value.fingerprint, 256) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !["reserved", "confirmed", "uncertain"].includes(value.status) ||
    !(
      value.nativeConsumed === null || typeof value.nativeConsumed === "boolean"
    ) ||
    !validResource(value.resourceBefore) ||
    !(value.resourceAfter === null || validResource(value.resourceAfter)) ||
    !nullableUuid(value.chatMessageUuid)
  )
    return false;
  if (
    value.status === "reserved" &&
    (value.nativeConsumed !== null ||
      value.resourceAfter !== null ||
      value.chatMessageUuid !== null)
  )
    return false;
  if (
    value.status === "confirmed" &&
    (value.nativeConsumed !== true ||
      value.resourceAfter === null ||
      value.chatMessageUuid === null)
  )
    return false;
  return true;
}
function validateLedger(value: unknown): {
  version: 1;
  entries: Record<string, SpellCastRecord>;
} {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, ["version", "entries"]) ||
    value.version !== VERSION ||
    !isPlainObject(value.entries)
  )
    throw fault(
      "SPELL_LEDGER_INVALID",
      "The PF2e spell-cast ledger is missing, malformed, or from an unsupported version.",
    );
  const pairs = Object.entries(value.entries);
  if (pairs.length > MAX_RECORDS)
    throw fault(
      "SPELL_LEDGER_INVALID",
      "The PF2e spell-cast ledger exceeds its supported capacity.",
    );
  for (const [key, record] of pairs) {
    if (!validRecord(record, key))
      throw fault(
        "SPELL_LEDGER_INVALID",
        "The PF2e spell-cast ledger contains an invalid record.",
      );
  }
  return value as { version: 1; entries: Record<string, SpellCastRecord> };
}
function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
function worldIdOf(ctx: BridgeContext): string {
  const id = ctx.game?.world?.id;
  if (!boundedString(id, 128))
    throw fault(
      "WORLD_UNAVAILABLE",
      "The active Foundry world identity is unavailable.",
    );
  return id;
}
function currentUserId(ctx: BridgeContext): string {
  const id = ctx.game?.user?.id;
  if (!boundedString(id, 128))
    throw fault(
      "SESSION_CHANGED",
      "The active Foundry user identity is unavailable.",
    );
  return id;
}
function sameWorld(ctx: BridgeContext, expectedWorldId: string): void {
  if (worldIdOf(ctx) !== expectedWorldId)
    throw fault(
      "WORLD_CHANGED",
      "The active world changed while updating the spell-cast ledger.",
    );
}
function readLedger(ctx: BridgeContext): {
  version: 1;
  entries: Record<string, SpellCastRecord>;
} {
  if (typeof ctx.game?.settings?.get !== "function")
    throw fault(
      "SPELL_LEDGER_API_UNAVAILABLE",
      "Foundry settings read API is unavailable for the spell-cast ledger.",
    );
  let value: unknown;
  try {
    value = ctx.game.settings.get(MODULE_ID, SETTING);
  } catch (cause) {
    throw fault(
      "SPELL_LEDGER_READ_FAILED",
      "The spell-cast ledger could not be read; no cast may proceed.",
      {
        cause:
          cause instanceof Error
            ? cause.message.slice(0, 240)
            : "Unknown settings read error",
      },
    );
  }
  if (value === undefined) return { version: VERSION, entries: {} };
  return clone(validateLedger(value));
}
function assertWriteApi(ctx: BridgeContext, expectedWorldId: string): void {
  sameWorld(ctx, expectedWorldId);
  if (typeof ctx.game?.settings?.set !== "function")
    throw fault(
      "SPELL_LEDGER_API_UNAVAILABLE",
      "Foundry settings write API is unavailable for the spell-cast ledger.",
    );
  if (typeof ctx.assertWrite !== "function")
    throw fault(
      "AUTHORIZATION_REQUIRED",
      "Spell-cast ledger writes require current GM authorization.",
    );
  ctx.assertWrite();
  sameWorld(ctx, expectedWorldId);
}
async function persist(
  ctx: BridgeContext,
  expectedWorldId: string,
  ledger: { version: 1; entries: Record<string, SpellCastRecord> },
): Promise<void> {
  assertWriteApi(ctx, expectedWorldId);
  try {
    await ctx.game.settings.set(MODULE_ID, SETTING, clone(ledger));
  } catch (cause) {
    throw fault(
      "SPELL_LEDGER_WRITE_FAILED",
      "The spell-cast ledger write did not complete; audit state must be checked before continuing.",
      {
        cause:
          cause instanceof Error
            ? cause.message.slice(0, 240)
            : "Unknown settings write error",
      },
    );
  }
  sameWorld(ctx, expectedWorldId);
}
async function withWorldLock<T>(
  ctx: BridgeContext,
  task: (worldId: string) => Promise<T>,
): Promise<T> {
  const worldId = worldIdOf(ctx);
  const previous = worldLocks.get(worldId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  worldLocks.set(worldId, tail);
  await previous;
  try {
    sameWorld(ctx, worldId);
    return await task(worldId);
  } finally {
    release();
    if (worldLocks.get(worldId) === tail) worldLocks.delete(worldId);
  }
}
function isoNow(): string {
  return new Date().toISOString();
}
function validReservation(input: SpellCastReservation): void {
  if (
    !isPlainObject(input) ||
    !exactKeys(input, [
      "castId",
      "sessionId",
      "actorUuid",
      "casterTokenUuid",
      "entryUuid",
      "spellUuid",
      "rank",
      "slotId",
      "targetTokenUuids",
      "messageMode",
      "reviewToken",
      "fingerprint",
      "resourceBefore",
    ])
  )
    throw fault(
      "INVALID_CAST_RESERVATION",
      "The spell-cast reservation contains unexpected fields.",
    );
  const now = isoNow();
  const candidate: SpellCastRecord = {
    ...input,
    worldId: "world",
    userId: "user",
    createdAt: now,
    updatedAt: now,
    status: "reserved",
    nativeConsumed: null,
    resourceAfter: null,
    chatMessageUuid: null,
  };
  if (!validRecord(candidate))
    throw fault(
      "INVALID_CAST_RESERVATION",
      "The spell-cast reservation contains invalid or unbounded fields.",
    );
}
function recordCopy(value: SpellCastRecord): SpellCastRecord {
  return clone(value);
}
function sameRecord(
  left: SpellCastRecord | undefined,
  right: SpellCastRecord,
): boolean {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}
function getEntry(
  entries: Record<string, SpellCastRecord>,
  castId: string,
): SpellCastRecord | undefined {
  return Object.prototype.hasOwnProperty.call(entries, castId)
    ? entries[castId]
    : undefined;
}
function actorSummary(
  ledger: { version: 1; entries: Record<string, SpellCastRecord> },
  actorUuid: string,
  limit: number,
): SpellCastActorSummary {
  if (!uuid(actorUuid))
    throw fault(
      "INVALID_INPUT",
      "actorUuid must be a bounded world Actor UUID.",
    );
  if (!integer(limit, 1, MAX_RECENT))
    throw fault(
      "INVALID_INPUT",
      "Actor ledger summary limit must be between 1 and 10.",
    );
  const all = Object.values(ledger.entries)
    .filter((record) => record.actorUuid === actorUuid)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const entries = all.slice(0, limit).map((record) => ({
    castId: record.castId,
    status: record.status,
    spellUuid: record.spellUuid,
    rank: record.rank,
    slotId: record.slotId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    nativeConsumed: record.nativeConsumed,
    resourceBefore: clone(record.resourceBefore),
    resourceAfter: record.resourceAfter ? clone(record.resourceAfter) : null,
    chatMessageUuid: record.chatMessageUuid,
  }));
  return {
    version: VERSION,
    actorUuid,
    recordCount: all.length,
    blockedCount: all.filter(
      (record) => record.status === "reserved" || record.status === "uncertain",
    ).length,
    capacity: MAX_RECORDS,
    capacityRemaining: MAX_RECORDS - Object.keys(ledger.entries).length,
    truncated: all.length > entries.length,
    entries,
  };
}

export async function withSpellCastLedger<T>(
  ctx: BridgeContext,
  task: (transaction: SpellCastLedgerTransaction) => Promise<T>,
): Promise<T> {
  return withWorldLock(ctx, async (lockedWorldId) => {
    let active = true;
    let operation = Promise.resolve();
    const serialized = <R>(work: () => Promise<R>): Promise<R> => {
      if (!active)
        return Promise.reject(
          fault(
            "LEDGER_TRANSACTION_CLOSED",
            "Spell-cast ledger transaction is closed.",
          ),
        );
      const result = operation.then(() => {
        if (!active)
          throw fault(
            "LEDGER_TRANSACTION_CLOSED",
            "Spell-cast ledger transaction is closed.",
          );
        return work();
      });
      operation = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
    const readCurrent = () => {
      sameWorld(ctx, lockedWorldId);
      return readLedger(ctx);
    };
    const transaction: SpellCastLedgerTransaction = {
      reserve: (input) =>
        serialized(async () => {
          sameWorld(ctx, lockedWorldId);
          const userId = currentUserId(ctx);
          if (!boundedString(input.sessionId, 256))
            throw fault(
              "SESSION_CHANGED",
              "A current bridge session identifier is required for spell-cast reservations.",
            );
          validReservation(input);
          const current = readCurrent();
          const duplicate = getEntry(current.entries, input.castId);
          if (duplicate)
            throw fault(
              "CAST_ALREADY_RECORDED",
              "This spell-cast intent already has a durable ledger record.",
              {
                castId: input.castId,
                status: duplicate.status,
              },
            );
          const blocker = Object.values(current.entries).find(
            (record) =>
              record.actorUuid === input.actorUuid &&
              (record.status === "reserved" || record.status === "uncertain"),
          );
          if (blocker)
            throw fault(
              "SPELL_CAST_RECONCILIATION_REQUIRED",
              "An unresolved spell-cast ledger record blocks new casts for this Actor.",
              {
                castId: blocker.castId,
                status: blocker.status,
                actorUuid: blocker.actorUuid,
              },
            );
          if (Object.keys(current.entries).length >= MAX_RECORDS)
            throw fault(
              "SPELL_LEDGER_FULL",
              "The spell-cast ledger reached its safe capacity; records are never evicted.",
            );
          const now = isoNow();
          const record: SpellCastRecord = {
            ...clone(input),
            worldId: lockedWorldId,
            userId,
            createdAt: now,
            updatedAt: now,
            status: "reserved",
            nativeConsumed: null,
            resourceAfter: null,
            chatMessageUuid: null,
          };
          const next = {
            version: VERSION as 1,
            entries: { ...clone(current.entries), [record.castId]: record },
          };
          try {
            await persist(ctx, lockedWorldId, next);
            const readback = readCurrent();
            if (!sameRecord(getEntry(readback.entries, record.castId), record))
              throw fault(
                "SPELL_LEDGER_READBACK_MISMATCH",
                "The spell-cast reservation could not be confirmed after saving.",
              );
          } catch (cause) {
            const observed = observeStatus(ctx, lockedWorldId, record.castId);
            throw fault(
              "SPELL_LEDGER_RESERVATION_UNCONFIRMED",
              "The spell-cast reservation may or may not be stored; native casting must not proceed.",
              {
                castId: record.castId,
                reservationMayExist: observed.status !== null,
                persistedStatus: observed.status,
                auditStateKnown: observed.known,
                nativeOperationMayProceed: false,
                causeCode: (cause as any)?.code ?? null,
                cause:
                  cause instanceof Error
                    ? cause.message.slice(0, 240)
                    : "Unknown reservation error",
              },
            );
          }
          return recordCopy(record);
        }),
      finalize: (castId, status, outcome) =>
        serialized(async () => {
          sameWorld(ctx, lockedWorldId);
          if (
            !boundedString(castId, 128) ||
            !["confirmed", "uncertain"].includes(status)
          )
            throw fault(
              "INVALID_LEDGER_FINALIZATION",
              "Spell-cast finalization state is invalid.",
            );
          if (
            !outcome ||
            !(
              outcome.nativeConsumed === null ||
              typeof outcome.nativeConsumed === "boolean"
            ) ||
            !(
              outcome.resourceAfter === null ||
              validResource(outcome.resourceAfter)
            ) ||
            !nullableUuid(outcome.chatMessageUuid)
          )
            throw fault(
              "INVALID_LEDGER_FINALIZATION",
              "Spell-cast finalization facts are invalid.",
            );
          if (
            status === "confirmed" &&
            (outcome.nativeConsumed !== true ||
              !outcome.resourceAfter ||
              !outcome.chatMessageUuid)
          )
            throw fault(
              "INVALID_LEDGER_FINALIZATION",
              "A confirmed spell cast requires native consumption, resulting resource facts, and a chat message UUID.",
            );
          const current = readCurrent();
          const reservation = getEntry(current.entries, castId);
          if (!reservation || reservation.status !== "reserved")
            throw fault(
              "SPELL_CAST_RESERVATION_LOST",
              "Only an existing reserved spell-cast record can be finalized.",
              {
                castId,
                status: reservation?.status ?? null,
              },
            );
          const terminal: SpellCastRecord = {
            ...clone(reservation),
            updatedAt: isoNow(),
            status,
            nativeConsumed: outcome.nativeConsumed,
            resourceAfter: outcome.resourceAfter
              ? clone(outcome.resourceAfter)
              : null,
            chatMessageUuid: outcome.chatMessageUuid,
          };
          if (!validRecord(terminal, castId))
            throw fault(
              "INVALID_LEDGER_FINALIZATION",
              "Final spell-cast record is invalid.",
            );
          const next = {
            version: VERSION as 1,
            entries: { ...clone(current.entries), [castId]: terminal },
          };
          try {
            await persist(ctx, lockedWorldId, next);
            const readback = readCurrent();
            if (!sameRecord(getEntry(readback.entries, castId), terminal))
              throw fault(
                "SPELL_LEDGER_READBACK_MISMATCH",
                "The spell-cast finalization could not be confirmed after saving.",
              );
            return recordCopy(terminal);
          } catch (cause) {
            const observed = observeStatus(ctx, lockedWorldId, castId);
            throw fault(
              "SPELL_CAST_FINALIZATION_UNCONFIRMED",
              "Spell-cast finalization failed; the settings store was not changed again. Inspect the observed audit state before any retry.",
              {
                castId,
                status: observed.status,
                auditStateKnown: observed.known,
                requestedStatus: status,
                requestedNativeConsumed: outcome.nativeConsumed,
                requestedResourceAfter: outcome.resourceAfter
                  ? clone(outcome.resourceAfter)
                  : null,
                requestedChatMessageUuid: outcome.chatMessageUuid,
                causeCode: (cause as any)?.code ?? null,
                cause:
                  cause instanceof Error
                    ? cause.message.slice(0, 240)
                    : "Unknown finalization error",
              },
            );
          }
        }),
      get: (castId) => {
        if (!active)
          throw fault(
            "LEDGER_TRANSACTION_CLOSED",
            "Spell-cast ledger transaction is closed.",
          );
        const record = getEntry(readCurrent().entries, castId);
        return record ? recordCopy(record) : null;
      },
      readActor: (actorUuid, limit = MAX_RECENT) => {
        if (!active)
          throw fault(
            "LEDGER_TRANSACTION_CLOSED",
            "Spell-cast ledger transaction is closed.",
          );
        return actorSummary(readCurrent(), actorUuid, limit);
      },
    };
    try {
      return await task(transaction);
    } finally {
      active = false;
      await operation;
    }
  });
}

function observeStatus(
  ctx: BridgeContext,
  worldId: string,
  castId: string,
): { known: boolean; status: SpellCastRecord["status"] | null } {
  try {
    sameWorld(ctx, worldId);
    const record = getEntry(readLedger(ctx).entries, castId);
    return { known: true, status: record?.status ?? null };
  } catch {
    return { known: false, status: null };
  }
}

export function readSpellCastActorSummary(
  ctx: BridgeContext,
  actorUuid: string,
  limit = MAX_RECENT,
): SpellCastActorSummary {
  const worldId = worldIdOf(ctx);
  if (!uuid(actorUuid))
    throw fault(
      "INVALID_INPUT",
      "actorUuid must be a bounded world Actor UUID.",
    );
  if (!integer(limit, 1, MAX_RECENT))
    throw fault(
      "INVALID_INPUT",
      "Actor ledger summary limit must be between 1 and 10.",
    );
  sameWorld(ctx, worldId);
  return actorSummary(readLedger(ctx), actorUuid, limit);
}
