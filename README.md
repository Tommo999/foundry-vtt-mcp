# Foundry VTT MCP

A system-agnostic Foundry VTT module and local MCP companion for campaign preparation. The module uses Foundry's document APIs; it does not connect directly to the database or require changes to your Foundry Docker container.

The companion runs on the computer where you use your GM browser and local AI agent. Keep that browser open while connected. Version 0.8 adds a two-step PF2e damage workflow: inspect a native chat damage roll for an explicit scene token, then apply that same reviewed roll after approval. Writes require GM approval by default; the GM can enable automatic writes for the current browser session.

See [Installation](docs/installation.md), the [Windows quick setup](docs/windows-setup.md), [Security](docs/security.md), the [Acceptance checklist](docs/acceptance-checklist.md), and the [tool reference](docs/tool-reference.md). Foundry v14 is the declared minimum. Version 0.8.1 repairs filtered compendium searches, encounter active-state reporting, and native PF2e ammunition inventory handling. The v0.8.1 live acceptance retest is pending; these fixes are not verified until the updated module and companion are loaded in Foundry and the targeted live checks pass.

For a Windows PC, download and extract the [Windows setup bundle](dist/foundry-vtt-windows-setup.zip), then double-click `setup-windows.cmd`.
