# Reply Composer Context - Build Order

Tickets build top to bottom. This epic adds reply awareness to the existing compose cockpit only. It does not add a separate reply product, new transport methods, X API calls, persistence, profile navigation fallback, auto-posting, or new scoring dimensions.

| ID | Prefix | Title | Track | Status | Depends on |
|---|---|---|---|---|---|
| RCC-001 | [FND] | Shared Reply Composer Context Contract | shared/contracts | todo | - |
| RCC-002 | [FND] | Overlay Reply Detection And Draft Split Helpers | overlay/dom | todo | RCC-001 |
| RCC-003 | - | Reply-Aware Engine Consumers | engine/llm + engine/deterministic | todo | RCC-001 |
| RCC-004 | - | Reply-Aware Compose Cockpit Orchestration | overlay/compose | todo | RCC-001, RCC-002, RCC-003 |
| RCC-005 | [INT] | Reply Context Integration Coverage | shared/engine/overlay tests | todo | RCC-003, RCC-004 |
| RCC-006 | [E2E] | Reply Composer Overlay Flow | runner/e2e | todo | RCC-005 |

## Pipeline Log

- 2026-06-29: Tickets authored from approved arch-recon output. Validator concerns folded into the architecture context and ticket AC.
