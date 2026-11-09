# v0.8.1 validation and pending live retest — 2026-11-07

## Result

The three repairs are implemented, reviewed and packaged locally as 0.8.1. All **219 tests across 30 files pass**, with no skips; type checking and standard/Windows packaging pass. The 51-tool contract is unchanged.

**Affected live acceptance is pending.** Browser automation was unavailable (`The browser access host is unavailable`), preventing installation and verification of the patched Foundry module and a coordinated companion restart/browser refresh. A successful local build does not close the original live findings.

The newly launched MCP stdio process reports 0.8.1 and lists 51 tools. A read-only `get_status` confirms the existing companion reaches Glimmerkeep (`glimmerkeep`), Foundry 14.363 / PF2e 8.7.0, automatic writes. This does not verify the loaded module or existing daemon version. No affected workflow is recorded as a patched live pass on that basis.

See the [structured evidence and read-only call log](live-retest-v0.8.1-2026-11-07.json). The original [report](live-acceptance-2026-11-07.md) and [134-call log](live-acceptance-2026-11-07.json) remain historical evidence.

## Implementation and regression evidence

| Repair | Changed implementation/tests | Verification |
| --- | --- | --- |
| Search | `packages/module/src/pf2e.ts`, `packages/module/tests/pf2e-read.test.ts` | Native compatible field requests; request-aware cold/warm index merging; scalar/nested level, size and price readers; zero preservation; hazard/equipment filters; ammo search; partial pack warnings; pagination; early unsupported equipment-size error. |
| Encounter reporting | `packages/module/src/encounters.ts`, `packages/module/tests/encounters.test.ts` | Summaries reuse the execution guard's active-state helper. Tests cover a false legacy flag on the current combat through list/inspect/start/next, plus inactive preparation and started/unselected cases. |
| Ammunition | `packages/module/src/pf2e-inventory.ts`, `packages/module/tests/pf2e-inventory.test.ts` | Native ammo fixtures cover read/add/stack, positive quantities and partial/full transfers, retaining source markers and native metadata. Native physical validation and legacy consumables remain supported. |

An isolated temporary copy restored the original encounter/inventory handlers and reconstructed the old search field requests, nested-only level reader and ammo exclusion. The affected suite produced **11 expected failures out of 58 tests** (4 search, 1 encounter, 6 ammunition); 47 checks passed. This is an old-behavior mutation check, not an untouched v0.8.0 checkout. It demonstrates regression sensitivity without reverting the shared workspace. The index fixture models dotted assignment and caching; exact Foundry internal causation still requires the patched live search retest.

Tool schema, strike and damage-application source hashes were unchanged during integration. The combat lock, stale-turn rejection, duplicate-damage/stale-review guards, `consumeAmmo: false`, consumable-weapon restriction and Windows setup implementation were preserved.

Release metadata changed in root/workspace `package.json` files, `package-lock.json`, `packages/module/module.json`, and `packages/companion/src/cli.ts`. Documentation changed in README, installation guide, acceptance checklist, tool reference, repair plan and release notes, with this new report/log added. No production handler outside the three repair files changed except the CLI's release-version literal.

## Final automated checks

| Command/check | Result |
| --- | --- |
| `FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test` | 219 passed; 30 files passed; no skips. Reviewed escalation enabled loopback/TLS subprocesses and portable PowerShell. |
| `npm run typecheck` | Passed. |
| `npm run package` | Passed; module ZIP built. Rollup emitted dependency comment-annotation notices and completed successfully. |
| `node scripts/package-windows.mjs` | Passed after normal packaging; 45 regular files in Windows setup ZIP. |
| Archive verification | Both ZIP CRC/integrity checks passed, manifests/package versions 0.8.1, archived files match build/checkout, no local certificates/keys/config included. Directory entries are excluded from regular-file counts. |
| Version consistency | Root and three workspace versions, exact internal dependencies, lockfile, module manifest and actual MCP initialization all agree at 0.8.1. |
| Tool contract | Actual MCP discovery returns 51 tools; shared tool schemas unchanged. |

This run was on Linux. Portable PowerShell checks do not establish real Windows installation or Windows ACL compatibility.

## Local artifacts

| Archive | Regular files | SHA-256 |
| --- | --- | --- |
| `dist/foundry-vtt-mcp.zip` | 3 | `e88aa87fdfcf3c0650dda62d93cb38a5de0a35c928b14c8f3fc2d69d43e6accd` |
| `dist/foundry-vtt-windows-setup.zip` | 45 | `f24909f30bd67b0960940ce75a6e3423ecb86808278a6232d3c6ccff6738a24d` |

## Pending live checks and resume procedure

1. Follow [the upgrade guide](installation.md#upgrade-from-080-to-081): replace the installed module files, restart the existing companion from the updated checkout, hard-refresh the GM browser, reconnect MCP and verify both loaded builds. Preserve configuration, certificates and pairing; do not reinitialize.
2. Recheck connection, world, write mode and existing fixture state. Do not assume the old test combat's turn or the old Actors' inventories are unchanged. If it still blocks isolated combat tests, coordinate native cleanup of `Combat.DyLIFuON9aWdqd57` with the GM.
3. Run the exact filtered Goblin Warrior query in `pf2e.pathfinder-monster-core`, then without a pack filter; require the expected UUID and no index warning. Recheck hazard complexity, supported creature/hazard sizes, equipment level/type/price filters and ammo type filtering. Equipment-size filters should return a clear unsupported-input error.
4. Compare list/inspect/combat-context activity for current and inactive encounters; exercise start/next only with safe isolated fixtures. Started/unselected encounters must not become active merely because they are started.
5. Inspect native Arrows (`Compendium.pf2e.equipment-srd.Item.w2ENw2VMPcsbif8g`), add/stack, change positive quantity and transfer partial/full quantities between identified test Actors; verify source and ammunition metadata.
6. Recheck stale-turn, duplicate-damage and stale-review safeguards with freshly inspected state. Never clear the ledger/reservations, blindly replay historical writes or apply old damage a second time. The historical destroyed shield is not a healthy-shield fixture.
7. Record actual deployed versions, requests/results, test fixture IDs and cleanup needs in a new dated continuation. Treat `Unsupported tool` as a deployment diagnostic before blaming a patched handler.

No new world fixtures, inventory mutations, combat advances or damage records were created by this repair run. The original acceptance artifacts may still require the cleanup listed in the historical report; their current state must be inspected before cleanup. Temporary automated fixtures were cleaned by their test harnesses; isolated regression evidence remains under `/tmp` and is not packaged.
