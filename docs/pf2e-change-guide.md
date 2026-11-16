# Start here: PF2e changes

Use this guide to find the PF2e adapter and focused tests for a change. Keep system-specific rules in PF2e handlers; the shared contract and generic Foundry operations remain system agnostic.

## First files to inspect

- Start with `packages/shared/src/index.ts` if tool inputs or read/write classification change.
- Follow the relevant dispatch branch in `packages/module/src/main.ts` to its handler in `packages/module/src/pf2e-*.ts`.
- For target resolution and system checks, inspect `packages/module/src/pf2e-target.ts` and `packages/module/src/pf2e.ts`.
- For spells, use the subsystem map in [architecture](architecture.md#package-map) and the matching operator guide: [casting](spellcasting.md), [resolution](spell-resolution.md), [effects](spell-effects.md), or [history and recovery](spell-history-recovery.md).

Search a specific tool and its likely tests from the repository root:

```sh
rg -n 'TOOL_NAME' packages/shared/src/index.ts packages/companion/src/cli.ts packages/module/src
rg -l 'TOOL_NAME|relevant behavior' packages/module/tests
```

## Focused checks

Run the smallest relevant test file first, for example:

```sh
npx vitest run packages/module/tests/pf2e-read.test.ts
npx vitest run packages/module/tests/pf2e-inventory.test.ts
npx vitest run packages/module/tests/pf2e-spell-cast.test.ts packages/module/tests/pf2e-spell-ledger.test.ts
```

Use the subsystem-to-test table in the [maintenance guide](maintenance.md#behavior-owner-and-tests) to find other focused suites. Run typecheck and broader checks required by the change.

## Safety and acceptance

Read the repository [AGENTS.md](../AGENTS.md) and [security guide](security.md) before changing authorization, native mutations, ammunition use, review fingerprints, or persistent outcome ledgers. Preserve native Foundry/PF2e validation and report uncertain outcomes without retrying writes. Fixture tests do not establish live compatibility; see the [acceptance checklist](acceptance-checklist.md) and the current [v0.13.0 validation record](validation-v0.13.0.md).
