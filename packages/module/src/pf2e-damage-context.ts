import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";

const MAX_SOURCE = 200_000;
const MAX_ACTOR_SOURCE = 1_000_000;
const MAX_TEXT = 400;
const MAX_INSTANCES = 40;
const DOS = ["criticalFailure", "failure", "success", "criticalSuccess"];

type Args = {
  messageUuid: string;
  targetTokenUuid: string;
  rollIndex?: number;
  operation?: "damage" | "healing";
  multiplier?: 0.5 | 1 | 2;
  shieldBlock?: boolean;
  shieldItemUuid?: string;
};

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function values(collection: any): any[] {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function")
    return Array.from(collection.values());
  if (collection?.[Symbol.iterator]) return Array.from(collection);
  return [];
}
function get(collection: any, id: string): any {
  return typeof collection?.get === "function" ? collection.get(id) : null;
}
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function json(value: any, limit: number, what: string): any {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      `${what} could not be serialized safely.`,
    );
  }
  if (!serialized || serialized.length > limit)
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      `${what} exceeds the supported size limit.`,
    );
  try {
    return JSON.parse(serialized);
  } catch {
    throw fail("INVALID_DAMAGE_SOURCE", `${what} is not valid JSON data.`);
  }
}
function finite(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function short(value: any): string | null {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : null;
}
function uuid(value: any): string | null {
  return typeof value?.uuid === "string" ? value.uuid.slice(0, 512) : null;
}
function rollClass(): any {
  const rolls = (globalThis as any).CONFIG?.Dice?.rolls;
  const found = Array.isArray(rolls)
    ? rolls.find((candidate: any) => candidate?.name === "DamageRoll")
    : null;
  if (!found)
    throw fail(
      "API_UNAVAILABLE",
      "PF2e's native DamageRoll class is not registered.",
    );
  return found;
}
function worldToken(token: any, ctx: PF2eContext): boolean {
  const scene = token?.parent;
  return (
    token?.documentName === "Token" &&
    !token.compendium &&
    scene?.documentName === "Scene" &&
    !scene.compendium &&
    !scene.parent &&
    get(ctx.game.scenes, scene.id) === scene &&
    get(scene.tokens, token.id) === token
  );
}
function validateArgs(
  args: Args,
): Required<
  Pick<Args, "rollIndex" | "operation" | "multiplier" | "shieldBlock">
> {
  const rollIndex = args.rollIndex ?? 0;
  const operation = args.operation ?? "damage";
  const multiplier = args.multiplier ?? 1;
  const shieldBlock = args.shieldBlock ?? false;
  if (!Number.isInteger(rollIndex) || rollIndex < 0 || rollIndex > 9)
    throw fail("INVALID_ARGUMENT", "rollIndex must be an integer from 0 to 9.");
  if (operation !== "damage" && operation !== "healing")
    throw fail("INVALID_ARGUMENT", "operation must be damage or healing.");
  if (![0.5, 1, 2].includes(multiplier))
    throw fail("INVALID_ARGUMENT", "multiplier must be 0.5, 1, or 2.");
  if (typeof shieldBlock !== "boolean")
    throw fail("INVALID_ARGUMENT", "shieldBlock must be a boolean.");
  if (shieldBlock && operation !== "damage")
    throw fail(
      "INVALID_ARGUMENT",
      "Shield Block can only be requested for damage.",
    );
  if (shieldBlock && !args.shieldItemUuid)
    throw fail(
      "INVALID_ARGUMENT",
      "shieldItemUuid is required when shieldBlock is true.",
    );
  if (!shieldBlock && args.shieldItemUuid !== undefined)
    throw fail(
      "INVALID_ARGUMENT",
      "shieldItemUuid is only allowed when shieldBlock is true.",
    );
  return {
    rollIndex,
    operation,
    multiplier: multiplier as 0.5 | 1 | 2,
    shieldBlock,
  };
}
function nativeRollOptions(
  message: any,
  origin: any,
  item: any,
  clone: any,
  effectiveOptions: string[],
): Set<string> {
  const contextOptions = message.flags?.pf2e?.context?.options;
  if (
    contextOptions !== undefined &&
    (!Array.isArray(contextOptions) ||
      contextOptions.length > 500 ||
      contextOptions.some(
        (v: any) => typeof v !== "string" || v.length > MAX_TEXT,
      ))
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Damage roll context options are malformed or oversized.",
    );
  const options = [...effectiveOptions];
  const originOptions = options
    .filter((o) => o.startsWith("self:"))
    .map((o) => o.replace(/^self\b/, "origin"));
  if (
    !clone ||
    typeof clone.getSelfRollOptions !== "function" ||
    typeof clone.applyDamage !== "function"
  )
    throw fail(
      "API_UNAVAILABLE",
      "PF2e did not provide a damage-capable contextual actor clone.",
    );
  const itemOptions =
    item &&
    ["affliction", "condition", "effect"].some((type) => item.isOfType?.(type))
      ? item.getRollOptions("item")
      : [];
  return new Set([
    ...options.filter((o: string) => !/^(?:self|target)(?::|$)/.test(o)),
    ...itemOptions,
    ...originOptions,
    ...clone.getSelfRollOptions(),
  ]);
}
async function effectsFor(
  message: any,
  origin: any,
  target: any,
  item: any,
  effectiveOptions?: string[],
): Promise<any[]> {
  if (!origin || !target) return [];
  const contextOptions = message.flags?.pf2e?.context?.options ?? [];
  if (
    !Array.isArray(contextOptions) ||
    contextOptions.length > 500 ||
    contextOptions.some(
      (v: any) => typeof v !== "string" || v.length > MAX_TEXT,
    )
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Damage roll context options are malformed or oversized.",
    );
  const options = [
    ...(effectiveOptions ?? contextOptions),
    ...origin.getRollOptions(["damage-received"]),
    ...target.getSelfRollOptions("target"),
  ].flat();
  const resolvables = item
    ? item.isOfType?.("spell")
      ? { spell: item }
      : { weapon: item }
    : {};
  const callbacks =
    origin.synthetics?.ephemeralEffects?.["damage-received"]?.target ?? [];
  if (!Array.isArray(callbacks))
    throw fail(
      "API_UNAVAILABLE",
      "PF2e damage-received contextual effects API is unavailable.",
    );
  const produced = await Promise.all(
    callbacks.map((callback: any) => callback({ test: options, resolvables })),
  );
  return produced
    .flat()
    .filter((effect: any) => effect != null)
    .map((effect: any) => {
      if (effect?.type !== "effect") return effect;
      const source = effect.toObject?.() ?? effect;
      return {
        ...source,
        system: {
          ...source.system,
          context: {
            origin: {
              actor: origin.uuid,
              token: null,
              item: null,
              spellcasting: null,
              rollOptions: [],
            },
            target: { actor: target.uuid, token: null },
            roll: null,
          },
          duration: {
            value: -1,
            unit: "unlimited",
            expiry: null,
            sustained: false,
          },
        },
      };
    });
}
function health(actor: any): any {
  const hp = actor.system?.attributes?.hp;
  const sp = hp?.sp;
  return {
    hp: {
      value: finite(hp?.value),
      max: finite(hp?.max),
      temp: finite(hp?.temp),
    },
    stamina: sp ? { value: finite(sp.value), max: finite(sp.max) } : null,
  };
}
function shieldState(actor: any): any {
  const shield = actor.heldShield;
  if (!shield) return null;
  const shieldHp = shield.system?.hp;
  const attributes = actor.system?.attributes?.shield;
  return {
    uuid: uuid(shield),
    name: short(shield.name),
    itemId: attributes?.itemId ?? null,
    raised: attributes?.raised === true,
    broken: attributes?.broken === true || shield.isBroken === true,
    destroyed: shieldHp?.value === 0 || attributes?.destroyed === true,
    hp: finite(shieldHp?.value),
    max: finite(shieldHp?.max),
    hardness: finite(shield.system?.hardness),
  };
}
export function snapshotDamageTarget(actor: any): {
  health: any;
  shield: any;
  conditionIds: string[];
} {
  return {
    health: health(actor),
    shield: shieldState(actor),
    conditionIds: conditionIds(actor),
  };
}
function conditionIds(actor: any): string[] {
  return values(actor?.items)
    .filter(
      (item) => item?.isOfType?.("condition") || item?.type === "condition",
    )
    .map((item) => uuid(item))
    .filter((id): id is string => Boolean(id))
    .sort()
    .slice(0, 200);
}
function actorSource(actor: any): any {
  const data = actor.toObject?.();
  if (!data)
    throw fail(
      "API_UNAVAILABLE",
      "PF2e actor source serialization is unavailable.",
    );
  return json(data, MAX_ACTOR_SOURCE, "Actor source data");
}
function withoutGeneratedIds(value: any): any {
  if (Array.isArray(value)) return value.map(withoutGeneratedIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["_id", "id", "uuid"].includes(key))
      .map(([key, entry]) => [key, withoutGeneratedIds(entry)]),
  );
}
function automationSettings(ctx: PF2eContext): any {
  const settings = ctx.game.settings;
  const read = (key: string) => {
    try {
      return settings?.get?.("pf2e", key) ?? null;
    } catch {
      return null;
    }
  };
  return {
    iwr: ctx.game.pf2e?.settings?.iwr ?? null,
    stamina: ctx.game.pf2e?.settings?.variants?.stamina ?? null,
    actorsDeadAtZero: read("automation.actorsDeadAtZero"),
  };
}
function snapshotFor(
  args: Args,
  normalized: ReturnType<typeof validateArgs>,
  ctx: PF2eContext,
  message: any,
  roll: any,
  token: any,
  actor: any,
  origin: any,
  contextActor: any,
  item: any,
  options: Set<string>,
  shield: any,
): any {
  const instances = roll.instances;
  if (!Array.isArray(instances) || instances.length > MAX_INSTANCES)
    throw fail("INVALID_DAMAGE_SOURCE", "Damage roll has too many instances.");
  const rollOptions = roll.options ?? {};
  const instanceData = instances.map((instance: any) => ({
    type: short(instance.type),
    category: short(instance.category),
    persistent: instance.persistent === true,
    materials:
      instance.materials &&
      typeof instance.materials[Symbol.iterator] === "function"
        ? Array.from(instance.materials).slice(0, 30).map(short)
        : [],
    traits: Array.isArray(instance.traits)
      ? instance.traits.slice(0, 50).map(short)
      : [],
  }));
  const contextOptions = message.flags?.pf2e?.context?.options ?? [];
  return {
    worldId: ctx.game.world?.id ?? null,
    worldTime: finite(ctx.game.time?.worldTime),
    operation: normalized.operation,
    multiplier: normalized.multiplier,
    source: {
      messageUuid: message.uuid,
      rollIndex: normalized.rollIndex,
      actorUuid: uuid(origin),
      itemUuid: uuid(item),
      itemName: short(item?.name),
      roll: json(roll.toJSON(), MAX_SOURCE, "Damage roll source"),
      total: roll.total,
      degreeOfSuccess: DOS[rollOptions.degreeOfSuccess] ?? null,
      options: contextOptions.slice(),
      kinds:
        roll.kinds && typeof roll.kinds[Symbol.iterator] === "function"
          ? Array.from(roll.kinds).slice(0, 50).map(short)
          : [],
      instances: instanceData,
    },
    target: {
      tokenUuid: token.uuid,
      actorUuid: actor.uuid,
      actorType: actor.type,
      health: health(actor),
      shield,
      conditionIds: conditionIds(actor),
    },
    context: {
      originActorUuid: uuid(origin),
      originSource: origin ? actorSource(origin) : null,
      targetActorSource: actorSource(actor),
      contextActorSource: withoutGeneratedIds(actorSource(contextActor)),
      options: [...options].slice(0, 500),
      automation: automationSettings(ctx),
    },
  };
}
async function tokenFor(args: Args, ctx: PF2eContext): Promise<any> {
  const token = await ctx.resolve(args.targetTokenUuid);
  if (!worldToken(token, ctx) || token.uuid !== args.targetTokenUuid)
    throw fail(
      "INVALID_TOKEN",
      "Target must be the exact world Scene Token specified.",
    );
  const actor = token.actor;
  if (!actor || !["character", "npc", "familiar"].includes(actor.type))
    throw fail(
      "UNSUPPORTED_TARGET",
      "Target must be a PF2e character, NPC, or familiar token.",
    );
  const hp = actor.system?.attributes?.hp;
  if (
    finite(hp?.value) === null ||
    finite(hp?.max) === null ||
    typeof actor.applyDamage !== "function" ||
    typeof actor.getContextualClone !== "function" ||
    typeof actor.getSelfRollOptions !== "function"
  )
    throw fail(
      "API_UNAVAILABLE",
      "PF2e target health or native damage application API is unavailable.",
    );
  return token;
}
async function sourceFor(
  args: Args,
  normalized: ReturnType<typeof validateArgs>,
  ctx: PF2eContext,
): Promise<any> {
  const message = await ctx.resolve(args.messageUuid);
  if (
    !message ||
    message.documentName !== "ChatMessage" ||
    message.compendium ||
    message.parent ||
    get(ctx.game.messages, message.id) !== message ||
    message.uuid !== args.messageUuid ||
    message.flags?.pf2e?.context?.type !== "damage-roll"
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Source must be an exact world PF2e damage-roll ChatMessage.",
    );
  const roll = message.rolls?.[normalized.rollIndex];
  const DamageRoll = rollClass();
  if (
    !(roll instanceof DamageRoll) ||
    (roll._evaluated !== true && roll.evaluated !== true) ||
    finite(roll.total) === null ||
    roll.total < 0 ||
    typeof roll.toJSON !== "function" ||
    typeof roll.alter !== "function" ||
    typeof roll.constructor?.fromData !== "function"
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Selected roll must be an evaluated native PF2e DamageRoll.",
    );
  return { message, roll };
}
async function prepare(args: Args, ctx: PF2eContext) {
  requirePF2e(ctx);
  const normalized = validateArgs(args);
  const [source, token] = await Promise.all([
    sourceFor(args, normalized, ctx),
    tokenFor(args, ctx),
  ]);
  const { message, roll } = source;
  const actor = token.actor;
  const origin = message.actor ?? null;
  const item = message.item ?? null;
  const messageOptions = message.flags?.pf2e?.context?.options ?? [];
  if (
    !Array.isArray(messageOptions) ||
    messageOptions.length > 500 ||
    messageOptions.some(
      (v: any) => typeof v !== "string" || v.length > MAX_TEXT,
    )
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Damage roll context options are malformed or oversized.",
    );
  const effectiveOptions = [...messageOptions];
  if (origin && actor.alliance)
    effectiveOptions.push(
      `origin:${actor.alliance === origin.alliance ? "ally" : "enemy"}`,
    );
  if (!effectiveOptions.some((option) => option.startsWith("target")))
    effectiveOptions.push(...actor.getSelfRollOptions("target"));
  const originOptions = effectiveOptions
    .filter((option) => option.startsWith("self:"))
    .map((option) => option.replace(/^self\b/, "origin"));
  const effects =
    normalized.operation === "damage"
      ? await effectsFor(message, origin, actor, item, effectiveOptions)
      : [];
  const contextActor = actor.getContextualClone(originOptions, effects);
  if (
    !contextActor ||
    typeof contextActor.getSelfRollOptions !== "function" ||
    typeof contextActor.applyDamage !== "function"
  )
    throw fail(
      "API_UNAVAILABLE",
      "PF2e did not provide a damage-capable contextual actor clone.",
    );
  const options = nativeRollOptions(
    message,
    origin,
    item,
    contextActor,
    effectiveOptions,
  );
  let shield = shieldState(actor);
  if (normalized.shieldBlock) {
    const shieldDoc = actor.heldShield;
    if (
      !shieldDoc ||
      uuid(shieldDoc) !== args.shieldItemUuid ||
      get(actor.items, shieldDoc.id) !== shieldDoc ||
      actor.system?.attributes?.shield?.itemId !== shieldDoc.id
    )
      throw fail(
        "INVALID_SHIELD",
        "Requested shield must be the target actor's currently held physical shield.",
      );
    const contextualShield = contextActor.heldShield;
    const contextualState = shieldState(contextActor);
    if (
      !shield.raised ||
      shield.broken ||
      shield.destroyed ||
      !contextualShield ||
      uuid(contextualShield) !== uuid(shieldDoc) ||
      !contextualState?.raised ||
      contextualState.broken ||
      contextualState.destroyed
    )
      throw fail(
        "INVALID_SHIELD",
        "Shield Block requires the same raised, unbroken, undestroyed physical shield in the native contextual actor.",
      );
  }
  const snapshot = snapshotFor(
    args,
    normalized,
    ctx,
    message,
    roll,
    token,
    actor,
    origin,
    contextActor,
    item,
    options,
    shield,
  );
  snapshot.source.messageFlags = json(
    message.flags?.pf2e ?? {},
    MAX_SOURCE,
    "Damage message flags",
  );
  snapshot.source.outcome = message.flags?.pf2e?.context?.outcome ?? null;
  snapshot.target.shieldBlock = normalized.shieldBlock;
  snapshot.target.shieldItemUuid = args.shieldItemUuid ?? null;
  const fingerprint = await hash(stable(snapshot));
  const cloned =
    normalized.operation === "damage"
      ? roll.constructor.fromData(
          json(snapshot.source.roll, MAX_SOURCE, "Damage roll source"),
        )
      : null;
  const nativeDamage =
    normalized.operation === "damage"
      ? cloned.alter(normalized.multiplier, 0)
      : -roll.total * normalized.multiplier;
  if (
    normalized.operation === "damage" &&
    !(nativeDamage instanceof rollClass())
  )
    throw fail(
      "API_UNAVAILABLE",
      "PF2e DamageRoll.alter did not return a native DamageRoll.",
    );
  if (normalized.operation === "healing" && finite(nativeDamage) === null)
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Healing amount is outside the supported numeric range.",
    );
  if (
    normalized.operation === "damage" &&
    (finite(nativeDamage.total) === null || nativeDamage.total < 0)
  )
    throw fail(
      "INVALID_DAMAGE_SOURCE",
      "Altered DamageRoll total is outside the supported numeric range.",
    );
  const outcome = message.flags?.pf2e?.context?.outcome ?? null;
  return {
    message,
    roll,
    rollIndex: normalized.rollIndex,
    targetToken: token,
    actor,
    contextActor,
    item,
    operation: normalized.operation,
    multiplier: normalized.multiplier,
    shieldBlock: normalized.shieldBlock,
    shieldItemUuid: args.shieldItemUuid,
    targetTokenUuid: token.uuid,
    targetActorUuid: actor.uuid,
    nativeDamage,
    nativeRollOptions: options,
    outcome,
    skipIWR: normalized.operation === "healing",
    shieldBlockRequest: normalized.shieldBlock,
    conditionalEffects: effects,
    applicationKey: `${message.uuid}:${normalized.rollIndex}:${actor.uuid}`,
    reviewToken: fingerprint,
    fingerprint,
    snapshot,
  };
}
async function hash(input: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle)
    throw fail(
      "API_UNAVAILABLE",
      "Secure SHA-256 fingerprinting is unavailable in this browser.",
    );
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function prepareDamageApplication(args: Args, ctx: PF2eContext) {
  return prepare(args, ctx);
}

export function assertPreparedDamageCurrent(
  prepared: any,
  ctx: PF2eContext,
): void {
  const token = get(
    prepared.targetToken?.parent?.tokens,
    prepared.targetToken?.id,
  );
  const message = get(ctx.game.messages, prepared.message?.id);
  if (
    token !== prepared.targetToken ||
    token?.actor !== prepared.actor ||
    message !== prepared.message ||
    message.rolls?.[prepared.rollIndex] !== prepared.roll ||
    !worldToken(prepared.targetToken, ctx)
  )
    throw fail(
      "STALE_DAMAGE_REVIEW",
      "Damage source or target identity changed after review.",
    );
  const current: any = snapshotFor(
    {} as any,
    {
      operation: prepared.operation,
      multiplier: prepared.multiplier,
      rollIndex: prepared.rollIndex,
      shieldBlock: prepared.shieldBlock,
    } as any,
    ctx,
    prepared.message,
    prepared.roll,
    prepared.targetToken,
    prepared.actor,
    prepared.message.actor ?? null,
    prepared.contextActor,
    prepared.item,
    prepared.nativeRollOptions,
    shieldState(prepared.actor),
  );
  current.source.messageFlags = json(
    prepared.message.flags?.pf2e ?? {},
    MAX_SOURCE,
    "Damage message flags",
  );
  current.source.outcome =
    prepared.message.flags?.pf2e?.context?.outcome ?? null;
  current.target.shieldBlock = prepared.shieldBlock;
  current.target.shieldItemUuid = prepared.shieldItemUuid ?? null;
  if (
    stable(current) !== stable(prepared.snapshot) ||
    current.target.tokenUuid !== prepared.targetTokenUuid ||
    current.target.actorUuid !== prepared.targetActorUuid
  )
    throw fail(
      "STALE_DAMAGE_REVIEW",
      "Damage source, target health, shield, IWR, or automation settings changed after review.",
    );
}

export async function handlePF2eInspectDamageApplication(
  args: Args,
  ctx: PF2eContext,
): Promise<Record<string, unknown>> {
  const prepared = await prepare(args, ctx);
  const ledger = ctx.game.settings?.get?.(
    "foundry-vtt-mcp",
    "damageApplications",
  );
  const records = ledger && typeof ledger === "object" ? ledger : {};
  const entry =
    records.entries?.[prepared.applicationKey] ??
    records[prepared.applicationKey] ??
    null;
  const record =
    entry && typeof entry === "object"
      ? {
          id: short(entry.id),
          status: short(entry.status),
          sourceMessageUuid: short(entry.sourceMessageUuid),
          rollIndex: Number.isInteger(entry.rollIndex) ? entry.rollIndex : null,
          actorUuid: short(entry.actorUuid),
          targetTokenUuid: short(entry.targetTokenUuid),
          operation:
            entry.operation === "damage" || entry.operation === "healing"
              ? entry.operation
              : null,
          multiplier: [0.5, 1, 2].includes(entry.multiplier)
            ? entry.multiplier
            : null,
          shieldBlock:
            typeof entry.shieldBlock === "boolean" ? entry.shieldBlock : null,
          createdAt: short(entry.createdAt),
          nativeConfirmed:
            typeof entry.nativeConfirmed === "boolean"
              ? entry.nativeConfirmed
              : null,
          chatMessageUuids: Array.isArray(entry.chatMessageUuids)
            ? entry.chatMessageUuids.slice(0, 10).map(short)
            : [],
        }
      : null;
  const healthState = prepared.snapshot.target.health;
  const rollData: any = prepared.snapshot.source;
  return {
    readOnly: true,
    nonAtomic: true,
    reviewToken: prepared.reviewToken,
    applicationKey: prepared.applicationKey,
    source: {
      messageUuid: prepared.message.uuid,
      rollIndex: prepared.rollIndex,
      itemUuid: rollData.itemUuid,
      itemName: rollData.itemName,
      total: rollData.total,
      operation: prepared.snapshot.operation,
      multiplier: prepared.snapshot.multiplier,
      degreeOfSuccess: rollData.degreeOfSuccess,
      instances: rollData.instances,
    },
    target: {
      tokenUuid: prepared.targetToken.uuid,
      actorUuid: prepared.actor.uuid,
      name: short(prepared.actor.name),
      type: prepared.actor.type,
      health: healthState,
      shield: prepared.snapshot.target.shield,
    },
    context: {
      rollOptions: prepared.snapshot.context.options,
      conditionalDamageReceivedEffects: prepared.conditionalEffects.length,
      iwrEnabled: prepared.snapshot.context.automation.iwr,
      staminaEnabled: prepared.snapshot.context.automation.stamina,
      nativeIWR:
        "PF2e applies current immunities, weaknesses, resistances, and healing adjustments through Actor#applyDamage; this preview does not predict final HP.",
    },
    shieldBlock: prepared.shieldBlockRequest
      ? { eligible: true, shield: prepared.snapshot.target.shield }
      : {
          eligible: prepared.snapshot.target.shield
            ? Boolean(
                prepared.snapshot.target.shield.raised &&
                !prepared.snapshot.target.shield.broken &&
                !prepared.snapshot.target.shield.destroyed,
              )
            : false,
          shield: prepared.snapshot.target.shield,
        },
    priorApplication: record,
  };
}
