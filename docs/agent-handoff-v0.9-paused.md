# Paused implementation handoff — 2026-11-10

**Resumed and superseded:** local v0.9.0 implementation/package work is complete; see [final validation](validation-v0.9.0.md) and [release notes](release-v0.9.0.md). Live acceptance/publication remain pending. The paused state below is historical.

The user requested a summary and a pause. The active objective remains implementing both v0.8.2 and v0.9; it is not complete. The implementation coder was interrupted and both additional read-only reviewers have finished. Resume only when the user asks.

## Completed local milestone: v0.8.2

- Added scoped `end_encounter`, with fresh tracker checks, shared combat locking, native cleanup and uncertain-outcome reporting.
- Added diagnostics distinguishing loaded module, installed manifest, running companion and MCP package/advertised versions.
- Added CI and tag-driven public distribution workflows, bundle verification and draft publication checks. Credentials are constrained to validated GitHub API endpoints and are not forwarded to asset redirects.
- Aligned release metadata at 0.8.2. Clean installation, type checking, standard/Windows packaging and **260 tests across 33 files** passed at this milestone, with PowerShell coverage required and enabled.
- Verified immutable local assets in `dist/releases/v0.8.2/`: manifest, module ZIP, Windows setup ZIP and checksums. Historical v0.8.1 assets remain preserved. See [v0.8.2 validation](validation-v0.8.2.md).

## Reviewed v0.9 foundations

- Implemented `pf2e_inspect_spellcasting` and `pf2e_inspect_resources`: native asynchronous options, ownership checks, prepared holes/indices, signature/heightened choices, focus/innate/item resource facts and bounded output. Main-agent focused verification passed **39 tests across four files** for that stage.
- Implemented a separate persistent `spellCasts` ledger with world-level serialization, reservation readback, duplicate/unresolved-Actor blocking and a 5000-record limit without eviction. Main-agent focused verification passed **20 tests** before subsequent casting integration edits. Independent review found no remaining blocker in that reviewed ledger state.
- Removed automatic audit rollback. Failed finalization observes/reports stored status and known outcome without another corrective write; native actions are never replayed to repair audit uncertainty.
- Main requirements/API evidence live in [the implementation plan](implementation-plan-v0.8.2-v0.9.md), [native spellcasting design](v0.9-native-spellcasting-design.md), [v0.9 validation](validation-v0.9.0.md) and the draft [operator guide](spellcasting.md).

## In progress when paused

The coder is implementing `pf2e_inspect_spell_cast` and `pf2e_cast_spell`, including session-bound expiring intents, native consumption, actual-cast cards, explicit caster/targets, combat checks and audit integration. Schemas/dispatch are being wired for an expected final **56-tool** contract. This casting slice is **not accepted or release-ready**. Current metadata remains 0.8.2 during development; the current checkout is not the immutable 52-tool v0.8.2 distribution.

Primary implementation files:

- `packages/module/src/pf2e-spellcasting.ts`
- `packages/module/src/pf2e-spell-ledger.ts`
- `packages/module/src/pf2e-spell-cast.ts`
- Their tests in `packages/module/tests/`, plus shared schemas, module dispatch/context and companion discovery tests.

The coder received the following review corrections. Some may already be partially applied; inspect current files and test results before deciding what remains:

1. Ordinary `system.location.heightenedLevel` is valid native heightening, not an alternate variant. Reject actual document `original`/`isVariant`/`parentItem` workflows instead.
2. Support native variable times `1 to 3` and `1 or 2`; reject canonical `free` and reaction casting, including outside combat. Unknown time data must not silently become executable.
3. Protect the async fingerprint window: synchronously recheck captured sources, derived facts, resources, identities and session after hashing, immediately before native work. Recheck expiry after lock waits and pre-write awaits.
4. Bind caster and target identities to preview; check the read-only ledger for blocked/full/invalid state before issuing an executable intent.
5. Re-resolve/revalidate after native card-building awaits; verify resource outcomes and context before final confirmation.
6. Verify exact native spell/card origin, actual-cast marker, entry, explicit scene/token/Actor speaker, intent metadata and preserved visibility. Preserve other native/module flags and require actual world-message membership.
7. Use strict owned regular entry validation and fail closed on invalid current combat context.
8. Make execution fixtures follow actual native consumption and async group behavior. Cover prepared, flexible, spontaneous/signature, fixed heightened spells, focus, free cantrips/focus and finite innate uses—not only prepared/focus examples.

One further item was being investigated, **not yet a confirmed finding**: the cast code currently prefers global `ChatMessage` over `game.messages.documentClass`. Verify that it uses the configured PF2e document class and preserves native overrides. Foundry v14 core is available at `/tmp/foundry-v14-core.mjs`.

Exact PF2e 8.7.0 primary sources and sample fixtures are in `/tmp/v09-*`, with permanent official links in the design document. Verified examples: Lingering/Fortissimo Composition use `free`; Heal Animal/Companion use `1 or 2`; Heal/Harm/Force Barrage use `1 to 3`. Level-25 NPC focus groups can have native group 13 while the actual card rank is clamped to 10. The ledger group-number validation is being adjusted for that case.

## Remaining delivery work

- Finish and review casting implementation and meaningful regressions; rerun integration checks.
- Align all final metadata/internal dependencies at **0.9.0** and confirm 56-tool discovery/classification.
- Finalize documentation and add the spellcasting guide to the Windows bundle allowlist.
- Run the full suite, type checking, builds and standard/Windows packaging on the final state. Prepare and verify immutable `dist/releases/v0.9.0/` assets, preserving earlier milestones.
- Complete the requirement-by-requirement audit before marking the goal complete.

## Deployment and authorization boundary

No new release has been published, no source commit/push was performed, and no new build was deployed to Foundry by this work. No live world writes were performed for these milestones. A read-only status check confirmed the existing Glimmerkeep bridge on Foundry 14.363 / PF2e 8.7.0, but remote module/daemon build versions were unverified. Live v0.8.2/v0.9 acceptance remains pending matching-build deployment and authorization. Do not replay old fixture writes or clear damage/spell audit records.

Preserve all unrelated preexisting work, including Windows setup and historical reports. Main owns scope/review/integration; implementation stays with the configured Luna-medium coder. The two additionally authorized agents performed read-only reviews. Do not commit, push, publish or deploy without an explicit user instruction.
