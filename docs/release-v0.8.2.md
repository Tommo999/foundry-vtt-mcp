# v0.8.2 release notes

Status: local milestone implementation and release archives verified; publication and live acceptance remain separate gates.

## Encounter completion

Adds `end_encounter`, bringing the MCP contract from 51 to 52 tools. It ends only the active, started world encounter identified by its explicit UUID and freshly inspected round, turn and combatant. Empty started encounters use the inspected null turn/combatant values. The operation uses the existing GM approval flow and combat lock, rechecks authorization, and invokes the native Combat deletion used by Foundry's own end-combat confirmation callback. Native cleanup hooks run; Actors, scene tokens and the persistent damage-application ledger are preserved.

Ending removes the Combat record. Inspect and retain any tracker information you need beforehand. If Foundry errors or removal cannot be confirmed, the tool reports an uncertain partial outcome; inspect the native tracker before taking further action. There is no automatic retry or general document-deletion tool.

## Running-version diagnostics

`get_status` and the companion CLI status command distinguish the compiled module code, the installed module manifest, the running companion, the MCP-facing client package and its advertised server version. They identify mismatches and missing legacy values separately, including when no GM browser is connected. A missing value is unverified, rather than assumed current. Diagnostics do not expose pairing tokens, certificates or configuration contents.

## Upgrade and verification

Update both the module and companion, restart the companion, and hard-refresh the GM browser. Check `get_status` after reconnecting; merely replacing files does not update a running process. Public update URLs and release automation are described in [Public Foundry releases](public-releases.md).

The version-aligned milestone passed clean `npm ci`, **260 tests across 33 files** with mandatory PowerShell coverage, `npm run typecheck`, and `npm run package:windows` (including the standard package and all production builds). Final archive checks and remaining deployment gates are recorded in [the versioned validation report](validation-v0.8.2.md). The local PowerShell checks ran on Linux; Windows PowerShell 5.1 hosted CI has not yet run.

## CI and public release automation

Adds read-only CI and a `v*` tag-triggered release workflow. Publication waits for the full test/typecheck/build checks and mandatory Windows PowerShell smoke checks. A separate publication job validates the four distribution files, ZIP integrity, embedded manifests, checksums, public destination, tag conflicts and release order. It creates the public tag from the destination repository's own default branch, uploads to a draft without overwriting assets, verifies downloaded draft hashes, then publishes. Credentials are restricted to the configured GitHub API asset endpoints and are not forwarded to asset redirects. Prereleases do not replace stable latest, and older stable releases are rejected.

The source repository remains private. Activate publishing by configuring the destination-limited token and repository variable described in [Public Foundry releases](public-releases.md), then explicitly push the reviewed source/tag. No hosted workflow run, new public release or live deployment has been performed as part of local preparation.

Live verification remains pending until matching v0.8.2 code is loaded in both the companion and GM browser. Test encounter completion only with an isolated test Combat and retain existing campaign scenes, tokens and damage audit records. Existing v0.8.1 acceptance reports remain historical evidence for their stated version.
