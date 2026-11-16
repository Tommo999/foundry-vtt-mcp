# Maintenance guide

This guide describes how to change the repository without losing its MCP contract, Foundry safety checks or Windows setup. The Windows setup archive includes maintainer guides but remains an installation subset: test trees and historical campaign reports are excluded. Use a full source checkout to follow links to tests or historical/live evidence.

For a focused starting point, use the [tool ownership guide](tool-change-guide.md), [PF2e change guide](pf2e-change-guide.md), or [transport change guide](transport-change-guide.md).

## Before changing code

1. Read the root [`AGENTS.md`](../AGENTS.md), the matching task guide linked above, and the relevant owner and tests. Read [architecture](architecture.md) for cross-layer or boundary changes; [security](security.md) before changing authorization, native writes, TLS/origin checks or uncertain outcomes; [installation](installation.md) for setup or packaging changes; and the [acceptance checklist](acceptance-checklist.md) plus [current validation record](validation-v0.13.0.md) for live or release work. Historical reports are needed only when changing or verifying that specific release evidence.
2. Inspect the working tree and preserve other edits. Keep one defined task in progress at a time. The main agent settles scope and plan before the single configured coder agent implements; the main agent reviews before the next workstream.
3. Identify which layers own the behavior: shared schema, CLI description, daemon transport, module dispatch, native handler, unit/integration tests and user docs.
4. Decide what evidence is required. Unit tests verify implementation behavior; Foundry live checks are separate and cannot be replaced by mocks or a successful build.

### Behavior, owner and tests

Use this map to find the smallest relevant change path. Start with the focused test, then follow its production owner and contract dependencies.

| Behavior | Primary owner | Useful tests |
| --- | --- | --- |
| Tool schema, read/write classification and MCP discovery | `packages/shared/src/index.ts`, `packages/companion/src/cli.ts` | `tests/shared.test.ts`, `tests/stdio.integration.test.ts` |
| Pairing, authenticated transport, request lifecycle and disconnects | `packages/companion/src/daemon.ts`, `packages/module/src/main.ts` | `packages/companion/test/daemon.test.ts`, `packages/module/tests/companion-pairing.test.ts`, `tests/stdio.integration.test.ts` |
| Approval, session checks and general Foundry document operations | `packages/module/src/main.ts`, `packages/module/src/security.ts` | `packages/module/tests/v08-integration.test.ts`, `packages/module/tests/security.test.ts`, `packages/module/tests/operations.test.ts`, `packages/module/tests/journal-sanitization.test.ts` |
| Encounter preparation, combat controls and snapshots | `packages/module/src/encounters.ts`, `packages/module/src/session-snapshot.ts` | `packages/module/tests/encounters.test.ts`, `packages/module/tests/session-snapshot.test.ts` |
| PF2e reads, imports, conditions and inventory | `packages/module/src/pf2e.ts`, `pf2e-writes.ts`, `pf2e-conditions.ts`, `pf2e-inventory.ts` | `packages/module/tests/pf2e-read.test.ts`, `pf2e-writes.test.ts`, `pf2e-conditions.test.ts`, `pf2e-inventory.test.ts` |
| PF2e checks, combat, strikes and damage | `packages/module/src/pf2e-checks.ts`, `pf2e-combat-context.ts`, `pf2e-strikes.ts`, `pf2e-damage-context.ts`, `pf2e-damage-application.ts` | Matching `pf2e-checks`, `pf2e-combat-context`, `pf2e-strikes`, `pf2e-damage-context`, `pf2e-damage-application` and `pf2e-damage-workflow` tests |
| PF2e spell casts and resources | `packages/module/src/pf2e-spell-cast.ts`, `pf2e-spellcasting.ts`, `pf2e-spell-ledger.ts` | `packages/module/tests/pf2e-spell-cast.test.ts`, `pf2e-spellcasting.test.ts`, `pf2e-spell-ledger.test.ts` |
| PF2e spell resolutions | `packages/module/src/pf2e-spell-resolution.ts`, `pf2e-spell-resolution-ledger.ts` | `packages/module/tests/pf2e-spell-resolution.test.ts`, `pf2e-spell-resolution-ledger.test.ts` |
| PF2e spell effects, durations and recovery | `packages/module/src/pf2e-spell-effect.ts`, `pf2e-spell-effect-ledger.ts`, `pf2e-spell-audit.ts`, `pf2e-spell-reconciliation-ledger.ts` | `packages/module/tests/pf2e-spell-effect.test.ts`, `pf2e-spell-effect-ledger.test.ts`, `pf2e-spell-audit.test.ts`, `pf2e-spell-reconciliation-ledger.test.ts` |
| Windows setup and source/archive packaging | `scripts/windows-setup-helper.mjs`, `scripts/setup-windows.ps1`, `scripts/package-windows.mjs`, `scripts/prepare-release.mjs` | `tests/windows-setup-helper.test.ts`, `tests/windows-powershell.test.mjs`, `tests/windows-package.test.mjs`, `tests/release.test.mjs`, `tests/release-publication.test.mjs` |

For a new tool, also update `docs/tool-reference.md` and `docs/acceptance-checklist.md`. For live acceptance, use the checklist separately from fixture tests; current version status is in [validation-v0.13.0.md](validation-v0.13.0.md).

## Adding or changing a tool

Use this checklist:

- [ ] Define or update the input schema and inferred tool type in `packages/shared/src/index.ts`.
- [ ] Classify the tool correctly in `writeTools` and, when appropriate, `destructiveTools`.
- [ ] Add a CLI description in `packages/companion/src/cli.ts` that states side effects, approval expectations and uncertainty limits plainly.
- [ ] Add/extend module dispatch in `packages/module/src/main.ts`; create a narrow handler in the appropriate file and context type.
- [ ] Validate target UUID, ownership, document type, world membership, scope and stale state in the handler. Recheck write authorization close to the native write.
- [ ] Use Foundry/system-native APIs. Return explicit partial or uncertain results if a multi-step write cannot be confirmed; do not retry automatically.
- [ ] Add focused tests for success, invalid input, stale state, authorization and partial outcomes as appropriate. Keep unit tests offline and fixture-based.
- [ ] Update `docs/tool-reference.md`, `docs/acceptance-checklist.md` and installation/release notes if user behavior or setup changes.
- [ ] Run focused tests, full checks required by scope, and confirm discovery still exposes the intended tool count. Do not change schemas/tools as incidental cleanup.

For live play, keep selection explicit and bounded. A tool should not become a generic script, unrestricted delete, permission editor or implicit retry mechanism.

## Safe refactoring and cleanup

Refactor in small sequential steps. Before removing or merging code, search all callers/tests/docs and inspect error paths, generated artifacts and Windows bundle inputs. Keep the existing `main.ts` `__test` seam used by integration tests unless a replacement is updated in the same reviewed change.

### Incremental candidates, not implemented changes

- **Split `main.ts` by responsibility:** it currently combines Foundry UI/session/approval, dispatch and many general handlers. First extract a self-contained section with explicit inputs and tests. Preserve event ordering, request-ID deduplication, approval expiry, session revalidation, exported test seam, and Windows source packaging. If new nested source directories are introduced, update `scripts/package-windows.mjs`; it currently gathers only top-level `.ts` files from the three source roots plus a fixed-file allowlist.
- **Narrow dynamic types:** replace `any` only where the real Foundry API shape is known and covered. Keep compatibility fallbacks explicit for supported Foundry/PF2e versions; a broad annotation-only sweep adds noise without proving runtime safety.
- **Consolidate collection helpers only after comparison:** Foundry collections may be represented by arrays, `.contents`, `.values()` or iterables. Before sharing helpers, prove ordering, identity, empty-value behavior and failure behavior are equivalent at each call site. Do not normalize away Foundry collection semantics.
- **Keep transport, session and world state separate:** daemon queues, browser approvals, in-memory combat locks and the persistent damage ledger have different lifetimes and guarantees. Do not merge them into a supposed distributed transaction/lock.

These are possible maintenance directions, not promises that refactors have happened or are required. Prefer a bug fix with clear evidence over cleanup unrelated to its scope.

## PF2e compendium and inventory maintenance

- Use native source fields for the installed PF2e family and keep index field requests non-overlapping: do not request a dotted path together with its ancestor in the same `getIndex` call. Parent `system.traits` and `system.price` fields may carry nested data; use the smallest shape needed for the filter.
- Compendium regressions should model requested dotted-field projection and warm cached-index extension. A mock that returns the same rows no matter which fields were requested will not detect a field-load failure.
- Test already-cached scalar and nested representations separately from raw compendium projection. Preserve numeric zero for levels/prices, ordinary empty results, pagination and per-pack warnings.
- Keep `ammo` in both the equipment-search and physical-inventory allowlists. Preserve `isOfType("physical")` validation and continue to reject spells, effects, actions and unsupported item types. Native ammo tests should verify quantity, compendium source marker and metadata through read/add/stack/update/transfer behavior.
- Do not add automatic ammunition use to strikes. Preserve `consumeAmmo: false` and the consumable-weapon restriction.

## Release and deployment maintenance

For public Foundry update assets, follow the [public release guide](public-releases.md). The command **npm run release:prepare -- --repository OWNER/REPO** builds and stages local assets; it does not publish them or change repository visibility. Update root and workspace versions, exact internal workspace dependencies, `package-lock.json`, `packages/module/module.json`, and the MCP server version in `packages/companion/src/cli.ts` together. Do not globally replace version strings in historical reports, test evidence or unrelated dependency ranges.

Run `npm ci`, focused tests, `npm test`, `npm run typecheck`, `npm run package`, and `npm run package:windows` as the release plan requires. Check that manifests, tool count, package versions and archives agree. Generated `dist/` files are outputs; rebuild them instead of editing by hand. The Windows bundle uses `scripts/package-windows.mjs`'s fixed file list and top-level source enumeration. Keep tests, fixture IDs and historical reports out of that installation bundle.

Build/package success does not update an installed Foundry module, running companion daemon or existing MCP client. Before marking a live bug fixed, deploy the exact build, verify both module and server versions, refresh/reconnect the GM browser and MCP client, then run the targeted live checklist. Record any unavailable live checks as pending with the concrete blocker. Keep old reports as history and write a new dated retest report/call log.

## Current validation status

See [v0.13.0 validation](validation-v0.13.0.md) for the current release's source checks, published-asset evidence and live acceptance status. Earlier release and live-retest reports are historical records for those builds only.
