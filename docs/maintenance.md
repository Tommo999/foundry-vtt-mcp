# Maintenance guide

This guide describes how to change the repository without losing its MCP contract, Foundry safety checks or Windows setup. The Windows setup archive includes maintainer guides but remains an installation subset: test trees and historical campaign reports are excluded. Use a full source checkout to follow links to tests or historical/live evidence.

## Before changing code

1. Read the root [`AGENTS.md`](../AGENTS.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), relevant handler/tests, [`architecture.md`](architecture.md), [security notes](security.md), [installation guide](installation.md), [acceptance checklist](acceptance-checklist.md), and current release/retest report.
2. Inspect the working tree and preserve other edits. Keep one defined task in progress at a time. The main agent settles scope and plan before the single configured coder agent implements; the main agent reviews before the next workstream.
3. Identify which layers own the behavior: shared schema, CLI description, daemon transport, module dispatch, native handler, unit/integration tests and user docs.
4. Decide what evidence is required. Unit tests verify implementation behavior; Foundry live checks are separate and cannot be replaced by mocks or a successful build.

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

## Last recorded release evidence

As last recorded on 2026-11-07, release 0.8.1 exposes 51 tools; 219 tests across 30 files passed, with type checking and standard/Windows archive checks. The patched v0.8.1 live acceptance checks remained pending deployment to the Foundry GM browser. See the [release notes](release-v0.8.1.md) and [live retest report](live-retest-v0.8.1-2026-11-07.md). These dated figures are historical evidence, not a live check of a later checkout.

The subsequent [2026-11-09 v0.8.1 live retest](live-retest-v0.8.1-2026-11-09.md) records the targeted fixes passing on Foundry 14.363 / PF2e 8.7.0. Current v0.8.2 integration evidence is tracked separately in [its validation record](validation-v0.8.2.md). Neither record establishes live compatibility for a newer build.
