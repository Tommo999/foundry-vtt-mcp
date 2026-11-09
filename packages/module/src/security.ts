const FORBIDDEN = new Set([
  "_id",
  "id",
  "uuid",
  "ownership",
  "permission",
  "permissions",
  "folder",
  "flags",
  "macro",
  "command",
  "prototype",
  "__proto__",
  "constructor",
  "active",
  "navigation",
  "playlist",
  "sound",
  "walls",
  "lights",
  "templates",
  "drawings",
  "tiles",
  "regions",
]);
const EMBEDDED_COLLECTIONS = new Set([
  "pages",
  "items",
  "tokens",
  "walls",
  "lights",
  "effects",
  "macros",
]);
export function validateObject(value: unknown, depth = 0): void {
  if (depth > 16) throw new Error("Input is too deeply nested.");
  if (Array.isArray(value)) {
    for (const item of value) validateObject(item, depth + 1);
    return;
  }
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error(`Unsafe property: ${key}`);
      if (
        key
          .split(".")
          .some((part) => FORBIDDEN.has(part) || part.startsWith("$"))
      )
        throw new Error(`Field is not writable: ${key}`);
      validateObject(item, depth + 1);
    }
}
export function sanitizeData(
  input: Record<string, unknown>,
): Record<string, unknown> {
  validateObject(input);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (EMBEDDED_COLLECTIONS.has(key.split(".")[0]))
      throw new Error(
        `Embedded collections must be changed through supported tools: ${key}`,
      );
    result[key] = value;
  }
  return result;
}
