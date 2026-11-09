# MCP tool reference

The companion publishes these system-agnostic tools through MCP. Inputs are validated, reads are paginated where applicable, and responses contain structured JSON. Actor and item types are discovered from the active system; their data can be read or supplied to Foundry's own document validation, but the tools do not interpret game mechanics.

The PF2e tools are also listed for MCP clients in every game system. They require the PF2e system and report a clear unavailable status elsewhere. System-specific data and rules are handled by the PF2e adapter; the general document and encounter-preparation tools remain system agnostic.

| Tool                              | Purpose                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pf2e_roll_check`                 | Roll a PF2e Perception, skill or saving throw using the prepared statistic and native modifiers; posts a Foundry chat roll. |
| `pf2e_inspect_actions`            | Inspect bounded PF2e action, strike and check information without executing it.                                             |
| `pf2e_roll_initiative`            | Roll initiative for selected combatants using their configured PF2e initiative statistic.                                   |
| `start_encounter`                 | Activate and start an encounter after all combatants have initiative.                                                       |
| `next_turn`                       | Advance one turn if the supplied expected round, turn and combatant still match.                                            |
| `search_content`                  | Search world Actors, Items, JournalEntries and Scenes by name and text content.                                             |
| `list_folders`                    | List world folders, optionally filtered by document type.                                                                   |
| `create_folder`                   | Create a typed folder, optionally nested under a parent folder.                                                             |
| `move_document`                   | Move a supported world document into a folder or to the root.                                                               |
| `browse_assets`                   | Browse image assets under a safe relative directory in Foundry's Data storage, with path filtering and pagination.          |
| `upload_asset`                    | Upload a supported image to the module asset folder using base64 data or a local path on the companion computer.            |
| `inspect_scene`                   | Return a bounded summary of scene dimensions, grid, tokens, walls, lights, levels and notes.                                |
| `add_map_note`                    | Add a journal-linked note at scene coordinates, optionally targeting a journal page.                                        |
| `get_status`                      | Report whether a GM browser is connected and identify its current world, Foundry version and game system.                   |
| `list_encounters`                 | List bounded combat preparation records, optionally filtered by scene.                                                      |
| `inspect_encounter`               | Read a combat preparation record and its combatants with pagination.                                                        |
| `create_encounter`                | Create an inactive, unstarted combat record for a selected scene.                                                           |
| `add_combatants`                  | Add selected scene token UUIDs to an unstarted preparation record; duplicates are skipped.                                  |
| `remove_combatants`               | Remove explicitly selected combatant UUIDs from an unstarted preparation record.                                            |
| `session_snapshot`                | Return bounded, factual party, scene, encounter and journal data for an agent to summarize.                                 |
| `discover_types`                  | List supported document types, or inspect the active system's Actor and Item subtypes and schema fields.                    |
| `search_world`                    | Find world Actors, Items, JournalEntries or Scenes by name with offset and limit pagination.                                |
| `list_compendiums`                | List available compendium packs with pagination.                                                                            |
| `search_compendium`               | Search a pack's index by name and return matching entries with pagination and their compendium UUIDs.                       |
| `get_document`                    | Read a document by its Foundry UUID, including compendium UUIDs.                                                            |
| `create_document`                 | Create a world Actor, Item, JournalEntry or Scene.                                                                          |
| `update_document`                 | Update a supported world document or embedded page by UUID.                                                                 |
| `create_embedded`                 | Create a JournalEntryPage in a JournalEntry, an Item in an Actor, or a Token in a Scene.                                    |
| `import_compendium`               | Import a supported compendium Actor, Item, JournalEntry or Scene into the world from its UUID.                              |
| `pf2e_status`                     | Report whether the PF2e adapter is available and its detected capabilities.                                                 |
| `pf2e_search_compendium`          | Search PF2e creature, hazard and equipment packs by text and supported type-specific filters, including hazard complexity and native ammunition. |
| `pf2e_party_summary`              | Summarize PF2e party members for encounter planning.                                                                        |
| `pf2e_import_document`            | Import one native PF2e compendium document, optionally applying the system's elite or weak adjustment.                      |
| `pf2e_analyze_encounter`          | Calculate PF2e encounter XP and difficulty for a supplied participant list and party. It does not award XP.                 |
| `pf2e_stage_encounter`            | Prepare hidden scene tokens for an encounter; it does not create or start combat.                                           |
| `pf2e_inspect_conditions`         | Inspect a PF2e Actor's current conditions and values.                                                                       |
| `pf2e_inspect_damage_application` | Inspect a selected native chat damage roll for an explicit PF2e scene token and return a review token.                      |
| `pf2e_apply_damage`               | Apply that inspected roll to the same target with the same options after GM approval.                                       |
| `pf2e_set_condition`              | Set one condition to an exact value, or apply an unvalued condition.                                                        |
| `pf2e_adjust_condition`           | Increase, decrease or remove one identified condition.                                                                      |
| `pf2e_apply_effect`               | Apply a PF2e compendium effect using its native duration and grant rules.                                                   |
| `pf2e_remove_effect`              | Remove one identified PF2e effect.                                                                                          |
| `pf2e_inventory`                  | Inspect an Actor's physical inventory, including native ammunition, and coin denominations.                                |
| `pf2e_add_inventory_item`         | Add a PF2e compendium physical item, including ammunition, with a positive quantity.                                         |
| `pf2e_set_item_quantity`          | Set an existing inventory item's quantity.                                                                                  |
| `pf2e_transfer_item`              | Transfer an inventory item and quantity between Actors.                                                                     |
| `pf2e_add_coins`                  | Add positive coin amounts by denomination to an Actor.                                                                      |
| `pf2e_create_loot`                | Create a PF2e loot Actor with supported items and coins.                                                                    |

## Example: create a journal and page

First create the world JournalEntry:

```json
{
  "documentType": "JournalEntry",
  "data": { "name": "The Sunken Archive" }
}
```

Use the returned JournalEntry UUID as `parentUuid` to add a page:

```json
{
  "parentUuid": "JournalEntry.abc123",
  "documentType": "JournalEntryPage",
  "data": {
    "name": "First Clues",
    "type": "text",
    "text": {
      "content": "<p>A salt-stained ledger names the missing curator.</p>"
    }
  }
}
```

To change that page later, call `update_document` with the page's own UUID:

```json
{
  "uuid": "JournalEntry.abc123.JournalEntryPage.def456",
  "data": { "text.content": "<p>The ledger also contains a coded route.</p>" }
}
```

## Importing from a compendium

Search a pack (using its collection identifier from `list_compendiums`), then pass a matching entry's UUID to `import_compendium`, for example `Compendium.world.adventure.Actor.abc123`. The import creates a world copy and leaves the source entry untouched. It preserves supported preparation fields; flags, effects, walls, lights and unsupported scene elements may be omitted, so inspect the imported result before use. In PF2e worlds, prefer `pf2e_import_document` for PF2e actors and items because it uses native system imports and preserves embedded mechanics; the generic import is intentionally a system-neutral projection.

## Search, organize and annotate

Use `search_content` with a phrase such as `"the missing curator"` to find matching world documents and short text snippets. Use `list_folders` to find a folder UUID, then `create_folder` for a new typed folder or `move_document` to organize an existing document. Set `folderUuid` to `null` to move it back to the root. Folder types must match the documents they contain; nested folders must have the same type as their parent.

Use `inspect_scene` before placing a map note so the agent can use the scene bounds and existing note locations. `add_map_note` requires a scene UUID, a world JournalEntry UUID, and finite `x`/`y` coordinates; optionally provide a page UUID, label, and icon. Scene summaries are bounded to 100 entries per embedded collection.

## Browse and upload assets

`browse_assets` accepts a safe relative directory anywhere under Foundry's Data storage; absolute paths and traversal segments are rejected. It lists PNG, JPEG, WebP, GIF and AVIF images. `upload_asset` accepts exactly one source: base64 image data up to 8 MiB, or `localPath` on the computer running the companion. Allowed formats are PNG, JPEG, WebP, GIF and AVIF; SVG is rejected. Uploads use a generated unique filename and do not overwrite existing files. The GM can set the upload destination root in Foundry's MCP asset upload root setting; the default is `assets/foundry-mcp`. Approval details show the destination directory, file name, format and size, not the base64 payload. The local path must be readable by the companion process; use base64 data when the file is on a different computer. The resulting path is relative to Foundry's Data directory.

## PF2e encounter preparation

1. Call `pf2e_status` and confirm PF2e is available. Use `pf2e_search_compendium` to find creatures or hazards by level, traits, rarity, size or text. Hazard searches can filter simple or complex hazards. Equipment searches also support item type and price filters.
2. Call `pf2e_party_summary` with a party UUID when you want a specific party. It summarizes party members, including NPCs. Use member levels and XP thresholds to plan. Encounter XP uses one party level and size; mixed-level parties must provide both explicit `partyLevel` and `partySize` overrides because the native calculator cannot calculate from individual levels.
3. Call `pf2e_analyze_encounter` with participants and either a party UUID or both `partyLevel` and `partySize`. Each participant can have a quantity and normal, elite or weak adjustment. `normal` leaves the creature unadjusted; elite and weak apply only to NPC Actors, and hazards reject those adjustments. Party analysis uses characters and reports NPC exclusions. The tool uses PF2e's native XP calculation and world Proficiency without Level setting; if the setting cannot be read, analysis returns an error instead of assuming a variant. It never awards XP.
4. Use `pf2e_import_document` when you want a native PF2e copy in the world. It uses Foundry/PF2e import APIs and preserves supported source fields and links; it is not a promise of a byte-for-byte copy or retention of every custom flag. Check the imported document's ownership in the destination world; source compendium ownership is not a guarantee of the resulting world permissions.
5. Call `pf2e_stage_encounter` with a scene and placements to create hidden tokens for GM review. Tokens are hidden by default; set `hidden: false` only when you want a visible token. World actors requested with an elite/weak adjustment are cloned before adjustment, so staging does not change the source actor. It creates no combat and starts no encounter. The operation is not atomic: on failure, inspect its partial result for created UUIDs and the failed placement, then reconcile those documents manually before retrying. The tools do not automatically roll back or retry partial writes.

Elite and weak adjustments use PF2e's native actor adjustment behavior rather than hard-coded formulas. Encounter analysis uses PF2e's native XP calculator and does not assume an already active encounter. These tools require a GM in a PF2e world. Their API compatibility has not yet been verified against a live PF2e installation.

## PF2e conditions, effects and inventory

`pf2e_inspect_conditions` reads native condition documents and values for a PF2e Actor. Condition writes remain granular: `pf2e_set_condition` uses the system condition slug and sets an exact value (or uses no value for an unvalued condition), while `pf2e_adjust_condition` changes a selected condition by UUID using increase, decrease or remove. The system's condition grant/lock rules remain in effect. Persistent-damage rolls and automatic persistent-damage ticks are not provided; native damage application may create persistent-damage conditions.

`pf2e_apply_effect` takes a PF2e compendium effect UUID and relies on PF2e's native duration and grant behavior. `pf2e_remove_effect` removes only the selected effect UUID. Both require GM approval or session auto-write; effect and condition changes are not equivalent to a general Actor delete operation.

`pf2e_inventory` provides a read-only view of an Actor's items and coins. `pf2e_add_inventory_item` adds a compendium item with quantity 1–9999 and native stacking unless `newStack` is requested. `pf2e_set_item_quantity` sets an existing item's quantity to an exact positive value from 1–9999, increasing or decreasing it; zero is rejected. `pf2e_transfer_item` physically moves the selected quantity from a source Actor to a target Actor; it does not simulate a purchase. A full-quantity transfer can remove the item from the source Actor. `pf2e_add_coins` only adds coins, with positive integer values per denomination; it does not deduct or convert currency.

`pf2e_create_loot` creates a Loot Actor with optional compendium items and coins. It uses Foundry's normal world ownership defaults and does not change permissions. Multi-step inventory transfers and loot creation can partially succeed. If a tool returns partial UUIDs, inspect and reconcile the results manually before another attempt; the server does not promise atomic rollback or automatic retries.

## System-agnostic encounter preparation

`list_encounters` and `inspect_encounter` read combat data. `create_encounter` creates a Combat document linked to the selected scene but leaves it inactive and unstarted. `add_combatants` accepts explicit token UUIDs from that scene; it skips tokens already represented and does not create or move tokens. `remove_combatants` accepts explicit Combatant UUIDs only. Preparation writes require GM approval by default. Started combat is not writable through these preparation tools.

## PF2e checks and combat controls

`pf2e_inspect_actions` returns bounded prepared action, strike and check information for a world Actor or explicit scene token. It is a reference view; it does not execute actions, attacks, or damage. `pf2e_roll_check` accepts a statistic slug for Perception, a skill (including lore skills), or Fortitude, Reflex, or Will. It uses PF2e's prepared statistic and posts a native roll to chat. An optional DC is bounded to 0–100. `messageMode` supports `public`, `gm`, `blind` or `self` and defaults to `gm`. A root Actor UUID may use the active token selection for contextual modifiers; pass a Scene Token UUID to name the token explicitly. Checks require GM approval because they post chat and may prompt other modules.

`pf2e_roll_initiative` accepts combatant UUIDs from one unstarted encounter and uses each actor's configured statistic, including Stealth when configured. Existing finite initiative values are skipped unless `reroll` is true. The default message mode is GM-only; PF2e also keeps hidden combatant rolls GM-only. Initiative writes require GM approval. The operation reports partial or uncertain outcomes; inspect the tracker before retrying.

`start_encounter` explicitly activates and starts a prepared combat through native Foundry APIs. Every participant must have initiative, and the tool refuses to switch from another active started encounter. `next_turn` calls Foundry's native turn method once and requires `expectedRound`, `expectedTurn` and `expectedCombatantUuid` from the latest `inspect_encounter` result. If the state changed, refresh the encounter before issuing another request. Both controls require GM approval. Chat rolls, encounter start and turn advancement must not be automatically retried after an uncertain result. These controls do not cast spells or apply damage to HP.

## Session snapshots

`session_snapshot` is read-only and returns bounded facts for an agent to summarize. If `sceneUuid` is omitted, it uses Foundry's current or active scene; if `encounterUuids` is omitted or empty, it includes up to five unstarted encounters, filtered to that scene when available. Invalid explicit scene, party, encounter or journal references are reported as warnings and do not fall back to another document. Journal references are explicit only: provide up to ten JournalEntry or JournalEntryPage UUIDs. Each journal is limited to five pages, and each text page returns up to 1,000 plain-text characters after reading at most 100,000 source characters. The party summary is optional PF2e data and may be unavailable in other systems or when PF2e integration is disabled. The caller can prepare a briefing from the returned facts; the server does not generate narrative or infer facts absent from the documents.

## PF2e combat context, strikes and damage

Call `pf2e_combat_context` with an encounter UUID to inspect the active encounter, current combatant, available targets, conditions and prepared strike selectors. It never changes Foundry's selected tokens or targets. It returns the expected round, turn and combatant UUID to use with a roll. Optionally give a target token UUID to inspect that target explicitly.

Copy the selector's `index`, `slug` and `itemUuid` fields, the attacker's `tokenUuid`, the selected target token UUID, and the encounter's expected state into a roll call. For example:

```json
{
  "encounterUuid": "Combat.from-context",
  "attackerTokenUuid": "Scene.from-context.Token.attacker",
  "targetTokenUuid": "Scene.from-context.Token.target",
  "strikeIndex": 0,
  "strikeSlug": "longsword",
  "strikeItemUuid": "Actor.from-context.Item.longsword",
  "expectedRound": 1,
  "expectedTurn": 0,
  "expectedCombatantUuid": "Combat.from-context.Combatant.attacker",
  "attackNumber": 1
}
```

Replace every example identifier and state value with the values returned for the live encounter. A changed turn or strike selector is rejected; inspect combat context again to refresh them.

`pf2e_roll_strike` takes the combat context's attacker, target, strike index/slug/item UUID and expected state. Choose `attackNumber` 1, 2 or 3 to select the native MAP variant; PF2e applies agile and other adjustments. Rolls are GM-only. Foundry must still show the same active combatant and tracker state when the request runs. Only primary PC/NPC strikes are supported; reactions, off-turn rolls, alternate usages and consumable-trait strikes are not. Native PF2e and module rule hooks can run, so review the resulting chat before retrying an uncertain roll.

`pf2e_roll_damage` uses the same explicit selectors and takes `critical: false` or `true` to choose the normal or critical damage method. Critical damage is an explicit request; the server does not infer or validate it against a previous attack. The native roll uses current PF2e damage context and is posted to GM-only chat for review. It does not apply HP damage or simulate target immunities, weaknesses or resistances. Strike/damage rolls do not track action economy or perform other combat bookkeeping. They require GM approval and uncertain results must be inspected before retrying.

## Boundaries

These tools support campaign preparation and bounded native live-play controls. They provide no general-purpose world-document deletion. Explicitly scoped operations can remove a selected condition, effect, inventory item or unstarted-combat participant; encounter and strike controls require explicit approval. They do not execute macros or JavaScript or change permissions. Persistent-damage rolling/ticks are unsupported. Existing Foundry asset paths may be referenced when the active system accepts them. Scene tools create and edit scene data; they do not switch the active scene or move live-play tokens. Foundry validation and permissions remain authoritative.

## Review and apply PF2e damage

Call `pf2e_inspect_damage_application` first with a native PF2e damage chat message UUID and an explicit scene token UUID. Select `rollIndex` (0 by default, maximum 9), `operation` (`damage` or explicit `healing`), multiplier (`0.5`, `1`, or `2`), and optional Shield Block settings. Inspection returns review facts and a `reviewToken`; it does not simulate final HP or guarantee all IWR effects. Healing explicitly converts the selected roll total according to native chat healing behavior; it does not infer vitality/void target rules.

Then call `pf2e_apply_damage` with the identical message, roll, target, operation, multiplier and Shield Block options, plus the exact `reviewToken`. Shield Block is supported only for damage with an explicit shield item UUID; the shield must be a held, raised physical shield and cannot be broken. Magical/spell shields and PF2e's global shield toggle are not used. Foundry/PF2e native `applyDamage` handles damage, temporary HP, stamina and shield processing; native persistent-damage condition creation, defeated automation and hooks may run. No automatic persistent-damage ticks or spell/reaction spending occurs.

Applications reserve a duplicate key (source chat UUID, roll index and Actor UUID) in a GM-restricted world setting before invoking the native API. Linked tokens for one Actor share the duplicate guard. The record persists through reloads; reserved or uncertain outcomes remain blocked. It serializes module-mediated writes through one connected GM bridge, not manual Foundry changes, other clients or multiple bridge processes. The setting is persisted world data, not a secret store. There is no automatic retry, rollback, force-clear or undo. For an uncertain outcome, manually reconcile chat and Actor state before further action; do not blindly delete a record. The ledger retains up to 5000 records and rejects new applications at capacity without eviction.

Example (copy the exact token and selections returned by inspection):

```json
{
  "messageUuid": "ChatMessage.example",
  "targetTokenUuid": "Scene.example.Token.target",
  "rollIndex": 0,
  "operation": "damage",
  "multiplier": 1,
  "shieldBlock": false,
  "reviewToken": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```
