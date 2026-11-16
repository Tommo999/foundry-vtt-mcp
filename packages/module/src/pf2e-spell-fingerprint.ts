/** Stable JSON representation used by spell review fingerprints. */
export function canonicalSpellFingerprintValue(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSpellFingerprintValue).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalSpellFingerprintValue(value[key])}`,
    )
    .join(",")}}`;
}

/** SHA-256 hex digest for the canonical spell-review representation. */
export async function digestSpellFingerprint(
  value: unknown,
  unavailableMessage: string,
  requireTextEncoder = false,
): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (
    !cryptoApi?.subtle ||
    (requireTextEncoder && typeof TextEncoder === "undefined")
  )
    throw Object.assign(new Error(unavailableMessage), {
      code: "CRYPTO_UNAVAILABLE",
    });
  const bytes = new TextEncoder().encode(canonicalSpellFingerprintValue(value));
  const hash = await cryptoApi.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
