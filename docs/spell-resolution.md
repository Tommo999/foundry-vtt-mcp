# PF2e spell-resolution operator guide

This v0.11 workflow rolls a native spell attack, one target's saving throw, or base spell damage for a spell that has already been cast with `pf2e_cast_spell`. It posts native PF2e chat only. It does not spend resources, advance actions or time, apply HP, scale damage by degree of success, or apply effects.

## Preview and execute

1. Confirm the native actual-cast chat card came from a confirmed bridge cast. Keep its exact `ChatMessage` UUID and caster token. Choose one explicit target token; if the confirmed cast recorded targets, choose one of those tokens. An empty cast-target list permits an explicit target choice in this preview.
2. Call `pf2e_inspect_spell_resolution` with those three UUIDs, `action` (`attack`, `save`, or `damage`), `messageMode`, and `attackNumber` for an attack. The preview returns the exact selection, five-minute `resolutionId`, `reviewToken`, and `expectedCombat` snapshot. Its ledger read confirms that this semantic operation has not already been reserved or recorded.
3. Call the matching `pf2e_roll_spell_attack`, `pf2e_roll_spell_save`, or `pf2e_roll_spell_damage` with the same selection and exact preview values. Attack number is 1–3 for attacks; use 1 for saves and damage. Writes require GM approval by default.
4. Review the returned native chat message. If execution reports an uncertain/partial outcome, inspect chat and the GM-only `spellResolutions` audit setting before any further action.

## Token and combat requirements

Both tokens must be current documents in the same world scene and have a usable Actor. PF2e resolves an Actor-valued attack/save target through its active canvas tokens, so the requested target must be the single native active token for that Actor. Save and damage origin checks require the same unambiguous caster token. Linked duplicate tokens that prevent an exact match are refused. Off-canvas tokens are not a supported roll context.

When a valid started Combat applies to the caster's scene, the caster must be its current combatant. A valid started Combat in another scene does not govern this roll. Invalid or incomplete current combat state is rejected. The execution must match the nullable `expectedCombat` preview value.

When the bridge-confirmed cast recorded targets, the selected target must be among them. When it recorded no targets, the resolution preview requires an explicit target choice. The native cast card's spell UUID, exact cast rank, entry, actual-cast marker, caster speaker, mode, and bridge cast metadata are checked again before rolling.

## What the actions roll

- **Attack:** PF2e's native rank-specific spell attack and modifiers, with one explicit target Actor and attack number.
- **Save:** one native Fortitude, Reflex, or Will statistic selected by the spell, against the spell's current native rank-specific DC. The tool does not roll damage automatically after a save.
- **Damage:** PF2e's native damage pipeline and chat hooks. Attack spells use the reviewed target context. Non-attack spells have target-independent base damage and do not claim target-specific modifiers. Neither path applies HP or multiplies damage for critical outcomes or saves.

The selected chat visibility is preserved. No custom formula, DC, statistic, modifier, overlay, target inference, resource-spend bypass, or direct damage API is accepted.

## Duplicate and uncertain outcomes

The world-level GM-restricted `spellResolutions` setting stores a bounded durable record for each semantic operation: cast card, action, target, and attack number where applicable. It also stores the selected message mode and Actor/token identities. A reservation is written and read back before PF2e runs. Reserved, confirmed, and uncertain records block duplicate attempts across new previews and reloads. The ledger has a 5,000-record limit and never evicts history.

An uncertain native outcome is not replayed or rolled back. Do not delete audit records to bypass a duplicate block. Inspect the actual chat card and audit status, then reconcile manually. A newly generated preview does not authorize repeating a blocked operation.

This workflow is based on PF2e 8.7.0 source behavior and needs live validation with matching deployed module, companion, Foundry, and PF2e builds. See [v0.11 validation](validation-v0.11.0.md).
