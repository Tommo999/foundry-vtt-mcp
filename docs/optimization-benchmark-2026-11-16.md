# Optimization benchmark — 2026-11-16

## Method and acceptance checklist

All investigation agents use GPT-6 Luna at medium reasoning with fresh context, sequentially. They receive a fixed read-only task, start from AGENTS and the relevant change guide, and report source reads, command batches, truncation, elapsed time if available and findings. No benchmark agent implements a synthetic feature or changes the world. Model input tokens and tool-output byte counts are unavailable: no token saving is inferred from line counts.

Baseline working-tree content fingerprint: `cd6b121fecedc50e2e0a78af41722f5f28efefd66ae492830645b6d4812ef6ca` (SHA-256 of sorted path-to-SHA-256 JSON for 166 tracked/untracked, nonignored files). The tree already contains the earlier approved changes; HEAD alone does not identify this baseline. The [baseline path/hash manifest](benchmarks/2026-11-16/baseline-sha256.json) is retained for identifying those inputs; hashes identify content but do not reconstruct an uncommitted checkout. This report records relevant before/after source changes below.

Main-agent assessment criteria, established before evaluating investigation answers:

| Task prompt | Required findings |
| --- | --- |
| Trace how to add a read-only tool, identifying required edits and tests. | Shared schema/classification; CLI description and generated registration; module dispatch/handler; contract/discovery/handler tests; user docs and separate live acceptance. |
| Trace a spell-resolution change from selection validation through native execution and ledger finalization. | Confirmed cast/selection validation; sourceFacts/currentFacts fingerprint; session-bound expiring intent; durable reservation before native call; attack/save/damage execution and uncertain finalization. |
| Diagnose how a disconnect during a pending write reaches the MCP client. | CLI error mapping; daemon pending-write OUTCOME_UNKNOWN; module session/approval invalidation; no automatic retry; relevant daemon/stdio/module tests. |

These are bounded discovery tasks, not completed real feature changes. Correctness scores assess the explanation, not native compatibility. Comparisons use identical task wording and the same model/reasoning settings. One run per state cannot distinguish causation from ordinary agent variation.

## Baseline observations

| Task | Agent | Command batches | Elapsed | Findings |
| --- | --- | ---: | --- | --- |
| Tool addition | baseline_tool | 5 | 34 seconds, self-reported | All 5 required findings; two oversized outputs required focused rereads. |
| Spell resolution | baseline_resolution | 7 | Unavailable: clock call aborted | All 5 required findings; one oversized search required focused rereads. |
| Pending-write disconnect | baseline_transport | 5 | About 45 seconds, self-reported | Client error mapping, uncertain daemon outcome and module queue invalidation found; daemon test location identified. Automatic-retry behavior described as absent. |

### Tool investigation read log

1. `pwd`; AGENTS 1–240 and tool-change guide 1–260 (files contain 25 and 33 lines).
2. `rg -n -A45 -B8` on maintenance tool checklist; schema-pattern search; read-only/schema/CLI/main search.
3. Broad symbol/dispatch search across shared, main, CLI, tests and tool/acceptance docs.
4. Shared 64–115, 490–555; main 205–255, 410–455; CLI 175–215, 280–340; shared tests 480–525, 560–590; tool-reference 1–45; acceptance 1–80. Output truncated.
5. Focused numbered reread: shared 485–545; main 215–300, 410–450; CLI 160–210, 278–338; shared tests 490–515, 565–585; maintenance 33–47; tool-reference 1–38; acceptance 1–18; tool-name search in test roots. Output truncated again. Findings still identify the required contract and ownership boundaries.

### Resolution investigation read log

1. File inventory for AGENTS, PF2e guide and spell files (bounded to 80 results).
2. AGENTS and PF2e change guide (25 and 33 lines).
3. Spell-resolution guide 1–240 (34 actual lines); broad selection/validation/execution/ledger/finalization search across resolution handler, ledger and cast. Search output 426 lines, truncated.
4. Resolution 1–130, 1110–1388; ledger 250–490.
5. Resolution 185–310, 515–690, 818–903.
6. Function lookup for validateSelection, resolveSelection, assertResolvedCurrent; resolution 130–185, 340–515, 700–818.
7. Resolution 323–350; file line counts; working-tree status.

### Transport investigation read log

1. AGENTS 1–240 and transport guide 1–260 (25 and 32 actual lines).
2. Broad pending/disconnect/socket/uncertain/timeout search in daemon, CLI, main, stdio and daemon tests.
3. Daemon 235–285, 385–455, 470–490; CLI 1–72; main 490–520, 645–725, 798–845; daemon tests 370–425.
4. CLI function/error search and 250–310; daemon 280–390; main 640–725.
5. CLI 300–350; daemon 455–480; main 465–490, 510–517. No output truncation or truncation-driven reread.

## Fixture comparison and implementation decisions

| Responsibility | Cast fixture | Resolution fixture | Effect fixture | Decision |
| --- | --- | --- | --- | --- |
| Identity and scene/token membership | Mutable suite globals and resource-bearing Actor | Per-fixture local scene/token and active-token APIs | Per-fixture local scene/token plus target item collections | Keep local: ownership and active-token behavior differ. |
| Serialization | Spell/entry source builders preserve resource pools | Explicit source snapshots and roll JSON classes | Document wrapper preserves source, flags and effect grants | Keep local: a generic document helper would hide fingerprint/provenance differences. |
| Settings | Separate cast ledger variable | Named cast/resolution/reconciliation variables, supported-key branches | Keyed store plus `pf2eEnabled` override and effect outcome setter | Defer sharing: configuration/callbacks would replace simple local semantics with indirection. |
| Native behavior | Resource consumption and actual-cast card | Hook/callback correlated attack/save/damage chat | Imported effect/condition grants and post-write evidence | Keep scenario-specific. |

No two inspected stores have the same complete read/write/reset contract. A shared clone-on-write wrapper alone would save little setup and add another owner to read. The plan's conditional fixture extraction is therefore deferred. Existing test assertions and fixtures are preserved. This decision follows source comparison, not a claim that every fixture helper is unique.

## Implementation and verification

The only production source change among the 166 baseline files is `packages/module/src/pf2e-spell-resolution.ts`; the existing context-measurement document also gains a link to this follow-up. The existing working-tree changes from earlier tasks were preserved. The [after path/hash manifest](benchmarks/2026-11-16/after-sha256.json) covers the same baseline paths. Added module-owned types cover source facts/current-state snapshots, preview output, confirmed public response and internal audit result, native-attempt failure details, and finalization failure details. Native documents/rolls remain dynamic and unvalidated source fields remain unknown. `nativeResult` is explicitly typed. The degree-of-success predicate uses equivalent literal/number narrowing; error codes, field values, validation sequence, fingerprint inputs and persistence formats are unchanged.

Commands run from the root:

- `npm run typecheck` — passed (also run by the coder before handoff).
- `npx vitest run packages/module/tests/pf2e-spell-resolution.test.ts packages/module/tests/pf2e-spell-resolution-ledger.test.ts packages/module/tests/pf2e-spell-audit.test.ts packages/module/tests/pf2e-spell-cast.test.ts packages/module/tests/pf2e-spell-effect.test.ts` — 5 files, 99 tests passed.
- `npm test` with approved local socket/subprocess access — 46 files passed; 448 tests passed, 1 skipped, 449 total. The skipped PowerShell smoke test remains unavailable on this host.
- `npm run package:windows` — passed; shared/module/companion production builds and both standard and Windows archives created (80 Windows bundle files). Two existing Rollup dependency PURE-annotation notices remain nonfatal.

No new runtime behavior was introduced or tests rewritten to match the new annotations. Existing regression cases exercise native attack/save/damage, stale reviews, session/combat changes and uncertain ledger outcomes. No deployment, publication or live-world writes occurred. Matching-build live Foundry/PF2e acceptance remains pending deployment/version verification and the relevant workflow checks.

## Results and extraction decision

The fresh `after_resolution` agent used the identical resolution task/start instructions and Luna medium configuration. It found all five required behaviors. It used five command batches versus seven before; elapsed time was only approximately reported as 1–2 minutes, while baseline timing was unavailable. Input tokens and output byte counts were unavailable in both runs.

| Resolution source read measure | Before | After |
| --- | ---: | ---: |
| Command batches | 7 | 5 |
| Explicitly requested handler lines, including repeat requests | 1,176 | 1,578 |
| Unique explicitly requested handler lines | 1,161 | 1,167 |
| Required findings | 5/5 | 5/5 |

Line counts use the inclusive, EOF-bounded ranges in the logs, excluding searches, docs and ledger reads. They measure requested ranges, not guaranteed delivered/processed lines: truncated output limits this proxy. The repeated-line volume increased while batch count decreased. A single pair with incomplete timing does not establish a token, time or discovery improvement, and model variation remains uncontrolled. No type-improvement benefit is claimed from these numbers. The type change establishes explicit internal data contracts and compiler checks; runtime regression tests passed.

### Post-change resolution read log

1. AGENTS and PF2e guide; working-tree status.
2. Spell-resolution guide 1–240 (34 actual lines); handler 1–300; cross-file resolution/ledger/finalization/authorization search across cast, resolution and audit.
3. Handler 500–580, 800–910, 920–1030, 1025–1215, 1215–1530 (EOF 1524); ledger 1–280; dispatch/test tool-name search. Output truncated.
4. Handler 430–505, 1227–1478; ledger 258–470; main 312–330.
5. Ledger 396–500 (EOF 483); handler 254–283, 928–1014, 1479–1507; line counts.

The tool and disconnect baselines did not demonstrate repeated reading of unrelated UI code. The resolution comparison focuses on its own handler/ledger rather than UI. **Defer another main.ts extraction.** A future concrete UI/session change can justify a separate design; file length and this small discovery sample do not.

The fixture comparison also defers consolidation under the approved conditional plan. No helper is added simply to replace a few cloning statements. Source changes are limited to resolution typing; additional outputs are this report and baseline/after file-hash manifests. No real feature implementation was benchmarked: these are discovery probes, and actual change-task efficiency remains an open measurement limitation. The benchmark evidence does not retroactively validate the earlier documentation-line estimates as token savings.
