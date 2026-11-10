# v0.9.1 — live casting validation

Maintenance release with a guarded live acceptance harness and recorded native casting evidence. Casting runtime behavior is unchanged; live calls used matching 0.9.0 builds. Prepared-slot validation remains pending native fixture setup.

This maintenance release records live validation of the v0.9 casting workflow on Foundry 14.363 / PF2e 8.7.0. Five new named fixtures passed: flexible prepared, spontaneous, focus, cantrip and finite innate. Native resource transitions, actual-cast message origins, explicit GM speakers/visibility, and same-session duplicate rejection were checked. See [live validation](live-validation-v0.9.1.md) for evidence and limits.

Ordinary prepared-slot casting remains unverified live. The generic document updater correctly rejects direct prepared-spell identifier writes, so the named prepared fixture needs native PF2e sheet preparation before that path can be tested. No source runtime defect was identified in the five completed paths. Existing fixture messages, spent test resources and audit records remain in the world for inspection; do not clear them to rerun tests.

No new MCP tools are added in this milestone. The contract remains at 56 tools. The full local suite passed 327 tests across 37 files, with mandatory PowerShell coverage, type checking and production builds. Live acceptance is partial until the prepared fixture is verified.
