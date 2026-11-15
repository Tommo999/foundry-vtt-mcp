# Roadmap through v0.15

Status recorded 2026-11-16. Releases follow acceptance gates rather than promised dates. This roadmap authorizes no live-world mutations and does not turn planned capabilities into compatibility claims.

## Release sequence

| Version | Theme | Status | Campaign/session benefit |
| --- | --- | --- | --- |
| v0.11 | Native spell resolution | Published; matching-build live acceptance pending | Resolve a confirmed cast with native spell attacks, saves and base damage. |
| v0.12 | Spell history and evidence-bound recovery | Published; assets anonymously verified; matching-build live acceptance pending | Inspect what happened after an interrupted operation and reconcile supported outcomes without replaying gameplay. |
| v0.13 | Reviewed spell effects and duration visibility | Approved implementation scope; design settled | Apply an explicitly selected native effect or condition from a confirmed cast, then inspect duration and sustain reminders. |
| v0.14 | Consumables and item spellcasting | Planned; native API investigation required | Use supported potions, scrolls, wands and other eligible items with explicit previews and native resource consumption. |
| v0.15 | Rest, recovery and session readiness | Planned; native API investigation required | Review supported party recovery workflows and see what still needs GM attention before the next encounter or session. |

The active implementation objective covers completion of v0.11–v0.13. v0.14 and v0.15 are roadmap scope, not started implementation. Publish and verify each accepted milestone before delivering the next release.

## v0.11 — native spell resolution

Delivered four tools for inspecting a resolution and rolling a native spell attack, one target's save or base spell damage. The published contract contains **60 tools**. Resolution is bound to a confirmed cast card and explicit tokens, with durable duplicate protection.

Example: “Preview this enemy's Reflex save against that confirmed cast, then roll it after approval.” Damage rolling, outcome scaling and HP application remain explicit separate decisions.

Local validation passed 375 tests across 41 files, builds, packaging and hosted CI. Published assets are preserved. Matching deployed module/companion versions and targeted live workflows still need acceptance. See [release notes](release-v0.11.0.md) and [validation](validation-v0.11.0.md).

## v0.12 — history and guided recovery

### Scope

- Three tools: `pf2e_inspect_spell_history`, `pf2e_inspect_spell_reconciliation`, and approved `pf2e_reconcile_spell_audit`; **63 tools** in total.
- Bounded, paginated cast/roll history with Actor, kind, original-status and effective-status filters.
- Exact native message/resource evidence checks for supported unresolved outcomes; actionable explanations when evidence is insufficient.
- A separate restricted reconciliation ledger, preserving original cast and resolution records and their duplicate keys.
- A bounded Bridge Spell audit panel using the same approval and session automatic-write path as MCP.

Example: “Inspect this interrupted cast. If the native card and durable resource evidence prove the outcome, preview a reconciliation for approval.” A valid overlay can retire an old Actor-wide unresolved blocker for a fresh cast; it never permits replay of the original operation.

### Validation and live acceptance

Source commit `4d03347a30fdfe5de81b4e176ae0ed920b44f5c7` passed local validation: **405 tests across 43 files**, mandatory PowerShell checks, type checking, builds and standard/Windows packaging. [Hosted CI](https://github.com/Tommo999/foundry-vtt-mcp/actions/runs/43719397451) passed Linux and Windows jobs. The four draft assets were downloaded and verified against the immutable local candidate before publication; the published assets were then downloaded anonymously and verified against the same candidate.

The [v0.12.0 public release](https://github.com/Tommo999/foundry-vtt-mcp-releases/releases/tag/v0.12.0) is published and marked latest. Matching-build live acceptance remains a separate pending gate. See [operator guide](spell-history-recovery.md), [design](v0.12-spell-history-recovery-design.md), and [validation](validation-v0.12.0.md).

## v0.13 — spell effects, durations and sustain reminders

### Scope

- Three planned tools: `pf2e_inspect_spell_effect`, approved `pf2e_apply_spell_effect`, and `pf2e_inspect_spell_durations`; target **66 tools** in total.
- Bind application to one confirmed cast card, explicit caster/target tokens and an operator-selected compendium effect or native condition/value.
- Preserve native effect rules, grants, origin context, duration and start-time handling. Condition changes use supported native APIs and preserve native provenance.
- Audit native creation, increases and already-satisfied outcomes with durable semantic duplicate protection and evidence-bound recovery.
- Read native duration/expiry facts and provide advisory sustain reminders in MCP and the Bridge UI.

Example: “Preview applying this selected spell effect to the fighter, approve it, then show its native duration and whether it needs a sustain reminder.”

### Boundaries and acceptance

Do not infer effects from spell text or degree of success. Do not spend spell resources again, lower/remove conditions through this application workflow, apply HP, extend durations or advance time. A sustain reminder does not claim an action was spent.

Require source-shaped effect/condition/grant tests, correct native provenance and duration behavior, stale-review and uncertain-write coverage, history/recovery integration, UI approval tests, full validation and verified release assets. Live acceptance must use matching builds. The [settled design](v0.13-native-spell-effects-design.md) defines the detailed contract.

## v0.14 — consumables and item spellcasting

### Intended scope

- Inspect native item-use readiness: quantity, charges/uses, eligibility and supported targeting requirements.
- Preview and approve supported consumable activations and item spellcasting, starting with source-verified potion, scroll and wand workflows.
- Preserve the native item's spell origin, casting mode and consumption rules instead of treating an item spell as an ordinary prepared spell.
- Link resource outcomes and native chat to durable operation history; block duplicate or uncertain item use across reloads.
- Reuse explicit damage/healing/effect review steps where the native activation does not apply them itself.

Examples: “Preview using this healing potion for the fighter” and “Preview casting this scroll at that enemy, including its native consumption.”

### Dependencies and acceptance

First inspect exact supported PF2e APIs and native hooks. Whitelist only workflows whose targets, resource transitions and results can be checked. Investigate depleted charges, failed activation, native quantity/deletion behavior, item casting context and interaction with v0.12/v0.13 audit history before settling schemas or tool counts.

Do not activate arbitrary macros/scripts, infer targets, silently refill items, enable ammunition consumption as an incidental change, or replay an uncertain use. Unsupported item types must be explicit. Release requires native-shaped consumption/casting tests, single-attempt uncertainty checks, existing spell/inventory regressions, packaging and matching-build live acceptance.

## v0.15 — rest, recovery and session readiness

### Intended scope

- Preview supported native rest/recovery workflows for explicitly selected Actors.
- Add reviewed native overnight-rest and refocus support where exact PF2e APIs provide a verifiable operation; do not emulate unsupported activities with guessed resource writes.
- Show before/after native resource facts and actual partial outcomes.
- Provide a bounded readiness summary of HP/resource facts, remaining conditions, active effects and unresolved audit records.
- Offer a GM-facing party checklist for the next encounter/session, reusing existing factual session snapshots and journals.

Example: “Preview the selected party members' supported overnight recovery, approve it, then report resources and conditions that still need attention.”

### Dependencies and acceptance

Build on v0.14's resource-use history and v0.13's native duration visibility. Research which recovery operations are native and what they actually change before committing to automation. Report unavailable workflows clearly.

Do not assume every condition/effect expires on rest, invent recovery formulas, rewrite unrelated daily preparation, implicitly advance the world clock, award benefits twice, or retry uncertain recovery. Preview must explain scope and unknown native-hook outcomes; final results report observations rather than guaranteed transactions. Validate multiple-Actor partial failure, duplicate recovery, resource/identity drift and interaction with existing audits. Tool counts remain to be designed.

## Delivery rules for every release

1. Settle native API evidence, explicit scope and the shared MCP contract before coding.
2. Use one Luna-medium agent for all coding/testing; the main agent plans and reviews.
3. Preserve approval-by-default, session authorization, TLS/origin checks, stale-context checks and durable duplicate protection. Never repair audit uncertainty by replaying gameplay.
4. Pass focused and full tests, mandatory Windows/PowerShell coverage, type checking, builds and package checks. Keep guides, discovery and classifications aligned.
5. Preserve earlier immutable assets; verify the new four-asset draft before public publication and verify public downloads afterward. Update GitHub between accepted milestones under the user's publishing authorization.
6. Track matching-build live acceptance separately. Automated tests and public releases do not establish live Foundry compatibility, and a release never authorizes unrequested live-world writes.
