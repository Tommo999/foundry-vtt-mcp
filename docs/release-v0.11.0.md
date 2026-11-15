# v0.11.0 — native PF2e spell resolution

v0.11.0 adds four PF2e spell-resolution tools and brings MCP discovery to 60 tools:

- `pf2e_inspect_spell_resolution` previews an attack, save, or base-damage roll from a confirmed actual-cast card.
- `pf2e_roll_spell_attack`, `pf2e_roll_spell_save`, and `pf2e_roll_spell_damage` execute the exact reviewed native selection after GM approval.

The tools use PF2e's native statistics, rank-specific spell and chat pipeline. They require explicit caster and target tokens. Attack/save target selection must map to the requested active canvas token; applicable started combat still requires the caster's turn. Spell saves and damage are separate actions. Damage is base damage only: the tools do not scale it by a save or critical outcome and never apply HP.

A new GM-restricted `spellResolutions` world ledger durably records the operation, visibility mode, and caster/target Actor and token identities before native work. Reserved, confirmed, and uncertain operations block semantic duplicates across reloads. The ledger has a 5,000-record no-eviction limit. Inspect chat and ledger state after any uncertain result; do not retry or clear records to bypass a block.

Implementation and focused validation details are in [v0.11 validation](validation-v0.11.0.md). Matching-build live acceptance remains pending; these notes do not claim live Foundry compatibility. See the [spell-resolution operator guide](spell-resolution.md) and [installation guide](installation.md).
