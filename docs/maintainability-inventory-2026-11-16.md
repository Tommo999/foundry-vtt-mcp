# Maintainability review coverage — 2026-11-16

Companion to the [review and roadmap](maintainability-review-2026-11-16.md). Inventory of all 156 tracked files at the reviewed commit; new audit documents are additional outputs. Physical line counts include blank lines.

## Review depth

- **Focused:** relevant implementation/setup sections were read and traced, in addition to structural inspection. This does not mean every branch was independently verified.
- **Structural:** inventory, size, responsibility, symbols/imports or build/test role examined; no complete behavioral review. Executable tests also ran in the full suite, subject to the reported PowerShell skip.
- **Historical:** catalogued as dated evidence/design context; not reread in full or revalidated.
- **Excluded detail:** lockfile dependency graph, ignored/generated output, and non-code visual assets were not audited semantically.

## File inventory

| File | Lines | Depth |
| --- | ---: | --- |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | 53 | Focused |
| [.github/workflows/release.yml](../.github/workflows/release.yml) | 163 | Focused |
| [.gitignore](../.gitignore) | 8 | Structural |
| [AGENTS.md](../AGENTS.md) | 25 | Focused |
| [CHANGELOG.md](../CHANGELOG.md) | 20 | Structural |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 99 | Focused |
| [README.md](../README.md) | 17 | Focused |
| [docs/acceptance-checklist.md](../docs/acceptance-checklist.md) | 79 | Structural |
| [docs/agent-handoff-v0.8.1.md](../docs/agent-handoff-v0.8.1.md) | 215 | Historical |
| [docs/agent-handoff-v0.9-paused.md](../docs/agent-handoff-v0.9-paused.md) | 60 | Historical |
| [docs/architecture.md](../docs/architecture.md) | 68 | Focused |
| [docs/implementation-plan-v0.8.1.md](../docs/implementation-plan-v0.8.1.md) | 96 | Historical |
| [docs/implementation-plan-v0.8.2-v0.9.md](../docs/implementation-plan-v0.8.2-v0.9.md) | 29 | Historical |
| [docs/implementation-plan-v0.9.1-v0.11.md](../docs/implementation-plan-v0.9.1-v0.11.md) | 29 | Historical |
| [docs/installation.md](../docs/installation.md) | 137 | Structural |
| [docs/live-acceptance-2026-11-07.json](../docs/live-acceptance-2026-11-07.json) | 2772 | Historical |
| [docs/live-acceptance-2026-11-07.md](../docs/live-acceptance-2026-11-07.md) | 129 | Historical |
| [docs/live-prepared-v0.9.1.md](../docs/live-prepared-v0.9.1.md) | 21 | Historical |
| [docs/live-readonly-v0.9.0-2026-11-10.md](../docs/live-readonly-v0.9.0-2026-11-10.md) | 24 | Historical |
| [docs/live-retest-v0.8.1-2026-11-07.json](../docs/live-retest-v0.8.1-2026-11-07.json) | 190 | Historical |
| [docs/live-retest-v0.8.1-2026-11-07.md](../docs/live-retest-v0.8.1-2026-11-07.md) | 58 | Historical |
| [docs/live-retest-v0.8.1-2026-11-09.json](../docs/live-retest-v0.8.1-2026-11-09.json) | 8608 | Historical |
| [docs/live-retest-v0.8.1-2026-11-09.md](../docs/live-retest-v0.8.1-2026-11-09.md) | 70 | Historical |
| [docs/live-validation-v0.9.1.md](../docs/live-validation-v0.9.1.md) | 56 | Historical |
| [docs/maintenance.md](../docs/maintenance.md) | 61 | Focused |
| [docs/public-hosting-validation-2026-11-09.json](../docs/public-hosting-validation-2026-11-09.json) | 70 | Historical |
| [docs/public-hosting-validation-2026-11-09.md](../docs/public-hosting-validation-2026-11-09.md) | 29 | Historical |
| [docs/public-releases.md](../docs/public-releases.md) | 42 | Structural |
| [docs/release-v0.10.0.md](../docs/release-v0.10.0.md) | 12 | Historical |
| [docs/release-v0.11.0.md](../docs/release-v0.11.0.md) | 12 | Historical |
| [docs/release-v0.12.0.md](../docs/release-v0.12.0.md) | 10 | Historical |
| [docs/release-v0.13.0.md](../docs/release-v0.13.0.md) | 17 | Historical |
| [docs/release-v0.8.1.md](../docs/release-v0.8.1.md) | 41 | Historical |
| [docs/release-v0.8.2.md](../docs/release-v0.8.2.md) | 27 | Historical |
| [docs/release-v0.9.0.md](../docs/release-v0.9.0.md) | 9 | Historical |
| [docs/release-v0.9.1.md](../docs/release-v0.9.1.md) | 9 | Historical |
| [docs/roadmap.md](../docs/roadmap.md) | 104 | Focused |
| [docs/security.md](../docs/security.md) | 9 | Focused |
| [docs/spell-effects.md](../docs/spell-effects.md) | 30 | Structural |
| [docs/spell-history-recovery.md](../docs/spell-history-recovery.md) | 38 | Structural |
| [docs/spell-resolution.md](../docs/spell-resolution.md) | 34 | Structural |
| [docs/spellcasting.md](../docs/spellcasting.md) | 71 | Structural |
| [docs/tool-reference.md](../docs/tool-reference.md) | 245 | Focused |
| [docs/v0.11-native-spell-resolution-design.md](../docs/v0.11-native-spell-resolution-design.md) | 37 | Historical |
| [docs/v0.12-spell-history-recovery-design.md](../docs/v0.12-spell-history-recovery-design.md) | 39 | Historical |
| [docs/v0.13-native-spell-effects-design.md](../docs/v0.13-native-spell-effects-design.md) | 59 | Historical |
| [docs/v0.9-native-spellcasting-design.md](../docs/v0.9-native-spellcasting-design.md) | 81 | Historical |
| [docs/validation-v0.10.0.md](../docs/validation-v0.10.0.md) | 29 | Historical |
| [docs/validation-v0.11.0.md](../docs/validation-v0.11.0.md) | 59 | Historical |
| [docs/validation-v0.12.0.md](../docs/validation-v0.12.0.md) | 28 | Historical |
| [docs/validation-v0.13.0.md](../docs/validation-v0.13.0.md) | 44 | Focused |
| [docs/validation-v0.8.2.md](../docs/validation-v0.8.2.md) | 53 | Historical |
| [docs/validation-v0.9.0.md](../docs/validation-v0.9.0.md) | 77 | Historical |
| [docs/windows-setup.md](../docs/windows-setup.md) | 50 | Structural |
| [package-lock.json](../package-lock.json) | 4328 | Excluded detail; role inventoried |
| [package.json](../package.json) | 31 | Focused |
| [packages/companion/package.json](../packages/companion/package.json) | 22 | Focused |
| [packages/companion/src/assets.ts](../packages/companion/src/assets.ts) | 160 | Focused |
| [packages/companion/src/cli.ts](../packages/companion/src/cli.ts) | 388 | Focused |
| [packages/companion/src/config.ts](../packages/companion/src/config.ts) | 42 | Focused |
| [packages/companion/src/daemon.ts](../packages/companion/src/daemon.ts) | 497 | Focused |
| [packages/companion/src/index.ts](../packages/companion/src/index.ts) | 1 | Focused |
| [packages/companion/src/updater.ts](../packages/companion/src/updater.ts) | 307 | Focused |
| [packages/companion/test/assets.test.ts](../packages/companion/test/assets.test.ts) | 78 | Structural |
| [packages/companion/test/daemon.test.ts](../packages/companion/test/daemon.test.ts) | 410 | Structural |
| [packages/companion/test/status.test.ts](../packages/companion/test/status.test.ts) | 46 | Structural |
| [packages/companion/test/updater.test.ts](../packages/companion/test/updater.test.ts) | 208 | Structural |
| [packages/companion/tsup.config.ts](../packages/companion/tsup.config.ts) | 13 | Focused |
| [packages/module/index.html](../packages/module/index.html) | 1 | Excluded detail; role inventoried |
| [packages/module/module.css](../packages/module/module.css) | 1 | Excluded detail; role inventoried |
| [packages/module/module.json](../packages/module/module.json) | 20 | Structural |
| [packages/module/package.json](../packages/module/package.json) | 19 | Focused |
| [packages/module/src/assets.ts](../packages/module/src/assets.ts) | 85 | Structural |
| [packages/module/src/bridge-context.ts](../packages/module/src/bridge-context.ts) | 9 | Focused |
| [packages/module/src/companion-pairing.ts](../packages/module/src/companion-pairing.ts) | 21 | Focused |
| [packages/module/src/encounters.ts](../packages/module/src/encounters.ts) | 1054 | Focused |
| [packages/module/src/main.ts](../packages/module/src/main.ts) | 2141 | Focused |
| [packages/module/src/pf2e-checks.ts](../packages/module/src/pf2e-checks.ts) | 250 | Focused |
| [packages/module/src/pf2e-combat-context.ts](../packages/module/src/pf2e-combat-context.ts) | 348 | Structural |
| [packages/module/src/pf2e-conditions.ts](../packages/module/src/pf2e-conditions.ts) | 507 | Structural |
| [packages/module/src/pf2e-context.ts](../packages/module/src/pf2e-context.ts) | 2 | Focused |
| [packages/module/src/pf2e-damage-application.ts](../packages/module/src/pf2e-damage-application.ts) | 515 | Focused |
| [packages/module/src/pf2e-damage-context.ts](../packages/module/src/pf2e-damage-context.ts) | 802 | Structural |
| [packages/module/src/pf2e-inventory.ts](../packages/module/src/pf2e-inventory.ts) | 765 | Focused |
| [packages/module/src/pf2e-native-source.ts](../packages/module/src/pf2e-native-source.ts) | 7 | Focused |
| [packages/module/src/pf2e-spell-audit-lock.ts](../packages/module/src/pf2e-spell-audit-lock.ts) | 38 | Focused |
| [packages/module/src/pf2e-spell-audit.ts](../packages/module/src/pf2e-spell-audit.ts) | 712 | Focused |
| [packages/module/src/pf2e-spell-cast.ts](../packages/module/src/pf2e-spell-cast.ts) | 1499 | Focused |
| [packages/module/src/pf2e-spell-effect-ledger.ts](../packages/module/src/pf2e-spell-effect-ledger.ts) | 379 | Focused |
| [packages/module/src/pf2e-spell-effect.ts](../packages/module/src/pf2e-spell-effect.ts) | 831 | Focused |
| [packages/module/src/pf2e-spell-ledger.ts](../packages/module/src/pf2e-spell-ledger.ts) | 811 | Structural |
| [packages/module/src/pf2e-spell-reconciliation-ledger.ts](../packages/module/src/pf2e-spell-reconciliation-ledger.ts) | 304 | Structural |
| [packages/module/src/pf2e-spell-resolution-ledger.ts](../packages/module/src/pf2e-spell-resolution-ledger.ts) | 483 | Focused |
| [packages/module/src/pf2e-spell-resolution.ts](../packages/module/src/pf2e-spell-resolution.ts) | 1422 | Focused |
| [packages/module/src/pf2e-spellcasting.ts](../packages/module/src/pf2e-spellcasting.ts) | 654 | Focused |
| [packages/module/src/pf2e-strikes.ts](../packages/module/src/pf2e-strikes.ts) | 820 | Structural |
| [packages/module/src/pf2e-target.ts](../packages/module/src/pf2e-target.ts) | 69 | Focused |
| [packages/module/src/pf2e-writes.ts](../packages/module/src/pf2e-writes.ts) | 591 | Structural |
| [packages/module/src/pf2e.ts](../packages/module/src/pf2e.ts) | 607 | Focused |
| [packages/module/src/security.ts](../packages/module/src/security.ts) | 67 | Focused |
| [packages/module/src/session-snapshot.ts](../packages/module/src/session-snapshot.ts) | 378 | Structural |
| [packages/module/tests/assets.test.ts](../packages/module/tests/assets.test.ts) | 31 | Structural |
| [packages/module/tests/companion-pairing.test.ts](../packages/module/tests/companion-pairing.test.ts) | 42 | Structural |
| [packages/module/tests/encounters.test.ts](../packages/module/tests/encounters.test.ts) | 1329 | Structural |
| [packages/module/tests/journal-sanitization.test.ts](../packages/module/tests/journal-sanitization.test.ts) | 57 | Structural |
| [packages/module/tests/operations.test.ts](../packages/module/tests/operations.test.ts) | 515 | Structural |
| [packages/module/tests/pf2e-checks.test.ts](../packages/module/tests/pf2e-checks.test.ts) | 300 | Structural |
| [packages/module/tests/pf2e-combat-context.test.ts](../packages/module/tests/pf2e-combat-context.test.ts) | 268 | Structural |
| [packages/module/tests/pf2e-conditions.test.ts](../packages/module/tests/pf2e-conditions.test.ts) | 469 | Structural |
| [packages/module/tests/pf2e-damage-application.test.ts](../packages/module/tests/pf2e-damage-application.test.ts) | 315 | Structural |
| [packages/module/tests/pf2e-damage-context.test.ts](../packages/module/tests/pf2e-damage-context.test.ts) | 414 | Structural |
| [packages/module/tests/pf2e-damage-workflow.test.ts](../packages/module/tests/pf2e-damage-workflow.test.ts) | 319 | Structural |
| [packages/module/tests/pf2e-integration.test.ts](../packages/module/tests/pf2e-integration.test.ts) | 157 | Structural |
| [packages/module/tests/pf2e-inventory.test.ts](../packages/module/tests/pf2e-inventory.test.ts) | 849 | Structural |
| [packages/module/tests/pf2e-read.test.ts](../packages/module/tests/pf2e-read.test.ts) | 829 | Structural |
| [packages/module/tests/pf2e-spell-audit.test.ts](../packages/module/tests/pf2e-spell-audit.test.ts) | 44 | Structural |
| [packages/module/tests/pf2e-spell-cast.test.ts](../packages/module/tests/pf2e-spell-cast.test.ts) | 1216 | Focused |
| [packages/module/tests/pf2e-spell-effect-ledger.test.ts](../packages/module/tests/pf2e-spell-effect-ledger.test.ts) | 220 | Structural |
| [packages/module/tests/pf2e-spell-effect.test.ts](../packages/module/tests/pf2e-spell-effect.test.ts) | 698 | Focused |
| [packages/module/tests/pf2e-spell-ledger.test.ts](../packages/module/tests/pf2e-spell-ledger.test.ts) | 564 | Structural |
| [packages/module/tests/pf2e-spell-reconciliation-ledger.test.ts](../packages/module/tests/pf2e-spell-reconciliation-ledger.test.ts) | 126 | Structural |
| [packages/module/tests/pf2e-spell-resolution-ledger.test.ts](../packages/module/tests/pf2e-spell-resolution-ledger.test.ts) | 337 | Structural |
| [packages/module/tests/pf2e-spell-resolution.test.ts](../packages/module/tests/pf2e-spell-resolution.test.ts) | 1098 | Focused |
| [packages/module/tests/pf2e-spellcasting.test.ts](../packages/module/tests/pf2e-spellcasting.test.ts) | 865 | Structural |
| [packages/module/tests/pf2e-strikes.test.ts](../packages/module/tests/pf2e-strikes.test.ts) | 611 | Structural |
| [packages/module/tests/pf2e-v04-integration.test.ts](../packages/module/tests/pf2e-v04-integration.test.ts) | 305 | Structural |
| [packages/module/tests/pf2e-writes.test.ts](../packages/module/tests/pf2e-writes.test.ts) | 399 | Structural |
| [packages/module/tests/preparation.test.ts](../packages/module/tests/preparation.test.ts) | 300 | Structural |
| [packages/module/tests/security.test.ts](../packages/module/tests/security.test.ts) | 27 | Structural |
| [packages/module/tests/session-snapshot.test.ts](../packages/module/tests/session-snapshot.test.ts) | 108 | Structural |
| [packages/module/tests/v05-integration.test.ts](../packages/module/tests/v05-integration.test.ts) | 152 | Structural |
| [packages/module/tests/v06-integration.test.ts](../packages/module/tests/v06-integration.test.ts) | 458 | Structural |
| [packages/module/tests/v07-integration.test.ts](../packages/module/tests/v07-integration.test.ts) | 235 | Focused |
| [packages/module/tests/v08-integration.test.ts](../packages/module/tests/v08-integration.test.ts) | 217 | Focused |
| [packages/module/vite.config.ts](../packages/module/vite.config.ts) | 20 | Focused |
| [packages/shared/package.json](../packages/shared/package.json) | 12 | Structural |
| [packages/shared/src/index.ts](../packages/shared/src/index.ts) | 677 | Focused |
| [scripts/live-v091-spellcasting.mjs](../scripts/live-v091-spellcasting.mjs) | 932 | Structural |
| [scripts/package-windows.mjs](../scripts/package-windows.mjs) | 150 | Focused |
| [scripts/package.mjs](../scripts/package.mjs) | 42 | Focused |
| [scripts/prepare-release.mjs](../scripts/prepare-release.mjs) | 271 | Focused |
| [scripts/release-publication.mjs](../scripts/release-publication.mjs) | 740 | Structural |
| [scripts/setup-windows.ps1](../scripts/setup-windows.ps1) | 373 | Structural |
| [scripts/windows-setup-helper.mjs](../scripts/windows-setup-helper.mjs) | 356 | Focused |
| [setup-windows.cmd](../setup-windows.cmd) | 14 | Structural |
| [tests/fixtures/localhost-key.pem](../tests/fixtures/localhost-key.pem) | 28 | Structural |
| [tests/fixtures/localhost.pem](../tests/fixtures/localhost.pem) | 19 | Structural |
| [tests/live-v091-spellcasting.test.mjs](../tests/live-v091-spellcasting.test.mjs) | 121 | Structural |
| [tests/release-publication.test.mjs](../tests/release-publication.test.mjs) | 797 | Structural |
| [tests/release.test.mjs](../tests/release.test.mjs) | 143 | Structural |
| [tests/shared.test.ts](../tests/shared.test.ts) | 782 | Focused |
| [tests/stdio.integration.test.ts](../tests/stdio.integration.test.ts) | 490 | Structural |
| [tests/windows-package.test.mjs](../tests/windows-package.test.mjs) | 81 | Focused |
| [tests/windows-powershell.test.mjs](../tests/windows-powershell.test.mjs) | 131 | Focused |
| [tests/windows-setup-helper.test.ts](../tests/windows-setup-helper.test.ts) | 248 | Structural |
| [tsconfig.json](../tsconfig.json) | 14 | Focused |

## Representative context sets

Whole-file source volume is a reproducible proxy for discovery cost only. These sets are illustrative and deliberately overlap. Focused reading should use symbols and ranges; no token reduction has been measured.

### Add tool

7 files; 4,802 physical lines.

- `packages/shared/src/index.ts`
- `packages/companion/src/cli.ts`
- `packages/module/src/main.ts`
- `tests/shared.test.ts`
- `tests/stdio.integration.test.ts`
- `docs/tool-reference.md`
- `docs/acceptance-checklist.md`

### Change spell casting

7 files; 6,894 physical lines.

- `packages/module/src/pf2e-spell-cast.ts`
- `packages/module/src/pf2e-spell-ledger.ts`
- `packages/module/src/pf2e-spellcasting.ts`
- `packages/module/src/bridge-context.ts`
- `packages/module/src/main.ts`
- `packages/module/tests/pf2e-spell-cast.test.ts`
- `packages/module/tests/pf2e-spell-ledger.test.ts`

### Fix transport

6 files; 4,603 physical lines.

- `packages/companion/src/daemon.ts`
- `packages/companion/src/cli.ts`
- `packages/shared/src/index.ts`
- `packages/module/src/main.ts`
- `packages/companion/test/daemon.test.ts`
- `tests/stdio.integration.test.ts`

### Change Windows bundle

6 files; 2,182 physical lines.

- `scripts/package-windows.mjs`
- `scripts/prepare-release.mjs`
- `scripts/release-publication.mjs`
- `tests/windows-package.test.mjs`
- `tests/release.test.mjs`
- `tests/release-publication.test.mjs`

## Coverage limits

Every tracked path is accounted for, but structural coverage must not be interpreted as exhaustive semantic coverage. The focused pass emphasized change boundaries, repeated helpers, safety-sensitive state transitions, fixture setup, packaging constraints, and current contributor guidance. Remaining structural-only files should receive targeted behavioral review when changes touch them. No hidden local configuration, secrets, campaign state, node_modules source audit, live script execution, deployment or publication was included.
