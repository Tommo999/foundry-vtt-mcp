import DOMPurify from "dompurify";
import type { BridgeContext } from "./bridge-context";
import { handleEncounters } from "./encounters";
import { handlePF2eRead, pf2eStatus } from "./pf2e";
import { handlePF2eConditions } from "./pf2e-conditions";

const LIMITS = {
  members: 12,
  skills: 50,
  conditions: 20,
  effects: 20,
  tokens: 50,
  notes: 50,
  encounters: 5,
  combatants: 50,
  references: 10,
  pages: 5,
  text: 1000,
  html: 100_000,
};
type Warning = {
  section: string;
  code: string;
  message: string;
  uuid?: string;
};

function values(collection: any): any[] {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function")
    return Array.from(collection.values());
  if (collection?.[Symbol.iterator]) return Array.from(collection);
  return [];
}
function label(value: unknown, max = 200): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function worldMember(doc: any, collection: any, name: string): boolean {
  return Boolean(
    doc &&
    doc.documentName === name &&
    !doc.compendium &&
    !doc.pack &&
    !doc.parent &&
    !doc.isEmbedded &&
    typeof collection?.get === "function" &&
    collection.get(doc.id) === doc,
  );
}
function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: "INVALID_INPUT" });
}
function bounded(items: any[], limit: number, map: (item: any) => unknown) {
  return {
    total: items.length,
    truncated: items.length > limit,
    items: items.slice(0, limit).map(map),
  };
}
function conditionSummary(report: any, limit: number) {
  const items = Array.isArray(report?.items) ? report.items : [];
  return {
    total: number(report?.total) ?? items.length,
    truncated: Boolean(report?.truncated) || items.length > limit,
    items: items.slice(0, limit).map((item: any) => ({
      uuid: label(item.uuid, 512),
      name: label(item.name),
      slug: label(item.slug, 100),
      value: number(item.value),
      active: typeof item.active === "boolean" ? item.active : null,
      locked: Boolean(item.locked),
      readOnly: Boolean(item.readOnly),
      expired: typeof item.expired === "boolean" ? item.expired : null,
      remainingDuration: number(item.remainingDuration),
      origin: label(item.origin, 512),
      duration: item.duration
        ? {
            value: number(item.duration.value),
            unit: label(item.duration.unit, 80),
            expiry: label(item.duration.expiry, 80),
            start: number(item.duration.start),
          }
        : null,
    })),
  };
}
function sceneSummary(scene: any) {
  const rect = scene.dimensions?.sceneRect;
  return {
    uuid: scene.uuid,
    name: label(scene.name),
    width: number(scene.width),
    height: number(scene.height),
    bounds: {
      x: number(rect?.x) ?? 0,
      y: number(rect?.y) ?? 0,
      width: number(rect?.width ?? scene.width),
      height: number(rect?.height ?? scene.height),
    },
    grid: {
      type: scene.grid?.type ?? null,
      size: number(scene.grid?.size),
      distance: number(scene.grid?.distance),
      units: label(scene.grid?.units),
    },
    tokens: bounded(values(scene.tokens), LIMITS.tokens, (token) => ({
      uuid: token.uuid,
      name: label(token.name),
      actorUuid: token.actor?.uuid ?? null,
      x: number(token.x),
      y: number(token.y),
      hidden: typeof token.hidden === "boolean" ? token.hidden : null,
    })),
    notes: bounded(values(scene.notes), LIMITS.notes, (note) => ({
      uuid: note.uuid,
      name: label(note.text ?? note.name),
      x: number(note.x),
      y: number(note.y),
      journalUuid: note.entry?.uuid ?? null,
      pageUuid: note.page?.uuid ?? null,
      pageId: note.pageId ?? null,
    })),
  };
}
function pageSummary(page: any) {
  if (page.type !== "text")
    return {
      uuid: page.uuid,
      name: label(page.name),
      type: page.type,
      text: null,
      truncated: false,
      sourceTruncated: false,
    };
  const source =
    typeof page.text?.content === "string" ? page.text.content : "";
  const safe = DOMPurify.sanitize(source.slice(0, LIMITS.html), {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  });
  const text =
    new DOMParser()
      .parseFromString(safe, "text/html")
      .body.textContent?.replace(/\s+/g, " ")
      .trim() ?? "";
  return {
    uuid: page.uuid,
    name: label(page.name),
    type: page.type,
    text: text.slice(0, LIMITS.text),
    truncated: source.length > LIMITS.html || text.length > LIMITS.text,
    sourceTruncated: source.length > LIMITS.html,
  };
}
function encounterSceneId(combat: any): string | undefined {
  return (
    combat.scene?.id ??
    (typeof combat.scene === "string"
      ? combat.scene
      : (combat._source?.scene ?? combat.sceneId))
  );
}

/** Read-only facts for an agent-authored briefing; no model call or persisted briefing is made here. */
export async function handleSessionSnapshot(
  args: Record<string, unknown>,
  ctx: BridgeContext,
): Promise<unknown> {
  const capturedAt = new Date().toISOString();
  const warnings: Warning[] = [];
  const warn = (section: string, error: any, uuid?: string) => {
    if (warnings.length >= 100) return;
    warnings.push({
      section,
      code: label(error?.code, 80) ?? "SECTION_UNAVAILABLE",
      message:
        label(error?.message ?? String(error), 500) ?? "Section unavailable",
      ...(uuid ? { uuid: uuid.slice(0, 512) } : {}),
    });
  };

  let scene: any = null;
  try {
    const candidate = args.sceneUuid
      ? await ctx.resolve(String(args.sceneUuid))
      : (ctx.game.scenes?.current ?? ctx.game.scenes?.active);
    if (!worldMember(candidate, ctx.game.scenes, "Scene"))
      throw invalid(
        args.sceneUuid
          ? "The selected scene is not a root Scene in this world."
          : "No current or active world Scene is available.",
      );
    scene = candidate;
  } catch (error) {
    warn("scene", error, args.sceneUuid as string | undefined);
  }

  let party: any = null;
  let pf2e = { available: false };
  try {
    pf2e = pf2eStatus(ctx) as { available: boolean };
  } catch (error) {
    warn("party", error);
  }
  if (pf2e.available) {
    try {
      const source: any = await handlePF2eRead(
        "pf2e_party_summary",
        { partyUuid: args.partyUuid },
        ctx,
      );
      const members: any[] = [];
      for (const member of (source.members ?? []).slice(0, LIMITS.members)) {
        const skills = Object.entries(member.preparedSkills ?? {});
        let state: any = null;
        try {
          const inspected: any = await handlePF2eConditions(
            "pf2e_inspect_conditions",
            { targetUuid: member.uuid },
            ctx,
          );
          state = {
            conditions: conditionSummary(
              inspected.conditions,
              LIMITS.conditions,
            ),
            effects: conditionSummary(inspected.effects, LIMITS.effects),
          };
        } catch (error) {
          warn("partyMemberState", error, member.uuid);
        }
        members.push({
          uuid: member.uuid,
          name: label(member.name),
          level: number(member.level),
          hitPoints: member.hitPoints ?? null,
          armorClass: number(member.armorClass),
          saves: member.saves ?? null,
          perception: number(member.perception),
          languages: Array.isArray(member.languages)
            ? member.languages.slice(0, 50).map((v: unknown) => label(v))
            : null,
          preparedSkills: Object.fromEntries(skills.slice(0, LIMITS.skills)),
          skillsTruncated: skills.length > LIMITS.skills,
          state,
        });
      }
      party = {
        partyUuid: source.partyUuid,
        systemVersion: source.systemVersion,
        memberCount: source.memberCount,
        truncated: source.memberCount > members.length,
        members,
      };
      for (const message of source.warnings ?? [])
        warn("party", { code: "PARTY_WARNING", message }, source.partyUuid);
    } catch (error) {
      warn("party", error, args.partyUuid as string | undefined);
    }
  } else
    warn(
      "party",
      {
        code: "PF2E_UNAVAILABLE",
        message:
          "PF2e party aggregation is unavailable or disabled; generic scene, encounter and journal data remain available.",
      },
      args.partyUuid as string | undefined,
    );

  const encounters: any[] = [];
  let encounterTotal = 0;
  const requested = [
    ...new Set((args.encounterUuids as string[] | undefined) ?? []),
  ];
  let selected = requested;
  if (!selected.length && (!args.sceneUuid || scene)) {
    const prepared = values(ctx.game.combats).filter(
      (combat) =>
        !combat.compendium &&
        !combat.parent &&
        (combat.started === false ||
          (combat.started !== true && combat.round === 0)) &&
        (!scene || encounterSceneId(combat) === scene.id),
    );
    encounterTotal = prepared.length;
    selected = prepared
      .slice(0, LIMITS.encounters)
      .map((combat) => combat.uuid);
  } else encounterTotal = selected.length;
  for (const uuid of selected.slice(0, LIMITS.encounters)) {
    try {
      encounters.push(
        await handleEncounters(
          "inspect_encounter",
          { uuid, offset: 0, limit: LIMITS.combatants },
          ctx,
        ),
      );
    } catch (error) {
      warn("encounter", error, uuid);
    }
  }

  const journals: any[] = [];
  const references = [
    ...new Set((args.journalUuids as string[] | undefined) ?? []),
  ];
  for (const uuid of references.slice(0, LIMITS.references)) {
    try {
      const doc = await ctx.resolve(uuid);
      const journal =
        doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
      if (!worldMember(journal, ctx.game.journal, "JournalEntry"))
        throw invalid(
          "Selected journal reference must belong to a root JournalEntry in this world.",
        );
      if (doc.documentName === "JournalEntryPage") {
        if (doc.compendium || journal.pages?.get?.(doc.id) !== doc)
          throw invalid("Selected page is not owned by the world journal.");
        journals.push({
          uuid: doc.uuid,
          journalUuid: journal.uuid,
          name: label(journal.name),
          pages: { total: 1, truncated: false, items: [pageSummary(doc)] },
        });
      } else if (doc.documentName === "JournalEntry")
        journals.push({
          uuid: doc.uuid,
          journalUuid: doc.uuid,
          name: label(doc.name),
          pages: bounded(values(doc.pages), LIMITS.pages, pageSummary),
        });
      else throw invalid("Select a JournalEntry or JournalEntryPage UUID.");
    } catch (error) {
      warn("journal", error, uuid);
    }
  }

  let sceneData: unknown = null;
  if (scene) {
    try {
      sceneData = sceneSummary(scene);
    } catch (error) {
      warn("scene", error, scene.uuid);
    }
  }
  return {
    capturedAt,
    completedAt: new Date().toISOString(),
    readOnly: true,
    nonAtomic: true,
    world: {
      id: ctx.game.world?.id ?? null,
      title: label(ctx.game.world?.title),
      systemId: ctx.game.system?.id ?? null,
      systemVersion: ctx.game.system?.version ?? null,
    },
    limits: LIMITS,
    party,
    scene: sceneData,
    encounters: {
      total: encounterTotal,
      truncated: encounterTotal > selected.slice(0, LIMITS.encounters).length,
      items: encounters,
    },
    journals: {
      total: references.length,
      truncated: references.length > LIMITS.references,
      items: journals,
    },
    warnings,
  };
}
