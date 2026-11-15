# v0.13.0 validation

The v0.13.0 release is published and anonymously verified. Matching-build live Foundry/PF2e acceptance remains pending.

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

## Published assets and verification

Source commit: `f2d7c41b24d51af3b19ffd6d47cd495c3f9dcd9c`. Hosted CI run [43729739433](https://github.com/Tommo999/foundry-vtt-mcp/actions/runs/43729739433) passed both the Linux Node tests/typecheck/build job and Windows PowerShell/setup archive job. The exact four draft assets were downloaded and matched by name, size and SHA-256 to the local candidate before publication.

The [public v0.13.0 release](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.13.0) is published and marked latest. `verify-published` passed anonymous downloads for all release assets. An independent anonymous fetch also confirmed that the stable `latest/download/module.json` bytes exactly match the local v0.13.0 manifest, its ZIP URL is pinned to `v0.13.0/foundry-vtt-mcp.zip`, the downloaded ZIP bytes match the candidate, and the public latest-release API reports stable tag `v0.13.0`.

The release files are preserved byte-for-byte in `dist/releases/v0.13.0`; no rebuild was performed after publication. Matching-build live Foundry/PF2e acceptance and live-world workflow checks remain pending. No live-world writes were performed.

| Asset | SHA-256 |
| --- | --- |
| `module.json` | `f3abbb819adddd109a78fb4519de2eac40342507fe2d7e6d4313b82c70e88087` |
| `foundry-vtt-mcp.zip` | `20f8803bc9993f8e9efa7575ae6e732956749b1c603304dd2de4bedf129c6097` |
| `foundry-vtt-windows-setup.zip` | `7bf7c455abf988a58623c3e1144378d2d3e2c838a0584320c40875b764b2c285` |
| `SHA256SUMS.txt` | `19dd6123271e0c61474d41f5e2b4c5f7883e88c65f07f46869ede1598387e24f` |

The Windows bundle includes `docs/roadmap.md`, `docs/spell-effects.md`, `docs/spell-history-recovery.md`, and `docs/release-v0.13.0.md`. It excludes validation reports and development/campaign artifacts.
