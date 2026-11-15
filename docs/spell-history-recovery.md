# PF2e spell history and recovery guide

v0.12.0 added the three spell history and reconciliation tools and a bounded read-only Spell audit section in the Foundry Bridge window. Version 0.13.0 extends history and evidence recovery to native spell-effect applications and adds duration inspection; its additional UI is described in the [spell effects guide](spell-effects.md). The UI uses the same paired GM session and approval settings as MCP requests.

Spell history shows what the bridge recorded about casts and native spell rolls. Guided reconciliation can append a verified observation to an unresolved record. It never casts or rolls again, restores resources, changes HP, deletes history, or rewrites the original outcome.

## Inspect history

Use `pf2e_inspect_spell_history` or the Bridge window's **Refresh (10)** button to page through bounded history. Filter MCP requests by Actor UUID, cast, resolution or effect kind, original status, or effective status. Each row keeps the original status visible alongside any accepted reconciliation, its decision, and the evidence message/resource/roll or native effect/condition facts. History omits session IDs, review tokens and full document sources.

An uncertain result means the bridge cannot safely conclude the whole operation completed. Inspect the returned message link, resource facts and audit status before taking another action. Do not clear audit records or generate new intents to bypass an unresolved operation.

## Preview recovery

Call `pf2e_inspect_spell_reconciliation` with the exact `kind` and `sourceId` from history. If needed, supply an explicit `candidateMessageUuid` for a current world native chat card. The bridge checks that card against the original spell, caster, target, visibility and operation metadata. A similar name or chat description is not evidence.

The preview either explains missing or contradictory evidence, or returns a short-lived `reconciliationId` and `reviewToken` for one supported decision:

- `confirmed-observed`: exact native evidence proves the recorded cast or roll occurred. Cast recovery also requires sufficient durable resource-transition evidence and consistent current native resources. A roll needs the exact evaluated native message and matching stored facts, when present.
- `refused-unchanged`: an uncertain cast durably recorded native consumption as exactly false, no chat message, and identical before/after resources. Current owned identities and resources must still match, with no conflicting actual-cast card. Missing chat alone never qualifies. This decision is unavailable for rolls.

For `kind: "effect"`, the evidence summary identifies the exact current native effect/condition, selected source/choice, expected operation and known outcome. Effect recovery requires concrete current target-owned native evidence; a reserved effect may be confirmed from its exact Bridge application marker. Condition recovery requires durable known outcome facts because native condition provenance is not modified to add Bridge flags. Reconciliation is available to a current GM in a new paired session when the original world and source evidence remain valid; the original operation session remains unchanged in history.

Old reserved casts without durable consumption evidence can remain unresolved even when current resources appear plausible. Deleted cards, resource drift, changed identities, incomplete scans and contradictory native facts cannot be overridden with a forced decision.

## Approve the append

Pass the exact unexpired `reconciliationId` and `reviewToken` to `pf2e_reconcile_spell_audit`. GM approval is required by default; existing session automatic-write authorization applies when enabled. Execution rechecks the source, current evidence and paired session before one audit append.

The original source record remains unchanged. A valid cast reconciliation can retire its Actor-wide unresolved blocker so a genuinely fresh cast can be reviewed. Original cast IDs, resolution operation keys and effect semantic application keys remain blocked permanently. Later legitimate resource spending does not invalidate an already accepted reconciliation.

If the append reports an uncertain result, inspect history first. A lost acknowledgement may still have committed the reconciliation. The bridge does not retry the append or replay the native action to repair uncertainty.

## Limits

The reconciliation ledger is GM-restricted, versioned, and limited to 5,000 entries without eviction. Malformed or unreadable data fails closed. Reconciliation is a recorded observation at approval time, not a transaction guarantee or a replacement for PF2e's native rules and hooks.

Focused v0.12 checks are recorded in the [v0.12 validation record](validation-v0.12.0.md); v0.13 checks are in [v0.13 validation](validation-v0.13.0.md). Matching-build live acceptance remains a separate gate until the updated module and companion versions are verified in Foundry and the targeted history/reconciliation workflows pass.
