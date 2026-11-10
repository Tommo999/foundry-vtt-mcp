# PF2e spellcasting through MCP

The v0.9 workflow adds four tools to the 56-tool contract. Local validation and remaining live acceptance gates are recorded in [validation](validation-v0.9.0.md). The immutable v0.8.2 release does not include these tools.

The spellcasting workflow uses a spell already owned by a character or NPC. It spends the selected native resource and posts a native actual-cast spell card. It does not automatically roll spell attacks, roll target saves, apply HP changes/effects, place templates, spend actions, recover resources or advance world time.

Native PF2e/Foundry hooks still run. Resolve material requirements and listed monetary costs separately; the supported native consumption paths spend slots, focus or finite innate uses.

## Inspect the caster

Use `get_status` through the agent's actual MCP connection and verify the matching module, companion and MCP builds. Keep the connected GM browser open. PF2e must be enabled in the world and module settings.

Call `pf2e_inspect_spellcasting` with a root Actor UUID or an explicit scene token UUID:

```json
{
  "targetUuid": "Scene.example.Token.caster",
  "offset": 0,
  "limit": 25
}
```

Use returned UUIDs rather than names. Page `options` or filter by an owned `entryUuid` to find the intended native option. Copy its spell UUID, computed `rank` and nullable `slotId`. A prepared position keeps its original index even when preceding positions are empty. Cantrip group 0 and its automatically heightened rank are different facts. Flexible non-cantrip and spontaneous options use rank pools; their slot ID is null.

`pf2e_inspect_resources` accepts the same target and pagination fields. It reports focus, hero points, prepared readiness, rank pools, finite innate uses and observed item uses/frequencies. Missing data remains unavailable/null; zero is a real value. These reads spend nothing and do not prepare or activate anything. Native option availability is a read-time fact; execution still needs a fresh reviewed context.

## Preview an explicit cast

Execution requires an explicit caster token even if inspection used a root Actor. This selects the speaker and scene without guessing among linked tokens. Select at most 20 explicit target tokens in that same scene, or use an empty target list when no target context is needed. Targets are recorded context; they are not automatically affected.

An illustrative ordinary prepared selection is:

```json
{
  "casterTokenUuid": "Scene.example.Token.caster",
  "entryUuid": "Actor.example.Item.entry",
  "spellUuid": "Actor.example.Item.spell",
  "rank": 1,
  "slotId": 0,
  "targetTokenUuids": ["Scene.example.Token.target"],
  "messageMode": "gm"
}
```

Pass the selection to `pf2e_inspect_spell_cast`. This creates an expiring local intent and returns `castId`, `reviewToken`, resource facts and the exact nullable `expectedCombat` snapshot. It posts no card and changes no world documents or settings. Review the returned cost and context before execution.

Message modes are `public`, `gm`, `blind` and `self`; the default is `gm`. Visibility is bound to the preview. You cannot change mode, targets, rank or prepared position during execution without taking a fresh preview.

## Execute the reviewed selection

Call `pf2e_cast_spell` with the identical selection plus the returned `castId`, `reviewToken` and exact `expectedCombat`. Outside the applicable encounter, the snapshot is null. In a started current encounter in the caster's scene, it identifies the encounter, round, turn and combatant; the caster must be that current combatant.

Writes require GM approval by default. Approved execution reserves the intent in a separate persistent audit ledger before invoking native PF2e consumption. It verifies the native result and resource change, builds the native actual-cast card, preserves native flags/visibility and replaces the speaker with the explicit caster. A deliberately repeated cast—including a free cantrip—needs a fresh preview. Reusing the old intent is rejected.

Use the computed rank returned by inspection. The bridge derives the appropriate native group/slot number itself, so an autoheightened cantrip does not accidentally spend a ranked slot. It independently verifies prepared slot membership because the native consumption method accepts an index without checking the slot's spell ID.

## Supported paths and limits

Ordinary prepared, flexible prepared, spontaneous/signature, focus, cantrip and finite-use innate paths use native PF2e options and resource APIs. Base spells may define optional variants: that alone does not prevent their ordinary base card from being posted. Selected alternate/amped variants, rituals, item/wand/staff/trick casting and consumable activation require future workflows.

Reaction/free-action casting and off-turn execution are outside this contract. Combat casting supports ordinary one-to-three-action base cards without tracking action spending. Multi-round/minute casting needs an exploration context; posting that card does not simulate elapsed time. No caller flag bypasses resource spending or native validation.

## Failure and reconciliation

Before native work, changed resources, ownership, native options, targets, session or encounter state invalidate the preview. Inspect again rather than altering the old request. Native refusal posts no cast card and is not reported as success.

After a reservation or native write, a failure can be partial: resources may have changed even if the card or audit confirmation failed. Inspect the reported before/after facts, native Actor spell sheet, chat and resource audit summary before taking further action. Do not automatically replay the request, take a fresh intent to bypass an unresolved record, refund resources or erase records.

Reserved and uncertain records survive reload and block new casts for that Actor. A committed confirmed record remains confirmed even when its acknowledgement was lost; the tool must report the observed state rather than rewriting older facts. The ledger retains up to 5000 records without eviction. It serializes writes through the connected bridge, not independent manual clients or multiple bridge processes, and it is persisted world data rather than a secret store.

This release includes no automatic refund, retry, general ledger-clear tool or reconciliation UI. Retain unresolved records and investigate with the GM/developer. The existing damage-application ledger is separate and must remain intact.
