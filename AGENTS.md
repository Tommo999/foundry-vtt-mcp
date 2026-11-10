# Repository working agreements

## Scope and ownership

- Keep requirements analysis, scope decisions and implementation planning with the main agent. For a coding task, settle the plan first, then delegate implementation to the configured coder agent (GPT-6 Luna, medium reasoning) **one task at a time**. The main agent reviews and integrates each result before starting another task. Do not spawn parallel implementation agents.
- Read this file and the relevant package/docs before editing. Inspect the current working tree and preserve concurrent user or agent changes. Own only the files assigned for the current task.
- Keep the core document and encounter APIs system agnostic. System-specific behavior belongs in an adapter that calls the system's native APIs and validates the system at runtime.
- Make the smallest behavior-preserving change that closes the requested issue. Do not use a repository-wide formatter for a narrow edit; format only the files you changed.

## Runtime safety invariants

- Treat `packages/shared/src/index.ts` as the MCP contract: schemas, tool names and read/write/destructive classifications must agree with companion descriptions, module dispatch, tests and documentation.
- Keep TLS and origin checks enabled. Do not add arbitrary JavaScript or macro execution, general world deletion, permission changes, automatic retries of uncertain writes, or certificate bypasses.
- Revalidate the current GM, world, socket and authorization near every native mutation. Keep `assertWrite()` adjacent to or immediately before the native write call, following the handler's current pattern.
- Preserve approval-by-default, session-scoped automatic writes, stale-turn checks, per-combat serialization, and explicitly scoped target/item/document checks.
- Preserve damage inspection/review binding and the persistent duplicate-application ledger. A review token is a fingerprint of reviewed inputs, not a transaction guarantee; an uncertain ledger reservation blocks blind retries and requires reconciliation.
- Keep strike ammunition consumption disabled (`consumeAmmo: false`) and retain the consumable-weapon strike restriction.
- Foundry's native validation and rule hooks remain authoritative. Report partial or uncertain outcomes; never silently retry a write.

## Validation and handoff

- Add focused regression coverage for behavior changes. Run relevant focused tests, type checking and required package checks; report the exact commands and actual counts.
- Unit and integration mocks do not establish live Foundry compatibility. Identify live checks as pending until the updated module and companion are deployed, their versions are verified, and targeted workflows pass.
- Do not commit, push, publish or deploy unless the user explicitly asks. Do not modify a live world while a task only authorizes code or documentation work.
- Finish with changed files, behavior, checks run, test counts, known limits, and live acceptance status. Clearly label any validation not performed.
