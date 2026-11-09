# Agent assignment: repair the v0.8 live acceptance findings

## Objective

Fix the three issues reproduced against the live Glimmerkeep world, add meaningful regression coverage, prepare a local v0.8.1 package, and retest the affected workflows. Preserve the existing 51-tool contract and the working combat/damage safeguards.

Repository: `/home/tomasmcaloney/Documents/Zed Projects/Foundry-VTT MCP`

Read before making changes:

- [Live acceptance report](live-acceptance-2026-11-07.md)
- [Recorded calls and fixture IDs](live-acceptance-2026-11-07.json)
- [Tool reference](tool-reference.md)
- [Installation and upgrade guide](installation.md)
- [Acceptance checklist](acceptance-checklist.md)
- Applicable repository/AGENTS instructions.

Historical test environment: Foundry **14.363**, PF2e **8.7.0**, bridge **0.8.0**, world **Glimmerkeep** (`glimmerkeep`), automatic writes. The 2026-11-07 run exercised all 51 tools in 134 calls: 45 passed, 5 passed with findings, and 1 failed. Automated baseline at that time: **196 tests in 27 files**, with type checking passing. These counts are historical; the workspace may contain additional work/tests now.

This assignment concerns implementation and validation. Do not treat the existing passing unit suite as evidence that the live failures are fixed.

## Working agreements and ownership

Keep requirements analysis, scope decisions and integration in the main agent. Once the implementation plan is settled, delegate coding to the configured `coder` custom agent (GPT-6 Luna, medium reasoning), as required by the user's working agreements. The preferred orchestrator is GPT-6.1 Sol at medium reasoning.

The three fixes can run in parallel with explicit ownership:

| Workstream | Owned files/responsibility |
|---|---|
| Search | `packages/module/src/pf2e.ts`, `packages/module/tests/pf2e-read.test.ts`, and directly relevant search tests |
| Encounter reporting | `packages/module/src/encounters.ts`, `packages/module/tests/encounters.test.ts` |
| Ammunition | `packages/module/src/pf2e-inventory.ts`, `packages/module/tests/pf2e-inventory.test.ts` |

The search owner also owns any ammunition-related change to the equipment-search allowlist in `pf2e.ts`; the inventory owner must coordinate that change rather than editing the same file independently.

Tell every worker they are not alone in the codebase: preserve other edits and adjust to concurrent changes. Inspect the current workspace before editing. In particular, Windows packaging/setup work and related tests are present; preserve that unrelated work.

The main agent reviews/integrates the fixes and coordinates release metadata, docs, packaging and live verification. Delegate any additional implementation after its scope is settled.

## 1. Repair filtered PF2e compendium search — highest priority

### Reproduction and evidence

Call `pf2e_search_compendium` with:

```json
{
  "kind": "creature",
  "pack": "pf2e.pathfinder-monster-core",
  "query": "Goblin Warrior",
  "limit": 3
}
```

Observed: a successful RPC envelope containing **zero results** and:

```text
Could not read pack pf2e.pathfinder-monster-core:
Cannot create property 'value' on number '1'
```

The same failure appeared across the Actor packs when no pack filter was supplied.

Control call:

```json
{
  "pack": "pf2e.pathfinder-monster-core",
  "query": "Goblin Warrior",
  "limit": 3
}
```

Generic `search_compendium` returned:

```text
Compendium.pf2e.pathfinder-monster-core.Actor.fLLKuOXwPq1Iq0U4
```

### Investigation and implementation

Inspect `fieldsFor`, `levelOf`, `matchesSearch`, and `pack.getIndex({ fields: ... })` in `pf2e.ts`.

Current field requests include both parent and child paths, for example:

- `system.details.level` and `system.details.level.value`
- `system.traits.size` and `system.traits.size.value`
- `system.level` and `system.level.value`
- `system.price`, `system.price.value`, and `system.price.per`

These overlapping requests are a **suspected** cause, not a proven diagnosis. Verify the actual Foundry/PF2e index shapes and merge behavior. Read current primary API/source documentation when needed.

Request compatible fields and normalize supported scalar versus nested-value representations where necessary. Avoid introducing an index-loading fix that leaves `levelOf` or size/price filtering unable to read the returned data. Preserve zero-valued levels/prices.

Keep creature, hazard and equipment filters, bounded pagination, pack selection and per-pack warnings. A genuinely broken pack should not erase good results from other packs.

### Acceptance criteria

- The exact live creature query above returns Goblin Warrior without an index warning.
- Search also works without an explicit pack.
- Hazard complexity and equipment level/type/price/size filters retain their behavior.
- Regression fixtures exercise supported scalar/nested index shapes and the actual failure mode. A mock that simply returns prebuilt rows regardless of requested fields is insufficient.
- Partial pack failures remain distinguishable from an ordinary empty search.

## 2. Correct encounter active-state reporting

### Reproduction and evidence

For the active, started test combat:

- `start_encounter`, `inspect_encounter`, and `next_turn` returned `active: false`.
- `pf2e_combat_context` returned `active: true`.
- Native start, turn advancement, strikes and damage worked.

Inspect `combatSummary` in `encounters.ts`. It currently uses:

```ts
Boolean(combat.active ?? ctx.game.combat?.id === combat.id)
```

An explicit false value prevents the current-combat fallback from being considered. The file already has an `isActive` helper used by execution guards.

### Implementation and acceptance criteria

Use a consistent, verified Foundry v14 active-state calculation for summaries and execution guards; reuse the existing helper where appropriate.

Add regressions for:

- `combat.active === false` while that document is the actual current combat.
- An inactive, unselected preparation combat.
- A started but unselected combat.
- Consistent reporting through list/inspect, start and next-turn results.

Keep this system agnostic. Preserve the shared combat lock, stale-turn rejection, unstarted-combat restrictions, authorization checks and partial-result behavior. Do not infer activity merely from `started`.

## 3. Support native PF2e ammunition in inventory workflows

### Reproduction and evidence

The imported Goblin Warrior has an Arrows item of native type `ammo`.

- `pf2e_inventory` omitted Arrows while listing weapons, armor and coins.
- `pf2e_add_inventory_item` rejected this source:

```text
Compendium.pf2e.equipment-srd.Item.w2ENw2VMPcsbif8g
```

Error:

```text
PF2E_UNSUPPORTED_ITEM:
Only PF2e physical inventory item types can be transferred or added.
```

Inspect `PHYSICAL_ITEM_TYPES`, `assertPhysical` and inventory filtering in `pf2e-inventory.ts`. The explicit allowlist omits `ammo`. Also inspect the equipment-search allowlist in `pf2e.ts`.

### Implementation and acceptance criteria

- Include native ammunition in inventory inspection and appropriate equipment search/type filters.
- Add, stack, set positive quantity, and transfer ammunition through native inventory APIs.
- Verify quantities, source fields and native ammunition metadata are preserved.
- Keep native physical-item validation and scoped type restrictions; do not allow arbitrary effect/spell/action Items as physical inventory.
- Preserve existing consumable support for older supported data shapes.
- Add meaningful ammo fixtures and regressions for read/add/quantity/transfer behavior.
- Do not add automatic ammunition consumption to strike execution. Preserve `consumeAmmo: false` and the existing consumable-weapon strike restriction.

## Validation and release deliverables

1. Run focused tests for each change.
2. Run the current full suite and checks:

```bash
npm test
npm run typecheck
npm run package
```

Some tests bind loopback sockets and launch TLS/MCP subprocesses. In this environment sandboxed execution previously returned `listen EPERM`; use the normal reviewed escalation mechanism when necessary. Do not disable TLS or weaken tests to work around it.

3. Prepare a **local v0.8.1 bugfix release** with consistent root/workspace package versions, exact internal dependency versions, module manifest, CLI MCP server version and lockfile. Preserve Windows packaging/setup integration. Do not change the 51-tool API unless a demonstrated fix requires it and that scope change is made explicit.
4. Verify the ZIP manifest/version and archive integrity.
5. Update upgrade/release notes with these fixes and precise validation evidence.
6. Retest the affected workflows live after the running companion and GM browser actually load the new build. Repository/package changes alone do not update already-running processes.
7. Produce a new dated or clearly versioned retest report. Keep the original report and call log as historical evidence rather than overwriting the failed results.

The earlier deployment mismatch was resolved only after restarting the companion from the updated checkout and hard-refreshing Foundry. Diagnose a renewed `Unsupported tool` response as a deployment/version problem before assuming the patched handler ran.

## Live retest boundaries and existing fixtures

Recheck connection/world/write mode and current fixture state before mutating anything. The world may have changed since the report.

Historical test encounter: `Combat.DyLIFuON9aWdqd57`. At the end of the recorded run it remained started at round 1, turn 1. There is no MCP end-combat or general deletion tool. Coordinate native UI cleanup with the GM when needed; do not add an arbitrary-JavaScript or unrestricted-deletion escape hatch.

Use only clearly identified test fixtures, or new isolated fixtures where necessary. The original report/JSON lists exact Actor, token, note, journal, Item, asset and chat UUIDs. Preserve the existing scene and its original token; they predate this acceptance run.

Retest at minimum:

- Filtered Goblin Warrior search, hazard search, equipment search and ammo type filtering.
- Inactive versus actual current combat reporting.
- Native ammo inspection, add/stack, quantity change and transfer between test Actors.
- Existing stale-turn, duplicate-damage and stale-review guards after integration.

Do not blindly replay old write requests, erase the damage-application ledger, clear uncertain reservations, or change campaign Actors to make tests pass. Six successful damage application audit records were created by the previous run. The test token shield was destroyed during a native Shield Block check; it is not a reusable healthy-shield fixture without explicit repair/replacement.

The previous run used bundled PF2e/Foundry icons and one 68-byte 1×1 PNG upload fixture. No external artwork service is needed.

## Definition of done

- All three live findings are resolved, with focused regressions that would fail against v0.8.0.
- Current full tests, type checking and packaging pass.
- v0.8.1 ZIP and upgrade notes are ready.
- Affected live checks pass on the stated environment, or any unavailable live validation is explicitly recorded as pending with its blocker.
- Final handoff lists changed files, actual test counts/results, remaining limitations and any test artifacts requiring cleanup.

