# v0.8.2 validation record

Status: local milestone implementation and packaging verified. Publication and live acceptance remain pending; this is not a deployed-release claim.

## Encounter and diagnostics integration

Reviewed the new scoped encounter-ending handler, its schema/write/destructive classifications, native dispatch, shared combat lock, fresh authorization checks, removal confirmation by stable ID/UUID, and partial-outcome behavior. Reviewed compile-time module/package version capture and separate daemon/client status enrichment. The installed manifest remains distinct from loaded module code; absent legacy values remain unverified.

Commands run by the main agent on 2026-11-09 (Australia/Adelaide), before final milestone version metadata and release automation were integrated:

- `npx vitest run packages/module/tests/encounters.test.ts packages/module/tests/v06-integration.test.ts packages/companion/test/status.test.ts packages/companion/test/daemon.test.ts tests/shared.test.ts tests/stdio.integration.test.ts`: **64 tests passed across six files**.
- `npm run typecheck`: passed.
- `npm run build`: passed. Vite reported non-fatal third-party PURE-annotation placement warnings in Zod; all workspaces built.
- `FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **240 tests passed across 32 files**, including available PowerShell smoke coverage. TLS/MCP tests ran with reviewed loopback access; TLS checks were not disabled.
- Contract inspection of the built shared package: **52 tools**. The tool reference now includes all 52 table entries.
- `sha256sum -c SHA256SUMS.txt` in `dist/releases/v0.8.1`: all three preserved historical assets passed; the historical release was not regenerated.

These results establish the reviewed integration state only. Final metadata, automation, package and archive verification results must be added after those changes land.

## Release automation review

- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npx vitest run tests/release-publication.test.mjs tests/release.test.mjs tests/windows-powershell.test.mjs`: **25 tests passed across three files**, with mandatory PowerShell coverage enabled. Fixtures exercise real ZIP bytes, corrupted archives, manifest/hash disagreement, duplicate/traversal paths, tag/version rules, destination visibility, release/tag conflicts, publication ordering and remote draft hash verification. GitHub API mutation paths use injected mocks; no remote mutation was performed.
- Both workflow YAML files parsed with PyYAML's BaseLoader; reviewed structural gates verified read-only source permissions, commit-pinned actions, tag-only release triggering, publication dependency on build and Windows checks, no publishing token in the build job, and serialized publication without cancellation.
- `RELEASE_REPOSITORY=Tommo999/foundry-vtt-mcp-releases RELEASE_TAG=v0.8.1 node scripts/release-publication.mjs verify-published`: passed against the existing public release. This read-only network check downloaded all four published assets anonymously and verified checksums/ZIP/manifest agreement. It establishes the verifier's behavior on v0.8.1, not publication or hosted-workflow success for v0.8.2.
- Windows CI requires the actual `powershell.exe` availability probe to succeed; it fails rather than silently skipping installer smoke coverage. Local PowerShell coverage used the provided Linux PowerShell runtime, not Windows PowerShell 5.1. The Windows job remains unexecuted until the workflow is activated on GitHub.

## Final version-aligned integration

- Root/workspace/module/lockfile versions and exact internal dependencies agree at **0.8.2**. MCP advertised and diagnostic versions now share the captured companion package version; release validation rejects divergent version sources. Current-version tests read package/module metadata while historical fixtures retain their original versions.
- Native deletion errors are always reported as partial/uncertain once deletion has been invoked, including a native post-delete hook error labelled `STALE_TURN`. Fresh-state checks still fail before deletion.
- The independent release review's credential finding was resolved: draft asset IDs and exact GitHub API endpoints are validated before authenticated fetch, and allowed HTTPS asset redirects are followed without the publication token. Malicious-host and signed-redirect regressions pass.
- `npm ci`: passed, installing the locked dependency graph.
- `npm run typecheck`: passed after version alignment.
- `npm run package:windows`: passed; includes `npm run package`, every production build, the standard ZIP, and the 51-file Windows setup bundle. Original generic v0.8.1 ZIPs were preserved in `dist/local-archive-pre-v0.8.2/` before replacing generic output paths. Immutable `dist/releases/v0.8.1/` remains untouched.
- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **260 tests passed across 33 files**, no skipped PowerShell coverage. TLS/loopback checks used reviewed escalation; TLS was not disabled.

## Remaining gates

- GitHub-hosted CI/release execution requires authorized source push/tag and a configured destination-limited publication token. No remote workflow run or publication is claimed by this record.
- Live checks require the matching module, companion and GM browser build actually loaded. No live world mutation is authorized merely by this local implementation task. Encounter-ending tests must use isolated test Combats and preserve campaign fixtures and damage audit records.
- Read-only `node packages/companion/dist/cli.js status` confirmed the existing bridge is connected to Glimmerkeep on Foundry 14.363 / PF2e 8.7.0. The newly built local MCP client reports 0.8.2, but the running bridge supplies no module/manifest/daemon version diagnostics; those three components are correctly marked unverified. This is a concrete deployment-verification blocker, not a successful v0.8.2 live test. No live write or restart was performed.

## Versioned release assets

`npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases` passed and created the immutable local milestone directory `dist/releases/v0.8.2/` containing `module.json`, `foundry-vtt-mcp.zip`, `foundry-vtt-windows-setup.zip` and `SHA256SUMS.txt`. The module manifest is 0.8.2, its discovery URL is the public repository's stable latest endpoint, and its download is pinned to `/releases/download/v0.8.2/foundry-vtt-mcp.zip`.

- `RELEASE_REPOSITORY=Tommo999/foundry-vtt-mcp-releases RELEASE_TAG=v0.8.2 RELEASE_ASSET_DIR=dist/releases/v0.8.2 node scripts/release-publication.mjs verify-local`: passed. This checks the exact asset allowlist, tag/version/public URLs, checksums, ZIP integrity/safe entries and standalone/embedded module/Windows manifest agreement. Sandboxed Node initially returned `spawnSync unzip EPERM`; the reviewed escalation passed without weakening checks.
- `sha256sum -c SHA256SUMS.txt` in the v0.8.2 release directory: all three hashed assets passed.
- `unzip -tq foundry-vtt-mcp.zip` and `unzip -tq foundry-vtt-windows-setup.zip`: both passed.
- Built shared contract inspection: **52 tools**. The documentation table has 52 entries with no missing or unknown tool names.
- Rechecked `dist/releases/v0.8.1/SHA256SUMS.txt`: all historical assets passed after v0.8.2 packaging.

No Foundry world was modified for this milestone. No new live test artifacts require cleanup. Existing v0.8.1 fixture cleanup remains described in its historical live report. These immutable v0.8.2 artifacts retain that milestone even as the source checkout moves on to v0.9.
