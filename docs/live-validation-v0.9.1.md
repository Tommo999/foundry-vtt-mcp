# v0.9 live spellcasting acceptance — 2026-11-10

## Result

Partial live acceptance passed on Glimmerkeep using Foundry 14.363, PF2e 8.7.0, and all five runtime components at 0.9.0. Fresh MCP discovery returned 56 tools. All fixture writes were restricted to a new scene and actors/items/tokens named `[MCP v0.9.1 ACCEPTANCE]`; the harness saved each operation before calling MCP and refused to replay any in-flight or uncertain operation.

Five native casts were confirmed on newly created fixtures:

| Path                        | Native resource before → after | Card check |
| --------------------------- | -----------------------------: | ---------- |
| Flexible prepared rank pool |                          2 → 1 | Passed     |
| Spontaneous rank pool       |                          2 → 1 | Passed     |
| Focus spell                 |                          1 → 0 | Passed     |
| Cantrip                     |              No resource spent | Passed     |
| Finite innate use           |                          2 → 1 | Passed     |

Each resulting message had the PF2e actual-cast roll option, the exact spell/entry origin, the explicit fixture caster speaker, GM whisper visibility without blind status, and matching bridge cast ID. Native resource documents agreed with the reported post-cast values. Five same-session duplicate attempts were rejected with `CAST_INTENT_USED`. A later stale-selection attempt was rejected with `CAST_INTENT_UNKNOWN`. Because that request ran in a new local companion process and the intent can also expire, this only confirms that an unknown or expired intent is rejected; it does not prove reconnect caused the rejection or exercise an in-process changed-selection mismatch.

## Prepared slot limitation

An ordinary prepared fixture was created, but the supported generic `update_document` path rejected the nested prepared spell `id` field before a native write. A subsequent read confirmed the slot remained empty. The harness marked the operation as a reconciled pre-write rejection and did not retry it. Prepared casting therefore remains untested pending assignment of the named fixture spell to a rank-one prepared slot through the PF2e sheet. Flexible prepared casting passed.

The slot write is intentionally not performed through arbitrary fields or direct native APIs; the MCP document sanitizer disallows identifiers inside generic updates. This is a fixture setup limitation, not a spell-casting failure.

## Scope and artifacts

The run created one named scene, six named NPCs, six regular spellcasting entries, six spells, and six scene tokens. No previous acceptance fixture, campaign document, encounter, damage/spell ledger, or existing Actor was changed. Five native messages and their audit records remain in the world. No cleanup deletion was performed. No automated failure interruption was induced against a live audit reservation.

The resumable harness is [live-v091-spellcasting.mjs](../scripts/live-v091-spellcasting.mjs). It keeps UUIDs and per-operation checkpoints in a mode-0600 file under `/tmp`, not in the checked-in report. Fixture mode requires an explicit environment opt-in and checks saved world/version and fixture ownership before continuing.

Checks run:

- `node --check scripts/live-v091-spellcasting.mjs`: passed.
- `node scripts/live-v091-spellcasting.mjs probe`: passed; read-only status confirmed all five versions and PF2e availability.
- `FOUNDRY_MCP_LIVE_ACCEPTANCE=I_ACCEPT_NAMED_FIXTURE_WRITES node scripts/live-v091-spellcasting.mjs fixture`: completed five casts, safely recorded the prepared-slot blocker, and verified five duplicate rejections. Rerun mode revalidated saved identities/cards without recasting.
- Read-only `get_document` checks for five messages and native post-cast Actor resources: all five cases passed.
- `git diff --check`: passed.

The 0.9.1 source currently adds harness guard tests and version metadata; this milestone has not yet been packaged or published. The fixture harness expects all five status versions to match the source package by default. When validating a deployed earlier build, set `FOUNDRY_MCP_EXPECTED_VERSION` explicitly.

This run does not cover ordinary prepared-slot consumption, alternate spell variants, item/staff/wand workflows, multi-client ledger contention, or induced uncertain native failures. No source runtime fix was required by these checks. Live acceptance remains partial until prepared casting is tested on the named fixture.


## v0.9.1 local release checks

The live calls above used matching **0.9.0** builds before the metadata-only 0.9.1 bump; they verify the retained runtime casting implementation, not deployment of 0.9.1. Prepared casting remains pending native fixture preparation. No runtime defect was found, so 0.9.1 adds the guarded acceptance harness/evidence without changing casting behavior.

Main-agent `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **327 tests passed across 37 files**, no skipped PowerShell coverage. `npm run typecheck` passed. `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases` builds production workspaces and both release ZIPs; final archive/publication results are recorded separately below. Tool contract remains 56.


Publication: [v0.9.1](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.9.1) was published as latest stable after `verify-local`, public `preflight`, draft identity/size/hash verification and `verify-published` all passed. Assets remain immutable in `dist/releases/v0.9.1/`. Prepared live casting remains pending; no existing fixture or ledger was cleared. This source milestone is pushed before starting v0.10.
