# External Feedback Loop - Build Order

Tickets build top to bottom. This epic consumes persisted External X Signals patterns as sanitized generation constraints. It does not add external evidence to the user's own corpus, voice samples, feedback actuals, active context, local post history, judge/apply prompts, transport methods, or overlay UI.

| ID | Status | Prefix | Title | Track | Depends on |
|---|---|---|---|---|---|
| EFL-001 | Done | [FND] | Define external pattern guidance contracts and renderer | engine/llm | - |
| EFL-002 | Done | [FND] | Add pattern-only snapshot reader | engine/external storage | EFL-001 |
| EFL-003 | Done | - | Wire external pattern guidance into generation | engine/llm, runner/server construction | EFL-001, EFL-002 |
| EFL-004 | Done | - | Enforce no-contamination boundaries | engine policy tests | EFL-003 |
| EFL-005 | Done | [INT] | Cover external pattern generation integration | engine/runner tests | EFL-001, EFL-002, EFL-003, EFL-004 |
| EFL-006 | Done | [DOC] | Document External Feedback Loop | docs | EFL-005 |

## Pipeline Log

- 2026-06-29: Tickets authored from approved arch recon. Validator fix folded into EFL-003 and EFL-005: provider/reader construction must share the same external repository as `ExternalXSignalsService`; injected service without paired provider disables external generation guidance rather than creating a separate reader.
- 2026-06-29: RGB ticket audit approved after updating EFL-002, EFL-004, and EFL-005 to match current repository/schema behavior.
- 2026-06-29: EFL-001 through EFL-004 completed. EFL-004 landed guard-only regression coverage because implementation boundaries already held.
- 2026-06-29: EFL-005 completed. Integration validation added storage-to-generation coverage and fixed removed-source-only patterns so they do not become generation prompt sources.
- 2026-06-29: EFL-006 completed. The feature README now documents External Feedback Loop as a generation-only consumer boundary over sanitized external pattern snapshots.
