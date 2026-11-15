# v0.11.0 validation record

## Implemented checks

- Four spell-resolution tool schemas, descriptions, annotations and module dispatch paths are wired; expected discovery count is **60**.
- Resolution preview and execution use explicit confirmed cast-card/caster/target selection, native PF2e roll APIs and a durable GM-restricted resolution ledger.
- Focused regression coverage exercises all three native roll paths, confirmed-card provenance, source/identity/session/expiry changes before chat creation, configured roll class changes, duplicate/full/malformed ledger states, and one-terminal-write audit uncertainty.
- The new operator workflow and supported limits are documented in [spell-resolution.md](spell-resolution.md).

## Local commands

The final focused module/integration run passed **81 tests across six files**. The local MCP stdio discovery run passed **3 tests in one file**, including the exact 60-tool list, descriptions and read/write annotations. Together those focused runs passed **84 tests across seven files**. Type checking and all three production workspace builds passed. The main agent owns full-suite and release-package validation.

Focused spell-resolution command:

```sh
npx vitest run packages/module/tests/pf2e-spell-resolution-ledger.test.ts packages/module/tests/pf2e-spell-resolution.test.ts packages/module/tests/pf2e-spell-ledger.test.ts tests/shared.test.ts --reporter=dot
```

The final module/integration command was:

```sh
npx vitest run packages/module/tests/v06-integration.test.ts packages/module/tests/pf2e-spell-resolution-ledger.test.ts packages/module/tests/pf2e-spell-resolution.test.ts packages/module/tests/pf2e-spell-ledger.test.ts tests/shared.test.ts packages/module/tests/companion-pairing.test.ts --reporter=dot
```

The stdio integration command was `npx vitest run tests/stdio.integration.test.ts --reporter=dot`; it requires permission to bind an ephemeral loopback listener. Package build command: `npm run build`.

Type checking:

```sh
npm run typecheck -- --pretty false
```

## Acceptance limits

The focused tests and Foundry mocks do not establish live compatibility. Full-suite results, final package archive verification, hosted release checks, immutable v0.11.0 release assets and matching-build Foundry/PF2e live acceptance must be recorded separately. Live acceptance is **pending** until v0.11.0 module and companion builds are deployed and their versions are confirmed in Foundry. No live world writes are claimed by this validation record.


## Main-agent final local acceptance

- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-pwsh-p_cceqeh/runtime/pwsh npm test`: **375 tests passed across 41 files**, with no skipped mandatory PowerShell coverage.
- `npm run typecheck`: passed; `git diff --check`: passed.
- `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases`: passed, building all production packages and both release ZIPs at 0.11.0. The initial unpublished candidate was preserved under a temporary archive and regenerated after removing the development validation report from the curated Windows bundle; operator guide and release notes remain bundled.
- Focused stdio discovery verified **60 tools**, the four names/descriptions, read-only preview and three approved non-destructive roll annotations. Module integration verifies dispatch, default approval queue, PF2e enablement and current session checks.
- Native source review checked exact PF2e 8.7.0 spell/statistic/check/damage code: actual-cast marker, rank-specific variants, contextual Actor clones, native full token UUID flags, string degrees of success and configured Dice constructor registry. Positive tests include native-shaped attack/save/base damage plus heightened explicit-target attack damage; stale state/session/expiry pre-create vetoes and single-attempt finalization with observed committed status are covered.
- Resolution reservations retain immutable message mode and both Actor/token identities for later history/reconciliation. Duplicate semantic operations remain blocked across fresh intents and reloads; records are never evicted. Source cast and damage ledger semantics are preserved.

Live status check `node packages/companion/dist/cli.js status` returned **ECONNREFUSED on 127.0.0.1:31415**. Module/manifest/running daemon are unverified; the local CLI/server report 0.11.0. Matching-build live attack/save/damage acceptance is therefore pending reconnection and authorized matching deployment. No new v0.11 live world writes, resource spending, HP changes or audit clearing occurred. Earlier isolated prepared-cast evidence is recorded separately and is not a v0.11 live test.

## Requirement audit

Implemented: four tools, strict source-card/owned entry/spell/rank/context binding; explicit native targets and applicable current combat; expiring session reviews and post-await synchronous guards; native APIs/hooks without global targeting or owned-method mutation; durable reservations/readback/semantic duplicates; one terminal write and honest observed audit status; separate reviewed HP workflow; metadata/docs/discovery/approval integration and source-shaped regressions. Native mixed healing/damage, selected alternate workflows, inferred save/critical scaling, automatic effects/actions/templates and arbitrary formulas remain outside this release's explicit contract. Hosted CI, public archive verification and publication results are appended when complete; no live compatibility claim is inferred from local tests.


## Hosted and public release acceptance

Source [commit e1d8345](https://github.com/Tommo999/foundry-vtt-mcp/commit/e1d8345) was pushed before the next milestone. [Hosted CI](https://github.com/Tommo999/foundry-vtt-mcp/actions/runs/43669606548) passed Node tests/typecheck/build and actual Windows PowerShell/archive verification. Final `verify-local` passed; built shared tool names and tool-reference rows were exactly **60/60**, with no missing or unknown entries.

Published [v0.11.0](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.11.0) as latest stable after public preflight and exact draft identity/size/hash verification. `verify-published` passed all four anonymous downloads. Distribution remains the exact manifest, module ZIP, Windows setup ZIP and checksums; source history and test/campaign reports were not copied into the public repository. Prior versioned assets remain preserved. Matching-build live acceptance is still pending because the local companion connection was refused; publication is not deployment or live validation.
