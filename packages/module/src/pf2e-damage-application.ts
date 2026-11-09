import type { BridgeContext } from "./bridge-context.js";
import { requirePF2e } from "./pf2e.js";
import {
  assertPreparedDamageCurrent,
  prepareDamageApplication,
  snapshotDamageTarget,
} from "./pf2e-damage-context.js";

const MODULE_ID = "foundry-vtt-mcp";
const LEDGER_SETTING = "damageApplications";
const MAX_ENTRIES = 5000;
const locks = new Map<string, Promise<void>>();

function error(code: string, message: string, partial?: unknown): Error {
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
function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function worldKey(ctx: BridgeContext): string {
  return String(ctx.game.world?.id ?? ctx.game.world?.uuid ?? "world");
}
async function withWorldLock<T>(
  ctx: BridgeContext,
  task: () => Promise<T>,
): Promise<T> {
  const key = worldKey(ctx);
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
function ledger(ctx: BridgeContext): any {
  const value = ctx.game.settings?.get?.(MODULE_ID, LEDGER_SETTING);
  if (value === undefined || value === null) return { version: 1, entries: {} };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !value.entries ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries)
  )
    throw error(
      "LEDGER_INVALID",
      "The PF2e damage application ledger is invalid; no damage was applied.",
    );
  const entries = Object.entries(value.entries);
  if (entries.length > MAX_ENTRIES)
    throw error(
      "LEDGER_INVALID",
      "The PF2e damage application ledger exceeds its supported limit.",
    );
  for (const [key, entry] of entries) {
    const record = entry as any;
    if (
      !key ||
      key.length > 1024 ||
      !record ||
      typeof record !== "object" ||
      !["reserved", "applied", "uncertain"].includes(record.status) ||
      typeof record.id !== "string" ||
      record.id.length > 128 ||
      typeof record.sourceMessageUuid !== "string" ||
      record.sourceMessageUuid.length > 512 ||
      !Number.isInteger(record.rollIndex) ||
      record.rollIndex < 0 ||
      record.rollIndex > 9 ||
      typeof record.actorUuid !== "string" ||
      record.actorUuid.length > 512 ||
      typeof record.targetTokenUuid !== "string" ||
      record.targetTokenUuid.length > 512 ||
      !["damage", "healing"].includes(record.operation) ||
      ![0.5, 1, 2].includes(record.multiplier) ||
      typeof record.shieldBlock !== "boolean" ||
      typeof record.createdAt !== "string" ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.nativeConfirmed !== "boolean" ||
      !Array.isArray(record.chatMessageUuids) ||
      record.chatMessageUuids.length > 10 ||
      !record.chatMessageUuids.every(
        (uuid: unknown) => typeof uuid === "string" && uuid.length <= 512,
      )
    )
      throw error(
        "LEDGER_INVALID",
        "The PF2e damage application ledger contains an invalid entry.",
      );
  }
  return value;
}
function id(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function prepare(args: any, ctx: BridgeContext): Promise<any> {
  return prepareDamageApplication(args, ctx as any);
}
function entryBase(prepared: any, args: any, applicationId: string) {
  return {
    id: applicationId,
    sourceMessageUuid: prepared.message?.uuid ?? args.messageUuid,
    rollIndex: prepared.rollIndex ?? args.rollIndex ?? 0,
    actorUuid: prepared.actor?.uuid ?? prepared.targetActorUuid,
    targetTokenUuid: prepared.targetToken?.uuid ?? args.targetTokenUuid,
    operation: prepared.operation ?? args.operation ?? "damage",
    multiplier: prepared.multiplier ?? args.multiplier ?? 1,
    shieldBlock: Boolean(prepared.shieldBlock ?? args.shieldBlock),
    status: "reserved" as const,
    createdAt: new Date().toISOString(),
    nativeConfirmed: false,
    chatMessageUuids: [],
  };
}
function targetState(prepared: any): object {
  return clone(snapshotDamageTarget(prepared.actor));
}
function chatOutcomeMessages(
  ctx: BridgeContext,
  before: Set<string>,
  identity: {
    actorUuid: string;
    actorId: string;
    tokenId: string;
    sceneId: string;
    itemUuid: string | null;
  },
): any[] {
  return values(ctx.game.messages).filter((message) => {
    if (!message?.uuid || before.has(message.uuid)) return false;
    const flags = message.flags?.pf2e;
    const context = flags?.context;
    const speaker = message.speaker ?? {};
    if (context?.type !== "damage-taken") return false;
    if ((speaker.actor ?? speaker.actorUuid) !== identity.actorId) return false;
    if (
      speaker.token !== identity.tokenId ||
      speaker.scene !== identity.sceneId
    )
      return false;
    const damageUuid = flags?.appliedDamage?.uuid;
    if (damageUuid && damageUuid !== identity.actorUuid) return false;
    const originItemUuid = flags?.origin?.uuid;
    if ((originItemUuid ?? null) !== identity.itemUuid) return false;
    return true;
  });
}
function changeSummary(before: any, after: any) {
  const delta = (a: unknown, b: unknown) =>
    typeof a === "number" && typeof b === "number" ? b - a : null;
  const beforeHealth = before?.health;
  const afterHealth = after?.health;
  const beforeHP = beforeHealth?.hp;
  const afterHP = afterHealth?.hp;
  const beforeStamina = beforeHealth?.stamina;
  const afterStamina = afterHealth?.stamina;
  const beforeShield = before?.shield;
  const afterShield = after?.shield;
  const beforeConditions = new Set(before?.conditionIds ?? []);
  const afterConditions = new Set(after?.conditionIds ?? []);
  return {
    hp: delta(beforeHP?.value, afterHP?.value),
    tempHp: delta(beforeHP?.temp, afterHP?.temp),
    stamina: delta(beforeStamina?.value, afterStamina?.value),
    shieldHp: delta(beforeShield?.hp, afterShield?.hp),
    conditionsAdded: [...afterConditions].filter(
      (uuid) => !beforeConditions.has(uuid),
    ),
    conditionsRemoved: [...beforeConditions].filter(
      (uuid) => !afterConditions.has(uuid),
    ),
  };
}
async function saveLedger(ctx: BridgeContext, value: any): Promise<void> {
  requirePF2e(ctx as any);
  ctx.assertWrite();
  await ctx.game.settings.set(MODULE_ID, LEDGER_SETTING, value);
}
function tokenStillWorld(prepared: any, ctx: BridgeContext): boolean {
  const token = prepared.targetToken;
  const scene = token?.parent;
  const collection = scene?.tokens;
  const found =
    typeof collection?.get === "function"
      ? collection.get(token.id)
      : values(collection).find((candidate) => candidate === token);
  return Boolean(
    token &&
    scene &&
    !scene.compendium &&
    !token.compendium &&
    found === token &&
    token.actor === prepared.actor,
  );
}

/** Read a safe, compact view of the persistent world damage ledger. */
export function readPF2eDamageApplicationLedger(ctx: BridgeContext): object {
  const value = ledger(ctx);
  return {
    version: 1,
    count: Object.keys(value.entries).length,
    entries: Object.values(value.entries).map((entry: any) => ({
      id: entry.id,
      sourceMessageUuid: entry.sourceMessageUuid,
      rollIndex: entry.rollIndex,
      actorUuid: entry.actorUuid,
      targetTokenUuid: entry.targetTokenUuid,
      operation: entry.operation,
      multiplier: entry.multiplier,
      shieldBlock: entry.shieldBlock,
      status: entry.status,
      createdAt: entry.createdAt,
      after: entry.after ?? null,
      chatMessageUuids: entry.chatMessageUuids ?? [],
    })),
  };
}

export async function handlePF2eApplyDamage(
  args: Record<string, any>,
  ctx: BridgeContext,
): Promise<object> {
  requirePF2e(ctx as any);
  const first = await prepare(args, ctx);
  if (first.reviewToken !== args.reviewToken)
    throw error(
      "STALE_REVIEW",
      "The damage review is stale. Inspect the damage again before applying it.",
    );
  if (!tokenStillWorld(first, ctx))
    throw error(
      "TARGET_CHANGED",
      "The selected target is no longer the same world token.",
    );
  return withWorldLock(ctx, async () => {
    requirePF2e(ctx as any);
    const current = await prepare(args, ctx);
    if (current.reviewToken !== args.reviewToken)
      throw error(
        "STALE_REVIEW",
        "The damage review changed before reservation; no damage was applied.",
      );
    if (!tokenStillWorld(current, ctx))
      throw error(
        "TARGET_CHANGED",
        "The selected target changed before reservation.",
      );
    const beforeLedger = ledger(ctx);
    const key = current.applicationKey;
    if (typeof key !== "string" || !key)
      throw error("INVALID_DAMAGE", "The damage application key is missing.");
    const existing = beforeLedger.entries[key];
    if (existing) {
      if (existing.status === "applied")
        throw error(
          "ALREADY_APPLIED",
          "This source roll was already applied to this Actor.",
          {
            applicationId: existing.id,
            status: existing.status,
            sourceMessageUuid: existing.sourceMessageUuid,
            actorUuid: existing.actorUuid,
          },
        );
      throw error(
        "RECONCILIATION_REQUIRED",
        "A previous attempt has an unresolved reservation. Reconcile it before applying this source roll again.",
        {
          applicationId: existing.id,
          status: existing.status,
          sourceMessageUuid: existing.sourceMessageUuid,
          actorUuid: existing.actorUuid,
          after: existing.after ?? null,
          chatMessageUuids: existing.chatMessageUuids ?? [],
        },
      );
    }
    if (Object.keys(beforeLedger.entries).length >= MAX_ENTRIES)
      throw error(
        "LEDGER_FULL",
        "The damage application ledger has reached its safe capacity.",
      );
    const applicationId = id();
    const reservation = entryBase(current, args, applicationId);
    const reservedLedger = {
      version: 1,
      entries: { ...beforeLedger.entries, [key]: reservation },
    };
    try {
      await saveLedger(ctx, reservedLedger);
    } catch (cause) {
      throw error(
        "PARTIAL_FAILURE",
        "The damage reservation could not be confirmed; native damage was not called.",
        {
          applicationId,
          reservationMayExist: true,
          nativeConfirmed: false,
          cause: String((cause as any)?.message ?? cause),
        },
      );
    }
    const confirmedLedger = ledger(ctx);
    if (
      confirmedLedger.entries[key]?.id !== applicationId ||
      confirmedLedger.entries[key]?.status !== "reserved"
    )
      throw error(
        "PARTIAL_FAILURE",
        "The damage reservation could not be confirmed; native damage was not called.",
        { applicationId, reservationMayExist: true, nativeConfirmed: false },
      );

    let fresh: any;
    try {
      requirePF2e(ctx as any);
      fresh = await prepare(args, ctx);
      if (
        fresh.reviewToken !== args.reviewToken ||
        fresh.applicationKey !== key ||
        !tokenStillWorld(fresh, ctx) ||
        fresh.actor !== current.actor ||
        fresh.targetToken !== current.targetToken
      )
        throw error(
          "STALE_REVIEW",
          "The reserved damage review changed before native application.",
        );
      assertPreparedDamageCurrent(fresh, ctx as any);
      const ownerCheck = ledger(ctx).entries[key];
      if (ownerCheck?.id !== applicationId || ownerCheck?.status !== "reserved")
        throw error(
          "RESERVATION_LOST",
          "The reserved ledger entry is no longer owned by this application.",
        );
      ctx.assertWrite();
    } catch (cause) {
      throw error(
        "RECONCILIATION_REQUIRED",
        "The reserved damage review or write authorization could not be revalidated. The reservation remains blocked and no native application was attempted.",
        {
          applicationId,
          status: "reserved",
          nativeAttempted: false,
          nativeConfirmed: false,
          causeCode: (cause as any)?.code ?? null,
          cause: String((cause as any)?.message ?? cause),
        },
      );
    }
    const beforeMessages = new Set(
      values(ctx.game.messages)
        .map((message) => message?.uuid)
        .filter((uuid) => typeof uuid === "string"),
    );
    const nativeIdentity = Object.freeze({
      actorUuid: fresh.actor.uuid,
      actorId: fresh.actor.id ?? fresh.actor._id,
      tokenId: fresh.targetToken.id ?? fresh.targetToken._id,
      sceneId: fresh.targetToken.parent.id ?? fresh.targetToken.parent._id,
      itemUuid: fresh.item?.uuid ?? null,
    });
    const before = targetState(fresh);
    let nativeReturn: any;
    let nativeError: any;
    try {
      nativeReturn = await fresh.contextActor.applyDamage({
        damage: fresh.nativeDamage,
        token: fresh.targetToken,
        item: fresh.item,
        rollOptions: fresh.nativeRollOptions,
        skipIWR: fresh.skipIWR,
        shieldBlockRequest: Boolean(fresh.shieldBlockRequest),
        outcome: fresh.outcome,
        final: false,
      });
    } catch (cause) {
      nativeError = cause;
    }
    let after: object | null = null;
    try {
      after = targetState(fresh);
    } catch {
      // The target may have been deleted during native processing.
    }
    const outcomes = chatOutcomeMessages(ctx, beforeMessages, nativeIdentity);
    const chatMessageUuids = outcomes
      .slice(0, 10)
      .map((message) => message.uuid);
    const confirmed =
      !nativeError &&
      nativeReturn === fresh.contextActor &&
      outcomes.length === 1;
    const targetChanged =
      fresh.targetToken.actor !== fresh.actor || !tokenStillWorld(fresh, ctx);
    const updateEntry = async (status: "applied" | "uncertain") => {
      try {
        const latest = ledger(ctx);
        const own = latest.entries[key];
        if (own?.id !== applicationId)
          throw new Error("Reservation ownership changed.");
        const nextEntry = {
          ...own,
          status,
          chatMessageUuids,
          nativeConfirmed: confirmed,
        };
        await saveLedger(ctx, {
          version: 1,
          entries: { ...latest.entries, [key]: nextEntry },
        });
      } catch (cause) {
        return cause;
      }
      return null;
    };
    if (confirmed) {
      const commitError = await updateEntry("applied");
      const result = {
        applicationId,
        sourceMessageUuid: fresh.message?.uuid ?? args.messageUuid,
        rollIndex: fresh.rollIndex,
        actorUuid: fresh.actor?.uuid,
        targetTokenUuid: fresh.targetToken?.uuid,
        operation: fresh.operation ?? args.operation ?? "damage",
        multiplier: fresh.multiplier ?? args.multiplier ?? 1,
        shieldBlock: Boolean(fresh.shieldBlock ?? args.shieldBlock),
        before,
        after,
        changes: after ? changeSummary(before, after) : null,
        nativeChatMessageUuid: chatMessageUuids[0],
        nativeConfirmed: true,
        targetChanged,
        ledgerStatus: commitError ? "reserved" : "applied",
      };
      if (commitError)
        throw error(
          "PARTIAL_FAILURE",
          "PF2e confirmed the damage, but the applied result could not be committed to the persistent ledger. The reservation still blocks retries.",
          {
            ...result,
            ledgerCommitError: String(
              (commitError as any)?.message ?? commitError,
            ),
          },
        );
      if (targetChanged)
        throw error(
          "PARTIAL_FAILURE",
          "PF2e confirmed the damage, but the selected token or scene changed during native processing. The Actor result is recorded and retries remain blocked.",
          {
            ...result,
            observedActorUuid: fresh.actor.uuid,
            outcomeUnknown: false,
          },
        );
      return result;
    }
    const updateError = await updateEntry("uncertain");
    const partial = {
      applicationId,
      sourceMessageUuid: fresh.message?.uuid ?? args.messageUuid,
      rollIndex: fresh.rollIndex,
      actorUuid: fresh.actor?.uuid,
      targetTokenUuid: fresh.targetToken?.uuid,
      before,
      after,
      changes: after ? changeSummary(before, after) : null,
      nativeReturnConfirmed: nativeReturn === fresh.contextActor,
      targetChanged,
      nativeChatMessageUuids: chatMessageUuids,
      status: updateError ? "reserved" : "uncertain",
      cause: nativeError ? String(nativeError?.message ?? nativeError) : null,
      outcomeUnknown: true,
      ...(updateError
        ? {
            ledgerCommitError: String(
              (updateError as any)?.message ?? updateError,
            ),
          }
        : {}),
    };
    throw error(
      "PARTIAL_FAILURE",
      "PF2e damage application could not be uniquely confirmed. The reservation blocks retries until reconciled.",
      partial,
    );
  });
}
