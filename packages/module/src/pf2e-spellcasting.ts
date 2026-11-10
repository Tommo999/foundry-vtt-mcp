import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { requirePF2e } from "./pf2e";
import { readSpellCastActorSummary } from "./pf2e-spell-ledger";

const MAX_ENTRIES = 100;
const MAX_ROWS = 500;
const CATEGORIES = new Set(["prepared", "spontaneous", "innate", "focus"]);
function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function text(value: unknown, max = 240): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function values(collection: any): any[] {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (collection && typeof collection.values === "function")
    return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function")
    return Array.from(collection);
  return [];
}
function owns(collection: any, doc: any): boolean {
  if (!collection || !doc) return false;
  if (typeof collection.get === "function")
    return collection.get(doc.id) === doc;
  return values(collection).includes(doc);
}
export function actorForSpellcastingTarget(target: any, ctx: PF2eContext): any {
  let actor = target;
  if (target?.documentName === "Token") {
    const scene = target.parent;
    if (
      scene?.documentName !== "Scene" ||
      scene.compendium ||
      scene.parent ||
      !owns(ctx.game.scenes, scene) ||
      !owns(scene.tokens, target)
    )
      throw fail("INVALID_INPUT", "Token target must belong to a world Scene.");
    actor = target.actor;
    if (!actor || actor.documentName !== "Actor" || actor.compendium)
      throw fail(
        "INVALID_INPUT",
        "Token has no usable linked or synthetic Actor.",
      );
  } else if (target?.documentName !== "Actor") {
    throw fail(
      "INVALID_INPUT",
      "Target must be a world Actor UUID or explicit Scene Token UUID.",
    );
  }
  if (actor.type !== "character" && actor.type !== "npc")
    throw fail(
      "UNSUPPORTED_ACTOR",
      "Spellcasting inspection supports PF2e character and NPC Actors.",
    );
  if (
    target === actor &&
    (actor.isEmbedded || actor.parent || !owns(ctx.game.actors, actor))
  )
    throw fail(
      "INVALID_INPUT",
      "Target must be a root world Actor; use its explicit token UUID for synthetic Actors.",
    );
  return actor;
}
export async function resolveSpellcastingTarget(
  args: Record<string, unknown>,
  ctx: PF2eContext,
) {
  const targetUuid = String(args.targetUuid ?? "");
  if (!targetUuid) throw fail("INVALID_INPUT", "targetUuid is required.");
  const target = await ctx.resolve(targetUuid);
  if (!target)
    throw fail("INVALID_INPUT", "Target was not found: " + targetUuid);
  return { targetUuid, actor: actorForSpellcastingTarget(target, ctx) };
}
export function entriesFor(actor: any): any[] {
  const casting = actor.spellcasting;
  if (!casting) return [];
  const candidates = [
    ...values(casting.regular),
    ...values(casting),
    ...values(casting.collections).map((collection) => collection?.entry),
    casting.ritual,
  ];
  // Never call get("trick-...") here: Foundry creates an ephemeral entry on demand.
  for (const item of values(actor.items))
    if (item?.type === "spellcastingEntry") candidates.push(item);
  const seen = new Set<any>();
  return candidates.filter((entry) => {
    if (!entry?.id || (entry.actor && entry.actor !== actor) || seen.has(entry))
      return false;
    seen.add(entry);
    return true;
  });
}
export function isCurrentNativeEntry(actor: any, entry: any): boolean {
  const casting = actor.spellcasting;
  return Boolean(
    entry &&
    entry.actor === actor &&
    entry.parent === actor &&
    !entry.compendium &&
    owns(actor.items, entry) &&
    (values(casting?.regular).includes(entry) ||
      values(casting).includes(entry) ||
      values(casting?.collections).some(
        (collection) => collection?.entry === entry,
      ) ||
      casting?.ritual === entry),
  );
}
function category(entry: any): string | null {
  return text(entry.category ?? entry.system?.prepared?.value, 60);
}
function entryProblem(entry: any): string | null {
  const kind = category(entry);
  if (entry.isRitual || kind === "ritual")
    return "Ritual entries are not supported by this inspection workflow.";
  if (entry.isEphemeral) return "Ephemeral entries are not supported.";
  if (!CATEGORIES.has(kind ?? ""))
    return "This spellcasting entry category is not supported.";
  if (typeof entry.spells?.getSpellData !== "function")
    return "PF2e native spell option data is unavailable.";
  return null;
}
function summary(entry: any, actor: any, issue: string | null) {
  return {
    uuid: text(entry.uuid, 512),
    id: text(entry.id, 100),
    name: text(entry.name),
    category: category(entry),
    tradition: text(entry.tradition ?? entry.system?.tradition?.value, 60),
    prepared: entry.isPrepared === true || category(entry) === "prepared",
    flexible:
      entry.isFlexible === true || entry.system?.prepared?.flexible === true,
    ephemeral: entry.isEphemeral === true,
    actorUuid: text(actor.uuid, 512),
    dc: number(entry.statistic?.dc?.value),
    attackModifier: number(entry.statistic?.check?.mod),
    supported: issue === null,
    unsupportedReason: issue,
  };
}
function fact(value: any): string | null {
  if (typeof value === "string") return text(value);
  if (value && typeof value === "object")
    return text(value.value ?? value.text ?? value.label);
  return null;
}
export function optionRow(
  entry: any,
  actor: any,
  group: any,
  active: any,
  slotId: number | null,
) {
  const spell = active.spell;
  const groupNumber =
    number(group.number) ?? (group.id === "cantrips" ? 0 : number(group.id));
  let rank = number(active.castRank);
  if (rank === null && typeof spell.computeCastRank === "function") {
    try {
      rank = number(spell.computeCastRank(groupNumber ?? undefined));
    } catch {
      rank = null;
    }
  }
  if (rank === null) rank = number(spell.rank);
  const kind = category(entry);
  const cost = number(spell.system?.cast?.focusPoints);
  let resourceKind = "none";
  if (cost !== null && cost > 0) resourceKind = "actorFocus";
  else if (cost === 0 && (spell.isCantrip || spell.isFocusSpell))
    resourceKind = "none";
  else if (kind === "focus") resourceKind = "unsupported";
  else if (kind === "innate") resourceKind = "innateUse";
  else if (kind === "prepared" && !entry.isFlexible && slotId !== null)
    resourceKind = "preparedSlot";
  else if (kind === "spontaneous" || (kind === "prepared" && entry.isFlexible))
    resourceKind = "rankPool";
  const uses =
    resourceKind === "actorFocus"
      ? actor.system?.resources?.focus
      : resourceKind === "innateUse"
        ? spell.system?.location?.uses
        : resourceKind === "rankPool"
          ? group.uses
          : null;
  const value = number(uses?.value),
    max = number(uses?.max);
  let issue: string | null = null;
  if (!spell.uuid || !spell.id) issue = "Native spell identity is unavailable.";
  else if (cost === null) issue = "Native spell resource cost is unavailable.";
  else if (resourceKind === "unsupported")
    issue = "This focus entry option has no supported native focus-cost data.";
  else if (
    spell.actor !== actor ||
    spell.system?.location?.value !== entry.id ||
    entry.spells.get(spell.id) !== spell
  )
    issue =
      "Native spell does not belong to this Actor and spellcasting entry.";
  else if (rank === null) issue = "Native cast rank is unavailable.";
  else if (resourceKind === "innateUse" && value === null)
    issue =
      "Native innate-use data is unavailable; unlimited use is not assumed.";
  else if (active.expended === true) issue = "This native option is expended.";
  else if (resourceKind === "innateUse" && value !== null && value <= 0)
    issue = spell.atWill
      ? "PF2e does not confirm an at-will use count."
      : "No innate uses remain.";
  else if (resourceKind === "rankPool" && value === null)
    issue = "Native rank-pool availability is unavailable.";
  else if (resourceKind === "rankPool" && value !== null && value <= 0)
    issue = "No spell slots remain in this rank pool.";
  else if (resourceKind === "rankPool" && max === 0)
    issue = "PF2e reports no slots in this rank pool.";
  else if (
    resourceKind === "actorFocus" &&
    (number(actor.system?.resources?.focus?.value) === null ||
      number(actor.system?.resources?.focus?.max) === null)
  )
    issue = "Native focus-point data is unavailable.";
  else if (
    resourceKind === "actorFocus" &&
    (number(actor.system?.resources?.focus?.value) ?? 0) < cost
  )
    issue = "Not enough focus points remain.";
  const system = spell.system ?? {};
  const resourceCost =
    resourceKind === "actorFocus"
      ? cost
      : resourceKind === "none"
        ? 0
        : ["preparedSlot", "rankPool", "innateUse"].includes(resourceKind)
          ? 1
          : null;
  return {
    entryUuid: text(entry.uuid, 512),
    entryName: text(entry.name),
    category: kind,
    tradition: text(entry.tradition, 60),
    dc: number(entry.statistic?.dc?.value),
    attackModifier: number(entry.statistic?.check?.mod),
    spellUuid: text(spell.uuid, 512),
    spellId: text(spell.id, 100),
    name: text(spell.name),
    rank,
    groupId:
      text(group.id, 40) ?? (groupNumber === null ? null : String(groupNumber)),
    groupNumber,
    slotId,
    signature: active.signature === true,
    virtual: active.virtual === true,
    expended: active.expended === true,
    resource: { kind: resourceKind, cost: resourceCost, value, max },
    available: issue === null,
    unsupportedReason: issue,
    time: fact(system.time),
    range: fact(system.range),
    target: fact(system.target),
    requirements: fact(system.requirements),
    costText: fact(system.cost),
  };
}
function enumerateOptions(entry: any, actor: any, data: any): any[] {
  const rows: any[] = [];
  for (const group of Array.isArray(data?.groups) ? data.groups : []) {
    const groupNumber =
      number(group.number) ?? (group.id === "cantrips" ? 0 : number(group.id));
    const preparedCantripGroup =
      category(entry) === "prepared" && groupNumber === 0;
    const slotBased =
      category(entry) === "prepared" &&
      (!entry.isFlexible || preparedCantripGroup);
    const active = Array.isArray(group.active) ? group.active : [];
    for (let index = 0; index < active.length; index++) {
      const option = active[index];
      if (option?.spell)
        rows.push(
          optionRow(entry, actor, group, option, slotBased ? index : null),
        );
    }
  }
  return rows;
}
function page<T>(items: T[], offset: number, limit: number) {
  return {
    total: items.length,
    offset,
    limit,
    hasMore: offset + limit < items.length,
    items: items.slice(offset, offset + limit),
  };
}
async function inspectSpells(
  args: Record<string, unknown>,
  actor: any,
  allEntries: any[],
  ctx: PF2eContext,
) {
  const offset = Number(args.offset ?? 0),
    limit = Math.min(100, Number(args.limit ?? 25));
  const filter = typeof args.entryUuid === "string" ? args.entryUuid : null;
  let entries = allEntries;
  if (filter) {
    const resolved = await ctx.resolve(filter);
    entries = allEntries.filter(
      (entry) =>
        entry.uuid === filter &&
        entry === resolved &&
        isCurrentNativeEntry(actor, entry),
    );
  }
  if (filter && entries.length !== 1)
    throw fail(
      "INVALID_INPUT",
      "entryUuid must identify one native entry owned by this Actor.",
    );
  const summaries: any[] = [],
    options: any[] = [],
    warnings: any[] = [];
  for (const entry of entries) {
    const issue = entryProblem(entry);
    summaries.push(summary(entry, actor, issue));
    if (issue) {
      warnings.push({ entryUuid: text(entry.uuid, 512), message: issue });
      continue;
    }
    try {
      const data = await entry.spells.getSpellData();
      if (!data || !Array.isArray(data.groups))
        throw new Error(
          "PF2e native spell option data has an unsupported shape.",
        );
      options.push(...enumerateOptions(entry, actor, data));
    } catch (cause) {
      warnings.push({
        entryUuid: text(entry.uuid, 512),
        message:
          cause instanceof Error
            ? cause.message.slice(0, 240)
            : "Native option data could not be read.",
      });
      summaries[summaries.length - 1] = summary(
        entry,
        actor,
        "PF2e native spell option data could not be read.",
      );
    }
  }
  const optionPage = page(options, offset, limit);
  const referenced = summaries.filter((item) =>
    optionPage.items.some((option: any) => option.entryUuid === item.uuid),
  );
  const discoverable = summaries.filter(
    (item) => !referenced.includes(item) && (!filter || !options.length),
  );
  const entrySummaries = [...referenced, ...discoverable].slice(0, MAX_ENTRIES);
  return {
    targetUuid: String(args.targetUuid),
    actorUuid: text(actor.uuid, 512),
    readOnly: true,
    executable: false,
    entries: {
      total: summaries.length,
      truncated: summaries.length > MAX_ENTRIES,
      items: entrySummaries,
    },
    options: optionPage,
    warnings: warnings.slice(0, MAX_ENTRIES),
    warningsTruncated: warnings.length > MAX_ENTRIES,
  };
}
function valMax(item: any) {
  return { value: number(item?.value), max: number(item?.max) };
}
async function resourceRows(actor: any, entries: any[], warnings: any[]) {
  const rows: any[] = [];
  for (const entry of entries) {
    const issue = entryProblem(entry);
    if (issue) {
      warnings.push({ entryUuid: text(entry.uuid, 512), message: issue });
      continue;
    }
    try {
      const data = await entry.spells.getSpellData();
      if (!data || !Array.isArray(data.groups))
        throw new Error("PF2e native resource data has an unsupported shape.");
      const kind = category(entry);
      for (const group of data.groups) {
        const rank =
          number(group.number) ??
          (group.id === "cantrips" ? 0 : number(group.id));
        if (rank === 0 || group.id === "cantrips") continue;
        if (kind === "prepared" && !entry.isFlexible) {
          const slots = entry.system?.slots?.["slot" + rank];
          if (!slots) {
            rows.push({
              kind: "preparedSlots",
              entryUuid: text(entry.uuid, 512),
              rank,
              supported: false,
              reason: "Native slot data is unavailable.",
            });
            continue;
          }
          const prepared = Array.isArray(slots.prepared) ? slots.prepared : [];
          const active = Array.isArray(group.active) ? group.active : [];
          const readyCount = prepared.reduce(
            (count: number, slot: any, index: number) => {
              const spell = active[index]?.spell;
              return (
                count +
                (slot?.id &&
                !slot.expended &&
                spell &&
                slot.id === spell.id &&
                spell.actor === actor &&
                spell.system?.location?.value === entry.id &&
                entry.spells.get(spell.id) === spell
                  ? 1
                  : 0)
              );
            },
            0,
          );
          rows.push({
            kind: "preparedSlots",
            entryUuid: text(entry.uuid, 512),
            entryName: text(entry.name),
            rank,
            readyCount,
            max: number(slots.max),
            slotsTotal: prepared.length,
            slotsTruncated: prepared.length > 100,
            slots: prepared.slice(0, 100).map((slot: any, index: number) => ({
              slotId: index,
              spellId: text(slot?.id, 100),
              expended: slot ? slot.expended === true : null,
            })),
            supported: true,
            reason: null,
          });
        } else if (
          kind === "spontaneous" ||
          (kind === "prepared" && entry.isFlexible)
        ) {
          const slots = entry.system?.slots?.["slot" + rank];
          rows.push({
            kind: "rankPool",
            entryUuid: text(entry.uuid, 512),
            entryName: text(entry.name),
            rank,
            ...valMax(slots),
            supported:
              number(slots?.value) !== null && number(slots?.max) !== null,
            reason:
              number(slots?.value) !== null && number(slots?.max) !== null
                ? null
                : "Native rank-pool data is unavailable.",
          });
        }
      }
      if (kind === "innate")
        for (const spell of values(entry.spells)) {
          const uses = spell.system?.location?.uses;
          rows.push({
            kind: "innateUse",
            entryUuid: text(entry.uuid, 512),
            spellUuid: text(spell.uuid, 512),
            spellName: text(spell.name),
            ...valMax(uses),
            supported:
              number(uses?.value) !== null && number(uses?.max) !== null,
            reason:
              number(uses?.value) !== null && number(uses?.max) !== null
                ? null
                : "Native finite-use data is unavailable; unlimited use is not assumed.",
          });
        }
    } catch (cause) {
      warnings.push({
        entryUuid: text(entry.uuid, 512),
        message:
          cause instanceof Error
            ? cause.message.slice(0, 240)
            : "Native resource data could not be read.",
      });
    }
  }
  for (const item of values(actor.items)) {
    const uses = item?.system?.uses ?? item?.uses,
      frequency = item?.system?.frequency;
    if (uses && typeof uses === "object")
      rows.push({
        kind: "itemUses",
        itemUuid: text(item.uuid, 512),
        itemName: text(item.name),
        itemType: text(item.type, 60),
        ...valMax(uses),
        supported: number(uses.value) !== null && number(uses.max) !== null,
        reason:
          number(uses.value) !== null && number(uses.max) !== null
            ? null
            : "Owned item use data is incomplete.",
      });
    if (frequency && typeof frequency === "object")
      rows.push({
        kind: "itemFrequency",
        itemUuid: text(item.uuid, 512),
        itemName: text(item.name),
        itemType: text(item.type, 60),
        value: number(frequency.value),
        max: number(frequency.max),
        per: text(frequency.per, 80),
        supported:
          number(frequency.value) !== null || number(frequency.max) !== null,
        reason:
          number(frequency.value) !== null || number(frequency.max) !== null
            ? null
            : "Owned item frequency shape is unsupported.",
      });
  }
  return {
    rows: rows.slice(0, MAX_ROWS),
    total: Math.min(rows.length, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
  };
}
async function inspectResources(
  args: Record<string, unknown>,
  actor: any,
  entries: any[],
  ctx: PF2eContext,
) {
  const offset = Number(args.offset ?? 0),
    limit = Math.min(100, Number(args.limit ?? 25)),
    warnings: any[] = [];
  const rowData = await resourceRows(actor, entries, warnings),
    resources = actor.system?.resources;
  const focusData = resources?.focus;
  const focusValues = valMax(focusData);
  const focusAvailable =
    Boolean(focusData && typeof focusData === "object") &&
    focusValues.value !== null &&
    focusValues.max !== null;
  const heroData = resources?.heroPoints;
  const heroValues = valMax(heroData);
  const heroAvailable =
    Boolean(heroData && typeof heroData === "object") &&
    heroValues.value !== null &&
    heroValues.max !== null;
  if (focusData && !focusAvailable)
    warnings.push({
      entryUuid: null,
      message: "Native focus resource shape is incomplete.",
    });
  if (heroData && !heroAvailable)
    warnings.push({
      entryUuid: null,
      message: "Native hero-point resource shape is incomplete.",
    });
  const focus = {
    ...focusValues,
    cap: number(focusData?.cap),
    available: focusAvailable,
    reason: focusAvailable
      ? null
      : "Native focus resource data is unavailable or incomplete.",
  };
  const heroPoints = {
    ...heroValues,
    available: heroAvailable,
    reason: heroAvailable
      ? null
      : "Native hero-point resource data is unavailable or incomplete.",
  };
  let spellCastAudit: any;
  try {
    spellCastAudit = {
      available: true,
      state: "known",
      ...readSpellCastActorSummary(ctx, String(actor.uuid)),
    };
  } catch (cause) {
    spellCastAudit = {
      available: false,
      state: "unavailable",
      warning:
        cause instanceof Error
          ? cause.message.slice(0, 240)
          : "Spell-cast audit state is unavailable.",
    };
  }
  return {
    targetUuid: String(args.targetUuid),
    actorUuid: text(actor.uuid, 512),
    readOnly: true,
    resources: { focus, heroPoints },
    spellCastAudit,
    entries: {
      total: rowData.total,
      offset,
      limit,
      hasMore: offset + limit < rowData.total,
      truncated: rowData.truncated,
      items: rowData.rows.slice(offset, offset + limit),
    },
    warnings: warnings.slice(0, MAX_ENTRIES),
    warningsTruncated: warnings.length > MAX_ENTRIES,
  };
}
export async function handlePF2eSpellcasting(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  const { targetUuid, actor } = await resolveSpellcastingTarget(args, ctx);
  if (!actor.spellcasting)
    return {
      targetUuid,
      actorUuid: text(actor.uuid, 512),
      readOnly: true,
      available: false,
      entries: {
        total: 0,
        offset: Number(args.offset ?? 0),
        limit: Number(args.limit ?? 25),
        hasMore: false,
        items: [],
      },
      warnings: [
        {
          entryUuid: null,
          message: "PF2e native Actor spellcasting API is unavailable.",
        },
      ],
    };
  const entries = entriesFor(actor);
  if (tool === "pf2e_inspect_spellcasting")
    return inspectSpells(args, actor, entries, ctx);
  if (tool === "pf2e_inspect_resources")
    return inspectResources(args, actor, entries, ctx);
  throw fail("UNSUPPORTED_TOOL", "Unsupported PF2e spellcasting tool: " + tool);
}
