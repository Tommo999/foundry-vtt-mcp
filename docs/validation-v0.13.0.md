# v0.13.0 candidate validation

This is a local development candidate, not a published release. Matching-build live Foundry/PF2e acceptance is pending.

## Local source checks

| Check | Result |
| --- | --- |
| Mandatory-PowerShell full suite | Passed: 45 files, 445 tests |
| Typecheck | Passed: `npm run typecheck` |
| Production build | Passed: `npm run build` |
| `git diff --check` | Passed |
| Standard package | Passed: `npm run package` |
| Windows setup bundle | Passed: `npm run package:windows` |
| Release candidate / `verify-local` | Passed for `Tommo999/foundry-vtt-mcp-releases`, tag `v0.13.0` |

Full test command:

```sh
FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-pwsh-p_cceqeh/runtime/pwsh npm test
```

The release check used `RELEASE_REPOSITORY=Tommo999/foundry-vtt-mcp-releases RELEASE_TAG=v0.13.0 RELEASE_ASSET_DIR=dist/releases/v0.13.0 node scripts/release-publication.mjs verify-local`.

## Scope and limits

Source-shaped PF2e fixtures validate native API call shapes and stale-evidence handling, but they do not establish live PF2e/Foundry compatibility. A GM must verify matching module and companion versions, effect creation and native grants, condition create/increase/no-op behavior, audit recovery, and duration inspection in an isolated live world before accepting the release.

## Candidate assets

The verified candidate is in `dist/releases/v0.13.0`. The build and packaging inputs do not embed a Git SHA; these assets were built from the reviewed working tree based on `d5f6bc04c58484710ccdbf19066ff50724ed5da1`. Record the resulting source commit after commit; preserve and verify these candidate bytes without rebuilding. Hosted CI, public publication, anonymous public download verification and live-world acceptance are pending.

| Asset | SHA-256 |
| --- | --- |
| `module.json` | `f3abbb819adddd109a78fb4519de2eac40342507fe2d7e6d4313b82c70e88087` |
| `foundry-vtt-mcp.zip` | `20f8803bc9993f8e9efa7575ae6e732956749b1c603304dd2de4bedf129c6097` |
| `foundry-vtt-windows-setup.zip` | `7bf7c455abf988a58623c3e1144378d2d3e2c838a0584320c40875b764b2c285` |
| `SHA256SUMS.txt` | `19dd6123271e0c61474d41f5e2b4c5f7883e88c65f07f46869ede1598387e24f` |

The Windows bundle includes `docs/roadmap.md`, `docs/spell-effects.md`, `docs/spell-history-recovery.md`, and `docs/release-v0.13.0.md`. It excludes validation reports and development/campaign artifacts.
