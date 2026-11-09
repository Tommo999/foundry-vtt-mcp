import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";

const CAPABILITIES = [
  "compendiumSearch",
  "partySummary",
  "encounterAnalysis",
] as const;
const EQUIPMENT_TYPES = new Set([
  "armor",
  "backpack",
  "book",
  "consumable",
  "equipment",
  "ammo",
  "shield",
  "treasure",
  "weapon",
]);
function error(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function enabled(ctx: PF2eContext): boolean {
  return ctx.game.settings?.get?.("foundry-vtt-mcp", "pf2eEnabled") !== false;
}
export function requirePF2e(ctx: PF2eContext): void {
  if (ctx.game.system?.id !== "pf2e")
    throw error("PF2E_UNAVAILABLE", "This tool requires the PF2e game system.");
  if (!enabled(ctx))
    throw error(
      "PF2E_UNAVAILABLE",
      "PF2e support is disabled in module settings.",
    );
  if (!ctx.game.pf2e)
    throw error(
      "PF2E_UNAVAILABLE",
      "The PF2e system API is not available yet.",
    );
}
export function pf2eStatus(ctx: PF2eContext): object {
  const detected = ctx.game.system?.id === "pf2e";
  const active = detected && enabled(ctx) && Boolean(ctx.game.pf2e);
  return {
    available: active,
    detected,
    systemId: ctx.game.system?.id ?? null,
    version: ctx.game.system?.version ?? null,
    enabled: detected ? enabled(ctx) : false,
    capabilities: Object.fromEntries(
      CAPABILITIES.map((name) => [name, active && capability(ctx, name)]),
    ),
  };
}
function capability(ctx: PF2eContext, name: string): boolean {
  const pf2e = ctx.game.pf2e;
  if (!pf2e) return false;
  if (name === "encounterAnalysis")
    return typeof pf2e.gm?.calculateXP === "function";
  if (name === "partySummary") return Boolean(ctx.game.actors?.party);
  if (name === "nativeImports")
    return (
      typeof ctx.game.actors?.fromCompendium === "function" &&
      typeof ctx.game.items?.fromCompendium === "function" &&
      typeof ctx.game.actors?.documentClass?.create === "function" &&
      typeof ctx.game.items?.documentClass?.create === "function"
    );
  if (name === "encounterStaging")
    return Boolean(
      ctx.game.scenes &&
      typeof ctx.game.actors?.documentClass?.prototype?.getTokenDocument ===
        "function" &&
      typeof ctx.game.scenes?.documentClass?.prototype
        ?.createEmbeddedDocuments === "function",
    );
  return Boolean(ctx.game.packs);
}
function array(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value[Symbol.iterator] === "function")
    return Array.from(value);
  if (value && typeof value.values === "function")
    return Array.from(value.values());
  return [];
}
function levelOf(data: any, kind: string): number | undefined {
  const level =
    kind === "creature" || kind === "hazard"
      ? data?.system?.details?.level
      : data?.system?.level;
  const value = level && typeof level === "object" ? level.value : level;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function copperPrice(system: any): { cp: number; basis: string } | undefined {
  const price = system?.price;
  if (price == null) return undefined;
  const value = price && typeof price === "object" ? price.value : price;
  if (value == null) return undefined;
  let copper: number;
  if (typeof value === "number") copper = value;
  else if (typeof value === "string") {
    const match = value.match(
      /^\s*(?:(\d+)\s*pp)?\s*(?:(\d+)\s*gp)?\s*(?:(\d+)\s*sp)?\s*(?:(\d+)\s*cp)?\s*$/i,
    );
    if (!match || !match.slice(1).some(Boolean)) return undefined;
    copper =
      Number(match[1] ?? 0) * 1000 +
      Number(match[2] ?? 0) * 100 +
      Number(match[3] ?? 0) * 10 +
      Number(match[4] ?? 0);
  } else if (typeof value === "object")
    copper =
      Number(value.pp ?? 0) * 1000 +
      Number(value.gp ?? 0) * 100 +
      Number(value.sp ?? 0) * 10 +
      Number(value.cp ?? 0);
  else return undefined;
  if (!Number.isFinite(copper)) return undefined;
  const per = Number((typeof price === "object" ? price.per : undefined) ?? 1);
  if (!Number.isFinite(per) || per <= 0) return undefined;
  return {
    cp: copper / per,
    basis: per === 1 ? "listed price" : "listed price per unit",
  };
}
function fieldsFor(kind: string): string[] {
  return kind === "creature"
    ? ["type", "system.details.level.value", "system.traits"]
    : kind === "hazard"
      ? [
          "type",
          "system.details.level.value",
          "system.details.isComplex",
          "system.traits",
        ]
      : ["type", "system.level.value", "system.traits", "system.price"];
}
function sizeOf(system: any): string | undefined {
  const size = system?.traits?.size;
  const value = size && typeof size === "object" ? size.value : size;
  return typeof value === "string" && value.length ? value : undefined;
}
function matchesSearch(
  row: any,
  args: Record<string, any>,
  kind: string,
): boolean {
  const q = String(args.query ?? "").toLowerCase();
  if (
    q &&
    !String(row.name ?? "")
      .toLowerCase()
      .includes(q)
  )
    return false;
  const system = row.system ?? {};
  if (kind === "hazard" && args.complexity !== undefined) {
    const isComplex = system.details?.isComplex;
    if (
      typeof isComplex !== "boolean" ||
      (args.complexity === "complex") !== isComplex
    )
      return false;
  }
  const level = levelOf(row, kind);
  if (
    args.levelMin !== undefined &&
    (level === undefined || level < args.levelMin)
  )
    return false;
  if (
    args.levelMax !== undefined &&
    (level === undefined || level > args.levelMax)
  )
    return false;
  const traits = system.traits?.value;
  if (
    args.traits?.length &&
    (!Array.isArray(traits) ||
      !args.traits.every((t: string) => traits.includes(t)))
  )
    return false;
  const rarity = system.traits?.rarity;
  if (args.rarities?.length && (!rarity || !args.rarities.includes(rarity)))
    return false;
  const size = sizeOf(system);
  if (args.sizes?.length && (!size || !args.sizes.includes(size))) return false;
  if (kind === "equipment") {
    if (args.itemTypes?.length && !args.itemTypes.includes(row.type))
      return false;
    const price = copperPrice(system);
    if (
      args.priceMinCp !== undefined &&
      (price === undefined || price.cp < args.priceMinCp)
    )
      return false;
    if (
      args.priceMaxCp !== undefined &&
      (price === undefined || price.cp > args.priceMaxCp)
    )
      return false;
  }
  return true;
}
async function searchCompendium(
  args: Record<string, any>,
  ctx: PF2eContext,
): Promise<object> {
  requirePF2e(ctx);
  const kind = String(args.kind);
  if (args.complexity !== undefined && kind !== "hazard")
    throw error("INVALID_INPUT", "Complexity filters only apply to hazards.");
  if (
    kind === "equipment" &&
    args.itemTypes?.some((type: string) => !EQUIPMENT_TYPES.has(type))
  )
    throw error("INVALID_INPUT", "Unsupported PF2e physical item type filter.");
  if (
    kind !== "equipment" &&
    (args.itemTypes?.length ||
      args.priceMinCp !== undefined ||
      args.priceMaxCp !== undefined)
  )
    throw error(
      "INVALID_INPUT",
      "Item type and price filters only apply to equipment.",
    );
  if (kind === "equipment" && args.sizes?.length)
    throw error(
      "INVALID_INPUT",
      "Size filters are not available for equipment index data.",
    );
  const packs = array(ctx.game.packs).filter(
    (pack) => !args.pack || pack.collection === args.pack,
  );
  const warnings: string[] = [];
  const rows: any[] = [];
  for (const pack of packs) {
    const expected = kind === "equipment" ? "Item" : "Actor";
    if (pack.documentName !== expected) {
      if (args.pack)
        warnings.push(
          `Pack ${pack.collection} stores ${pack.documentName}, expected ${expected}.`,
        );
      continue;
    }
    try {
      const index = await pack.getIndex({ fields: fieldsFor(kind) });
      for (const row of array(index)) {
        if (kind === "creature" && row.type !== "npc") continue;
        if (kind === "hazard" && row.type !== "hazard") continue;
        if (kind === "equipment" && !EQUIPMENT_TYPES.has(row.type)) continue;
        if (!matchesSearch(row, args, kind)) continue;
        const system = row.system ?? {};
        const price = kind === "equipment" ? copperPrice(system) : undefined;
        rows.push({
          uuid:
            row.uuid ??
            `Compendium.${pack.collection}.${pack.documentName}.${row._id}`,
          name: row.name,
          type: row.type,
          level: levelOf(row, kind) ?? null,
          traits: Array.isArray(system.traits?.value)
            ? system.traits.value
            : [],
          rarity: system.traits?.rarity ?? null,
          size: sizeOf(system) ?? null,
          priceCp: price?.cp ?? null,
          priceBasis: price?.basis ?? null,
          pack: pack.collection,
        });
      }
    } catch (e: any) {
      warnings.push(
        `Could not read pack ${pack.collection}: ${e?.message ?? String(e)}`,
      );
    }
  }
  if (args.pack && !packs.length)
    warnings.push(`Pack ${args.pack} was not found.`);
  rows.sort(
    (a, b) =>
      a.pack.localeCompare(b.pack) ||
      String(a.name).localeCompare(String(b.name)) ||
      a.uuid.localeCompare(b.uuid),
  );
  const offset = Number(args.offset ?? 0),
    limit = Math.min(100, Number(args.limit ?? 25));
  return {
    kind,
    total: rows.length,
    offset,
    limit,
    results: rows.slice(offset, offset + limit),
    warnings,
  };
}
function partyMembers(party: any): any[] {
  const seen = new Set<string>();
  return array(party.members).filter((member) => {
    const uuid = String(member?.uuid ?? "");
    if (!uuid || seen.has(uuid)) return false;
    seen.add(uuid);
    return true;
  });
}
function partyCharacters(party: any): any[] {
  return partyMembers(party).filter((member) => member?.type === "character");
}
function finite(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export async function resolveParty(
  ctx: PF2eContext,
  partyUuid?: string,
): Promise<any> {
  requirePF2e(ctx);
  let party = partyUuid ? await ctx.resolve(partyUuid) : ctx.game.actors?.party;
  if (!party || party.type !== "party" || party.documentName !== "Actor")
    throw error("INVALID_INPUT", "A world PF2e party Actor is required.");
  if (party.compendium || party.isEmbedded || party.parent)
    throw error("INVALID_INPUT", "Party must be a world Actor.");
  return party;
}
async function summarizeParty(
  args: Record<string, any>,
  ctx: PF2eContext,
): Promise<object> {
  const party = await resolveParty(ctx, args.partyUuid);
  const members = partyMembers(party);
  const warnings: string[] = [];
  if (members.length > 12)
    warnings.push(`Party summary capped at 12 of ${members.length} members.`);
  const nonCharacters = members.filter(
    (member) => member.type !== "character",
  ).length;
  if (nonCharacters)
    warnings.push(
      `${nonCharacters} non-character party member(s) included in summary.`,
    );
  const actors = members.slice(0, 12).map((member) => {
    const skills = member.skills ?? {};
    const preparedSkills: Record<string, number | null> = {};
    for (const [name, stat] of Object.entries(skills))
      preparedSkills[name] = finite(
        (stat as any)?.mod ?? (stat as any)?.check?.mod ?? (stat as any)?.value,
      );
    const saves = member.saves ?? member.system?.saves ?? {};
    const conditions = array(member.conditions?.contents ?? member.conditions)
      .filter((c) => typeof c === "string" || c?.active !== false)
      .map((c) =>
        typeof c === "string"
          ? { name: c, active: true, value: null }
          : {
              name: c?.name ?? c?.slug ?? null,
              active: c?.active ?? true,
              value: finite(c?.value ?? c?.system?.value),
            },
      )
      .filter((c) => c.name);
    return {
      uuid: member.uuid,
      name: member.name,
      level: levelOf(member, "creature") ?? member.level ?? null,
      perception: finite(
        member.perception?.mod ??
          member.perception?.check?.mod ??
          member.perception?.value,
      ),
      preparedSkills,
      languages: member.system?.details?.languages?.value ?? null,
      armorClass: member.armorClass?.value ?? null,
      saves: {
        fortitude: finite(
          saves.fortitude?.mod ??
            saves.fortitude?.check?.mod ??
            saves.fortitude?.value,
        ),
        reflex: finite(
          saves.reflex?.mod ?? saves.reflex?.check?.mod ?? saves.reflex?.value,
        ),
        will: finite(
          saves.will?.mod ?? saves.will?.check?.mod ?? saves.will?.value,
        ),
      },
      conditions,
      hitPoints: {
        value: finite(
          member.hitPoints?.value ?? member.system?.attributes?.hp?.value,
        ),
        max: finite(
          member.hitPoints?.max ?? member.system?.attributes?.hp?.max,
        ),
        temp: finite(
          member.hitPoints?.temp ?? member.system?.attributes?.hp?.temp,
        ),
      },
    };
  });
  return {
    partyUuid: party.uuid,
    systemVersion: ctx.game.system?.version ?? null,
    members: actors,
    memberCount: members.length,
    warnings,
  };
}
function partyLevel(members: any[]): number | undefined {
  const levels = members
    .map((member) => member.level ?? levelOf(member, "creature"))
    .filter((n: any) => typeof n === "number" && Number.isFinite(n));
  if (
    !levels.length ||
    levels.length !== members.length ||
    new Set(levels).size !== 1
  )
    return undefined;
  return levels[0];
}
// PF2e source APIs: src_module_actor_base.ts exposes `level`; native previews use clone({save:false, keepId:false}) and applyAdjustment without persisting the source.
async function getAdjustment(actor: any, adjustment: string): Promise<any> {
  if (actor.type === "hazard") {
    if (adjustment !== "normal")
      throw error(
        "INVALID_INPUT",
        "Hazards do not support elite or weak adjustment.",
      );
    return actor;
  }
  if (actor.type !== "npc")
    throw error(
      "INVALID_INPUT",
      "Encounter participants must be NPCs or hazards.",
    );
  if (typeof actor.clone !== "function")
    throw error(
      "UNSUPPORTED_API",
      "PF2e Actor clone API is required for encounter preview.",
    );
  const clone = actor.clone({}, { save: false, keepId: false });
  if (
    !clone ||
    clone === actor ||
    ("persisted" in clone && clone.persisted !== false)
  )
    throw error(
      "UNSUPPORTED_API",
      "PF2e did not provide a non-persisted preview clone.",
    );
  if (typeof clone.applyAdjustment !== "function")
    throw error("UNSUPPORTED_API", "PF2e applyAdjustment API is unavailable.");
  await clone.applyAdjustment(adjustment === "normal" ? null : adjustment);
  return clone;
}
async function analyzeEncounter(
  args: Record<string, any>,
  ctx: PF2eContext,
): Promise<object> {
  requirePF2e(ctx);
  const calculate = ctx.game.pf2e?.gm?.calculateXP;
  if (typeof calculate !== "function")
    throw error(
      "UNSUPPORTED_API",
      "Native PF2e encounter XP calculation API is unavailable.",
    );
  const party =
    args.partyUuid || ctx.game.actors?.party
      ? await resolveParty(ctx, args.partyUuid)
      : null;
  const members = party ? partyCharacters(party) : [];
  const excluded = party ? partyMembers(party).length - members.length : 0;
  if (members.length > 12)
    throw error(
      "INVALID_INPUT",
      "Encounter analysis supports parties of at most 12 characters.",
    );
  const inferred = partyLevel(members);
  if (
    (args.partyLevel === undefined || args.partySize === undefined) &&
    inferred === undefined
  )
    throw error(
      "INVALID_INPUT",
      "Mixed or unavailable party levels require explicit partyLevel and partySize.",
    );
  const level = args.partyLevel ?? inferred;
  const size = args.partySize ?? members.length;
  if (!level || !size)
    throw error(
      "INVALID_INPUT",
      "A non-empty party or explicit partyLevel and partySize is required.",
    );
  const pwol = ctx.game.pf2e.settings?.variants?.pwol?.enabled;
  if (typeof pwol !== "boolean")
    throw error(
      "UNSUPPORTED_API",
      "Cannot determine the PF2e proficiency without level setting.",
    );
  const npcLevels: number[] = [],
    hazards: { level: number; isComplex: boolean }[] = [],
    warnings: string[] = excluded
      ? [
          `${excluded} non-character party member(s) excluded from level inference.`,
        ]
      : [],
    entries: any[] = [];
  for (const entry of args.participants) {
    let source = await ctx.resolve(entry.uuid);
    if (source?.documentName !== "Actor" || source.isEmbedded || source.parent)
      throw error(
        "INVALID_INPUT",
        `Participant ${entry.uuid} must be an Actor document.`,
      );
    if (source.type !== "npc" && source.type !== "hazard")
      throw error(
        "INVALID_INPUT",
        `Participant ${entry.uuid} is not a PF2e creature or hazard.`,
      );
    let actor = await getAdjustment(source, entry.adjustment);
    const isNpc = actor.type === "npc",
      isHazard = actor.type === "hazard";
    if (!isNpc && !isHazard)
      throw error(
        "INVALID_INPUT",
        `Participant ${entry.uuid} is not a PF2e creature or hazard.`,
      );
    const rawLevel = actor.level ?? actor.system?.details?.level?.value;
    if (typeof rawLevel !== "number" || !Number.isFinite(rawLevel))
      throw error(
        "UNSUPPORTED_API",
        `PF2e level data is unavailable for ${entry.uuid}.`,
      );
    if (isNpc) {
      for (let i = 0; i < entry.quantity; i++) npcLevels.push(rawLevel);
    } else {
      if (entry.adjustment !== "normal")
        throw error(
          "INVALID_INPUT",
          "Hazards do not support elite or weak adjustment.",
        );
      const complex = actor.system?.details?.isComplex;
      if (typeof complex !== "boolean")
        throw error(
          "UNSUPPORTED_API",
          `Hazard complexity data is unavailable for ${entry.uuid}.`,
        );
      for (let i = 0; i < entry.quantity; i++)
        hazards.push({ level: rawLevel, isComplex: complex });
    }
    const single = calculate(
      level,
      1,
      isNpc ? [rawLevel] : [],
      isHazard
        ? [{ level: rawLevel, isComplex: actor.system.details.isComplex }]
        : [],
      { pwol },
    );
    entries.push({
      uuid: entry.uuid,
      name: actor.name,
      type: actor.type,
      adjustment: entry.adjustment,
      quantity: entry.quantity,
      effectiveLevel: rawLevel,
      xpEach: single.totalXP,
    });
    const range =
      isHazard && !actor.system.details.isComplex ? 4 : pwol ? 7 : 4;
    if (rawLevel - level > range || rawLevel - level < -range)
      warnings.push(
        `${actor.name} is outside the native XP table range and is clamped by PF2e.`,
      );
  }
  // `game.pf2e.gm.calculateXP` is installed by src_scripts_set-game-pf2e.ts and implemented in src_scripts_macros_xp_index.ts.
  const result = calculate(level, size, npcLevels, hazards, { pwol });
  return {
    partyUuid: party?.uuid ?? null,
    partyLevel: level,
    partySize: size,
    pwol,
    totalXP: result.totalXP,
    rating: result.rating,
    ratingXP: result.ratingXP,
    xpPerPlayer: result.xpPerPlayer,
    budgets: result.encounterBudgets,
    participants: entries,
    warnings,
  };
}
export async function handlePF2eRead(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  if (tool === "pf2e_status") return pf2eStatus(ctx);
  if (tool === "pf2e_search_compendium")
    return searchCompendium(args as any, ctx);
  if (tool === "pf2e_party_summary") return summarizeParty(args as any, ctx);
  if (tool === "pf2e_analyze_encounter")
    return analyzeEncounter(args as any, ctx);
  throw error(
    "UNSUPPORTED_API",
    `PF2e read adapter does not implement ${tool}.`,
  );
}
