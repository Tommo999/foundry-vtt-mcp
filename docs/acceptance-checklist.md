# Manual acceptance checklist

A real Foundry v14 instance is required for these checks; this repository has no bundled Foundry runtime.

- [ ] Install and enable the module in a v14 world; confirm it reports active world, Foundry version, system ID and version.
- [ ] Connect through trusted localhost certificate while Foundry is served through HTTPS reverse proxy. Confirm an untrusted certificate and unexpected Origin are rejected.
- [ ] Confirm a non-GM cannot pair or execute document changes; another browser cannot silently replace the paired session.
- [ ] Search and read world documents and compendium entries; verify pagination and UUID lookup.
- [ ] Discover actor/item types and schema information on two different game systems without hard-coded system rules.
- [ ] Create and update a journal with pages, actor and embedded item, scene and embedded token. Confirm each write prompts by default and approval shows target and proposed data.
- [ ] Reject a write, let an approval expire, change worlds and disconnect during approval. Confirm none applies an unintended write.
- [ ] Enable automatic writes, perform an allowed update, then disconnect or change worlds and confirm approval mode is restored.
- [ ] Import a compendium document into the world and confirm the source pack remains unchanged.
- [ ] Interrupt connection during a write; check Foundry for its actual outcome and verify companion does not retry.
- [ ] Confirm tools reject general deletion, permission changes, executable content and unsupported document types; verify every live-play control is explicitly scoped and requires approval.
- [ ] Search document text and confirm snippets omit permission data, flags and macros.
- [ ] Create a typed folder, move a world document into it, then return the document to the root.
- [ ] Browse image assets from safe relative Data directories and confirm absolute paths, traversal segments and non-image file results are rejected.
- [ ] Upload PNG, JPEG, WebP, GIF or AVIF by base64 and by companion-local path; reject SVG, oversize files and attempts to overwrite an existing path. Confirm approval details show metadata without the image payload.
- [ ] Inspect scenes with more than 100 tokens or notes and confirm summaries are bounded and marked truncated.
- [ ] Add a journal-linked scene note at valid coordinates, including a page UUID, then confirm invalid journal/page/scene combinations fail safely.
- [ ] Confirm a localPath upload reads from the companion host, not the GM browser or Foundry Docker host.
- [ ] Verify core system-agnostic tools work in a non-PF2e system; PF2e-specific tools should remain listed and report unavailable.
- [ ] In a PF2e world, verify capability status and filtered compendium search for creature, simple/complex hazard and equipment entries.
- [ ] Confirm generic `import_compendium` remains system-neutral and document PF2e recommendations to use `pf2e_import_document` for native embedded mechanics.
- [ ] Verify party summary and encounter analysis for a selected mixed-level party with both explicit party-level and party-size overrides; confirm NPC exclusions and XP is reported without being awarded.
- [ ] Verify analysis follows the world Proficiency without Level setting and fails clearly if that setting cannot be read.
- [ ] Import a PF2e compendium actor with normal, elite and weak adjustments and inspect preserved system fields, links and ownership.
- [ ] Stage hidden encounter tokens (hidden by default, with explicit visible option) and confirm no combat is created or started. Verify elite/weak staging clones world actors without changing the source. Exercise a mid-batch failure and reconcile reported partial UUIDs without retrying the whole batch.
- [ ] Test the PF2e tools against at least two supported PF2e versions before publishing compatibility claims; this checklist does not mark any version verified.
- [ ] Inspect PF2e conditions on a world Actor and linked/unlinked scene token Actor; set an exact valued condition, set an unvalued condition, increase/decrease/remove by UUID, and confirm grant/lock restrictions are honored.
- [ ] Apply a compendium effect and confirm native duration/grant behavior; remove only the selected effect UUID. Confirm persistent-damage state is never rolled or applied automatically.
- [ ] Inspect inventory/coins; add stacked and new-stack compendium items; set a quantity within 1–9999; add positive coins by denomination and confirm no deductions or XP awards occur.
- [ ] Transfer an item between actors, confirm physical source removal and target addition, and test a mid-operation partial result for UUIDs and no automatic retry.
- [ ] Create a PF2e loot Actor with items and coins. Confirm world ownership defaults are used and permissions are not edited.
- [ ] Confirm condition/effect/inventory mutations require approval by default and honor GM auto-write only for the current session.
- [ ] In two different game systems, list and inspect encounters; create an inactive, unstarted combat for a selected scene and confirm current scene/combat state is unchanged.
- [ ] Add scene tokens to a preparation combat; verify duplicates are skipped, cross-scene tokens and unsupported party/troop grouping are rejected, and existing tokens are not moved or created.
- [ ] Remove only selected Combatant UUIDs from an unstarted combat; verify started combat writes are rejected and partial outcomes are reported without automatic retries.
- [ ] Confirm encounter reads report bounded participants and selection/round/turn summaries without rolling initiative or advancing turns.
- [ ] Request snapshots with party, scene, encounter and journal sources; confirm output is structured, bounded (five encounters, ten journals), read-only, and contains no generated narrative.
- [ ] In PF2e, inspect actions/checks and verify action/strike inspection is read-only, bounded, and executes no attack or damage roll.
- [ ] Roll a skill, Perception and each save with omitted and explicit DCs; verify native modifiers, chat visibility for public/GM/blind/self, and explicit token context. Confirm checks use the approved-write flow and uncertain chat outcomes are inspected before retry.
- [ ] Roll PF2e initiative using the configured skill, including Stealth for an actor configured for it; confirm assigned finite initiatives are skipped by default and reroll occurs only when requested. Check hidden actors remain GM-only.
- [ ] Start a prepared encounter only after every participant has initiative; confirm Foundry's native start hooks run and another active encounter is not switched unexpectedly.
- [ ] Advance one turn using expected round, turn and combatant from the latest inspect result. Confirm stale and concurrent duplicate requests are rejected and Foundry's native turn effects run once.
- [ ] Verify start, initiative and turn controls require GM approval; interrupt each native operation and inspect the actual world outcome before any retry. Confirm these encounter controls do not cast spells or spend spell resources.
- [ ] In a started PF2e encounter, inspect combat context and confirm it reports the current combatant, token candidates and strike selectors without changing controlled tokens or user targets.
- [ ] Roll a primary PC and NPC strike at MAP 1, 2 and 3 against an explicit target while another unrelated token remains targeted; confirm native AC, outcome and GM-only chat, ammunition is not consumed, and consumable weapons are rejected.
- [ ] Try a stale expected round, turn, combatant, strike index and item UUID; confirm they are rejected before a roll. Confirm off-turn/reaction and alternate-usage strikes are rejected.
- [ ] Roll normal and explicitly requested critical damage; confirm each result appears in GM-only chat and the roll tools leave HP unchanged. Use the separate v0.8 inspection/application checks below to test reviewed damage application.
- [ ] Inspect a native damage roll for an explicit token; verify the review token is bound to the selected chat message, roll, target and options. Confirm inspection makes no Actor changes.
- [ ] Apply an inspected roll after approval; verify native HP/temp HP/stamina and Shield Block behavior, and inspect persistent-damage/defeated hooks. Repeat with changed target/options and a reused token; confirm rejection. Confirm reserved/uncertain records block retry after reload.
- [ ] Verify strike/damage tools require GM approval and inspect chat after cancel, interrupt or uncertain result before retrying.
- [ ] Test PF2e combat context, rolls and damage application against at least two supported PF2e versions before publishing compatibility claims; this checklist does not mark any version verified.
- [ ] **v0.8.1 retest:** Search for Goblin Warrior in `pf2e.pathfinder-monster-core` and across packs; confirm results return without index warnings. Recheck hazard complexity, equipment filters, and ammunition type filtering.
- [ ] **v0.8.1 retest:** Compare list/inspect/start/next-turn active reporting when `combat.active` is false for the selected current Combat, an inactive unselected preparation Combat, and a started but unselected Combat.
- [ ] **v0.8.1 retest:** Inspect native Arrows, add a new stack and add to a compatible stack, change its positive quantity, then transfer partial and full quantities between isolated test Actors. Confirm the compendium source marker, ammunition uses and other source metadata survive native operations.
- [ ] **v0.8.1 retest:** Recheck stale-turn, duplicate-damage and stale-review guards after loading the updated module and companion. Keep the original damage audit records and use only isolated test fixtures.
- [ ] **v0.8.2:** Inspect an isolated active started Combat, then call `end_encounter` with its exact UUID/round/turn/combatant. Confirm the Combat is removed through native cleanup while Actors, tokens, scenes and damage audit records remain. Include an empty started test Combat with null tracker values.
- [ ] **v0.8.2:** Reject inactive/unstarted/non-world Combat targets, stale tracker values and concurrent duplicate end requests. Interrupt native ending or simulate unconfirmed removal; confirm an uncertain partial result is reported without retry.
- [ ] **v0.8.2:** Verify status identifies loaded module code, installed manifest, running companion, MCP client and advertised server separately. Deliberately use an old companion or stale GM tab; confirm mismatches are visible. Missing legacy/disconnected values must be unverified, and no pairing secrets may appear.
- [ ] **v0.8.2 release automation:** Run the checked-in CI and tag workflow on GitHub after explicit activation. Confirm tests, type checking, build and archive checks precede publication; only the four distribution assets reach the public repository. Repeated tags/releases must refuse overwrite, and prereleases must not replace the stable latest release. A local workflow review is not a successful hosted run.

## v0.9 spellcasting live acceptance

These unchecked live checks remain required; local tests and packages do not establish live compatibility. Use isolated character/NPC fixtures after the matching module and companion are actually loaded.

- [ ] Inspect world Actors and linked/unlinked scene-token Actors. Confirm exact owned entry/spell UUIDs, native DC/modifier facts, casting times, traditions, ranks, prepared positions, signature/virtual choices and unavailable reasons are bounded and factual. Reject cross-world, stale, compendium and cross-Actor selections.
- [ ] Inspect prepared cantrips with empty positions before the selected slot. Confirm original slot indices survive, slot group 0 stays distinct from autoheightened cast rank, and flexible prepared cantrip positions remain identifiable.
- [ ] Inspect ordinary prepared, flexible rank pools, spontaneous signatures, focus and finite innate uses. Verify native heightening choices, empty pools, expended slots and zero values; missing NPC resources must remain null/unavailable rather than invented unlimited uses.
- [ ] Page large spell/resource lists and inspect owned-item uses/frequencies. Confirm reads and previews do not change Actor/Item/settings/chat state, controlled tokens, user targets or world time. Verify non-PF2e/disabled adapters report unavailable.
- [ ] Preview a supported explicit caster/entry/spell/rank/slot/target/mode selection. Confirm it returns a unique expiring intent and review fingerprint bound to native resource state, exact identities, current connection and applicable encounter state.
- [ ] Execute approved isolated prepared, flexible, spontaneous/signature, focus, cantrip and finite innate casts. Verify the native resource expenditure and native actual-cast chat flags/card. Confirm the explicit caster speaker and public/GM/blind/self visibility match the preview without changing global targeting.
- [ ] Reject wrong prepared-slot membership, expended/exhausted resources, altered rank/targets/mode, expired or cross-session intent, stale selection/resources, changed combat, off-turn caster and concurrent duplicate requests before native execution.
- [ ] Cast outside combat; verify exploration card creation does not advance world time. Reject reaction/free-action casting both in and outside combat; reject multi-round/minute casting in combat. Report ritual, item/staff/wand/trick and selected alternate/amped workflows unsupported; ordinary base spells with overlay definitions must remain usable.
- [ ] Repeat a deliberately free cantrip with a fresh preview; confirm the old intent cannot be replayed. A resource-consumption refusal must post no cast card and must not be reported as success.
- [ ] Interrupt resource consumption, card creation and final audit persistence separately. Verify known resource/chat results are reported, durable reservations survive reload, uncertain Actor outcomes block new intents, and there is no automatic retry/refund/ledger clearing. Do not erase existing damage audit records.
- [ ] Confirm spell casting alone applies no automatic HP changes, target saves, templates, effects, action spending, recovery or persistent-damage ticks. Recheck existing damage stale-review/duplicate guards, strike ammunition restrictions and encounter locks after integration.
