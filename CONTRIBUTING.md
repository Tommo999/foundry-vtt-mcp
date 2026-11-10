# Contributing

This repository contains the Foundry module, shared MCP contracts, local companion, and Windows setup bundle. You can work on schemas, handlers and tests without a Foundry world, companion configuration, pairing token or certificates. Live acceptance tasks are separate and require an explicitly available Foundry GM browser and world.

## Requirements and setup

- Node.js 22.12 or later.
- npm (use the version bundled with the selected Node.js installation).
- From the repository root, install the locked workspace dependencies:

```sh
npm ci
```

Run all commands from the checkout root unless a command says otherwise. The packages use npm workspaces; install dependencies at the root rather than independently in each package.

## Tests and checks

Run one or more focused tests directly with Vitest:

```sh
npx vitest run packages/module/tests/pf2e-read.test.ts
npx vitest run packages/module/tests/encounters.test.ts packages/module/tests/v06-integration.test.ts
npx vitest run packages/companion/test/daemon.test.ts
```

The companion test directory is `packages/companion/test` (singular); module tests are under `packages/module/tests`. Root-level tests cover cross-package behavior and Windows PowerShell setup checks.

Run the complete suite and static type check with:

```sh
npm test
npm run typecheck
```

The root `npm test` lifecycle runs `pretest` first, which builds the companion, then runs the full Vitest suite. Some companion tests open loopback TLS/WebSocket listeners and launch subprocesses. If the environment blocks those operations, report the actual failure and use the approved execution environment. Keep TLS checks enabled and do not convert restricted tests into skips to obtain a passing count.

The Windows setup test can use an installed PowerShell executable on Linux or macOS:

```sh
FOUNDRY_MCP_PWSH_PATH=/path/to/pwsh npm test
```

This validates the installer's supported PowerShell syntax and tested setup helpers in the available runtime. A Linux run does not verify Windows installation, Windows PowerShell 5.1 behavior in every environment, ACL changes, shortcuts or Windows-only path semantics. Use a real Windows host for those checks.

## Build and packaging

Choose the command for the artifact you need; these commands are alternatives, not a sequence:

```sh
# Build all workspaces for local validation (no archive)
npm run build

# Build and create the Foundry module ZIP
npm run package

# Build/package the module, then create the Windows setup bundle
npm run package:windows
```

`npm run build` builds shared, module and companion workspaces. `npm run package` also builds the workspaces and creates `dist/foundry-vtt-mcp.zip`. `npm run package:windows` includes that standard package step, then creates `dist/foundry-vtt-windows-setup.zip`; run it once when you need the Windows artifact. On Unix, both archive commands require `zip`. On Windows they use PowerShell's `Compress-Archive`. Inspect the manifest/version and archive contents when release work requires it.

Build output under package `dist/` directories and root `dist/` archives is generated. Edit source files and rebuild; never hand-edit generated output.

The Windows setup archive is a curated installation bundle, not a complete developer checkout. It includes these maintainer guides, selected source and installation documentation, but excludes test trees and historical campaign reports. Links to tests and historical or live evidence require a full repository checkout. Do not broaden the Windows archive to include campaign fixture IDs or historical reports.

## Formatting and review

Format only the files in your change:

```sh
npx prettier --write path/to/changed-file.ts path/to/changed-file.md
```

The `npm run format` script formats broad source, test, script and JSON globs. Avoid it for focused changes because it can rewrite unrelated files.

Before handing off, inspect the complete diff and verify:

- The change stays within the agreed scope and preserves unrelated edits.
- Tests exercise the failure mode and relevant boundaries, not just a prebuilt success result.
- Tool schemas, classifications, dispatch, descriptions and docs agree if a tool changes.
- Generated artifacts were rebuilt instead of edited by hand.
- You have not exposed tokens, certificates, config files, local paths or campaign data.

Use this handoff format:

```text
Changed files:
Behavior changed:
Focused tests: <command and result>
Full checks: <command and result, or not run>
Packaging/artifacts: <result, or not run>
Known limits:
Live acceptance: <passed with environment/version, pending with blocker, or not applicable>
```

## Current validation record

As last recorded on 2026-11-07, release 0.8.1 has 51 tools and passed 219 tests across 30 files, type checking, and standard/Windows archive checks. The v0.8.1 targeted live retest remains pending because the updated module and companion were not verified in the Foundry GM browser. These are recorded results, not a fresh check of your current checkout; see the [live retest report](docs/live-retest-v0.8.1-2026-11-07.md).
