/** Read PF2e's native Item source identity, without inferring legacy flag provenance. */
export function nativeCompendiumSourceUuid(item: any): string | null {
  const statsSource = item?._stats?.compendiumSource ?? item?._source?._stats?.compendiumSource;
  if (typeof statsSource === "string" && statsSource.startsWith("Compendium.")) return statsSource;
  const sourceId = item?.sourceId;
  return typeof sourceId === "string" && sourceId.startsWith("Compendium.") ? sourceId : null;
}
