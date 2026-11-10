# v0.9.0 live read-only acceptance — 2026-11-10

## Result

The updated live bridge and a fresh MCP stdio connection passed bounded read-only acceptance checks. The world is `Glimmerkeep` (`glimmerkeep`), running Foundry 14.363 and PF2e 8.7.0. `get_status` reported compiled module, installed module manifest, running companion, MCP client and MCP server all at 0.9.0, with no mismatches or unverified versions. PF2e was detected and enabled; spellcasting inspection, resource inspection, spell cast preview and spell casting were reported available.

The fresh SDK stdio client discovered **56 tools**. `get_status`, `pf2e_inspect_spellcasting`, `pf2e_inspect_resources` and `pf2e_inspect_spell_cast` were annotated `readOnlyHint: true`, `destructiveHint: false`. This is a distinct check from any existing client/tool cache.

## Read-only calls

- `get_status`: 1 successful call; all five versions matched 0.9.0.
- `pf2e_status`: 1 successful call; PF2e 8.7.0 detected and enabled.
- `search_world` for Scenes and Actors: 2 successful bounded calls. The world returned 2 scenes and 7 Actors. The active acceptance scene contained existing MCP acceptance tokens; all existing Actors were acceptance/retest fixtures or the Party Actor. No suitable non-fixture caster was available.
- `pf2e_inspect_spellcasting`: 2 successful calls against existing acceptance NPCs. Both returned no spell options and the warning that ritual entries are unsupported.
- `pf2e_inspect_resources`: 2 successful calls against the same NPCs. Both returned resource summaries and the same ritual warning. No spending or recovery was requested.
- Legacy read smoke: `search_world` and `list_folders` each returned successfully (one bounded call each).

All calls used the live MCP stdio interface and the local companion. Scene and Actor search results included large native document payloads; the acceptance record retains only bounded counts and outcomes, not world exports or sensitive configuration.

## Not exercised

No existing suitable caster with an owned spell entry and usable spell option was present in the bounded Actor listing. Therefore `pf2e_inspect_spell_cast` preview and native spell consumption/card posting could not be meaningfully exercised. No fixtures were created, changed, replayed or removed. No chat was posted; no encounter, document, setting, ledger or resource was mutated. Automatic write mode was enabled, so no write-capable tool was called.

Live acceptance is **partial**: status, discovery/classifications, bounded world discovery, PF2e spell/resource inspections, and legacy read smoke passed. Cast preview and native spell execution remain pending until an explicitly suitable caster/fixture is available. This read-only run does not validate write behavior or rule support for other spellcasting paths.
