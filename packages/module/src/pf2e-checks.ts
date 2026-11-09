import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { resolvePF2eTarget } from "./pf2e-target";
import { requirePF2e } from "./pf2e";
import { describeStrikes } from "./pf2e-strikes";

const MAX_TEXT = 200;
const MAX_TRAITS = 20;
const MESSAGE_MODES = new Set(["public", "gm", "blind", "self"]);

function fail(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
function short(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function boundedStrings(value: unknown, max = MAX_TRAITS): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, max)
    .map((item) => item.slice(0, 100));
}
function resolveStatistic(actor: any, slug: string): any | null {
  if (slug === "perception") return actor.perception ?? null;
  if (["fortitude", "reflex", "will"].includes(slug))
    return actor.saves?.[slug] ?? null;
  return actor.skills && Object.hasOwn(actor.skills, slug)
    ? actor.skills[slug]
    : null;
}
function statisticRow(slug: string, statistic: any) {
  return {
    slug: short(slug, 80),
    label: short(statistic?.label),
    modifier: finite(statistic?.check?.mod ?? statistic?.mod),
    available: typeof statistic?.check?.roll === "function",
  };
}
function featureSummary(actor: any, offset: number, limit: number) {
  const items = Array.isArray(actor.items?.contents)
    ? actor.items.contents
    : actor.items && typeof actor.items[Symbol.iterator] === "function"
      ? Array.from(actor.items)
      : [];
  const features = items.filter((item: any) =>
    ["action", "feat", "ability"].includes(item.type),
  );
  const candidates = features.slice(offset, offset + limit).map((item: any) => {
    const system = item.system ?? {};
    const actions = system.actions?.value ?? system.actions ?? null;
    const rawTraits = system.traits?.value ?? system.traits ?? [];
    return {
      uuid: short(item.uuid, 512),
      name: short(item.name),
      type: short(item.type, 40),
      actionCost: finite(actions),
      actionType: short(system.actionType?.value ?? system.actionType, 40),
      traits: boundedStrings(rawTraits),
    };
  });
  return {
    items: candidates,
    total: features.length,
  };
}
function listStatistics(actor: any) {
  const rows = [statisticRow("perception", actor.perception)];
  for (const slug of ["fortitude", "reflex", "will"]) {
    const statistic = actor.saves?.[slug];
    if (statistic) rows.push(statisticRow(slug, statistic));
  }
  const skills =
    actor.skills && typeof actor.skills === "object"
      ? Object.entries(actor.skills)
      : [];
  for (const [slug, statistic] of skills.slice(0, 50))
    rows.push(statisticRow(slug, statistic));
  return rows.slice(0, 54);
}
function statisticsCount(actor: any): number {
  const skills =
    actor.skills && typeof actor.skills === "object"
      ? Object.keys(actor.skills).length
      : 0;
  const saves = ["fortitude", "reflex", "will"].filter(
    (slug) => actor.saves?.[slug],
  ).length;
  return 1 + saves + skills;
}
function inspectActions(
  args: Record<string, unknown>,
  targetUuid: string,
  actor: any,
) {
  const offset = Number(args.offset ?? 0);
  const limit = Math.min(100, Number(args.limit ?? 25));
  const featureData = featureSummary(actor, offset, limit);
  const strikes = describeStrikes(actor);
  const checks = listStatistics(actor);
  const checksTotal = statisticsCount(actor);
  return {
    targetUuid,
    actorUuid: actor.uuid,
    readOnly: true,
    executable: false,
    note: "Features and prepared strikes are descriptive data. This tool does not execute attacks, damage, or other actions.",
    features: {
      total: featureData.total,
      truncated: offset + limit < featureData.total,
      offset,
      limit,
      items: featureData.items,
    },
    strikes,
    checks,
    checksTotal,
    checksTruncated: checksTotal > checks.length,
    initiative: actor.initiative
      ? {
          statistic: short(
            actor.system?.initiative?.statistic ?? "perception",
            80,
          ),
          modifier: finite(actor.initiative.mod),
        }
      : null,
  };
}

export async function handlePF2eChecks(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  requirePF2e(ctx);
  if (tool === "pf2e_inspect_actions") {
    const targetUuid = String(args.targetUuid);
    const { actor } = await resolvePF2eTarget(ctx, targetUuid, {
      creatureOnly: true,
    });
    return inspectActions(args, targetUuid, actor);
  }
  if (tool !== "pf2e_roll_check")
    throw fail("UNKNOWN_TOOL", `Unsupported PF2e check tool: ${tool}`);

  const targetUuid = String(args.targetUuid);
  const slug = String(args.statistic);
  const dc = args.dc === undefined ? null : Number(args.dc);
  const messageMode = String(args.messageMode ?? "gm");
  if (!MESSAGE_MODES.has(messageMode))
    throw fail("INVALID_INPUT", "Unsupported roll message mode.");

  const first = await resolvePF2eTarget(ctx, targetUuid, {
    creatureOnly: true,
  });
  const latest = await resolvePF2eTarget(ctx, targetUuid, {
    creatureOnly: true,
  });
  if (latest.target !== first.target || latest.actor !== first.actor)
    throw fail("TARGET_CHANGED", "PF2e target changed before the roll.");
  const { target, actor } = latest;
  const statistic = resolveStatistic(actor, slug);
  if (typeof statistic?.check?.roll !== "function")
    throw fail(
      "STATISTIC_UNAVAILABLE",
      `PF2e statistic is unavailable: ${slug}`,
    );
  requirePF2e(ctx);
  ctx.assertWrite();
  const token = target.documentName === "Token" ? target : null;
  let messageUuid: string | null = null;
  let degreeOfSuccess: string | null = null;
  let started = false;
  try {
    started = true;
    const roll = await statistic.check.roll({
      token,
      dc,
      skipDialog: true,
      createMessage: true,
      messageMode,
      callback: (_roll: any, outcome: any, message: any) => {
        messageUuid = short(message?.uuid, 512);
        degreeOfSuccess = short(outcome, 40);
      },
    });
    if (!roll) {
      if (messageUuid)
        throw Object.assign(
          new Error(
            "PF2e created a roll message but did not return the roll result.",
          ),
          {
            code: "PARTIAL_FAILURE",
            partial: {
              targetUuid,
              statistic: slug,
              messageUuid,
              outcomeUnknown: true,
            },
          },
        );
      return {
        targetUuid,
        statistic: slug,
        cancelled: true,
        messageUuid: null,
      };
    }
    if (finite(roll.total) === null)
      throw new Error("PF2e returned a roll without a finite total.");
    const die = Array.isArray(roll.dice)
      ? roll.dice.find((d: any) => d?.faces === 20)
      : null;
    return {
      targetUuid,
      actorUuid: actor.uuid,
      tokenContext: token ? "explicit" : "native-actor-context",
      ...(token ? { tokenUuid: token.uuid } : {}),
      statistic: slug,
      label: short(statistic.label),
      dc,
      messageMode,
      total: finite(roll.total),
      d20: finite(die?.total),
      degreeOfSuccess,
      messageUuid,
    };
  } catch (cause) {
    if (!started) throw cause;
    throw Object.assign(
      new Error(
        "PF2e roll failed or was interrupted; inspect chat before retrying.",
      ),
      {
        code: "PARTIAL_FAILURE",
        partial: {
          targetUuid,
          statistic: slug,
          messageUuid,
          outcomeUnknown: true,
        },
      },
    );
  }
}
