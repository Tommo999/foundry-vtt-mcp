import type { PF2eContext } from "./pf2e-context";
import { describeStrikes } from "./pf2e-strikes";
import { handlePF2eConditions } from "./pf2e-conditions";
import { requirePF2e } from "./pf2e";

const MAX_TEXT = 200;
const MAX_CONDITIONS = 20;
const MAX_EFFECTS = 20;
const MAX_TOKENS = 100;
const CREATURE_TYPES = ["character", "npc", "familiar"];
const ATTACKER_TYPES = ["character", "npc"];

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function collectionGet(collection: any, id: string): any {
  return typeof collection?.get === "function" ? collection.get(id) : undefined;
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
function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function rootCombat(combat: any, uuid: string, ctx: PF2eContext): boolean {
  return Boolean(
    combat &&
    combat.documentName === "Combat" &&
    combat.uuid === uuid &&
    !combat.compendium &&
    !combat.parent &&
    collectionGet(ctx.game.combats, combat.id) === combat,
  );
}
function resolveScene(combat: any, ctx: PF2eContext): any | null {
  const ref = combat.scene;
  const scene =
    ref && typeof ref === "object"
      ? ref
      : collectionGet(
          ctx.game.scenes,
          ref ?? combat.sceneId ?? combat._source?.scene ?? "",
        );
  if (
    !scene ||
    scene.documentName !== "Scene" ||
    scene.compendium ||
    scene.parent ||
    collectionGet(ctx.game.scenes, scene.id) !== scene
  )
    return null;
  return scene;
}
function resolveToken(uuid: string, scene: any): any {
  const tokens = values(scene?.tokens);
  const token = tokens.find((entry) => entry?.uuid === uuid);
  return token &&
    token.documentName === "Token" &&
    !token.compendium &&
    token.parent === scene &&
    collectionGet(scene.tokens, token.id) === token
    ? token
    : null;
}
function tokenRow(token: any) {
  const actor = token.actor;
  const ac = actor?.system?.attributes?.ac?.value;
  return {
    uuid: token.uuid,
    name: text(token.name),
    actorUuid: text(actor?.uuid, 512),
    actorName: text(actor?.name),
    actorType: text(actor?.type, 40),
    x: finite(token.x),
    y: finite(token.y),
    elevation: finite(token.elevation),
    hidden: typeof token.hidden === "boolean" ? token.hidden : null,
    ac: finite(ac),
    rendered: Boolean(token.object && token.object.document === token),
  };
}
function conditionRows(report: any, key: "conditions" | "effects") {
  const section = report?.[key];
  const rows = Array.isArray(section?.items) ? section.items : [];
  const cap = key === "conditions" ? MAX_CONDITIONS : MAX_EFFECTS;
  return {
    total: finite(section?.total) ?? rows.length,
    truncated: Boolean(section?.truncated) || rows.length > cap,
    items: rows.slice(0, cap).map((item: any) => ({
      uuid: text(item.uuid, 512),
      name: text(item.name),
      slug: text(item.slug, 100),
      value: finite(item.value),
      active: typeof item.active === "boolean" ? item.active : null,
      expired: typeof item.expired === "boolean" ? item.expired : null,
      remainingDuration: finite(item.remainingDuration),
      origin: text(item.origin, 512),
    })),
  };
}
async function actorState(actor: any, targetUuid: string, ctx: PF2eContext) {
  const warnings: string[] = [];
  if (!actor || actor.documentName !== "Actor")
    return { warnings: ["This combatant has no resolved Actor."], data: null };
  let conditions: any = {
    total: 0,
    truncated: false,
    items: [],
  };
  let effects: any = { ...conditions };
  try {
    const report = (await handlePF2eConditions(
      "pf2e_inspect_conditions",
      { targetUuid },
      ctx,
    )) as any;
    conditions = conditionRows(report, "conditions");
    effects = conditionRows(report, "effects");
  } catch {
    warnings.push("PF2e conditions and effects could not be read.");
  }
  return {
    warnings,
    data: {
      uuid: text(actor.uuid, 512),
      name: text(actor.name),
      type: text(actor.type, 40),
      level: finite(actor.system?.details?.level?.value),
      ac: finite(actor.system?.attributes?.ac?.value),
      conditions,
      effects,
    },
  };
}

/** A read-only, bounded view of a PF2e encounter and its explicit target. */
export async function handlePF2eCombatContext(
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  const encounterUuid = String(args.encounterUuid);
  const combat = await ctx.resolve(encounterUuid);
  if (!rootCombat(combat, encounterUuid, ctx))
    throw coded("INVALID_ENCOUNTER", "Select a root Combat in this world.");
  const scene = resolveScene(combat, ctx);
  if (!scene)
    throw coded(
      "INVALID_ENCOUNTER_SCENE",
      "Encounter must belong to a root Scene in this world.",
    );

  const combatant = combat.combatant ?? null;
  const isMember = Boolean(
    combatant &&
    combatant.documentName === "Combatant" &&
    combatant.parent === combat &&
    collectionGet(combat.combatants, combatant.id) === combatant,
  );
  const currentToken = isMember ? (combatant.token ?? null) : null;
  const currentActor = isMember
    ? (combatant.actor ?? currentToken?.actor)
    : null;
  const warnings: string[] = [];
  if (!isMember) warnings.push("The encounter has no current combatant.");
  const validCurrentToken = Boolean(
    currentToken &&
    resolveToken(currentToken.uuid, scene) === currentToken &&
    currentToken.actor === currentActor,
  );
  if (currentToken && !validCurrentToken)
    warnings.push(
      "The current combatant token is not available in the encounter scene.",
    );
  if (currentActor && !ATTACKER_TYPES.includes(currentActor.type))
    warnings.push(
      "The current Actor type does not expose PF2e creature strikes.",
    );

  let selectedTarget: any = null;
  if (args.targetTokenUuid !== undefined) {
    const uuid = String(args.targetTokenUuid);
    selectedTarget = resolveToken(uuid, scene);
    if (!selectedTarget)
      throw coded(
        "INVALID_TOKEN",
        "Target must be an exact world token in the encounter scene.",
      );
    if (!selectedTarget.actor)
      throw coded("INVALID_TOKEN", "Target token has no PF2e Actor.");
    if (!CREATURE_TYPES.includes(selectedTarget.actor.type))
      throw coded(
        "INVALID_TOKEN",
        "Target must be a PF2e character, NPC, or familiar token.",
      );
  }

  const offset = Number(args.offset ?? 0);
  const limit = Math.min(MAX_TOKENS, Number(args.limit ?? 25));
  const sceneTokens = values(scene.tokens).filter(
    (token) =>
      token?.documentName === "Token" &&
      !token.compendium &&
      token.parent === scene &&
      collectionGet(scene.tokens, token.id) === token,
  );
  const visibleTokens = sceneTokens.slice(offset, offset + limit).map(tokenRow);

  let attackerState: any = null;
  if (currentActor && validCurrentToken) {
    const state = await actorState(currentActor, currentToken.uuid, ctx);
    attackerState = {
      ...state.data,
      token: tokenRow(currentToken),
    };
    warnings.push(...state.warnings);
  }

  let targetState: any = null;
  if (selectedTarget) {
    const state = await actorState(
      selectedTarget.actor,
      selectedTarget.uuid,
      ctx,
    );
    targetState = {
      ...state.data,
      token: tokenRow(selectedTarget),
    };
    warnings.push(...state.warnings);
  }

  let strikes: any = { total: 0, truncated: false, items: [] };
  if (
    currentActor &&
    ATTACKER_TYPES.includes(currentActor.type) &&
    validCurrentToken
  ) {
    try {
      strikes = describeStrikes(currentActor);
    } catch {
      warnings.push("PF2e prepared strikes could not be read.");
    }
  }

  const currentScene = ctx.game.scenes.current ?? ctx.game.scenes.active;
  let nativeTokens: any[] = [];
  try {
    nativeTokens =
      typeof currentActor?.getActiveTokens === "function"
        ? values(currentActor.getActiveTokens(true, true))
        : [];
  } catch {
    warnings.push("PF2e could not resolve the Actor's active token context.");
  }
  const nativeToken =
    nativeTokens.find((token) => token.object?.controlled) ??
    nativeTokens[0] ??
    null;
  const nativeAttackerMatches = Boolean(
    currentToken && nativeToken === currentToken,
  );
  if (currentActor && currentToken && !nativeAttackerMatches)
    warnings.push(
      "PF2e may use a different active token for this Actor; verify the token context before rolling.",
    );

  const started = combat.started === true;
  const round = finite(combat.round);
  const turn = finite(combat.turn);
  const active = Boolean(
    combat.active === true ||
    ctx.game.combat === combat ||
    ctx.game.combat?.id === combat.id,
  );
  const expectedTurn =
    started &&
    active &&
    round !== null &&
    Number.isInteger(round) &&
    round >= 1 &&
    turn !== null &&
    Number.isInteger(turn) &&
    turn >= 0 &&
    isMember
      ? {
          expectedRound: round,
          expectedTurn: turn,
          expectedCombatantUuid: combatant.uuid,
        }
      : null;

  return {
    readOnly: true,
    executable: false,
    nonAtomic: true,
    encounter: {
      uuid: combat.uuid,
      name: text(combat.name),
      active,
      started,
      round,
      turn,
      currentCombatantUuid: isMember ? combatant.uuid : null,
      ...(expectedTurn ?? {}),
    },
    scene: {
      uuid: scene.uuid,
      name: text(scene.name),
      viewed: currentScene === scene,
      rendered: Boolean(
        currentScene === scene &&
        currentToken?.object &&
        currentToken.object.document === currentToken,
      ),
      tokens: {
        total: sceneTokens.length,
        offset,
        limit,
        truncated: offset + limit < sceneTokens.length,
        items: visibleTokens,
      },
    },
    attacker: {
      combatantUuid: isMember ? combatant.uuid : null,
      tokenUuid: text(currentToken?.uuid, 512),
      actor: attackerState,
      strikes,
      nativeAttackerMatches,
    },
    target: selectedTarget
      ? {
          tokenUuid: selectedTarget.uuid,
          actor: targetState,
        }
      : null,
    warnings: warnings.slice(0, 20),
  };
}
