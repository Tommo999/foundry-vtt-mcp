# Foundry VTT MCP

A system-agnostic Foundry VTT module and local MCP companion for campaign preparation. The module uses Foundry's document APIs; it does not connect directly to the database or require changes to your Foundry Docker container.

The companion runs on the computer where you use your GM browser and local AI agent. Keep that browser open while connected. Version 0.8 adds a two-step PF2e damage workflow: inspect a native chat damage roll for an explicit scene token, then apply that same reviewed roll after approval. Writes require GM approval by default; the GM can enable automatic writes for the current browser session.

Start with [agent instructions](AGENTS.md) if you are an automated coding agent, or the [contributor guide](CONTRIBUTING.md) for setup, tests and package commands. The [architecture guide](docs/architecture.md) maps the request path and source packages; the [maintenance guide](docs/maintenance.md) records safety invariants, tool-change steps and cleanup candidates. For operating the bridge, see [Installation](docs/installation.md), the [Windows quick setup](docs/windows-setup.md), [Security](docs/security.md), the [Acceptance checklist](docs/acceptance-checklist.md), and the [tool reference](docs/tool-reference.md).

Maintainers preparing anonymous Foundry update assets should see [Public releases](docs/public-releases.md).

See the [roadmap through v0.15](docs/roadmap.md) for release scope, campaign/session examples, dependencies, and acceptance gates.

The published v0.13.0 release contains 66 MCP tools, including GM-selected native spell effects, condition outcomes and duration inspection. Its public assets are anonymously verified; matching-build live acceptance remains pending. See the [v0.13.0 release](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.13.0), the [roadmap](docs/roadmap.md), [release notes](docs/release-v0.13.0.md), and the [spell effects guide](docs/spell-effects.md). The [spell history and recovery guide](docs/spell-history-recovery.md) covers the v0.12 history tools, and [installation guidance](docs/installation.md) covers upgrades.

Foundry v14 is the declared minimum. Version 0.8.1 repairs filtered compendium searches, encounter active-state reporting, and native PF2e ammunition inventory handling. The targeted live retest passed on 2026-11-09 using Foundry 14.363 / PF2e 8.7.0, including fresh encounter start and turn advancement. See the [live retest report](docs/live-retest-v0.8.1-2026-11-09.md) for evidence, limits and test-fixture cleanup; this does not establish compatibility across other versions.

For a Windows PC, download and extract the [Windows setup bundle](dist/foundry-vtt-windows-setup.zip), then double-click `setup-windows.cmd`.
