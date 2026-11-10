# v0.9.0 local release

Adds four PF2e tools (56 total): `pf2e_inspect_spellcasting`, `pf2e_inspect_resources`, `pf2e_inspect_spell_cast` and `pf2e_cast_spell`. The two-step cast workflow binds explicit caster, owned entry/spell, native rank/slot, targets, visibility, resources and applicable encounter state to an expiring session intent.

Execution requires approval by default, durably reserves the intent, invokes native consumption and posts a native actual-cast card with the explicit speaker. A separate persistent ledger blocks duplicate or unresolved Actor casts. Partial outcomes are reported without automatic retries, refunds or ledger clearing. Native hooks remain authoritative.

Ordinary prepared, flexible, spontaneous/signature, focus, cantrip and finite innate paths are supported. Alternate/amped, ritual, item/staff/wand/trick, reaction and free-action casting are outside scope. Casting does not automate attacks, saves, HP/effects, templates, actions, recovery or elapsed time.

See [upgrade instructions](installation.md), [operator guide](spellcasting.md), [validation](validation-v0.9.0.md) and the unchecked [live acceptance checklist](acceptance-checklist.md). Local packaging does not publish or deploy this release. Live compatibility remains pending matching-build deployment and isolated workflow verification. Historical v0.8.1/v0.8.2 assets remain preserved.
