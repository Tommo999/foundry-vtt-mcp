import type { PF2eContext } from "./pf2e-context";
function fail(message: string): Error {
  return Object.assign(new Error(message), { code: "INVALID_INPUT" });
}
function collectionHas(collection: any, doc: any): boolean {
  if (!collection || !doc) return false;
  if (typeof collection.get === "function")
    return collection.get(doc.id) === doc;
  return true;
}
function actorForDocument(
  ctx: PF2eContext,
  doc: any,
  options: { creatureOnly?: boolean } = {},
) {
  let actor = doc;
  if (doc.documentName === "Token") {
    const scene = doc.parent;
    if (
      !scene ||
      scene.documentName !== "Scene" ||
      scene.compendium ||
      scene.parent
    )
      throw fail("Token targets must belong to a world Scene.");
    if (!collectionHas(ctx.game.scenes, scene))
      throw fail("Token target Scene is not part of the active world.");
    actor = doc.actor;
    if (!actor) throw fail("Token has no linked or synthetic PF2e Actor.");
    if (actor.documentName !== "Actor" || actor.compendium)
      throw fail("Token did not resolve to a usable world Actor.");
  } else if (doc.documentName !== "Actor")
    throw fail(
      "Target must be a world Actor UUID or an explicit Scene Token UUID.",
    );
  if (actor.documentName !== "Actor" || actor.compendium)
    throw fail("Target Actor must belong to the active world.");
  if (
    doc === actor &&
    (actor.isEmbedded || actor.parent || !collectionHas(ctx.game.actors, actor))
  )
    throw fail(
      "Target must be a root Actor in the active world; use its explicit token UUID for synthetic Actors.",
    );
  if (
    options.creatureOnly &&
    !["character", "npc", "familiar"].includes(actor.type)
  )
    throw fail("Target must be a PF2e character, NPC, or familiar.");
  return actor;
}
export async function resolvePF2eActor(
  ctx: PF2eContext,
  uuid: string,
  options: { creatureOnly?: boolean } = {},
): Promise<any> {
  const doc = await ctx.resolve(uuid);
  if (!doc) throw fail(`PF2e target was not found: ${uuid}`);
  return actorForDocument(ctx, doc, options);
}
export async function resolvePF2eTarget(
  ctx: PF2eContext,
  uuid: string,
  options: { creatureOnly?: boolean } = {},
): Promise<{ target: any; actor: any }> {
  const target = await ctx.resolve(uuid);
  if (!target) throw fail(`PF2e target was not found: ${uuid}`);
  return { target, actor: actorForDocument(ctx, target, options) };
}
