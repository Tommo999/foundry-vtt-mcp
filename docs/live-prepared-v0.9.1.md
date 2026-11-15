# Live prepared spell acceptance (2026-11-10)

## Runtime

The connected world was **Glimmerkeep**, on Foundry VTT 14.363 and PF2e 8.7.0. Runtime diagnostics reported compiled and installed module 0.9.0, running companion 0.9.0, and MCP client/server 0.10.0. The client/companion mismatch was present throughout; this run is live evidence for the currently installed stack, not a matching v0.9.1 acceptance result.

## Isolated fixture and workflow

The existing acceptance scene name and prefix were verified before writing. A bounded PF2e creature search returned nine wizard-name candidates. The Dhampir Wizard from the installed Monster Core compendium was read and confirmed to contain a native prepared Arcane spellcasting entry with an unexpended rank-1 Command spell.

Using the PF2e native import workflow, one new NPC Actor was imported from that compendium entry, renamed with the acceptance prefix, and linked to one hidden token in the existing acceptance scene. Its prepared entry, spell identity and unexpended slot were verified after import. No existing campaign Actor or token was changed.

The spellcasting inspection returned Command as an available prepared option in rank 1, slot 0. A cast preview selected that exact caster, entry, spell and slot, with GM-only message mode, no target tokens, and no active combat. One cast request returned confirmed. Readback showed the prepared slot changed from unexpended to expended. The resulting ChatMessage was verified to have the imported Actor and token as speaker, the selected owned spell and casting entry as native origin, native cast rank 1, GM-only whisper visibility, and the bridge spell-cast correlation metadata. No spell target effects or HP changes were requested or applied.

An exact repeat of the same cast intent was rejected as already used. A subsequent Actor read confirmed the slot remained expended. No uncertain result was retried, no document was deleted, and no campaign or damage ledger state was changed.

## Result and limits

The prepared-spell import, inspection, preview, single native cast, slot consumption, card provenance and duplicate-intent rejection all passed on the live installed stack. The v0.9.1 matching-version acceptance remains pending because the module and running companion reported 0.9.0 while the MCP client/server reported 0.10.0. The created acceptance Actor and hidden token remain in the world for inspection; they were intentionally not removed.

The 0600 resumability/checkpoint file is `/tmp/live-prepared-v091-20261110-progress.json`. It contains fixture identifiers and must remain local; it is not committed.
