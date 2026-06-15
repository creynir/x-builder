# Founder Story Reach — Build Order

Tickets build top to bottom. This epic adds only a detected format and safety
guardrails. It deliberately does not add runtime amplifier data, UI controls, or
judge dimensions.

| ID | Prefix | Title | Track | Depends on |
|---|---|---|---|---|
| FSR-001 | [FND] | Runtime taxonomy contract | shared/client | — |
| FSR-002 | — | Founder-story classifier, label, and weights | engine/client | FSR-001 |
| FSR-003 | [CHORE] | Runtime no-amplifier verification | shared/engine/client/docs | FSR-001, FSR-002 |
| FSR-004 | [INT] | Analyze API founder-story wiring | engine | FSR-002, FSR-003 |
| FSR-005 | [E2E] | Studio detected-format smoke | client/e2e | FSR-004 |
| FSR-006 | [DOC] | Future amplifier note | docs | FSR-005 |
