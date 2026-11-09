import type { ToolName } from "@foundry-mcp/shared";
import type { PF2eContext } from "./pf2e-context";
import { resolvePF2eActor, resolvePF2eTarget } from "./pf2e-target";

function coded(code: string, message: string, partial?: unknown): Error {
  return Object.assign(new Error(message), {
    code,
    ...(partial === undefined ? {} : { partial }),
  });
}
function values(collection: any): any[] {
  if (Array.isArray(collection)) return collection;
  if (collection?.contents) return Array.from(collection.contents);
  if (collection && typeof collection[Symbol.iterator] === "function")
    return Array.from(collection);
  if (collection && typeof collection.values === "function")
    return Array.from(collection.values());
  return [];
}
function cleanNumber(value: any): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function rootActorUuid(actor: any): string {
  return actor.uuid ?? `Actor.${actor.id}`;
}
function activeConditions(actor: any): any[] {
  return values(actor.conditions?.contents ?? actor.conditions);
}
function effects(actor: any): any[] {
  const found = actor.itemTypes?.effect;
  if (found) return values(found);
  return values(actor.items).filter((item) => item?.type === "effect");
}
function parentGrant(
  actor: any,
  item: any,
): { id: string; name: string } | null {
  const id =
    item.system?.references?.parent?.id ?? item.flags?.pf2e?.grantedBy?.id;
  if (!id) return null;
  const parent = actor.items?.get?.(id) ?? actor.conditions?.get?.(id);
  return { id, name: parent?.name ?? null } as any;
}
function restrictedGrant(actor: any, item: any): boolean {
  const ownRestricted = Object.values(item?.flags?.pf2e?.itemGrants ?? {}).some(
    (grant: any) => grant?.onDelete === "restrict",
  );
  const granterId =
    item.flags?.pf2e?.grantedBy?.id ?? item.system?.references?.parent?.id;
  if (!granterId) return ownRestricted;
  const granter =
    actor.items?.get?.(granterId) ?? actor.conditions?.get?.(granterId);
  const grantsRestricted = Object.values(
    granter?.flags?.pf2e?.itemGrants ?? {},
  ).some(
    (grant: any) => grant?.id === item.id && grant?.onDelete === "restrict",
  );
  return grantsRestricted || ownRestricted;
}
function readOnly(item: any): boolean {
  return Boolean(
    item?.isLocked || item?.readonly || item?.inMemoryOnly || item?.isInMemory,
  );
}
function serializeCondition(item: any): object {
  return {
    uuid: item.uuid ?? null,
    id: item.id ?? null,
    slug: item.slug ?? null,
    name: item.name ?? null,
    value: item.value ?? item.system?.value?.value ?? null,
    active: item.active ?? true,
    locked: Boolean(item.isLocked),
    readOnly: readOnly(item),
    origin: item.origin?.uuid ?? null,
    parentGrant:
      item.system?.references?.parent?.id ??
      item.flags?.pf2e?.grantedBy?.id ??
      null,
  };
}
function serializeEffect(item: any, actor: any): object {
  const duration = item.system?.duration ?? null;
  const expired =
    typeof item.isExpired === "boolean"
      ? item.isExpired
      : item.system?.expired === true;
  const remaining = item.remainingDuration?.remaining;
  return {
    uuid: item.uuid ?? null,
    id: item.id ?? null,
    slug: item.slug ?? null,
    name: item.name ?? null,
    active: !expired && (item.active ?? true),
    expired,
    remainingDuration:
      typeof remaining === "number" && Number.isFinite(remaining)
        ? remaining
        : null,
    locked: Boolean(item.isLocked),
    readOnly: readOnly(item),
    origin: item.origin?.uuid ?? null,
    parentGrant: parentGrant(actor, item),
    duration: duration
      ? {
          value: duration.value ?? null,
          unit: duration.unit ?? null,
          expiry: duration.expiry ?? null,
          sustained: duration.sustained ?? null,
          start: item.system?.start?.value ?? null,
        }
      : null,
  };
}
function partialError(
  operation: string,
  actor: any,
  target: any,
  item: any,
  error: any,
): Error {
  return coded(
    "PF2E_PARTIAL_FAILURE",
    `PF2e ${operation} failed after the native operation began: ${error?.message ?? String(error)}`,
    {
      actorUuid: rootActorUuid(actor),
      targetUuid: target.uuid ?? null,
      operation,
      itemUuid: item?.uuid ?? null,
      outcomeUnknown: true,
    },
  );
}
function assertConditionEditable(actor: any, item: any) {
  if (readOnly(item) || restrictedGrant(actor, item))
    throw coded(
      "PF2E_READ_ONLY",
      "This condition is locked, granted, or read-only and cannot be changed directly.",
    );
  if (
    item.slug === "persistent-damage" ||
    String(item.slug ?? "").startsWith("persistent-damage-")
  )
    throw coded(
      "PF2E_UNSUPPORTED",
      "Persistent damage changes require the PF2e damage workflow and are not available through this tool.",
    );
}
function pf2e(ctx: PF2eContext): any {
  if (
    ctx.game.system?.id !== "pf2e" ||
    !ctx.game.pf2e ||
    ctx.game.settings?.get?.("foundry-vtt-mcp", "pf2eEnabled") === false
  )
    throw coded("PF2E_UNAVAILABLE", "PF2e support is unavailable or disabled.");
  return ctx.game.pf2e;
}

export async function handlePF2eConditions(
  tool: ToolName,
  args: Record<string, unknown>,
  ctx: PF2eContext,
): Promise<unknown> {
  const api = pf2e(ctx);
  if (tool === "pf2e_inspect_conditions") {
    const { target, actor } = await resolvePF2eTarget(
      ctx,
      String(args.targetUuid),
      { creatureOnly: true },
    );
    const conditions = activeConditions(actor),
      actorEffects = effects(actor),
      cap = 100;
    return {
      targetUuid: target.uuid ?? null,
      actorUuid: rootActorUuid(actor),
      actorName: actor.name,
      conditions: {
        total: conditions.length,
        truncated: conditions.length > cap,
        items: conditions.slice(0, cap).map(serializeCondition),
      },
      effects: {
        total: actorEffects.length,
        truncated: actorEffects.length > cap,
        items: actorEffects
          .slice(0, cap)
          .map((item) => serializeEffect(item, actor)),
      },
    };
  }
  if (tool === "pf2e_set_condition") {
    const { target, actor } = await resolvePF2eTarget(
      ctx,
      String(args.targetUuid),
      { creatureOnly: true },
    );
    const slug = String(args.slug);
    if (slug === "persistent-damage" || slug.startsWith("persistent-damage-"))
      throw coded(
        "PF2E_UNSUPPORTED",
        "Persistent damage is read-only through this tool.",
      );
    const manager = api.ConditionManager;
    if (
      typeof manager?.getCondition !== "function" ||
      typeof manager?.updateConditionValue !== "function"
    )
      throw coded(
        "UNSUPPORTED_API",
        "PF2e ConditionManager APIs are unavailable.",
      );
    const definition = manager.getCondition(slug);
    if (!definition)
      throw coded("INVALID_INPUT", `Unknown PF2e condition slug: ${slug}`);
    const base = definition.toObject?.() ?? definition;
    const baseValue = base.system?.value?.value;
    const existingAll =
      actor.getCondition?.(slug, { all: true }) ??
      activeConditions(actor).filter((item) => item.slug === slug);
    const existing = Array.isArray(existingAll)
      ? (existingAll.find((item) => item.active) ?? existingAll[0])
      : existingAll;
    const requested = args.value === undefined ? 1 : Number(args.value);
    if (typeof baseValue !== "number" && args.value !== undefined)
      throw coded(
        "INVALID_INPUT",
        "This condition is unvalued and does not accept a numeric value.",
      );
    if (
      existing &&
      typeof (existing.value ?? existing.system?.value?.value) !== "number"
    ) {
      return {
        changed: false,
        condition: serializeCondition(existing),
        targetUuid: target.uuid ?? null,
        actorUuid: rootActorUuid(actor),
      };
    }
    if (
      existing &&
      Number(existing.value ?? existing.system?.value?.value) === requested
    )
      return {
        changed: false,
        condition: serializeCondition(existing),
        targetUuid: target.uuid ?? null,
        actorUuid: rootActorUuid(actor),
      };
    if (existing) assertConditionEditable(actor, existing);
    if (typeof actor.increaseCondition !== "function")
      throw coded(
        "UNSUPPORTED_API",
        "PF2e Actor.increaseCondition API is unavailable.",
      );
    ctx.assertWrite();
    try {
      if (existing)
        await manager.updateConditionValue(existing.id, actor, requested);
      else
        await actor.increaseCondition(slug, {
          value: requested,
          max: requested,
        });
    } catch (error) {
      throw partialError("set condition", actor, target, existing, error);
    }
    const current = actor.getCondition?.(slug);
    if (!current)
      throw coded(
        "PF2E_PARTIAL_FAILURE",
        "PF2e did not confirm that the condition was applied.",
        {
          actorUuid: rootActorUuid(actor),
          targetUuid: target.uuid ?? null,
          operation: "set condition",
          outcomeUnknown: true,
        },
      );
    const actualValue = current.value ?? current.system?.value?.value ?? null;
    return {
      changed: true,
      condition: serializeCondition(current),
      requestedValue: requested,
      actualValue,
      capped: typeof actualValue === "number" && actualValue !== requested,
      targetUuid: target.uuid ?? null,
      actorUuid: rootActorUuid(actor),
    };
  }
  if (tool === "pf2e_adjust_condition") {
    const { target, actor } = await resolvePF2eTarget(
      ctx,
      String(args.targetUuid),
      { creatureOnly: true },
    );
    const condition = await ctx.resolve(String(args.conditionUuid));
    if (
      !condition ||
      condition.documentName !== "Item" ||
      condition.type !== "condition" ||
      condition.parent !== actor ||
      actor.items?.get?.(condition.id) !== condition
    )
      throw coded(
        "INVALID_INPUT",
        "Condition UUID must identify a condition owned by the selected Actor.",
      );
    assertConditionEditable(actor, condition);
    if (
      condition.slug === "persistent-damage" ||
      String(condition.slug ?? "").startsWith("persistent-damage-")
    )
      throw coded(
        "PF2E_UNSUPPORTED",
        "Persistent damage changes require the PF2e damage workflow.",
      );
    if (
      args.operation === "increase" &&
      (condition.value ?? condition.system?.value?.value) === null
    )
      return {
        changed: false,
        targetUuid: target.uuid ?? null,
        actorUuid: rootActorUuid(actor),
        conditionUuid: condition.uuid,
        operation: args.operation,
        condition: serializeCondition(condition),
      };
    if (
      typeof actor.increaseCondition !== "function" ||
      typeof actor.decreaseCondition !== "function"
    )
      throw coded(
        "UNSUPPORTED_API",
        "PF2e Actor condition APIs are unavailable.",
      );
    ctx.assertWrite();
    try {
      const operation = String(args.operation);
      if (operation === "increase") await actor.increaseCondition(condition);
      else if (operation === "decrease")
        await actor.decreaseCondition(condition);
      else await actor.decreaseCondition(condition, { forceRemove: true });
    } catch (error) {
      throw partialError(
        `condition ${String(args.operation)}`,
        actor,
        target,
        condition,
        error,
      );
    }
    const updated = actor.getCondition?.(condition.slug);
    return {
      changed: true,
      targetUuid: target.uuid ?? null,
      actorUuid: rootActorUuid(actor),
      conditionUuid: condition.uuid,
      operation: args.operation,
      condition: updated ? serializeCondition(updated) : null,
    };
  }
  if (tool === "pf2e_apply_effect") {
    const { target, actor } = await resolvePF2eTarget(
      ctx,
      String(args.targetUuid),
      { creatureOnly: true },
    );
    const source = await ctx.resolve(String(args.uuid));
    if (
      !source ||
      source.documentName !== "Item" ||
      source.type !== "effect" ||
      !source.compendium ||
      source.parent ||
      !source.pack ||
      ctx.game.packs?.get?.(source.pack) !== source.compendium ||
      (source.compendium?.metadata?.system &&
        source.compendium.metadata.system !== "pf2e")
    )
      throw coded(
        "INVALID_INPUT",
        "Effect source must be a root Item of type effect in a compendium.",
      );
    const collection = ctx.game.items;
    if (
      typeof collection?.fromCompendium !== "function" ||
      typeof actor.createEmbeddedDocuments !== "function"
    )
      throw coded(
        "UNSUPPORTED_API",
        "PF2e compendium import or Actor embedded Item API is unavailable.",
      );
    const data = await collection.fromCompendium(source, {
      keepId: false,
      clearOwnership: true,
      clearFolder: true,
      clearSort: true,
      clearState: true,
    });
    if (!data || data.type !== "effect")
      throw coded(
        "INVALID_INPUT",
        "Compendium source did not produce a PF2e effect.",
      );
    delete data._id;
    delete data.system?.start;
    ctx.assertWrite();
    try {
      const created = await actor.createEmbeddedDocuments("Item", [data], {
        keepId: false,
        keepEmbeddedIds: true,
      });
      if (
        !Array.isArray(created) ||
        created.length === 0 ||
        created.some(
          (item: any) =>
            item?.documentName !== "Item" ||
            item.type !== "effect" ||
            item.parent !== actor ||
            !item.id ||
            !item.uuid ||
            (typeof actor.items?.get === "function" &&
              actor.items.get(item.id) !== item),
        )
      ) {
        throw coded(
          "PF2E_PARTIAL_FAILURE",
          "PF2e did not confirm that the effect was created on the target Actor.",
          {
            actorUuid: rootActorUuid(actor),
            targetUuid: target.uuid ?? null,
            operation: "apply effect",
            outcomeUnknown: true,
          },
        );
      }
      return {
        targetUuid: target.uuid ?? null,
        actorUuid: rootActorUuid(actor),
        effects: created.map((item: any) => serializeEffect(item, actor)),
      };
    } catch (error) {
      throw partialError("apply effect", actor, target, null, error);
    }
  }
  if (tool === "pf2e_remove_effect") {
    const { target, actor } = await resolvePF2eTarget(
      ctx,
      String(args.targetUuid),
      { creatureOnly: true },
    );
    const effect = await ctx.resolve(String(args.effectUuid));
    if (
      !effect ||
      effect.documentName !== "Item" ||
      effect.type !== "effect" ||
      effect.parent !== actor ||
      actor.items?.get?.(effect.id) !== effect
    )
      throw coded(
        "INVALID_INPUT",
        "Effect UUID must identify an effect owned by the selected Actor.",
      );
    if (readOnly(effect) || restrictedGrant(actor, effect))
      throw coded(
        "PF2E_READ_ONLY",
        "This effect is locked, granted, or read-only and cannot be removed directly.",
      );
    if (typeof effect.delete !== "function")
      throw coded(
        "UNSUPPORTED_API",
        "PF2e effect deletion API is unavailable.",
      );
    ctx.assertWrite();
    try {
      await effect.delete();
      if (actor.items?.get?.(effect.id) === effect)
        throw coded(
          "PF2E_PARTIAL_FAILURE",
          "PF2e did not confirm effect removal.",
          {
            actorUuid: rootActorUuid(actor),
            targetUuid: target.uuid ?? null,
            operation: "remove effect",
            itemUuid: effect.uuid ?? null,
            outcomeUnknown: true,
          },
        );
      return {
        removed: true,
        targetUuid: target.uuid ?? null,
        actorUuid: rootActorUuid(actor),
        effectUuid: String(args.effectUuid),
      };
    } catch (error) {
      throw partialError("remove effect", actor, target, effect, error);
    }
  }
  throw coded(
    "UNSUPPORTED_API",
    `PF2e condition/effect adapter does not implement ${tool}.`,
  );
}
