# My Feedback Loop - Build Order

Tickets build top to bottom. This epic records deliberate prediction snapshots, links them to captured posts, and surfaces local predicted-vs-actual learnings. It does not store every typed draft, change reach weights, change `metric_obs`, or add cloud analytics.

| ID | Status | Prefix | Title | Track | Depends on |
|---|---|---|---|---|---|
| MFL-001 | Done | [FND] | Define feedback-loop shared contracts | shared | - |
| MFL-002 | Done | [FND] | Add SQLite migration 2 and feedback repository | engine/storage | MFL-001 |
| MFL-003 | Done | - | Build FeedbackLoopService | engine/service | MFL-002 |
| MFL-004 | Done | - | Add feedback Fastify routes | engine/api | MFL-003 |
| MFL-005 | Done | - | Extend EngineTransport and runner bindings | shared/runner/overlay transport | MFL-004 |
| MFL-006 | Done | - | Record deliberate compose actions | overlay compose | MFL-005 |
| MFL-007 | Done | - | Show feedback summary and manual links in settings | overlay settings | MFL-005 |
| MFL-008 | Done | [INT] | Cover backend and transport feedback loop | engine/runner tests | MFL-005 |
| MFL-009 | Done | [E2E] | Verify overlay feedback happy path | e2e | MFL-006, MFL-007, MFL-008 |
| MFL-010 | Done | [DOC] | Document My Feedback Loop | docs | MFL-009 |

## Pipeline Log

- 2026-06-28: RGB ticket audit approved after dependency-table correction.
- 2026-06-28: Build completed through MFL-010. Focused backend, transport, overlay build, and E2E validation passed.
