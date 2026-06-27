# Smarter Generation Context - Build Order

Tickets build top to bottom. This epic changes only generation context assembly. It does not change overlay transport, runner transport, generated response schemas, or posting behavior.

| ID | Prefix | Title | Track | Depends on |
|---|---|---|---|---|
| SGC-001 | [FND] | Request-aware generation guidance contract and audited format mapping | engine/shared-contract-adjacent | - |
| SGC-002 | - | Format playbook slicing | engine | SGC-001 |
| SGC-003 | - | Voice sample selection | engine | SGC-001 |
| SGC-004 | - | Exported createGenerationGuidanceResolver | engine | SGC-002, SGC-003 |
| SGC-005 | - | GenerateIdeasService request-aware guidance wiring | engine | SGC-004 |
| SGC-006 | - | HTTP and runner parity | engine/runner | SGC-005 |
| SGC-007 | [INT] | Generation context wiring across engine entry points | engine/runner tests | SGC-006 |
| SGC-008 | [DOC] | Smarter generation context documentation | docs | SGC-007 |
