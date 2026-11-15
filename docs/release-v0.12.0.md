# v0.12.0 — spell history and evidence-bound reconciliation

v0.12.0 adds bounded spell audit history and evidence-bound recovery for unresolved native PF2e casts and spell rolls. MCP discovery grows from 60 to 63 tools.

- `pf2e_inspect_spell_history` returns paginated cast/resolution records with original/effective status filters and reconciliation evidence references.
- `pf2e_inspect_spell_reconciliation` checks a single unresolved record against current native card, resource, identity, and roll evidence.
- `pf2e_reconcile_spell_audit` appends one approved reconciliation decision to a separate GM-restricted world ledger. It does not rewrite source records, replay gameplay, or refund resources.
- The Bridge window adds a bounded Spell audit panel with history refresh, details, evidence links, and reconciliation preview. Reconcile actions use existing approval and session-scoped automatic-write controls.

See the [spell history and recovery guide](spell-history-recovery.md), [v0.12 design](v0.12-spell-history-recovery-design.md), and [v0.12 validation record](validation-v0.12.0.md). Unit tests, package checks, or release publication do not establish live Foundry compatibility. Matching-build live acceptance remains pending until the module and companion versions are verified and the targeted workflows pass in Foundry.
