# v0.8.1 live retest — 2026-11-09

## Result

The repaired **PF2e search**, **native ammunition inventory**, and **encounter activity/next-turn reporting** passed their targeted live checks in Glimmerkeep, Foundry **14.363** / PF2e **8.7.0**, with automatic writes. After the GM ended the old acceptance combat, a successful fresh `start_encounter` and a further `next_turn` also passed. **All three original v0.8.1 findings are resolved in the exercised live workflows.**

Recorded **81 client tool requests across 21 tool names**: 73 successful responses, six expected validation/safety rejections, one initially blocked fresh-start request (subsequently resolved after GM cleanup), and one harness input error rejected by MCP schema validation before execution. The harness error omitted `encounterUuid` from initiative setup; the corrected explicit request succeeded. This was a targeted retest, not a repeat of all 51 tools. No new application defect was found in the exercised paths.

See the [structured requests/results](live-retest-v0.8.1-2026-11-09.json). The original [v0.8.0 report](live-acceptance-2026-11-07.md), [call log](live-acceptance-2026-11-07.json), and [earlier pending retest](live-retest-v0.8.1-2026-11-07.md) remain historical evidence.

## Build verification

- Fresh MCP initialization reported server version **0.8.1**.
- The module manifest served by the actual Foundry host reported **0.8.1**, including the public release update URLs.
- Served module JavaScript SHA-256 was `1e5004ff0492cf29a4ec46cae4f31991d0564fee299d75c97beb15817c52ae9f`, identical to the local patched build.
- Actual GM-browser tool responses exercised the repaired handlers successfully. Direct browser DOM/version inspection remained unavailable because the browser access host was unavailable; server-file verification and functional results provide the recorded build evidence. The daemon does not expose its own release version through status, so its in-memory version was not independently inspected.

## Findings retested

| Area | Result | Evidence |
| --- | --- | --- |
| Exact creature search | PASS | Goblin Warrior in `pf2e.pathfinder-monster-core` returned the expected `fLLKuOXwPq1Iq0U4` Actor, level -1, with no warnings. Generic control agreed. |
| Cross-pack and structured creature search | PASS | Unrestricted query returned three matches with no warnings. Level/trait/size filters and bounded pagination worked. |
| Hazards | PASS | Simple and complex queries returned results without index warnings. Direct document reads confirmed sampled `isComplex: false` and `true` values. |
| Equipment and ammo search | PASS | Native Arrows matched `ammo`, level 0 and 1 cp per unit. Dagger matched weapon/level/20 cp filters. Unsupported equipment-size filtering returned `INVALID_INPUT`. |
| Empty versus unavailable search | PASS | Missing text returned an empty result without warnings; a nonexistent pack returned an explicit pack warning. No real pack was damaged to manufacture partial failure. |
| Active encounter reporting | PASS | List, inspect, combat context and successful next-turn results all reported the actual current combat as active, although its raw stored `active` flag was false. |
| Inactive preparation | PASS | Newly created unselected preparation reported inactive/unstarted before and after initiative. |
| Next turn | PASS | One confirmed advance moved the old test combat from round 1/turn 1 to round 2/turn 0, returning `active: true`. The previous tracker state was then rejected with `STALE_TURN`. |
| Fresh start | PASS | Initially refused with `OTHER_ENCOUNTER_ACTIVE`. After the GM ended the old fight, the prepared fixture started at round 1/turn 0 and returned `active: true`. A further native next turn returned active at round 2/turn 0; inspect and combat context agreed. The new combat raw active flag was true; false-legacy-flag coverage came from the original combat. |
| Native ammo inspection | PASS | Existing Goblin inventory included native Arrows that v0.8.0 omitted. |
| Ammo add/stack/quantity | PASS | New stack 3, native add/stack to 5, exact positive update to 7. |
| Ammo transfer | PASS | Partial transfer: source 4/target 3. Full remainder transfer stacked into target 7 and removed the temporary source stack. |
| Ammo metadata | PASS | Source marker and base item, uses, size, slug, traits, price, publication, level and bulk survived add/update/partial/full transfer. |
| Scoped physical-item validation | PASS | A native effect source was rejected with `PF2E_UNSUPPORTED_ITEM`; the target inventory remained one ammo stack. |

The original acceptance loot inventory, coin amounts, wealth and bulk were restored exactly to their captured baseline after the full transfer. The new isolated loot Actor holds the seven test Arrows. No campaign Actor inventory was used for mutations.

## Safety checks

- A fresh inspection first confirmed the selected historical damage record was already `applied` and `nativeConfirmed`. A deliberate duplicate application was rejected with `ALREADY_APPLIED` before native damage.
- A deliberately altered review fingerprint was rejected with `STALE_REVIEW`.
- The real turn/context change also changed the review fingerprint. Submitting the genuine pre-turn review was rejected with `STALE_REVIEW`.
- A stale tracker request was rejected without another turn advance.
- Target health remained **59/60 HP, 0 temporary HP**, and the inspected prior application record retained the same ID/status/content. No new damage application, ledger clear or uncertain reservation was requested.
- Native turn-start hooks expired the historical Raise a Shield effect. This was an observed side effect of the authorized turn advance. The destroyed test shield was not repaired or reused; the unrelated resistance effect remained.

## Fixtures and cleanup

Use native Foundry UI for cleanup; MCP has no general Actor/Combat deletion or end-combat tool.

| Fixture | Identifier / state |
| --- | --- |
| New isolated loot Actor | `Actor.5RXzoUWQ2da3Mxkz` — **[MCP 0.8.1 RETEST 2026-11-09] Ammo transfer target** |
| New test ammo | `Actor.5RXzoUWQ2da3Mxkz.Item.RUTBQNQ3jzBZvmux` — 7 Arrows |
| New test encounter | `Combat.qy1N9ilBt9yVKl9D` — now active/started at **round 2, turn 0**; one existing acceptance Target Token combatant |
| New combatant | `Combat.qy1N9ilBt9yVKl9D.Combatant.hM5x33FG5bDFjsQ1` — initiative 6 |
| Known new initiative chat | `ChatMessage.Ga3h2aoMj2F2aJdz` — GM-only initiative roll |
| Existing old test encounter | `Combat.DyLIFuON9aWdqd57` — ended/removed by the GM; absent from the refreshed encounter list |
| Existing source loot | `Actor.O7wmqBzoenWFou65` — original inventory restored; temporary ammo stack removed by native full transfer |

Keep the original scene, its original token and the historical successful damage audit records. New fixture cleanup is separate from the optional historical cleanup in the original report. **End the new test combat `Combat.qy1N9ilBt9yVKl9D` before normal campaign play.** The old combat was ended by the GM to unblock the successful fresh-start continuation. Remove the new combat, labelled loot Actor/ammo and optional initiative chat through native Foundry UI when no longer needed.

## Remaining limits

- Fresh start is now passed. A started-but-unselected live reporting case still has automated-only coverage; this run did not manufacture an unselected started combat. After the old fight ended, the preparation fixture was selected while still unstarted and correctly reported active; activity was not inferred merely from started state.
- Real corrupt-pack partial failure, zero-price items, alternate PF2e/Foundry versions, PC/resource variants and Windows installation were not separately exercised here.
- No new strike, Shield Block or successful damage application was performed. Existing safeguards were retested through rejection paths; broader compatibility is not implied.
- No automated suite was rerun for this live-only task; the latest earlier automated record was 226 tests across 31 files passing during public-release preparation.
- No source code, package version, live module files, public release assets or repository visibility was changed by this test run.
