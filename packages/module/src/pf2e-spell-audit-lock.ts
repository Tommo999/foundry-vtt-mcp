import type { BridgeContext } from "./bridge-context.js";

const locks = new Map<string, Promise<void>>();

function worldId(ctx: BridgeContext): string {
  const id = ctx.game?.world?.id;
  if (typeof id !== "string" || id.length === 0 || id.length > 128)
    throw Object.assign(new Error("The active world identity is unavailable."), {
      code: "WORLD_UNAVAILABLE",
    });
  return id;
}

/** Serializes all spell audit settings operations for a world. */
export async function withSpellAuditLock<T>(
  ctx: BridgeContext,
  task: (worldId: string) => Promise<T>,
): Promise<T> {
  const id = worldId(ctx);
  const previous = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  locks.set(id, tail);
  await previous;
  try {
    if (worldId(ctx) !== id)
      throw Object.assign(new Error("The active world changed during spell audit access."), {
        code: "WORLD_CHANGED",
      });
    return await task(id);
  } finally {
    release();
    if (locks.get(id) === tail) locks.delete(id);
  }
}
