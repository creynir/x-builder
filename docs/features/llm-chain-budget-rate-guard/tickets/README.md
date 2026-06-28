# LLM Chain Budget / Rate Guard - Build Order

Tickets build top to bottom. This epic changes only engine LLM chain budgeting and runner page-binding admission control. It does not add UI, shared transport methods, public request/response fields, auth, or database storage.

| ID | Prefix | Title | Track | Status | Depends on |
|---|---|---|---|---|---|
| LCB-001 | [FND] | Add chain deadline and judge timeout override | engine/llm | done | - |
| LCB-002 | [FND] | Add runner LLM binding guard | runner/transport | done | - |
| LCB-003 | - | Enforce generate chain budget | engine/llm + engine/api | done | LCB-001 |
| LCB-004 | - | Enforce apply chain budget | engine/llm + engine/api | done | LCB-001 |
| LCB-005 | [INT] | Verify budget and guard wiring | engine/runner tests | in-progress | LCB-002, LCB-003, LCB-004 |

## Pipeline Log

- 2026-06-28: Tickets authored from approved arch recon.
- 2026-06-28: LCB-001 completed through RGB-TDD with Blue, Yellow, and [FND] checkpoint approval.
- 2026-06-28: LCB-002 completed through RGB-TDD with Blue, Yellow, and [FND] checkpoint approval.
- 2026-06-28: LCB-003 completed through RGB-TDD with Blue and Yellow approval.
- 2026-06-28: LCB-004 completed through RGB-TDD with Blue and Yellow approval.
