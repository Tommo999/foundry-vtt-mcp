# Foundry VTT MCP 0.8.1

Local bugfix release, 2026-11-07. Module and Windows setup archives are built and verified. Live acceptance remains pending deployment of the patched module and companion.

## Fixes

- PF2e compendium search requests the native index fields without overlapping parent and child paths. Level, size and price readers accept supported nested and scalar cached-index shapes, including zero values. Pack-specific failures remain visible alongside results from readable packs. Native ammunition is included in equipment type search.
- Encounter summaries now use the same current-combat activity calculation as execution guards. An explicit false legacy flag no longer masks the current encounter selected in Foundry; started state alone does not make an unselected encounter active.
- Native PF2e ammunition is included in inventory inspection and accepted by the existing physical-item inventory paths for add/stack, quantity changes and transfers. Native physical validation remains in force. Strikes continue to use `consumeAmmo: false`, and consumable weapons remain rejected by strike execution.

The release preserves the 51-tool contract. Foundry v14 remains the minimum version. This bugfix does not establish PF2e compatibility across versions; complete the live checks before relying on it in a campaign.

## Upgrade

Follow [Upgrade from 0.8.0 to 0.8.1](installation.md#upgrade-from-080-to-081). Keep the current pairing configuration, certificates and token. Replace the module, restart the companion from the updated checkout, refresh the Foundry GM browser, and reconnect the MCP client. Verify both the module and MCP server report 0.8.1.

## Validation status

Focused automated validation completed during implementation:

- Search: `packages/module/tests/pf2e-read.test.ts` — 17 tests passed.
- Encounters: `packages/module/tests/encounters.test.ts` and `packages/module/tests/v06-integration.test.ts` — 29 tests passed.
- Ammunition: `packages/module/tests/pf2e-inventory.test.ts` — 18 tests passed.
- Type checking passed after the implementation changes.
- A separate isolated old-behavior regression check reported 58 tests, with 11 expected failures in the three repaired areas (4 search, 1 encounter, 6 ammunition) and 47 passing checks.

Final integration validation:

- `FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test` — **219 tests across 30 files passed**, no skips. Reviewed loopback access enabled the TLS/MCP subprocess tests and portable PowerShell smoke test.
- `npm run typecheck` — passed.
- `npm run package` — passed; generated `dist/foundry-vtt-mcp.zip`.
- `node scripts/package-windows.mjs` — passed after the standard package build; generated `dist/foundry-vtt-windows-setup.zip` with 45 files. This is the packaging stage of `npm run package:windows`, without rebuilding the module twice.
- ZIP integrity checks passed; archived manifests report 0.8.1, and archived module/source files match the current build/checkout. Root/workspace versions, exact internal dependencies, lockfile and module manifest are consistent.
- A newly launched MCP process reported server version **0.8.1** and exactly **51 tools**. Tool schemas and strike/damage handlers remain unchanged.
- Windows setup was checked from Linux using portable PowerShell; an actual Windows installation and Windows-only ACL behavior were not exercised.

See the [versioned validation and pending-live report](live-retest-v0.8.1-2026-11-07.md) and its [structured evidence](live-retest-v0.8.1-2026-11-07.json).

**Live acceptance is pending.** Browser automation returned `The browser access host is unavailable`. The existing companion still reaches Glimmerkeep on Foundry 14.363 / PF2e 8.7.0, but the installed module and existing daemon have not been updated or verified at 0.8.1. The fresh MCP process/version check above does not establish the version of either running component. The affected search, encounter, ammunition and safety-guard live checks therefore remain pending. No new world fixtures or damage applications were created. The original [v0.8.0 acceptance report](live-acceptance-2026-11-07.md) and [call log](live-acceptance-2026-11-07.json) are retained as historical evidence.
