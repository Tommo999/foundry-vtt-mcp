# Public hosting validation — 2026-11-09

Public hosting is live in [Tommo999/foundry-vtt-mcp-releases](https://github.com/Tommo999/foundry-vtt-mcp-releases), with [v0.8.1 published](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.8.1) as a normal release. The original development repository remains private. No source-repository history, test trees, live acceptance reports or campaign fixture identifiers were published. The Windows setup asset intentionally includes selected application sources and maintainer documentation.

## Foundry installation/update URL

```text
https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/latest/download/module.json
```

The published manifest points to the version-pinned module ZIP. Its bytes agree with the manifest inside that ZIP, and its metadata agrees with the source manifest inside the Windows setup ZIP. Source manifest templates remain repository-neutral; `release:prepare` generates distribution metadata without editing them.

An existing manual installation with no update URL needs its module files replaced once with the public release package to acquire the manifest metadata. Publishing the same version does not update a manual installation by itself. Foundry module updates do not update the companion: install the matching companion/setup version separately, preserve configuration/certificates/pairing, restart the companion and refresh the GM browser as appropriate.

## Validation

- `FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **226 tests passed across 31 files**, no skips, including loopback/TLS/MCP and portable PowerShell checks.
- `npm run typecheck`: passed.
- `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases`: passed; staged four assets under `dist/releases/v0.8.1` without replacing the original local v0.8.1 ZIPs.
- Both release ZIPs passed integrity checks. Module ZIP contains exactly module.json, module.js and module.css. Windows setup ZIP contains 51 regular files and excludes credentials, TLS keys/certificates, tests and campaign reports.
- Downloaded stable manifest, version-pinned module ZIP, Windows ZIP and checksum file with unauthenticated curl (configuration disabled). Downloaded bytes and SHA-256 hashes matched the local release assets.
- GitHub reports the distribution repository public, the release published/non-draft/non-prerelease, and the original development repository private.
- Module/tool contract and gameplay handlers were unchanged; release version remains 0.8.1. GitHub publication is complete; no running Foundry module/companion deployment or world mutation was performed.

See [structured evidence](public-hosting-validation-2026-11-09.json) for URLs and hashes. The [earlier v0.8.1 live retest](live-retest-v0.8.1-2026-11-07.md) remains pending; public accessibility and automated tests do not establish live compatibility. Windows validation here ran on Linux, not a real Windows installation.

## Future releases

Follow [Public releases](public-releases.md). Update all version locations together, run checks, prepare assets for this repository, and publish a new matching vVERSION tag with the four assets. Do not overwrite an existing published release. A code push alone does not publish a Foundry update. The preparation command is local-only; publishing is a separate authenticated action.
