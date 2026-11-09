# v0.8.1 repair plan

Status: implementation, review, automated validation and local packaging completed sequentially using one coding subagent. Affected live acceptance remains pending verified deployment; see the [validation report](live-retest-v0.8.1-2026-11-07.md).

## Scope and evidence

Resolve the three live v0.8.0 findings without changing the 51-tool contract. Preserve Windows setup and packaging work, native inventory validation, combat locking, stale-turn rejection, damage reservations/audit records, duplicate-application protection, and stale-review checks. Do not add automatic ammunition consumption or unrestricted execution/deletion tools.

Reviewed the original [acceptance report](live-acceptance-2026-11-07.md), [recorded calls](live-acceptance-2026-11-07.json), [assignment](agent-handoff-v0.8.1.md), tool reference, installation guide, acceptance checklist, current handlers and existing tests.

Read-only review on 2026-11-07 confirmed the companion connects to Glimmerkeep on Foundry 14.363 / PF2e 8.7.0 with automatic writes. The exact filtered Goblin Warrior query still returns no results with the scalar-property warning; the equivalent generic search returns the expected UUID. Inspecting the ammunition source confirms native `type: "ammo"`, quantity 10, ammunition uses and base-item metadata. No world mutations were made during this review. These observations establish a current reproduction, not a fixed-build acceptance result.

| Finding | Review conclusion | Required repair |
| --- | --- | --- |
| Filtered compendium search | Overlapping index paths are a strong suspect; the exact Foundry merge failure still needs a focused reproduction. `levelOf` also only reads nested `.value`, so removing paths alone is insufficient. Existing mocks ignore requested fields. | Request compatible fields, normalize supported shapes, and model index construction in regressions. |
| Encounter active state | Confirmed inconsistency: summaries use nullish fallback, whereas execution guards already accept the actual current combat even when its `active` flag is false. | Use one verified active-state calculation for summaries and guards. Do not infer activity from `started`. |
| Ammunition | Confirmed: both inventory and equipment-search physical-type allowlists omit `ammo`. Existing arrows/bolts tests use generic equipment fixtures. | Admit native ammunition while retaining physical-item validation, with real ammunition fixtures. |

PF2e 8.7.0's native browser requests leaf level paths and parent price/traits data, rather than all overlapping paths. Native ammunition extends the physical item implementation. Use these exact-version primary sources when implementing:

- [Bestiary index fields](https://github.com/foundryvtt/pf2e/blob/pf2e-8.7.0/src/module/apps/compendium-browser/tabs/bestiary.ts)
- [Hazard index fields](https://github.com/foundryvtt/pf2e/blob/pf2e-8.7.0/src/module/apps/compendium-browser/tabs/hazard.ts)
- [Equipment index fields](https://github.com/foundryvtt/pf2e/blob/pf2e-8.7.0/src/module/apps/compendium-browser/tabs/equipment.ts)
- [Native ammunition implementation](https://github.com/foundryvtt/pf2e/blob/pf2e-8.7.0/src/module/item/ammo/document.ts)
- [Foundry v14 CompendiumCollection API](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.CompendiumCollection.html)

## Execution and ownership

The main agent retains requirements, scope, integration, review and live acceptance responsibility. The user subsequently requested only one subagent and one task at a time. Reuse one configured `coder` agent, GPT-6 Luna at medium reasoning, for search, encounter reporting, inventory, then release preparation; review and validate each task before assigning the next. The requested orchestrator is GPT-6.1 Sol at medium reasoning.

Before edits, each worker must inspect the current workspace. Tell every worker they are not alone in the codebase: preserve other edits and adapt to concurrent changes. No worker should overwrite unrelated Windows work.

### 1. Search worker

Own `packages/module/src/pf2e.ts`, `packages/module/tests/pf2e-read.test.ts`, and directly relevant search tests. This worker alone owns the equipment-search ammunition allowlist change.

1. Reproduce index construction using requested fields, including an existing scalar encountered while assigning a child path. Establish which incompatible requests cause the failure; do not encode the suspected diagnosis as an unsupported assertion.
2. Select compatible fields informed by the installed Foundry/PF2e behavior and native browser. Cover initial index loading and subsequent cached-index extension.
3. Normalize supported scalar and nested level/size/price values. Preserve level zero, price zero, denomination parsing and per-unit pricing. Avoid widening accepted malformed data unnecessarily.
4. Retain creature/hazard/equipment filtering, explicit and unrestricted pack selection, bounded pagination, stable results and per-pack warnings. One broken pack must leave other packs' results intact.
5. Add native `ammo` to equipment type filtering in coordination with the inventory worker.
6. Address the equipment-size validation edge: equipment size filtering is currently explicitly unsupported, but the rejection occurs inside per-pack row processing. Validate this unsupported combination before reading packs so callers receive `INVALID_INPUT`, rather than misleading pack warnings. Preserve supported creature/hazard size filters. Enabling equipment size filtering is outside this bugfix unless native index evidence justifies an explicit scope adjustment.

Regression requirements: a request-aware index fixture that fails against v0.8.0; scalar/nested level and size representations; zero-valued levels/prices; hazard complexity; equipment level/type/price/per filters; native ammo; pagination; ordinary empty results versus partial pack failure. A mock returning the same prebuilt rows regardless of fields is insufficient.

### 2. Encounter worker

Own `packages/module/src/encounters.ts` and `packages/module/tests/encounters.test.ts`.

1. Verify the current-combat/active semantics against Foundry v14, then reuse the existing `isActive` helper where appropriate for all summaries and guards.
2. Add cases for a current combat whose `active` flag is false, an inactive unselected preparation combat, and a started but unselected combat.
3. Assert consistent results through list, inspect, start and next-turn workflows. Retain system independence, shared lock, authorization, stale-turn and unstarted-combat restrictions, and partial-result handling.

### 3. Inventory worker

Own `packages/module/src/pf2e-inventory.ts` and `packages/module/tests/pf2e-inventory.test.ts`. Coordinate equipment-search changes with the search worker; do not edit `pf2e.ts` concurrently.

1. Add native `ammo` to the scoped physical-item allowlist while preserving native `isOfType("physical")` validation and existing consumable compatibility.
2. Exercise inspection, native add, stacking, positive quantity changes, and partial/full transfers through the existing native APIs.
3. Use actual `type: "ammo"` fixtures with source identity, base item, uses, size, traits and relevant ammunition metadata. Verify source/target quantities and metadata after operations, including stacking.
4. Retain rejection of spells, effects and actions as physical inventory. Keep `consumeAmmo: false` and the existing consumable-weapon strike restriction unchanged.

## Integration and automated acceptance

1. Workers run their focused tests and report exact results. Where practical, demonstrate that new regressions fail against the corresponding old behavior without reverting others' work.
2. Main agent reviews diffs, coordinates shared search/inventory assumptions, and checks that all 51 tool names and schemas remain stable. Run relevant combat/damage guard tests after integration.
3. Delegate the settled release implementation: update root/workspace versions, exact internal dependency versions, module manifest, CLI MCP server version and lockfile to 0.8.1; update installation/release notes. Preserve Windows setup/package integration.
4. Run `npm test`, `npm run typecheck`, and `npm run package`. Use reviewed escalation for loopback/TLS subprocess tests if the sandbox returns `listen EPERM`; do not weaken TLS or skip checks to obtain a pass. Record actual current counts, not the historical 196-test baseline.
5. Exercise Windows packaging and available PowerShell smoke coverage from Linux, explicitly distinguishing this from a real Windows installation test. `npm run package:windows` includes the normal package build; avoid unnecessary duplicate builds.
6. Verify archive integrity, manifest version, required files, internal version consistency and the Windows package. Check that packaging includes no credentials or local certificates using the existing packaging checks.

## Deployment gate and live retest

A package on disk does not update an already-running companion or browser. Before accepting live results, load the 0.8.1 module, restart the companion from this checkout, hard-refresh the GM browser and verify both versions. Use MCP initialization `serverInfo.version` for the server and Foundry module/version information for the module; connection status alone does not establish build identity. An `Unsupported tool` response first triggers deployment/version diagnosis.

Recheck connection, world, write mode and fixture state before any mutation. Preserve the original scene and its pre-existing token. Inspect the historical encounter `Combat.DyLIFuON9aWdqd57` rather than assuming its old turn state. Use clearly named isolated retest fixtures or confirmed acceptance fixtures. Coordinate any required native combat cleanup with the GM; there is no MCP end-combat/deletion tool.

| Workflow | Live acceptance evidence |
| --- | --- |
| Creature search | Exact Goblin Warrior query in `pf2e.pathfinder-monster-core`, then without a pack filter, returns the expected creature without the index warning. |
| Other search filters | Hazard complexity, supported creature/hazard sizes, equipment level/type/price filters and native ammo type search succeed; unsupported equipment size input reports a clear error. |
| Encounter state | List/inspect agree with combat context for actual current versus inactive preparation and started/unselected encounters. Start/next responses agree where safe isolated fixtures permit these mutations. |
| Ammunition | Inspect native arrows; add a fresh stack; add to an existing compatible stack; set positive quantity; transfer partial and full quantities between isolated Actors. Record quantities and source/native metadata. |
| Safeguards | Recheck stale-turn, duplicate-damage and stale-review rejection using freshly inspected state and controlled test fixtures. Preserve unstarted restrictions and existing damage records. |

Do not blindly replay historical writes, clear damage ledgers/reservations, or modify campaign Actors to obtain passing results. The six previous successful damage audit records remain valid. The historical test shield was destroyed and is not a healthy-shield fixture; use a new isolated fixture if any shield-dependent test is necessary. Duplicate-damage checks must not result in a second application. Confirm stale-turn requests are actually stale before sending them.

Write a new versioned/dated report and structured call log, for example `docs/live-retest-v0.8.1-2026-11-07.md` and `.json` if executed on that date. Preserve the original failed report and call log. Record deployed versions, exact commands/test counts, raw affected tool results, fixture IDs, mutations, cleanup needs and any blocked checks.

## Completion criteria

- All three findings have regressions and reviewed fixes.
- Current full tests, type checking, standard packaging and Windows packaging pass, with exact evidence recorded.
- Local 0.8.1 archives and upgrade notes are ready; the tool contract remains at 51 tools.
- Affected live checks pass on the verified new deployment, or unavailable checks are explicitly marked pending with their blocker. Automated tests alone do not close a live finding.
- Final handoff lists changed files, validation results, limitations and test artifacts requiring cleanup.
