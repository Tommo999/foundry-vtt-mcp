# Agent context measurement — 2026-11-16

## Scope and method

This records the evidence available after adding the tool, PF2e and transport change guides. The repository does not expose per-agent input-token or file-read telemetry, so no actual agent token savings or elapsed discovery-time improvement can be claimed.

The reproducible proxy is documentation line count. Before the change, the maintenance guide told every contributor to read AGENTS, CONTRIBUTING, relevant code/tests, architecture, security, installation, acceptance checklist and the current release/retest report. The concrete documents named there totalled 546 lines at baseline. The revised entry path is AGENTS plus one matching task guide: 58 lines for tool work (25 + 33), 58 for PF2e work (25 + 33), and 57 for transport work (25 + 32). This reduces the prescribed initial guidance by 488–489 lines, or about 89%, before task-specific source, tests and conditionally relevant safety/setup references. It is a policy/read-volume proxy, not a measured model prompt.

To compare source context, the same illustrative file sets from the maintainability review were recounted. Those volumes are unchanged by the new guides; the earlier extraction had already reduced `main.ts`.

| Representative task | Before extraction | Current source set | Difference |
| --- | ---: | ---: | ---: |
| Add a tool | 4,802 lines | 3,972 lines | −830 |
| Change spell casting | 6,894 lines | 6,106 lines | −788 |
| Fix transport | 4,603 lines | 3,773 lines | −830 |
| Change Windows bundle | 2,182 lines | 2,246 lines | +64 |

These sets count every line in selected files and overstate a focused read. They do not measure what an agent actually opens or how many lines it needs. The bundle task grew because its archive test now covers nested files, exclusions, deterministic ordering and symlinks.

## Next extraction decision

Do not split the remaining UI/session responsibilities from `main.ts` yet. The guide change measures lower prescribed documentation reading, but it supplies no evidence that UI/session code is being read unnecessarily or that another extraction would reduce task context. The current file is 1,305 lines after the general document handlers moved to `general-documents.ts`; that size alone does not justify another boundary.

For a future measurement, give agents the same representative task before and after a candidate extraction. Record the source paths and line ranges they actually inspect, elapsed discovery time, available input-token usage, and whether the change passes the same acceptance checks. Consider one UI or session extraction only if that comparison shows less unrelated context while preserving approval expiry, request deduplication, response ordering, disconnect behavior, session/world revalidation, audit UI refresh and the `__test` seam.

## How to reproduce the available proxy

- Initial guidance: count the listed files at the pre-guide checkout with `wc -l AGENTS.md CONTRIBUTING.md docs/maintenance.md docs/architecture.md docs/security.md docs/installation.md docs/acceptance-checklist.md docs/validation-v0.13.0.md`.
- Current starts: `wc -l AGENTS.md docs/tool-change-guide.md docs/pf2e-change-guide.md docs/transport-change-guide.md`.
- Source sets and their before/current values are recorded in `docs/maintainability-review-2026-11-16.md`; the before values come from the baseline inventory and the current values from the Task 8 reassessment.

## Follow-up investigation

The [Luna medium benchmark](optimization-benchmark-2026-11-16.md) records three fresh-agent discovery probes and a repeated resolution probe after internal typing improvements. It includes source-range logs, correctness checks, file hashes and limitations. The mixed results establish no token or elapsed-time improvement; further UI/session extraction remains deferred.
