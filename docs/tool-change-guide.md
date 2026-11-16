# Find the owner of a tool

Use this guide to trace one tool from the shared contract to its implementation, tests and user documentation. `packages/shared/src/index.ts` remains the authoritative tool list and schema; this guide does not maintain a second list.

## Trace a tool by name

From the repository root, replace `TOOL_NAME` with the exact snake-case tool name:

```sh
rg -n '^  TOOL_NAME:' packages/shared/src/index.ts
rg -n 'TOOL_NAME' packages/companion/src/cli.ts
rg -n '"TOOL_NAME"' packages/module/src/main.ts packages/module/src/general-documents.ts packages/module/src/*.ts
rg -l 'TOOL_NAME' packages/module/tests packages/companion/test tests
rg -n 'TOOL_NAME' docs/tool-reference.md docs/acceptance-checklist.md
```

The first result identifies the schema. The CLI match is its MCP description and annotations. The module match shows dispatch and, usually, a handler branch; follow the called handler to its exported function and native API call. Test filename matches are candidates: open the relevant cases to confirm they exercise the behavior being changed. Documentation matches identify user-facing behavior and live acceptance steps.

If a search has no match, check whether the tool is grouped under a shared switch branch or whether its docs describe a whole tool family. Do not add a new alias or second tool registry just to make the search easier.

## Common owners

| Change area | Start with |
| --- | --- |
| Tool input, defaults, read/write or destructive classification | [`packages/shared/src/index.ts`](../packages/shared/src/index.ts) |
| MCP description and registration | [`packages/companion/src/cli.ts`](../packages/companion/src/cli.ts) |
| Approval, session checks and dispatch | [`packages/module/src/main.ts`](../packages/module/src/main.ts) |
| General document operations | [`packages/module/src/general-documents.ts`](../packages/module/src/general-documents.ts) |
| Companion transport and pairing | [`packages/companion/src/daemon.ts`](../packages/companion/src/daemon.ts), then module session handling |
| Encounter controls and snapshots | [`packages/module/src/encounters.ts`](../packages/module/src/encounters.ts), [`session-snapshot.ts`](../packages/module/src/session-snapshot.ts) |
| PF2e behavior | Start at the matching `packages/module/src/pf2e-*.ts` handler; the [architecture guide](architecture.md#package-map) maps handler families |

For a subsystem-to-focused-test map, see [Behavior, owner and tests](maintenance.md#behavior-owner-and-tests). For tool-change requirements, use the [maintenance checklist](maintenance.md#adding-or-changing-a-tool). Read the [security guide](security.md) before changing authorization, native writes, or uncertain outcomes. Fixture tests do not replace [live acceptance](acceptance-checklist.md).
