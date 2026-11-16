# Start here: transport and pairing changes

Use this guide for MCP registration, companion RPC/WebSocket behavior, pairing, reconnects, and bridge request lifecycle changes.

## First files to inspect

- `packages/shared/src/index.ts` owns tool schemas, names, classifications, and bridge message types.
- `packages/companion/src/cli.ts` registers MCP tools, describes side effects, and maps daemon failures to MCP results.
- `packages/companion/src/daemon.ts` owns loopback HTTPS/WSS, pairing, request IDs, timeouts, and pending calls.
- `packages/module/src/main.ts` owns browser session checks, approval, automatic-write state, dispatch, and disconnect behavior.
- `packages/module/src/companion-pairing.ts` validates pairing messages; `packages/module/src/bridge-context.ts` exposes current-session dependencies to handlers.

Trace a tool or message name with:

```sh
rg -n 'TOOL_OR_MESSAGE_NAME' packages/shared/src/index.ts packages/companion/src packages/module/src
rg -l 'relevant behavior' packages/companion/test packages/module/tests tests
```

## Focused checks

```sh
npx vitest run packages/companion/test/daemon.test.ts
npx vitest run packages/module/tests/companion-pairing.test.ts packages/module/tests/v08-integration.test.ts
npx vitest run tests/stdio.integration.test.ts
```

These integration tests may need local socket and subprocess access. Follow the [maintenance guide](maintenance.md#behavior-owner-and-tests) to find related suites, then run broader checks required by the change.

## Safety and acceptance

Read [AGENTS.md](../AGENTS.md), the [security guide](security.md), and the [architecture guide](architecture.md#request-path) before changing pairing, origins, TLS, session authorization, retry behavior, or write outcomes. Keep TLS and origin checks enabled; a disconnect after a write may leave its outcome unknown, so inspect Foundry instead of retrying blindly. Local tests do not establish live Foundry compatibility; current release status is in [v0.13.0 validation](validation-v0.13.0.md).
