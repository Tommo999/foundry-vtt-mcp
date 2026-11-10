# v0.9.0 validation record

Status: local implementation and packaging complete on 2026-11-10. Immutable v0.9.0 assets are in `dist/releases/v0.9.0/`; historical v0.8.1/v0.8.2 assets remain intact. Publication, deployment and live compatibility remain pending.

## Inspection integration

Added `pf2e_inspect_spellcasting` and `pf2e_inspect_resources`, bringing the intermediate development contract to **54 tools**. Version metadata deliberately remains 0.8.2 until the final v0.9 integration step; do not treat an interim checkout as the packaged v0.8.2 milestone.

The main agent reviewed the native asynchronous group loading, malformed-result warnings, current owned entry/spell identity, prepared-slot holes and indices, actual native ranks/signature options, UUID-less unsupported ritual summaries, focus-cost precedence, missing-versus-zero resources, and bounded resource/warning output. Source-shaped fixtures cover native focus groups without a `number` field and heightened non-signature grouping by current rank. Prepared readiness excludes blank/stale selections and has per-rank slot truncation markers.

- `npx vitest run packages/module/tests/pf2e-spellcasting.test.ts tests/shared.test.ts packages/module/tests/v06-integration.test.ts tests/stdio.integration.test.ts`: main-agent verification passed **39 tests across four files**, including loopback MCP discovery and read-only annotations.
- The coder's type checking and production build passed for this integration. Final full-suite, type checking and release builds must be repeated after casting/version integration; these focused checks do not establish that later state.
- No Foundry world writes, deployment or live spellcasting checks were performed. Exact-version API and pack evidence is recorded in [the native spellcasting design](v0.9-native-spellcasting-design.md).

## Earlier checkpoint requirements (completed locally below)

- Add expiring, session-bound cast preview and guarded native execution, including native consumption/refusal/resource verification, explicit native speaker/mode/card facts, target context, stale-turn/state protection and uncertain-outcome handling.
- Integrate blocked-ledger state into resource inspection and register the restricted world setting. Recheck approval/default authorization and all new MCP contract annotations/descriptions.
- Complete v0.9.0 metadata, documentation, full suite/type checking/packaging and immutable release ZIP/checksum/manifest verification. Expected final contract: **56 tools**.
- Perform matching-build live checks only after authorized deployment and isolated fixtures are available, or record the concrete blocker. Existing v0.8.1/0.8.2 evidence is not a substitute for v0.9 acceptance.

## Internal ledger integration

Implemented `pf2e-spell-ledger.ts` with a world-scoped transaction lock, `reserve`/`finalize`/`get`/`readActor` operations, and a separate read-only Actor summary. It validates bounded version-1 records, preserves cached settings data through cloning, rereads before updates, checks current authorization/world immediately before persistence and verifies reservation readback. Reserved/uncertain Actor records block fresh intents; confirmed history permits deliberate fresh casts. Capacity is 5000 without eviction. It performs no native spell action or setting registration itself.

Review removed an automatic audit rollback: a failed finalization now makes no second corrective write, retains any committed terminal facts, and reports observed status plus requested outcome. Missing/unreadable/malformed state fails closed. The independent read-only review found no remaining blocker in the ledger's inspected flows; it did not execute tests.

- Main-agent `npx vitest run packages/module/tests/pf2e-spell-ledger.test.ts`: **20 tests passed**, covering cross-Actor serialization, duplicate/reloaded blockers, cache isolation, authorization/world changes, capacity, malformed stores, before/after-commit and readback failures, single-attempt finalization, inherited-key lookup and bounded summaries.
- Coder `npm run typecheck`: passed. The ledger is not exposed as a mutation tool; setting registration and resource-summary integration are part of the casting task now in progress.


## Final resumed integration — 2026-11-10

Three Luna-medium agents performed sequential implementation and two read-only reviews. Main-agent integration accepted the configured PF2e chat class, post-hash derived-option and prepared-index checks, malformed-combat refusal, expiry/session checks, target binding, and source/document/derived-option comparison across native card construction. The final read-only safety review found no remaining blocker in the reviewed casting paths. Native mutations remain guarded and uncertain terminal audit writes are never replayed.

Changed areas: `pf2e-spell-cast.ts` and casting regressions; the spellcasting/ledger modules, shared schemas, bridge session getter and dispatch, companion discovery/descriptions; legacy v0.4–v0.8 paired-session fixtures; root/workspace/lock/module version metadata; Windows guide allowlist/test; README, installation, tool reference, acceptance checklist, spellcasting guide and release notes. All final metadata/internal dependencies agree at **0.9.0**. Discovery and documentation agree on **56 tools**, with no missing or unknown names.

Final main-agent checks:

- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **321 tests passed across 36 files**, no skips. Reviewed escalation enabled local TLS loopback listeners and subprocess probes; TLS checks were retained. An earlier sandboxed run failed on EPERM, and a subsequent full run exposed missing paired-session fixtures; those fixtures were corrected before this final passing run.
- `npm run typecheck`: passed.
- `npm run package:windows`: passed, including all production builds and standard module ZIP; Windows source bundle has 55 files and includes `docs/spellcasting.md`.
- `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases`: passed, creating the four immutable v0.9.0 assets.
- `RELEASE_REPOSITORY=Tommo999/foundry-vtt-mcp-releases RELEASE_TAG=v0.9.0 RELEASE_ASSET_DIR=dist/releases/v0.9.0 node scripts/release-publication.mjs verify-local`: passed with reviewed subprocess escalation. Verifies allowlist, hashes, ZIP integrity/safe paths, versions/public URLs and embedded manifests.
- `sha256sum -c SHA256SUMS.txt`, `unzip -tq foundry-vtt-mcp.zip`, and `unzip -tq foundry-vtt-windows-setup.zip` in each of `dist/releases/v0.9.0/`, `v0.8.2/` and `v0.8.1/`: all passed.
- Built `toolSchemas` versus tool-reference table: **56/56**, zero missing/unknown names. `git diff --check`: passed.

Regression fixtures exercise prepared, flexible, spontaneous/signature, focus including free focus/high-level NPC group 13, cantrip and finite innate consumption; native refusal, stale state/session/turn, expiry behind locks, ordinary heightening versus variants, variable casting times, async fingerprint/card changes, configured class selection, explicit speaker/visibility, corrupted card identity and audit uncertainty. These source-shaped mocks do not establish live compatibility or exhaustive PF2e rule support.

## Requirement audit and pending external gates

- Plan steps 1–4 (v0.8.2): local implementation/release checks retained and historical assets reverified; see its validation record.
- Steps 5–7: four PF2e tools, bounded inspection, guarded native consumption/card creation, persistent duplicate/uncertainty ledger and focused/integration regressions are complete locally.
- Step 8: metadata/docs, full tests/typecheck/builds and immutable release verification complete locally. **Live acceptance is not performed.** Matching updated module/companion/GM-browser versions must be deployed and verified first, followed by isolated workflows from the unchecked acceptance checklist. The previous bridge's module/daemon versions were unverified; no new read-only status result or deployment is claimed here.
- No commit, push, publication, deployment, live world write, ledger clearing or fixture replay occurred during resumption. Hosted CI/release execution and Windows PowerShell 5.1 remain unperformed; local mandatory coverage used Linux PowerShell. No new live fixtures require cleanup.
- Native reaction/free-action, ritual, selected alternate/amped and item/wand/staff/trick workflows remain unsupported; no automatic effects/HP, saves, templates, action spending or time advancement. Ledger serializes this bridge, not independent clients; unresolved records require investigation and cannot be bypassed with a new intent.
