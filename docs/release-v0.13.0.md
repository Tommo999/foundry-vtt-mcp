# Foundry VTT MCP v0.13.0 — reviewed spell effects and durations

The matching-build live acceptance gate is pending.

## Changes

- Add `pf2e_inspect_spell_effect`, `pf2e_apply_spell_effect` and `pf2e_inspect_spell_durations`, bringing MCP discovery to 66 tools.
- Allow the GM to select an exact PF2e compendium effect or supported condition/value for an explicit target of a confirmed cast. The bridge does not infer spell effects from rules text or degree of success.
- Apply effects and conditions through PF2e's native APIs, retaining native duration, start, grant and condition-provenance behavior.
- Add a restricted no-eviction spell-effect outcome ledger with semantic duplicate protection and evidence-bound recovery. Reconciliation preserves the original record and does not reopen the application key.
- Add a bounded Bridge duration and advisory sustain view with explicit Actor/token selection. The view does not change time, effects or actions.

## Operator limits

Application does not spend spell resources again, roll, apply HP, lower/remove conditions, extend duration, advance time, or perform a sustain action. Native hooks can create additional documents. Returned native results and bounded target-owned documents observed after application are reported as observations; concurrent clients/native hooks mean an item difference is not exclusive proof of causation. Uncertain outcomes are not retried or rolled back.

Review [spell effects guide](spell-effects.md), [spell history and recovery guide](spell-history-recovery.md), and [installation](installation.md). See [validation](validation-v0.13.0.md) for local checks and pending live acceptance.
