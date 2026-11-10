# v0.10.0 — verified updates and version guidance

This source milestone keeps the MCP contract at 56 tools and adds an explicit CLI update flow.

- `foundry-mcp upgrade` checks the official public latest stable release.
- `foundry-mcp upgrade --stage <new-directory>` downloads the four allowlisted release assets and validates the stable tag, manifest, checksums and ZIP contents before printing manual installation guidance.
- `get_status`, CLI `status`, and the Windows `check-status.ps1` show component versions and ordered recovery steps when versions mismatch or a legacy component cannot report its version.
- The paired bridge reports the running companion package version for the current socket session. Disconnect clears that cached value.

The updater does not extract or execute downloaded files, replace installed files, modify companion configuration, rotate TLS/pairing credentials, or restart services. MCP stdio remains JSON-RPC only; use the separate `upgrade` command for update checks.

Validation: 338 tests across 39 files passed with mandatory PowerShell coverage, plus type checking and production/release packaging. See [validation](validation-v0.10.0.md) for hosted/public checks and live limitations. Foundry updates the module; the local companion still needs the guided separate update/restart.
