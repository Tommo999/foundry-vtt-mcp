# PF2e spell effects and duration guide

Version 0.13.0 adds read-only spell-effect previews, one approved native application tool, and explicit target duration inspection. The operator chooses the compendium effect or supported condition/value. The bridge does not infer a spell's effects from its name, description, chat text, degree of success, or rules.

## Preview and apply

1. Confirm that the cast appears in spell history with a confirmed native actual-cast card.
2. Call `pf2e_inspect_spell_effect` with that exact card, caster token, explicit same-scene target token, and one choice: an installed PF2e compendium effect UUID, or a native condition slug with its exact value. The preview checks target Actor, selected source, duplicate key and (when applicable) the caster's current combat turn.
3. Review the exact selected source/condition and expected native operation. The preview is the GM's choice; it is not a rule-based spell mapping.
4. Call `pf2e_apply_spell_effect` with the exact previewed selection, `applicationId`, `reviewToken`, and `expectedCombat`. This uses the existing Bridge/MCP GM approval path. Session automatic writes behave as configured for other MCP writes.

Effect creation uses PF2e's native compendium conversion and Actor Item creation. Native rules, duration, start time, origin context and grant hooks remain authoritative. Native grants can create more Actor-owned Items. The result reports native returned documents and bounded documents observed on the target Actor; an observed Item delta does not prove that this bridge call caused every change, since other clients and native hooks may act concurrently. No rollback or automatic retry is attempted.

Condition choices use PF2e's native condition manager. The workflow can create an absent supported condition, raise an exact editable condition, or audit an already-satisfied no-op. It cannot lower or remove a condition, create a raw condition Item, simulate persistent damage, spend spell resources again, apply HP, or overwrite native condition provenance.

Each cast/target/effect or cast/target/condition semantic key is durable and blocks replay, including after reconciliation. Uncertain writes may have changed the Actor; inspect native state and history before taking another action. Do not make a fresh intent to bypass a reserved or uncertain key.

## History and evidence recovery

`pf2e_inspect_spell_history` includes effect applications alongside casts and rolls. Effect rows retain the original status and show any accepted effective status and evidence links. `pf2e_inspect_spell_reconciliation` accepts `kind: "effect"` and the application ID. A positive recovery requires the current exact target-owned native Item, selected compendium source, cast context, application marker, fingerprint and stored outcome facts. A reserved effect can be confirmed only from its exact native application marker. Conditions preserve native provenance, so recovery requires sufficient durable condition identity and known outcome facts. Missing evidence is not proof that nothing happened.

`pf2e_reconcile_spell_audit` appends a confirmed-observed result through the normal approval queue. It leaves the original effect ledger record unchanged, does not reopen the semantic application key, and can be reviewed by a current GM in a new paired session. Evidence is rechecked against the current review session and original world/source facts before append.

## Inspect durations

`pf2e_inspect_spell_durations` requires an explicit world Actor UUID or scene Token UUID, and returns at most 50 native effect/condition rows per page. It reports native duration unit/value, remaining duration, expired state, start and initiative when available, sustained state and source/application/cast links when known. Missing values remain `null`/unknown; the native `unlimited` unit is shown as unlimited rather than converted to a guessed time. Native conditions do not receive Bridge provenance flags; a bounded audit-ledger outcome can link a condition when its record identifies the current Item. Malformed or unreadable ledger data produces a warning while native duration facts remain readable.

The Bridge duration panel requires an explicit Actor or token UUID and shows at most ten rows. A sustained label is an advisory only. Neither MCP nor the Bridge panel spends a sustain action, changes a duration, advances time, schedules reminders, or changes an effect.

Native-shaped tests do not establish live Foundry/PF2e compatibility. Validate matching module and companion builds on an isolated world before relying on this workflow. See [v0.13.0 validation](validation-v0.13.0.md) and the [settled design](v0.13-native-spell-effects-design.md).
