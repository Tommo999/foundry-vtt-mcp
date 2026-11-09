# Foundry MCP live acceptance report — 2026-11-07

World: Glimmerkeep (`glimmerkeep`). Foundry 14.363; PF2e 8.7.0; module/companion 0.8.0. Test date uses Australia/Adelaide. Live testing used automatic-write mode.

## Result

All 51 tool endpoints were exercised in 134 recorded calls. Classification: 45 pass, 5 pass with a functional/compatibility finding, 1 failure. Every endpoint returned at least one successful RPC response; PF2e filtered search is classified as a failure despite its `ok: true` envelope because it returned no expected result and pack-index errors.

The automated suite passed: 196 tests across 27 files. Type checking passed. This is a live smoke/functional check on this one Foundry/PF2e version combination, not exhaustive compatibility certification.

The initial stale companion/browser processes rejected newer tools. After the user restarted the companion from the updated checkout and hard-refreshed Foundry, v0.8 capabilities were available. Earlier unsupported/disconnected responses are retained in the call log as deployment diagnostics, not current tool failures.

## Findings

1. **Filtered PF2e compendium search fails.** `pf2e_search_compendium` for kind `creature`, pack `pf2e.pathfinder-monster-core`, query `Goblin Warrior` returned zero results and `Cannot create property 'value' on number '1'`. Generic `search_compendium` on the same pack/query returned the expected creature UUID. The unrestricted filtered search produced equivalent warnings for all Actor packs. Suspected cause: requesting both parent index paths and nested `.value` paths in `packages/module/src/pf2e.ts` (`fieldsFor`); this diagnosis needs a patch and retest.
2. **Encounter active-state reporting is inconsistent.** `inspect_encounter`, `start_encounter`, and `next_turn` report `active: false` for the active, started test combat. `pf2e_combat_context` correctly reports `active: true`, and native start/turn/strike operations work. `combatSummary` in `packages/module/src/encounters.ts` uses a false `combat.active` value before checking the actual current combat. The existing `isActive` helper already uses the current combat identity.
3. **PF2e ammunition compatibility gap.** Imported Goblin Warrior contains an `ammo` item (Arrows). `pf2e_inventory` omits it; `pf2e_add_inventory_item` rejects the native Arrows source with `PF2E_UNSUPPORTED_ITEM`. The physical-item allowlist in `packages/module/src/pf2e-inventory.ts` omits `ammo`. Weapon, armor, coin, loot, stacking/quantity and transfer cases passed.

No production code was changed as part of these tests.

## Verified workflows

- World/status/type discovery, generic and text search, UUID reading, folder creation and movement.
- Journal creation/update and text page creation; generic Item import and native PF2e creature import, including weak adjustment.
- Image upload and subsequent asset browsing; note creation at scene coordinates.
- Native party summary and encounter XP analysis with explicit level/size. The world party is empty; populated-party behavior was not live-tested.
- Conditions: exact frightened value, increase, decrease, remove. Effects: apply Guidance and remove it.
- Inventory: add a new weapon stack, exact quantity change, transfer quantity to a new loot Actor, coin addition and loot creation.
- Hidden scene staging, inactive encounter creation, exact combatant addition/removal, duplicate skipping, native initiative, encounter start and one turn advance.
- Perception, Athletics and Fortitude/Reflex/Will checks against a DC.
- NPC native strikes at MAP 1/2/3. Agile penalties were -4/-8. Native success/failure and GM-only chat were reported.
- Normal and critical damage rolls without automatic HP application.
- Damage review and native application: 50→47 HP for 3 damage; explicit healing 47→59 HP for 12.
- Half and double damage requests with typed native damage rolls.
- Native slashing resistance 2 plus a raised physical shield absorbed a 4-point slashing result without HP/shield loss.
- Shield Block against a 22-point piercing roll: hardness 3, temporary HP 4→0, Actor HP 50→35, shield HP 12→0. Native shield destruction was reported.
- Duplicate damage rejected with `ALREADY_APPLIED`; stale review rejected with `STALE_REVIEW`; repeated stale turn rejected with `STALE_TURN`.
- Started-combat preparation rejected; permission-field updates rejected; a destroyed shield rejected before application.

## Per-tool results

| Tool | Result | Calls |
|---|---|---:|
| `add_combatants` | PASS | 3 |
| `add_map_note` | PASS | 1 |
| `browse_assets` | PASS | 3 |
| `create_document` | PASS | 2 |
| `create_embedded` | PASS | 3 |
| `create_encounter` | PASS | 1 |
| `create_folder` | PASS | 1 |
| `discover_types` | PASS | 1 |
| `get_document` | PASS | 2 |
| `get_status` | PASS | 4 |
| `import_compendium` | PASS | 2 |
| `inspect_encounter` | PASS WITH FINDING | 3 |
| `inspect_scene` | PASS | 1 |
| `list_compendiums` | PASS | 2 |
| `list_encounters` | PASS | 3 |
| `list_folders` | PASS | 3 |
| `move_document` | PASS | 3 |
| `next_turn` | PASS WITH FINDING | 2 |
| `pf2e_add_coins` | PASS | 1 |
| `pf2e_add_inventory_item` | PASS WITH FINDING | 3 |
| `pf2e_adjust_condition` | PASS | 3 |
| `pf2e_analyze_encounter` | PASS | 1 |
| `pf2e_apply_damage` | PASS | 8 |
| `pf2e_apply_effect` | PASS | 2 |
| `pf2e_combat_context` | PASS | 2 |
| `pf2e_create_loot` | PASS | 1 |
| `pf2e_import_document` | PASS | 2 |
| `pf2e_inspect_actions` | PASS | 1 |
| `pf2e_inspect_conditions` | PASS | 2 |
| `pf2e_inspect_damage_application` | PASS | 9 |
| `pf2e_inventory` | PASS WITH FINDING | 2 |
| `pf2e_party_summary` | PASS | 2 |
| `pf2e_remove_effect` | PASS | 1 |
| `pf2e_roll_check` | PASS | 5 |
| `pf2e_roll_damage` | PASS | 6 |
| `pf2e_roll_initiative` | PASS | 1 |
| `pf2e_roll_strike` | PASS | 3 |
| `pf2e_search_compendium` | FAIL | 3 |
| `pf2e_set_condition` | PASS | 1 |
| `pf2e_set_item_quantity` | PASS | 1 |
| `pf2e_stage_encounter` | PASS | 1 |
| `pf2e_status` | PASS | 3 |
| `pf2e_transfer_item` | PASS | 1 |
| `remove_combatants` | PASS | 1 |
| `search_compendium` | PASS | 10 |
| `search_content` | PASS | 1 |
| `search_world` | PASS | 1 |
| `session_snapshot` | PASS | 1 |
| `start_encounter` | PASS WITH FINDING | 1 |
| `update_document` | PASS | 13 |
| `upload_asset` | PASS | 1 |

## Test fixtures and cleanup

All new world documents were testing fixtures. The existing scene `Scene.J6MzumtLUwDPMK5z` and its original token were retained. Two new hidden tokens and one map note were added to that existing test scene.

**The test combat is still started at round 1, turn 1. End/delete it through Foundry's Combat Tracker before normal play.** The MCP tools intentionally provide no general world-document deletion or end-combat tool.

Suggested manual cleanup order:

1. End/delete test encounter `Combat.DyLIFuON9aWdqd57`.
2. Remove these two newly labeled tokens from the existing test scene:
   - `Scene.J6MzumtLUwDPMK5z.Token.uhoDpyIgXnPS6mZe` — [MCP ACCEPTANCE] Attacker Token
   - `Scene.J6MzumtLUwDPMK5z.Token.W5fbXefak31UkvJZ` — [MCP ACCEPTANCE] Target Token
3. Remove map note `Scene.J6MzumtLUwDPMK5z.Note.BYPKojRta1OgBgCC`.
4. Remove folder `Folder.4Aqqi534MLRCChZh` ([MCP ACCEPTANCE 2026-11-07] Actors) and its four newly created Actors:
   - `Actor.05H2LvFPer0rbsJc`
   - `Actor.6zOiQpI9EeMLx3Lt`
   - `Actor.O7wmqBzoenWFou65`
   - `Actor.3CjdDmRxzqwRguPk`
5. Remove journal `JournalEntry.ZvoDbWrrV5BWtOQC` (its test page is embedded), and world Item `Item.WO3hlVhRPbGVR6Kt`.
6. Optionally remove the 68-byte uploaded PNG: `assets/foundry-mcp/acceptance/Be9fPJcT9fgMmMNo-mcp-acceptance-2026-11-07.png`.
7. Optionally remove the 22 test roll/outcome chat messages listed in the accompanying JSON.

Six confirmed application records remain in the hidden world duplicate-prevention setting. These are successful audit records, not uncertain reservations; the API offers no ledger-clear operation.

The Frightened condition and Guidance effect created for round-trip testing were removed. The raised-shield and resistance effects, destroyed shield and temporary test state are embedded in the listed test token Actor.

## Image sources

Actor/equipment icons came from installed PF2e/Foundry assets (`systems/pf2e/...`, `icons/...`). No external image-search or artwork-download service was used. The upload test used a fixed base64 1×1 PNG fixture.

## Limits of this run

Approval-mode rejection/expiry, connection loss during an in-flight write, cross-user pairing, non-PF2e systems, other PF2e versions, PC strike/resource variants, stamina-enabled live play, and persistent-damage ticks were not live-tested. Automated tests cover multiple guard and partial-failure paths. Automatic persistent-damage ticks are not implemented.

