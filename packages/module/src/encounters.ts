import type { ToolName } from "@foundry-mcp/shared";
import type { BridgeContext } from "./bridge-context.js";
import { requirePF2e } from "./pf2e.js";

const locks = new Map<string, Promise<void>>();
const MAX_COMBATANTS = 40;

function codedError(
  code: string,
  message: string,
  partial?: Record<string, unknown>,
): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial ? { partial } : {}),
  });
}
function partialError(
  message: string,
  partial: Record<string, unknown>,
): Error {
  return codedError("PARTIAL_FAILURE", message, partial);
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
function collectionGet(collection: any, id: string): any {
  return typeof collection?.get === "function" ? collection.get(id) : undefined;
}
function worldScene(scene: any, ctx: BridgeContext): boolean {
  return Boolean(
    scene &&
    scene.documentName === "Scene" &&
    !scene.compendium &&
    !scene.parent &&
    collectionGet(ctx.game.scenes, scene.id) === scene,
  );
}
function worldCombat(combat: any, ctx: BridgeContext): boolean {
  return Boolean(
    combat &&
    combat.documentName === "Combat" &&
    !combat.compendium &&
    !combat.parent &&
    collectionGet(ctx.game.combats, combat.id) === combat,
  );
}
async function resolveWorldScene(
  uuid: string,
  ctx: BridgeContext,
): Promise<any> {
  const scene = await ctx.resolve(uuid);
  if (!worldScene(scene, ctx) || scene.uuid !== uuid) {
    throw codedError(
      "INVALID_SCENE",
      "Select a root Scene in the active world.",
    );
  }
  return scene;
}
async function resolveWorldCombat(
  uuid: string,
  ctx: BridgeContext,
): Promise<any> {
  const combat = await ctx.resolve(uuid);
  if (!worldCombat(combat, ctx) || combat.uuid !== uuid) {
    throw codedError(
      "INVALID_ENCOUNTER",
      "Select a root Combat in the active world.",
    );
  }
  return combat;
}
function combatScene(combat: any, ctx: BridgeContext): any | null {
  const sceneRef = combat.scene;
  const scene =
    typeof sceneRef === "object" && sceneRef !== null
      ? sceneRef
      : collectionGet(
          ctx.game.scenes,
          sceneRef ?? combat.sceneId ?? combat._source?.scene ?? "",
        );
  return worldScene(scene, ctx) ? scene : null;
}
function assertUnstarted(combat: any): void {
  const round = combat.round;
  if (
    combat.started === true ||
    (combat.turn !== null &&
      Number.isFinite(combat.turn) &&
      combat.round > 0) ||
    !Number.isFinite(round) ||
    round !== 0 ||
    (combat.turn !== null && combat.turn !== 0)
  ) {
    throw codedError(
      "ENCOUNTER_STARTED",
      "Combatant changes are only allowed in an unstarted encounter at round zero.",
    );
  }
}
function isActive(combat: any, ctx: BridgeContext): boolean {
  return Boolean(
    combat.active === true ||
    ctx.game.combat === combat ||
    ctx.game.combat?.id === combat.id,
  );
}
function assertRootCombat(combat: any, ctx: BridgeContext): void {
  if (!worldCombat(combat, ctx))
    throw codedError(
      "INVALID_ENCOUNTER",
      "Encounter is no longer in this world.",
    );
}
function combatants(combat: any): any[] {
  return values(combat.combatants);
}
function tokenIdOf(combatant: any): string | null {
  return combatant.tokenId ?? combatant.token?.id ?? null;
}
function combatSummary(
  combat: any,
  ctx: BridgeContext,
): Record<string, unknown> {
  const scene = combatScene(combat, ctx);
  return {
    uuid: combat.uuid,
    name: combat.name ?? null,
    sceneUuid: scene?.uuid ?? null,
    sceneName: scene?.name ?? scene?.id ?? null,
    active: isActive(combat, ctx),
    started: combat.started === true,
    round: Number.isFinite(combat.round) ? combat.round : null,
    turn: Number.isFinite(combat.turn) ? combat.turn : null,
    combatantCount: combatants(combat).length,
    currentCombatantUuid: combat.combatant?.uuid ?? null,
  };
}
export function encounterSummary(
  combat: any,
  ctx: BridgeContext,
): Record<string, unknown> {
  return combatSummary(combat, ctx);
}
function inspectCombat(
  combat: any,
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Record<string, unknown> {
  const rows = combatants(combat);
  const turnOrder = Array.isArray(combat.turns) ? combat.turns : rows;
  const order = new Map(
    turnOrder.map((entry: any, index: number) => [entry.id, index]),
  );
  const offset = Number(args.offset ?? 0);
  const limit = Math.min(100, Number(args.limit ?? 25));
  const selected = rows.slice(offset, offset + limit).map((combatant) => {
    const allRelated = values(combatant.relatedTokens ?? combatant.tokens);
    const related = allRelated
      .slice(0, MAX_COMBATANTS)
      .map((token: any) => token.uuid)
      .filter(Boolean);
    const token = combatant.token ?? null;
    const initiative = combatant.initiative;
    return {
      uuid: combatant.uuid,
      name: combatant.name ?? combatant.actor?.name ?? null,
      tokenUuid: token?.uuid ?? combatant.tokenUuid ?? null,
      actorUuid: combatant.actor?.uuid ?? combatant.actorUuid ?? null,
      relatedTokenUuids: related,
      relatedTokenCount: Number(
        combatant.relatedTokenCount ?? allRelated.length,
      ),
      relatedTokensTruncated: allRelated.length > related.length,
      initiative:
        typeof initiative === "number" && Number.isFinite(initiative)
          ? initiative
          : null,
      hidden: Boolean(combatant.hidden ?? token?.hidden),
      defeated: Boolean(combatant.defeated),
      order: order.get(combatant.id) ?? null,
    };
  });
  return {
    ...combatSummary(combat, ctx),
    total: rows.length,
    offset,
    limit,
    combatants: selected,
  };
}
function combatantsCollectionIds(combat: any): Set<string> {
  return new Set(combatants(combat).map((entry) => entry.id));
}
export async function withCombatLock<T>(
  combat: any,
  ctx: BridgeContext,
  fn: () => Promise<T>,
): Promise<T> {
  const worldId = String(ctx.game.world?.id ?? "world");
  const key = `${worldId}:${combat.uuid}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}
function existingCombatantForToken(combat: any, token: any): any | undefined {
  return combatants(combat).find(
    (entry) =>
      tokenIdOf(entry) === token.id || entry.token?.uuid === token.uuid,
  );
}
async function listEncounters(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  let scene: any;
  if (args.sceneUuid)
    scene = await resolveWorldScene(String(args.sceneUuid), ctx);
  const all = values(ctx.game.combats);
  const rows = all.filter(
    (combat) =>
      worldCombat(combat, ctx) &&
      (!scene || combatScene(combat, ctx) === scene),
  );
  const offset = Number(args.offset ?? 0);
  const limit = Math.min(100, Number(args.limit ?? 25));
  return {
    total: rows.length,
    offset,
    limit,
    encounters: rows
      .slice(offset, offset + limit)
      .map((combat) => combatSummary(combat, ctx)),
  };
}
async function createEncounter(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const scene = await resolveWorldScene(String(args.sceneUuid), ctx);
  const combatClass = ctx.game.combats?.documentClass;
  if (typeof combatClass?.create !== "function") {
    throw codedError(
      "API_UNAVAILABLE",
      "Foundry configured Combat creation API is unavailable.",
    );
  }
  const before = new Set(values(ctx.game.combats).map((entry) => entry.uuid));
  ctx.assertWrite();
  let combat: any;
  try {
    combat = await combatClass.create(
      { scene: scene.id, active: false, round: 0, turn: null },
      { keepId: false, render: false, renderSheet: false },
    );
  } catch {
    const created = values(ctx.game.combats).filter(
      (entry) => !before.has(entry.uuid),
    );
    throw partialError(
      "Foundry did not confirm encounter creation. Check the world before retrying.",
      {
        createdEncounterUuids: created.map((entry) => entry.uuid),
        sceneUuid: scene.uuid,
        outcomeUnknown: true,
      },
    );
  }
  if (
    !combat ||
    !worldCombat(combat, ctx) ||
    combatScene(combat, ctx) !== scene ||
    combat.started === true ||
    combat.round !== 0 ||
    combat.turn !== null ||
    combat.active === true
  ) {
    const created = values(ctx.game.combats).filter(
      (entry) => !before.has(entry.uuid),
    );
    throw partialError(
      "Foundry did not confirm the new world Combat. Check the world before retrying.",
      {
        createdEncounterUuids: created.map((entry) => entry.uuid),
        ...(combat?.uuid ? { returnedEncounterUuid: combat.uuid } : {}),
        sceneUuid: scene.uuid,
        outcomeUnknown: true,
      },
    );
  }
  return combatSummary(combat, ctx);
}
async function inspectEncounter(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const combat = await resolveWorldCombat(String(args.uuid), ctx);
  return inspectCombat(combat, args, ctx);
}
type TokenCandidate = { token: any; uuid: string };
async function preflightTokens(
  combat: any,
  tokenUuids: string[],
  ctx: BridgeContext,
): Promise<{ scene: any; candidates: TokenCandidate[] }> {
  const scene = combatScene(combat, ctx);
  if (!scene)
    throw codedError(
      "INVALID_ENCOUNTER_SCENE",
      "Encounter must belong to a root Scene in the active world.",
    );
  const candidates: TokenCandidate[] = [];
  for (const uuid of tokenUuids) {
    const token = await ctx.resolve(uuid);
    ctx.assertWrite();
    if (
      !token ||
      token.documentName !== "Token" ||
      token.compendium ||
      token.parent !== scene ||
      collectionGet(scene.tokens, token.id) !== token ||
      token.uuid !== uuid ||
      !token.actor
    ) {
      throw codedError(
        "INVALID_TOKEN",
        `Token ${uuid} must be a root token in the encounter Scene with a linked or synthetic Actor.`,
      );
    }
    if (
      ctx.game.system?.id === "pf2e" &&
      (token.flags?.pf2e?.troop || token.actor.type === "party")
    ) {
      throw codedError(
        "UNSUPPORTED_COMBATANT",
        "PF2e party and troop tokens cannot be added as ordinary combatants; add their members through Foundry.",
      );
    }
    candidates.push({ token, uuid });
  }
  return { scene, candidates };
}
function snapshotCombatants(combat: any): Map<string, any> {
  return new Map(combatants(combat).map((entry) => [entry.id, entry]));
}
function addRows(scene: any, tokens: any[]): any[] {
  return tokens.map((token) => ({
    sceneId: scene.id,
    tokenId: token.id,
    actorId: token.actorId ?? token.actor.id,
    hidden: Boolean(token.hidden),
  }));
}
async function addCombatants(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const combat = await resolveWorldCombat(String(args.encounterUuid), ctx);
  ctx.assertWrite();
  assertUnstarted(combat);
  const tokenUuids = args.tokenUuids as string[];
  if (new Set(tokenUuids).size !== tokenUuids.length) {
    throw codedError("INVALID_TOKEN", "Token UUIDs must be unique.");
  }
  const { scene, candidates } = await preflightTokens(combat, tokenUuids, ctx);
  if (typeof combat.createEmbeddedDocuments !== "function") {
    throw codedError(
      "API_UNAVAILABLE",
      "Foundry Combatant creation API is unavailable.",
    );
  }
  return withCombatLock(combat, ctx, async () => {
    ctx.assertWrite();
    if (!worldCombat(combat, ctx))
      throw codedError(
        "INVALID_ENCOUNTER",
        "Encounter was removed before the write.",
      );
    assertUnstarted(combat);
    const currentScene = combatScene(combat, ctx);
    if (currentScene !== scene)
      throw codedError(
        "ENCOUNTER_SCENE_CHANGED",
        "Encounter Scene changed before the write.",
      );
    const skipped: string[] = [];
    const selected: any[] = [];
    for (const candidate of candidates) {
      const token = collectionGet(scene.tokens, candidate.token.id);
      if (
        token !== candidate.token ||
        token.uuid !== candidate.uuid ||
        token.parent !== scene ||
        !worldScene(scene, ctx) ||
        !token.actor
      ) {
        throw codedError(
          "INVALID_TOKEN",
          `Token ${candidate.uuid} changed before the write.`,
        );
      }
      if (
        ctx.game.system?.id === "pf2e" &&
        (token.flags?.pf2e?.troop || token.actor.type === "party")
      ) {
        throw codedError(
          "UNSUPPORTED_COMBATANT",
          "PF2e party and troop tokens cannot be added as ordinary combatants.",
        );
      }
      if (existingCombatantForToken(combat, token))
        skipped.push(candidate.uuid);
      else selected.push(token);
    }
    if (selected.length === 0) {
      return {
        encounterUuid: combat.uuid,
        addedCombatantUuids: [],
        skippedTokenUuids: skipped,
      };
    }
    const before = snapshotCombatants(combat);
    ctx.assertWrite();
    assertUnstarted(combat);
    const requestedTokenUuids = selected.map((token) => token.uuid);
    try {
      const result = await combat.createEmbeddedDocuments(
        "Combatant",
        addRows(scene, selected),
        { keepId: false },
      );
      const after = snapshotCombatants(combat);
      const created = [...after.entries()]
        .filter(([id]) => !before.has(id))
        .map(([, entry]) => entry);
      const requestedTokenIds = new Set(selected.map((token) => token.id));
      const byToken = new Map<string | null, any[]>();
      for (const entry of created) {
        const tokenId = tokenIdOf(entry);
        const entries = byToken.get(tokenId) ?? [];
        entries.push(entry);
        byToken.set(tokenId, entries);
      }
      const valid = selected.flatMap((token) => byToken.get(token.id) ?? []);
      const allConfirmed =
        values(result).length === selected.length &&
        valid.length === selected.length &&
        selected.every((token) => byToken.get(token.id)?.length === 1) &&
        created.every((entry) => requestedTokenIds.has(tokenIdOf(entry)));
      if (!allConfirmed || combat.started === true) {
        throw partialError(
          "Foundry only partially confirmed combatant creation. Inspect this encounter before retrying.",
          {
            encounterUuid: combat.uuid,
            sceneUuid: scene.uuid,
            createdCombatantUuids: created.map((entry) => entry.uuid),
            requestedTokenUuids,
            skippedTokenUuids: skipped,
            outcomeUnknown: true,
            ...(combat.started === true
              ? { encounterStartedDuringWrite: true }
              : {}),
          },
        );
      }
      return {
        encounterUuid: combat.uuid,
        addedCombatantUuids: valid.map((entry) => entry.uuid),
        skippedTokenUuids: skipped,
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as any).code === "PARTIAL_FAILURE"
      )
        throw error;
      const after = snapshotCombatants(combat);
      const requestedTokenIds = new Set(
        candidates.map((candidate) => candidate.token.id),
      );
      const created = [...after.entries()]
        .filter(([id]) => !before.has(id))
        .map(([, entry]) => entry)
        .filter((entry) => requestedTokenIds.has(tokenIdOf(entry)));
      throw partialError(
        "Combatant creation failed or was interrupted. Inspect this encounter before retrying.",
        {
          encounterUuid: combat.uuid,
          sceneUuid: scene.uuid,
          createdCombatantUuids: created.map((entry) => entry.uuid),
          requestedTokenUuids,
          skippedTokenUuids: skipped,
          outcomeUnknown: true,
          ...(combat.started === true
            ? { encounterStartedDuringWrite: true }
            : {}),
        },
      );
    }
  });
}
async function removeCombatants(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const combat = await resolveWorldCombat(String(args.encounterUuid), ctx);
  ctx.assertWrite();
  assertUnstarted(combat);
  const ids = args.combatantUuids as string[];
  if (new Set(ids).size !== ids.length) {
    throw codedError("INVALID_COMBATANT", "Combatant UUIDs must be unique.");
  }
  const selected: any[] = [];
  for (const uuid of ids) {
    const combatant = await ctx.resolve(uuid);
    ctx.assertWrite();
    if (
      !combatant ||
      combatant.documentName !== "Combatant" ||
      combatant.parent !== combat ||
      !combat.combatants ||
      collectionGet(combat.combatants, combatant.id) !== combatant ||
      combatant.uuid !== uuid
    ) {
      throw codedError(
        "INVALID_COMBATANT",
        `Combatant ${uuid} must belong to the selected encounter.`,
      );
    }
    selected.push(combatant);
  }
  if (typeof combat.deleteEmbeddedDocuments !== "function") {
    throw codedError(
      "API_UNAVAILABLE",
      "Foundry Combatant deletion API is unavailable.",
    );
  }
  return withCombatLock(combat, ctx, async () => {
    ctx.assertWrite();
    if (!worldCombat(combat, ctx))
      throw codedError(
        "INVALID_ENCOUNTER",
        "Encounter was removed before the write.",
      );
    assertUnstarted(combat);
    const current = selected.map((entry) =>
      collectionGet(combat.combatants, entry.id),
    );
    if (current.some((entry, index) => entry !== selected[index])) {
      throw codedError(
        "INVALID_COMBATANT",
        "Combatant membership changed before the write.",
      );
    }
    const before = snapshotCombatants(combat);
    const requested = selected.map((entry) => entry.id);
    ctx.assertWrite();
    assertUnstarted(combat);
    try {
      await combat.deleteEmbeddedDocuments("Combatant", requested);
      const after = snapshotCombatants(combat);
      const removed = requested.filter(
        (id) => before.has(id) && !after.has(id),
      );
      if (removed.length !== requested.length || combat.started === true) {
        throw partialError(
          "Foundry only partially confirmed combatant removal. Inspect this encounter before retrying.",
          {
            encounterUuid: combat.uuid,
            removedCombatantUuids: removed.map((id) => before.get(id).uuid),
            requestedCombatantUuids: selected.map((entry) => entry.uuid),
            outcomeUnknown: true,
            ...(combat.started === true
              ? { encounterStartedDuringWrite: true }
              : {}),
          },
        );
      }
      return {
        encounterUuid: combat.uuid,
        removedCombatantUuids: removed.map((id) => before.get(id).uuid),
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as any).code === "PARTIAL_FAILURE"
      )
        throw error;
      const after = snapshotCombatants(combat);
      const removed = requested.filter(
        (id) => before.has(id) && !after.has(id),
      );
      throw partialError(
        "Combatant removal failed or was interrupted. Inspect this encounter before retrying.",
        {
          encounterUuid: combat.uuid,
          removedCombatantUuids: removed.map((id) => before.get(id).uuid),
          requestedCombatantUuids: selected.map((entry) => entry.uuid),
          outcomeUnknown: true,
          ...(combat.started === true
            ? { encounterStartedDuringWrite: true }
            : {}),
        },
      );
    }
  });
}

async function startEncounter(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const combat = await resolveWorldCombat(String(args.encounterUuid), ctx);
  ctx.assertWrite();
  return withCombatLock(combat, ctx, async () => {
    ctx.assertWrite();
    assertRootCombat(combat, ctx);
    assertUnstarted(combat);
    const participants = combatants(combat);
    if (participants.length === 0)
      throw codedError(
        "EMPTY_ENCOUNTER",
        "Add combatants before starting this encounter.",
      );
    const withoutInitiative = participants
      .filter((entry) => !Number.isFinite(entry.initiative))
      .map((entry) => entry.uuid);
    if (withoutInitiative.length)
      throw codedError(
        "INITIATIVE_REQUIRED",
        "Roll initiative for every combatant before starting the encounter.",
      );
    const otherActive = values(ctx.game.combats).find(
      (entry) =>
        entry !== combat && entry.started === true && isActive(entry, ctx),
    );
    if (otherActive)
      throw codedError(
        "OTHER_ENCOUNTER_ACTIVE",
        "Another started encounter is active. End or deactivate it in Foundry before starting this one.",
      );
    if (
      typeof combat.activate !== "function" ||
      typeof combat.startCombat !== "function"
    )
      throw codedError(
        "API_UNAVAILABLE",
        "Foundry combat activation or start API is unavailable.",
      );

    let activationAttempted = false;
    try {
      if (!isActive(combat, ctx)) {
        ctx.assertWrite();
        assertRootCombat(combat, ctx);
        assertUnstarted(combat);
        activationAttempted = true;
        await combat.activate();
        if (!isActive(combat, ctx))
          throw new Error("Foundry did not confirm encounter activation.");
      }
      ctx.assertWrite();
      assertRootCombat(combat, ctx);
      assertUnstarted(combat);
      if (
        !combatants(combat).length ||
        combatants(combat).some((entry) => !Number.isFinite(entry.initiative))
      )
        throw new Error(
          "Combatants or their initiatives changed during activation.",
        );
      const activeStartedEncounter = values(ctx.game.combats).find(
        (entry) =>
          entry !== combat && entry.started === true && isActive(entry, ctx),
      );
      if (activeStartedEncounter)
        throw new Error(
          "Another started encounter became active during activation.",
        );
      await combat.startCombat();
      if (combat.started !== true)
        throw new Error("Foundry did not confirm that combat started.");
      return combatSummary(combat, ctx);
    } catch (cause) {
      if ((cause as any)?.code === "PARTIAL_FAILURE") throw cause;
      throw partialError(
        "Encounter start failed or was interrupted. Inspect Foundry before retrying.",
        {
          encounterUuid: combat.uuid,
          active: isActive(combat, ctx),
          started: combat.started === true,
          round: Number.isFinite(combat.round) ? combat.round : null,
          turn: Number.isFinite(combat.turn) ? combat.turn : null,
          activationAttempted,
          outcomeUnknown: true,
        },
      );
    }
  });
}

async function nextTurn(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const combat = await resolveWorldCombat(String(args.encounterUuid), ctx);
  ctx.assertWrite();
  return withCombatLock(combat, ctx, async () => {
    ctx.assertWrite();
    assertRootCombat(combat, ctx);
    if (combat.started !== true || !isActive(combat, ctx))
      throw codedError(
        "ENCOUNTER_NOT_ACTIVE",
        "Only the active started encounter can advance.",
      );
    const expectedRound = Number(args.expectedRound);
    const expectedTurn = Number(args.expectedTurn);
    const expectedCombatantUuid = String(args.expectedCombatantUuid);
    const current = combat.combatant;
    if (
      combat.round !== expectedRound ||
      combat.turn !== expectedTurn ||
      current?.uuid !== expectedCombatantUuid
    )
      throw codedError(
        "STALE_TURN",
        "Encounter state changed. Inspect the tracker and retry with its current round, turn, and combatant.",
      );
    if (typeof combat.nextTurn !== "function")
      throw codedError(
        "API_UNAVAILABLE",
        "Foundry next-turn API is unavailable.",
      );
    const before = {
      round: combat.round,
      turn: combat.turn,
      combatantUuid: current.uuid,
    };
    try {
      ctx.assertWrite();
      assertRootCombat(combat, ctx);
      if (
        combat.round !== expectedRound ||
        combat.turn !== expectedTurn ||
        combat.combatant?.uuid !== expectedCombatantUuid
      )
        throw codedError(
          "STALE_TURN",
          "Encounter state changed before advancing.",
        );
      await combat.nextTurn();
      const advanced =
        Number.isFinite(combat.round) &&
        Number.isFinite(combat.turn) &&
        (combat.round > before.round ||
          (combat.round === before.round && combat.turn !== before.turn));
      if (!advanced) throw new Error("Foundry did not confirm a turn advance.");
      return { ...combatSummary(combat, ctx), previous: before };
    } catch (cause) {
      if ((cause as any)?.code === "STALE_TURN") throw cause;
      throw partialError(
        "Turn advance failed or was interrupted. Inspect Foundry before retrying.",
        {
          encounterUuid: combat.uuid,
          previous: before,
          current: {
            round: Number.isFinite(combat.round) ? combat.round : null,
            turn: Number.isFinite(combat.turn) ? combat.turn : null,
            combatantUuid: combat.combatant?.uuid ?? null,
          },
          outcomeUnknown: true,
        },
      );
    }
  });
}

async function rollInitiative(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  requirePF2e(ctx);
  const combat = await resolveWorldCombat(String(args.encounterUuid), ctx);
  ctx.assertWrite();
  assertUnstarted(combat);
  if (typeof combat.rollInitiative !== "function")
    throw codedError(
      "API_UNAVAILABLE",
      "PF2e native initiative API is unavailable.",
    );
  const uuids = args.combatantUuids as string[];
  if (new Set(uuids).size !== uuids.length)
    throw codedError("INVALID_COMBATANT", "Combatant UUIDs must be unique.");
  const selected: any[] = [];
  for (const uuid of uuids) {
    const combatant = await ctx.resolve(uuid);
    ctx.assertWrite();
    if (
      !combatant ||
      combatant.documentName !== "Combatant" ||
      combatant.parent !== combat ||
      combatant.combat !== combat ||
      collectionGet(combat.combatants, combatant.id) !== combatant ||
      combatant.uuid !== uuid ||
      !combatant.actor?.initiative ||
      typeof combatant.actor.initiative.roll !== "function"
    )
      throw codedError(
        "INVALID_COMBATANT",
        `Combatant ${uuid} must be a supported PF2e participant in this encounter.`,
      );
    selected.push(combatant);
  }
  return withCombatLock(combat, ctx, async () => {
    ctx.assertWrite();
    requirePF2e(ctx);
    assertRootCombat(combat, ctx);
    assertUnstarted(combat);
    const skipped: string[] = [];
    const successes: Array<{
      combatantUuid: string;
      initiative: number;
      statistic: string | null;
      messageUuid: string | null;
    }> = [];
    let currentUuid: string | null = null;
    let nativeAttempted = false;
    const evaluation: { current: any } = { current: null };
    try {
      for (let index = 0; index < selected.length; index++) {
        const entry = selected[index];
        currentUuid = entry.uuid;
        evaluation.current = null;
        ctx.assertWrite();
        requirePF2e(ctx);
        assertRootCombat(combat, ctx);
        assertUnstarted(combat);
        if (
          collectionGet(combat.combatants, entry.id) !== entry ||
          entry.uuid !== uuids[index] ||
          !entry.actor?.initiative ||
          typeof entry.actor.initiative.roll !== "function"
        )
          throw codedError(
            "INVALID_COMBATANT",
            "Combatant membership or PF2e initiative support changed before rolling.",
          );
        if (Number.isFinite(entry.initiative) && args.reroll !== true) {
          skipped.push(entry.uuid);
          continue;
        }
        const statistic =
          entry.actor.initiative.statistic?.base?.slug ??
          entry.actor.system?.initiative?.statistic ??
          null;
        nativeAttempted = true;
        const result = await combat.rollInitiative([entry.id], {
          skipDialog: true,
          createMessage: true,
          updateTurn: false,
          messageMode: args.messageMode ?? "gm",
          callback: (roll: any, _outcome: any, message: any) => {
            if (Number.isFinite(roll?.total))
              evaluation.current = {
                total: roll.total,
                messageUuid:
                  typeof message?.uuid === "string" ? message.uuid : null,
              };
          },
        });
        const value = entry.initiative;
        if (
          result !== combat ||
          !Number.isFinite(value) ||
          !evaluation.current ||
          evaluation.current.total !== value
        )
          throw new Error("PF2e did not confirm an initiative result.");
        successes.push({
          combatantUuid: entry.uuid,
          initiative: value,
          statistic,
          messageUuid: evaluation.current.messageUuid,
        });
        assertRootCombat(combat, ctx);
        assertUnstarted(combat);
        if (
          collectionGet(combat.combatants, entry.id) !== entry ||
          entry.uuid !== uuids[index]
        )
          throw new Error(
            "Combatant membership changed while initiative was rolling.",
          );
      }
      return {
        encounterUuid: combat.uuid,
        rolled: successes,
        skippedCombatantUuids: skipped,
      };
    } catch (cause) {
      if (!nativeAttempted && successes.length === 0) throw cause;
      throw partialError(
        "Initiative roll failed or was interrupted. Inspect the encounter before retrying.",
        {
          encounterUuid: combat.uuid,
          rolled: successes,
          skippedCombatantUuids: skipped,
          failedCombatantUuid: currentUuid,
          reason:
            cause instanceof Error
              ? cause.message.slice(0, 300)
              : "Unknown error",
          messageUuid: evaluation.current?.messageUuid ?? null,
          evaluatedRoll: Number.isFinite(evaluation.current?.total)
            ? evaluation.current.total
            : null,
          observedInitiative: Number.isFinite(
            selected.find((entry) => entry.uuid === currentUuid)?.initiative,
          )
            ? selected.find((entry) => entry.uuid === currentUuid).initiative
            : null,
          outcomeUnknown: true,
        },
      );
    }
  });
}

export async function handleEncounters(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  if (tool === "list_encounters") return listEncounters(args, ctx);
  if (tool === "inspect_encounter") return inspectEncounter(args, ctx);
  if (tool === "create_encounter") return createEncounter(args, ctx);
  if (tool === "add_combatants") return addCombatants(args, ctx);
  if (tool === "remove_combatants") return removeCombatants(args, ctx);
  if (tool === "start_encounter") return startEncounter(args, ctx);
  if (tool === "next_turn") return nextTurn(args, ctx);
  if (tool === "pf2e_roll_initiative") return rollInitiative(args, ctx);
  throw codedError(
    "UNSUPPORTED_TOOL",
    `Encounter adapter does not implement ${tool}.`,
  );
}
