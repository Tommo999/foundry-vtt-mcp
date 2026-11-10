# v0.10.0 validation

Local source implementation reviewed with no remaining blocker in the inspected updater/pairing/archive paths. Contract remains **56 tools**. Version metadata/internal dependencies are aligned at 0.10.0.

Changes: shared structured upgrade guidance; daemon paired message with captured running version; current-socket/legacy pairing validation and Foundry version panel; separate CLI `upgrade` and `upgrade --stage <new-directory>`; official bounded anonymous release downloads, SHA256 and ZIP/manifest verification, exclusive staging with no installation/execution/config changes; Windows verifier using bundled tar.exe rather than a new unzip dependency; Windows packaging allowlist and hosted verifier coverage; upgrade instructions and focused regressions.

Main checks:

- `FOUNDRY_MCP_REQUIRE_POWERSHELL=1 FOUNDRY_MCP_PWSH_PATH=/tmp/foundry-mcp-powershell/pwsh npm test`: **338 tests passed across 39 files**, no skips.
- `npm run typecheck`: passed.
- `npm run release:prepare -- --repository Tommo999/foundry-vtt-mcp-releases`: passed; builds all production packages and both immutable ZIPs in `dist/releases/v0.10.0/`.
- `node packages/companion/dist/cli.js upgrade`: passed against the actual public latest v0.9.1; correctly identified local 0.10.0 as newer. It made no installation/config/world changes. Staging an older version is rejected.
- `git diff --check`: passed.

Source-shaped regressions cover legacy/missing and malformed version fields, stale pairing sockets, mismatches/unknown diagnostics, untrusted redirect hosts, streamed size limits, existing staging/config preservation, exact staged files, corrupted hashes/invalid metadata/bundle failure and downgrade refusal. Release-verifier tests retain corrupted/traversal/duplicate archive checks and are now included in actual Windows CI.

Hosted Windows CI, public publication and post-publication real staging are recorded below when complete. Matching module/daemon/browser live acceptance remains pending deployment; this updater task did not modify a live world or restart the companion. No config, certificate, pairing or audit record was reset.


Hosted CI for initial commit `42606be` passed Node validation and rejected one Windows assertion solely because the native corrupt-archive error prefix differed. CRC/traversal/duplicate/native PowerShell checks passed. Normalized the existing verifier error wording, added a 4097-entry rejection regression and bounded subprocess timeouts; no archive checks were relaxed. Focused archive suite: 22 tests passed. The earlier unpublished v0.10.0 candidate was preserved under `/tmp` and regenerated from the final helper source before publication.


## Final hosted and public acceptance

Final local full suite after the bounds regression: **339 tests passed across 39 files** with mandatory PowerShell coverage. [Hosted CI for final source `6609454`](https://github.com/Tommo999/foundry-vtt-mcp/actions/runs/42752930777) passed both Node tests/typecheck/build and actual Windows PowerShell/archive verifier jobs. The earlier failed run remains preserved as diagnosis evidence.

Published [v0.10.0](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.10.0) as latest stable after local ZIP/checksum verification, public preflight and exact draft-asset byte/hash verification. `verify-published` passed for all four anonymous downloads. Earlier releases were not overwritten.

Real `node packages/companion/dist/cli.js upgrade --stage <new temporary directory>` succeeded against the published **v0.10.0**. It staged exactly `module.json`, both ZIPs and `SHA256SUMS.txt`, verified manifest/ZIP/checksum agreement, and printed ordered manual update/restart/reconnect steps. No files were installed/executed and no configuration, certificates, pairing, running service or world was modified. Full Windows guided installation and deployed v0.10 version-panel behavior remain distinct live gates; actual Windows archive verification is passed.
