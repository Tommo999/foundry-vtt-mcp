import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { withCombatLock } from "./encounters";
import { requirePF2e } from "./pf2e";

const MAX_TEXT = 400;
const MAX_INSTANCES = 40;
const DOS = ["criticalFailure", "failure", "success", "criticalSuccess"];

function error(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function partial(message: string, data: Record<string, unknown>): Error {
  return error("PARTIAL_FAILURE", message, { ...data, outcomeUnknown: true });
}
function short(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function collectionValues(collection: any): any[] {
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
function worldCombat(combat: any, ctx: PF2eContext): boolean {
  return Boolean(
    combat?.documentName === "Combat" &&
    !combat.compendium &&
    !combat.parent &&
    get(ctx.game.combats, combat.id) === combat,
  );
}
function worldToken(token: any, ctx: PF2eContext, scene?: any): boolean {
  return Boolean(
    token?.documentName === "Token" &&
    !token.compendium &&
    token.parent?.documentName === "Scene" &&
    !token.parent.compendium &&
    !token.parent.parent &&
    get(ctx.game.scenes, token.parent.id) === token.parent &&
    (!scene || token.parent === scene) &&
    get(token.parent.tokens, token.id) === token,
  );
}
function degree(roll: any): string | null {
  const value = roll?.options?.degreeOfSuccess;
  return Number.isInteger(value) && DOS[value] ? DOS[value] : null;
}
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function messageUuid(message: any): string | null {
  return typeof message?.uuid === "string" ? message.uuid.slice(0, 512) : null;
}
function messages(ctx: PF2eContext): any[] {
  return collectionValues(ctx.game.messages);
}
type RollIdentity = {
  actorUuid: string;
  actorId: string;
  attackerUuid: string;
  attackerId: string;
  sceneId: string;
  targetUuid: string;
  targetActorUuid: string;
  itemUuid: string;
};
function originMatches(
  message: any,
  identity: RollIdentity,
  type: string,
): boolean {
  const flags = message?.flags?.pf2e;
  const context = flags?.context;
  if (
    !context ||
    context.type !== type ||
    flags.origin?.uuid !== identity.itemUuid
  )
    return false;
  if (
    message?.speaker?.actor !== identity.actorId ||
    message?.speaker?.token !== identity.attackerId ||
    message?.speaker?.scene !== identity.sceneId
  )
    return false;
  if (type === "attack-roll") {
    return Boolean(
      context.action === "strike" &&
      context.origin?.actor === identity.actorUuid &&
      context.origin?.token === identity.attackerUuid &&
      context.target?.actor === identity.targetActorUuid &&
      context.target?.token === identity.targetUuid,
    );
  }
  return Boolean(
    context.sourceType === "attack" &&
    context.actor === identity.actorId &&
    context.token === identity.attackerId &&
    flags.target?.actor === identity.targetActorUuid &&
    flags.target?.token === identity.targetUuid,
  );
}
function matchingMessages(
  before: Set<string>,
  ctx: PF2eContext,
  identity: RollIdentity,
  type: string,
): any[] {
  return messages(ctx).filter(
    (message) =>
      !before.has(message?.id) && originMatches(message, identity, type),
  );
}
function chatCapture(
  ctx: PF2eContext,
  actor: any,
  attacker: any,
  target: any,
  itemUuid: string,
  type: string,
) {
  const identity: RollIdentity = {
    actorUuid: String(actor.uuid),
    actorId: String(actor.id),
    attackerUuid: String(attacker.uuid),
    attackerId: String(attacker.id),
    sceneId: String(attacker.parent.id),
    targetUuid: String(target.uuid),
    targetActorUuid: String(target.actor.uuid),
    itemUuid: String(itemUuid),
  };
  const before = new Set(messages(ctx).map((message) => message?.id));
  const matches: any[] = [];
  const hook = (message: any) => {
    if (
      !before.has(message?.id) &&
      originMatches(message, identity, type) &&
      !matches.includes(message)
    )
      matches.push(message);
  };
  const hooks = (globalThis as any).Hooks;
  const hookId = hooks?.on?.("createChatMessage", hook);
  return {
    before,
    matches,
    close() {
      if (hookId !== undefined) hooks?.off?.("createChatMessage", hookId);
    },
    all() {
      for (const message of matchingMessages(before, ctx, identity, type))
        if (!matches.includes(message)) matches.push(message);
      return matches;
    },
    identity,
  };
}
function assertCombat(
  combat: any,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): any {
  if (!worldCombat(combat, ctx) || combat.uuid !== args.encounterUuid)
    throw error(
      "INVALID_ENCOUNTER",
      "Select a root Combat in the active world.",
    );
  if (
    combat.started !== true ||
    !(
      combat.active === true ||
      ctx.game.combat === combat ||
      ctx.game.combat?.id === combat.id
    ) ||
    ctx.game.combat?.id !== combat.id
  )
    throw error(
      "ENCOUNTER_NOT_ACTIVE",
      "Strike rolls require the active started encounter.",
    );
  if (
    combat.round !== args.expectedRound ||
    combat.turn !== args.expectedTurn ||
    combat.combatant?.uuid !== args.expectedCombatantUuid ||
    get(combat.combatants, combat.combatant?.id) !== combat.combatant
  )
    throw error(
      "STALE_TURN",
      "Encounter state changed. Inspect the combat tracker before rolling.",
    );
  return combat;
}
async function resolveRequest(args: Record<string, unknown>, ctx: PF2eContext) {
  const combat = await ctx.resolve(String(args.encounterUuid));
  assertCombat(combat, args, ctx);
  const attacker = await ctx.resolve(String(args.attackerTokenUuid));
  const target = await ctx.resolve(String(args.targetTokenUuid));
  if (!worldToken(attacker, ctx) || !worldToken(target, ctx, attacker.parent))
    throw error(
      "INVALID_TOKEN",
      "Attacker and target must be world tokens in the same scene.",
    );
  const scene = attacker.parent;
  if ((ctx.game.scenes?.current ?? ctx.game.scenes?.active) !== scene)
    throw error(
      "SCENE_NOT_ACTIVE",
      "Both tokens must be on Foundry's currently viewed scene.",
    );
  if (!attacker.actor || !["character", "npc"].includes(attacker.actor.type))
    throw error(
      "UNSUPPORTED_ATTACKER",
      "Attacker must be a PF2e character or NPC token.",
    );
  if (
    !target.actor ||
    !["character", "npc", "familiar"].includes(target.actor.type)
  )
    throw error(
      "UNSUPPORTED_TARGET",
      "Target must be a PF2e character, NPC, or familiar token.",
    );
  if (!target.object || target.object.document !== target)
    throw error(
      "TOKEN_NOT_RENDERED",
      "Target token must be rendered on the active scene.",
    );
  const current = combat.combatant;
  if (
    !current ||
    current.token !== attacker ||
    current.actor !== attacker.actor
  )
    throw error(
      "NOT_CURRENT_COMBATANT",
      "Attacker must be the current combatant's exact token.",
    );
  const active = attacker.actor.getActiveTokens?.(true, true);
  const nativeToken = Array.isArray(active)
    ? (active.find((token: any) => token?.object?.controlled) ?? active[0])
    : null;
  if (nativeToken !== attacker)
    throw error(
      "AMBIGUOUS_ATTACKER_TOKEN",
      "PF2e would use a different attacker token. Use the combatant's active token.",
    );
  return {
    combat,
    scene,
    attacker,
    target,
    actor: attacker.actor,
    attackerActor: attacker.actor,
    targetActor: target.actor,
  };
}
function resolveStrike(actor: any, args: Record<string, unknown>) {
  const actions = Array.isArray(actor.system?.actions)
    ? actor.system.actions
    : [];
  const index = Number(args.strikeIndex);
  const strike = actions[index];
  if (
    !strike ||
    strike.type !== "strike" ||
    strike.slug !== args.strikeSlug ||
    strike.item?.uuid !== args.strikeItemUuid ||
    strike.item?.actor !== actor
  )
    throw error(
      "STALE_STRIKE",
      "Prepared strike changed; inspect actions and select it again.",
    );
  return strike;
}
function eventForCheck(ctx: PF2eContext): MouseEvent {
  const skip = Boolean(ctx.game.user?.settings?.showCheckDialogs);
  return Object.assign(new Event("click"), {
    ctrlKey: true,
    metaKey: false,
    shiftKey: skip,
  }) as MouseEvent;
}
function eventForDamage(ctx: PF2eContext): MouseEvent {
  const skip = Boolean(ctx.game.user?.settings?.showDamageDialogs);
  return Object.assign(new Event("click"), {
    ctrlKey: true,
    metaKey: false,
    shiftKey: skip,
  }) as MouseEvent;
}
function verifyRollMessage(
  roll: any,
  candidates: any[],
  type: string,
): any | null {
  if (!candidates.length || typeof roll?.toJSON !== "function") return null;
  const rollJson = stable(roll.toJSON());
  const matches = candidates.filter((message) => {
    const listedRolls = collectionValues(message.rolls);
    return (
      listedRolls.length > 0 &&
      stable(listedRolls[0]?.toJSON?.() ?? listedRolls[0]) === rollJson
    );
  });
  if (matches.length !== 1) return null;
  const mode = matches[0].flags?.pf2e?.context?.messageMode;
  if (mode !== "gm") return null;
  if (
    type === "attack-roll" &&
    matches[0].flags?.pf2e?.context?.action !== "strike"
  )
    return null;
  return matches[0];
}
function observedTotalFromMessage(message: any): number | null {
  const firstRoll = collectionValues(message?.rolls)[0];
  const data = firstRoll?.toJSON?.() ?? firstRoll;
  return number(data?.total ?? data?._total);
}
function rollData(roll: any) {
  const total = number(roll?.total);
  const d20 = collectionValues(roll?.dice).find((die) => die?.faces === 20);
  const dos = degree(roll);
  if (total === null || !dos) return null;
  return { total, d20: number(d20?.total), degreeOfSuccess: dos };
}
function damageData(roll: any) {
  const total = number(roll?.total);
  if (total === null) return null;
  return {
    total,
    formula: short(roll.formula, 2000),
    damage: collectionValues(roll.instances)
      .slice(0, MAX_INSTANCES)
      .map((instance) => ({
        type: short(instance.type, 80),
        category: short(instance.category, 80),
        total: number(instance.total),
      })),
    damageTruncated: collectionValues(roll.instances).length > MAX_INSTANCES,
  };
}
function assertWriteContext(
  args: Record<string, unknown>,
  combat: any,
  attacker: any,
  target: any,
  attackerActor: any,
  targetActor: any,
  ctx: PF2eContext,
) {
  requirePF2e(ctx);
  ctx.assertWrite();
  assertCombat(combat, args, ctx);
  if (
    !worldToken(attacker, ctx, combat.scene) ||
    !worldToken(target, ctx, combat.scene)
  )
    throw error(
      "INVALID_TOKEN",
      "Attacker or target token changed before the roll.",
    );
  if (
    combat.combatant?.token !== attacker ||
    combat.combatant?.actor !== attacker.actor
  )
    throw error(
      "NOT_CURRENT_COMBATANT",
      "Attacker is no longer the current combatant.",
    );
  if (attacker.actor !== attackerActor || target.actor !== targetActor)
    throw error(
      "TARGET_CHANGED",
      "Attacker or target Actor changed before the roll.",
    );
  if (
    !attacker.object ||
    attacker.object.document !== attacker ||
    !target.object ||
    target.object.document !== target
  )
    throw error(
      "TOKEN_NOT_RENDERED",
      "Attacker and target must remain rendered on the active scene.",
    );
}
function candidateIds(candidates: any[]) {
  return candidates
    .slice(0, 10)
    .map((message) => message?.uuid)
    .filter((uuid) => typeof uuid === "string");
}
async function rollStrike(args: Record<string, unknown>, ctx: PF2eContext) {
  const initial = await resolveRequest(args, ctx);
  return withCombatLock(initial.combat, ctx, async () => {
    assertWriteContext(
      args,
      initial.combat,
      initial.attacker,
      initial.target,
      initial.attackerActor,
      initial.targetActor,
      ctx,
    );
    const current = await resolveRequest(args, ctx);
    if (
      current.actor !== initial.attackerActor ||
      current.attacker !== initial.attacker ||
      current.attacker.actor !== initial.attackerActor ||
      current.target !== initial.target ||
      current.target.actor !== initial.targetActor
    )
      throw error(
        "TARGET_CHANGED",
        "Attacker or target changed before the roll.",
      );
    const strike = resolveStrike(current.actor, args);
    const attackNumber = Number(args.attackNumber ?? 1);
    const variant = strike.variants?.[attackNumber - 1];
    if (
      !strike.ready ||
      strike.canAttack === false ||
      typeof variant?.roll !== "function"
    )
      throw error(
        "STRIKE_UNAVAILABLE",
        "The selected strike is unavailable for this attack number.",
      );
    if (
      strike.item?.isOfType?.("weapon") &&
      strike.item.traits?.has?.("consumable")
    )
      throw error(
        "CONSUMABLE_WEAPON_UNSUPPORTED",
        "Native PF2e strike rolls consume consumable-trait weapons; this tool will not roll those items.",
      );
    requirePF2e(ctx);
    ctx.assertWrite();
    assertWriteContext(
      args,
      current.combat,
      current.attacker,
      current.target,
      current.attackerActor,
      current.targetActor,
      ctx,
    );
    const capture = chatCapture(
      ctx,
      current.actor,
      current.attacker,
      current.target,
      strike.item.uuid,
      "attack-roll",
    );
    let roll: any = null;
    let invoked = false;
    try {
      invoked = true;
      roll = await variant.roll({
        target: current.target.object,
        consumeAmmo: false,
        createMessage: true,
        event: eventForCheck(ctx),
        callback: (evaluated: any) => {
          roll = evaluated;
        },
      });
      const candidates = capture.all();
      if (roll === null || roll === undefined) {
        if (candidates.length === 0)
          return {
            cancelled: true,
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
          };
        throw partial(
          "PF2e created a strike message without confirming the returned roll.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            chatMessageUuids: candidateIds(candidates),
          },
        );
      }
      if (typeof roll === "string")
        throw partial("PF2e returned an unconfirmed strike result.", {
          encounterUuid: current.combat.uuid,
          strikeSlug: strike.slug,
          chatMessageUuids: candidateIds(candidates),
        });
      const data = rollData(roll);
      const message = verifyRollMessage(roll, candidates, "attack-roll");
      if (!data || !message)
        throw partial(
          "Strike roll could not be matched unambiguously to its native chat message.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            observedTotal: number(roll.total),
            chatMessageUuids: candidateIds(candidates),
          },
        );
      try {
        assertWriteContext(
          args,
          current.combat,
          current.attacker,
          current.target,
          current.attackerActor,
          current.targetActor,
          ctx,
        );
      } catch (cause) {
        throw partial(
          "Strike completed while combat state changed; inspect chat before retrying.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            ...data,
            chatMessageUuid: messageUuid(message),
            reason:
              cause instanceof Error
                ? cause.message.slice(0, 200)
                : "Combat state changed",
          },
        );
      }
      return {
        encounterUuid: current.combat.uuid,
        attackerTokenUuid: current.attacker.uuid,
        targetTokenUuid: current.target.uuid,
        strikeIndex: Number(args.strikeIndex),
        strikeSlug: strike.slug,
        attackNumber,
        ...data,
        chatMessageUuid: messageUuid(message),
      };
    } catch (cause) {
      if ((cause as any)?.code === "PARTIAL_FAILURE") throw cause;
      const candidates = capture.all();
      if (!invoked) throw cause;
      throw partial(
        "Strike failed or was interrupted. Inspect Foundry chat before retrying.",
        {
          encounterUuid: current.combat.uuid,
          strikeSlug: strike.slug,
          observedTotal:
            number(roll?.total) ?? observedTotalFromMessage(candidates[0]),
          chatMessageUuids: candidateIds(candidates),
          reason:
            cause instanceof Error
              ? cause.message.slice(0, 200)
              : "Unknown error",
        },
      );
    } finally {
      capture.close();
    }
  });
}
async function rollDamage(args: Record<string, unknown>, ctx: PF2eContext) {
  const initial = await resolveRequest(args, ctx);
  return withCombatLock(initial.combat, ctx, async () => {
    assertWriteContext(
      args,
      initial.combat,
      initial.attacker,
      initial.target,
      initial.attackerActor,
      initial.targetActor,
      ctx,
    );
    const current = await resolveRequest(args, ctx);
    if (
      current.actor !== initial.attackerActor ||
      current.attacker !== initial.attacker ||
      current.attacker.actor !== initial.attackerActor ||
      current.target !== initial.target ||
      current.target.actor !== initial.targetActor
    )
      throw error(
        "TARGET_CHANGED",
        "Attacker or target changed before the damage roll.",
      );
    const strike = resolveStrike(current.actor, args);
    const attackNumber = Number(args.attackNumber ?? 1);
    if (!strike.variants?.[attackNumber - 1])
      throw error(
        "DAMAGE_UNAVAILABLE",
        "The selected attack number is unavailable for this strike.",
      );
    const method = args.critical === true ? strike.critical : strike.damage;
    if (
      !strike.ready ||
      strike.canAttack === false ||
      typeof method !== "function"
    )
      throw error(
        "DAMAGE_UNAVAILABLE",
        "The selected strike cannot roll the requested damage.",
      );
    requirePF2e(ctx);
    ctx.assertWrite();
    assertWriteContext(
      args,
      current.combat,
      current.attacker,
      current.target,
      current.attackerActor,
      current.targetActor,
      ctx,
    );
    const capture = chatCapture(
      ctx,
      current.actor,
      current.attacker,
      current.target,
      strike.item.uuid,
      "damage-roll",
    );
    let roll: any = null;
    let invoked = false;
    try {
      invoked = true;
      roll = await method({
        target: current.target.object,
        mapIncreases: attackNumber - 1,
        createMessage: true,
        event: eventForDamage(ctx),
        callback: (evaluated: any) => {
          roll = evaluated;
        },
      });
      const candidates = capture.all();
      if (roll === null || roll === undefined) {
        if (candidates.length === 0)
          return {
            cancelled: true,
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
          };
        throw partial(
          "PF2e created a damage message without confirming the returned roll.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            chatMessageUuids: candidateIds(candidates),
          },
        );
      }
      if (typeof roll === "string")
        throw partial("PF2e returned an unconfirmed damage result.", {
          encounterUuid: current.combat.uuid,
          strikeSlug: strike.slug,
          critical: args.critical === true,
          chatMessageUuids: candidateIds(candidates),
        });
      const data = damageData(roll);
      const message = verifyRollMessage(roll, candidates, "damage-roll");
      if (!data || !message)
        throw partial(
          "Damage roll could not be matched unambiguously to its native chat message.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            critical: args.critical === true,
            observedTotal: number(roll.total),
            chatMessageUuids: candidateIds(candidates),
          },
        );
      try {
        assertWriteContext(
          args,
          current.combat,
          current.attacker,
          current.target,
          current.attackerActor,
          current.targetActor,
          ctx,
        );
      } catch (cause) {
        throw partial(
          "Damage roll completed while combat state changed; inspect chat before retrying.",
          {
            encounterUuid: current.combat.uuid,
            strikeSlug: strike.slug,
            critical: args.critical === true,
            ...data,
            chatMessageUuid: messageUuid(message),
            reason:
              cause instanceof Error
                ? cause.message.slice(0, 200)
                : "Combat state changed",
          },
        );
      }
      return {
        encounterUuid: current.combat.uuid,
        attackerTokenUuid: current.attacker.uuid,
        targetTokenUuid: current.target.uuid,
        strikeIndex: Number(args.strikeIndex),
        strikeSlug: strike.slug,
        critical: args.critical === true,
        attackNumber,
        ...data,
        chatMessageUuid: messageUuid(message),
      };
    } catch (cause) {
      if ((cause as any)?.code === "PARTIAL_FAILURE") throw cause;
      const candidates = capture.all();
      if (!invoked) throw cause;
      throw partial(
        "Damage roll failed or was interrupted. Inspect Foundry chat before retrying.",
        {
          encounterUuid: current.combat.uuid,
          strikeSlug: strike.slug,
          critical: args.critical === true,
          observedTotal:
            number(roll?.total) ?? observedTotalFromMessage(candidates[0]),
          chatMessageUuids: candidateIds(candidates),
          reason:
            cause instanceof Error
              ? cause.message.slice(0, 200)
              : "Unknown error",
        },
      );
    } finally {
      capture.close();
    }
  });
}

export function describeStrikes(actor: any) {
  const actions = Array.isArray(actor.system?.actions)
    ? actor.system.actions
    : [];
  const strikes = actions
    .map((strike: any, index: number) => ({ strike, index }))
    .filter(({ strike }: any) => strike?.type === "strike");
  return {
    total: strikes.length,
    truncated: strikes.length > 50,
    items: strikes.slice(0, 50).map(({ strike, index }: any) => ({
      index,
      type: "strike",
      slug: short(strike.slug, 100),
      label: short(strike.label),
      itemUuid: short(strike.item?.uuid, 512),
      itemName: short(strike.item?.name),
      traits: collectionValues(strike.traits)
        .slice(0, 20)
        .map((trait: any) => short(trait?.name ?? trait?.label, 100)),
      ready: typeof strike.ready === "boolean" ? strike.ready : null,
      canAttack:
        typeof strike.canAttack === "boolean" ? strike.canAttack : null,
      modifier: number(
        strike.totalModifier ??
          strike.check?.mod ??
          strike.statistic?.check?.mod ??
          strike.modifier,
      ),
      consumableWeapon: Boolean(
        strike.item?.isOfType?.("weapon") &&
        strike.item.traits?.has?.("consumable"),
      ),
      rollAvailable:
        typeof strike.variants?.[0]?.roll === "function" &&
        !(
          strike.item?.isOfType?.("weapon") &&
          strike.item.traits?.has?.("consumable")
        ),
      damageAvailable: typeof strike.damage === "function",
      unsupportedReason:
        strike.item?.isOfType?.("weapon") &&
        strike.item.traits?.has?.("consumable")
          ? "PF2e native strike rolls consume consumable-trait weapons."
          : null,
      variants: Array.isArray(strike.variants)
        ? strike.variants
            .slice(0, 3)
            .map((variant: any, variantIndex: number) => ({
              attackNumber: variantIndex + 1,
              penalty: number(variant.penalty),
              label: short(variant.label),
            }))
        : [],
    })),
  };
}

export async function handlePF2eStrikes(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_roll_strike") return rollStrike(args, ctx);
  if (tool === "pf2e_roll_damage") return rollDamage(args, ctx);
  throw error("UNKNOWN_TOOL", `Unsupported PF2e strike tool: ${tool}`);
}
