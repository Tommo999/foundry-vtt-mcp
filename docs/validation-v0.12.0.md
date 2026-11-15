# v0.12.0 validation record

## Automated checks

- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-pwsh-p_cceqeh/runtime/pwsh npm test`: passed, **405 tests across 43 files**, including mandatory PowerShell smoke coverage.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- `npm run package`: passed; production workspaces built and the standard module ZIP was created.
- `npm run package:windows`: passed; production workspaces built and the Windows setup archive was created with **69 files**.
- `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases`: passed; created the local immutable candidate in `dist/releases/v0.12.0/`.
- `RELEASE_REPOSITORY=Tommo999/foundry-vtt-mcp-releases RELEASE_TAG=v0.12.0 RELEASE_ASSET_DIR=dist/releases/v0.12.0 node scripts/release-publication.mjs verify-local`: passed. This verifies the four-file allowlist, hashes, ZIP contents/safe paths, public URLs, versions, and embedded manifests.

The release candidate contains exactly these four assets:

| Asset | SHA-256 / verification |
| --- | --- |
| `module.json` | `76589d859e5d875a267ab0ef923e66edacba15e94d9e122ca116518b3c85872c` |
| `foundry-vtt-mcp.zip` | `f3ad7947599afed7bfef1184568ab9c395445880f33c55b929d85fa6911c0df8` |
| `foundry-vtt-windows-setup.zip` | `76382105f5a44f3e51f26e6e2c9ff8cfb30edc008ef0e1fbb933551c88d5e07d` |
| `SHA256SUMS.txt` | Contains the three hashes above; its own hash is intentionally not self-listed. |

## Acceptance status

The code and package checks are automated and mock-based. Live Foundry acceptance is pending: install matching v0.12.0 module and companion builds, confirm version diagnostics and 63-tool discovery, then exercise history pagination, preview/reconcile approval, interrupted cast recovery, and spell-resolution recovery in a test world. No live world was modified and this candidate has not been published.
