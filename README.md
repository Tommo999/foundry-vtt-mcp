# Foundry VTT MCP

A system-agnostic Foundry VTT module and local MCP companion for campaign preparation. The module uses Foundry's document APIs; it does not connect directly to the database or require changes to your Foundry Docker container.

The companion runs on the computer where you use your GM browser and local AI agent. Keep that browser open while connected. Version 0.8 adds a two-step PF2e damage workflow: inspect a native chat damage roll for an explicit scene token, then apply that same reviewed roll after approval. Writes require GM approval by default; the GM can enable automatic writes for the current browser session.

Start with [agent instructions](AGENTS.md) if you are an automated coding agent, or the [contributor guide](CONTRIBUTING.md) for setup, tests and package commands. The [architecture guide](docs/architecture.md) maps the request path and source packages; the [maintenance guide](docs/maintenance.md) records safety invariants, tool-change steps and cleanup candidates. For operating the bridge, see [Installation](docs/installation.md), the [Windows quick setup](docs/windows-setup.md), [Security](docs/security.md), the [Acceptance checklist](docs/acceptance-checklist.md), and the [tool reference](docs/tool-reference.md).

Maintainers preparing anonymous Foundry update assets should see [Public releases](docs/public-releases.md).

The v0.8.2 milestone adds scoped encounter ending, running-version diagnostics, and tested tag-release automation. Its MCP contract has 52 tools. See the [release notes](docs/release-v0.8.2.md) and [validation record](docs/validation-v0.8.2.md) for local packaging and live-verification status. The published v0.9.0 release extends this to 56 tools with native PF2e spell/resource inspection, reviewed cast intents and guarded resource/card creation. See the [spellcasting guide](docs/spellcasting.md) and [v0.9 validation](docs/validation-v0.9.0.md). The v0.9.1 checkout is under live acceptance; prepared-slot casting remains pending fixture preparation. See [live validation](docs/live-validation-v0.9.1.md).

Foundry v14 is the declared minimum. Version 0.8.1 repairs filtered compendium searches, encounter active-state reporting, and native PF2e ammunition inventory handling. The targeted live retest passed on 2026-11-09 using Foundry 14.363 / PF2e 8.7.0, including fresh encounter start and turn advancement. See the [live retest report](docs/live-retest-v0.8.1-2026-11-09.md) for evidence, limits and test-fixture cleanup; this does not establish compatibility across other versions.

For a Windows PC, download and extract the [Windows setup bundle](dist/foundry-vtt-windows-setup.zip), then double-click `setup-windows.cmd`.
