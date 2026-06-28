# Generation Category Panel - Build Order

Tickets build top to bottom. This epic adds a bounded internal-scroll category panel to the existing compose generation rail. It does not change generation prompts, scoring, judge behavior, category taxonomy, category ranking/capping, transport contracts, runner bindings, Fastify routes, or composer write behavior.

| ID | Status | Prefix | Title | Track | Depends on |
|---|---|---|---|---|---|
| GCP-001 | In Progress | - | Bounded Generation Category Panel | overlay/ui | - |
| GCP-002 | Todo | [INT] | Rail Integration Regression | overlay/browser tests | GCP-001 |

## Pipeline Log

- 2026-06-28: Tickets authored from arch-recon output. Validator concern folded into scope and Visual AC: wide mode proves rail-local `70vh`; stacked mode may remain constrained by the existing `60vh` outer cockpit pin.
