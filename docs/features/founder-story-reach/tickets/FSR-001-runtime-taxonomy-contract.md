---
status: todo
---

# FSR-001: [FND] Runtime taxonomy contract

## Implementation Details

Extend the deterministic format contract with `founder_story`.

- Add `founder_story` to `detectedPostFormatSchema`.
- Mirror the format in the engine `PostFormat` type.
- Re-export any updated shared types through the existing shared package export
  path.
- Add a detected-format label helper and use it from `DeterministicDetailInspector`
  so the UI renders `Founder story` instead of the raw enum value
  `founder_story`.
- Do not add any runtime amplifier contract.

This is a contract ticket only. Classifier predicates, reach weights, and
integration behavior are implemented in later tickets.

## Data Models

`DetectedPostFormat` gains one enum member:

```ts
"founder_story"
```

No other schema fields are added. In particular, these remain out of scope:

```ts
scoringContext.amplifier
scoringContext.eventContext
prediction.amplifierType
prediction.signals[].signal_key for amplifier signals
judge amplifier dimensions
```

## Integration Point

The user reaches this contract through the existing Studio scoring flow. The
contract is produced by shared schemas and consumed by the engine classifier,
engine reach tables, API response validation, and client deterministic details.

## Scope Boundaries / Out of Scope

- IN: shared enum/type update, engine type mirror, detected-format label helper,
  `DeterministicDetailInspector` label usage, schema and render contract tests.
- OUT: classifier logic, weights, estimator math, judge prompt changes, UI
  controls, account-history import, event/emotional amplifier runtime fields.
- Zero-trace rule: no amplifier-shaped runtime properties, stubs, TODOs, or
  placeholder interfaces.

## Test Strategy & Fixture Ownership

Unit tests. Owning suites: shared schema tests and client deterministic component
tests. If a label helper does not already exist, create it with direct unit
coverage or cover it through a `DeterministicDetailInspector` render test.
Fixtures should be small inline contract objects. All dependencies are
in-process.

## Definition of Done

- `founder_story` parses as a valid detected format.
- Existing detected-format members continue to parse.
- Runtime amplifier-shaped keys do not survive schema parsing or route/response
  boundaries; existing Zod strip semantics must not be changed to strict rejection.
- `pnpm typecheck` and `pnpm test` pass.

## Acceptance Criteria

- Given a deterministic analysis payload with `detectedFormat: "founder_story"`
  / When shared schemas parse it / Then parsing succeeds and exported types
  include the new format.
- Given an otherwise valid request includes `scoringContext.amplifier` / When
  shared schemas parse it / Then parsing follows existing strip semantics and the
  parsed request does not retain the key.
- Given an otherwise valid prediction payload includes `amplifierType` / When
  shared schemas parse it / Then parsing follows existing strip semantics and the
  parsed prediction does not retain the key.
- Given `DeterministicDetailInspector` receives an item with
  `detectedFormat: "founder_story"` / When it renders the detected-format row /
  Then the visible value is `Founder story`, not `founder_story`.

## Edge Cases

Unknown enum values still fail according to the existing schema behavior.
Unknown object keys still strip according to existing Zod behavior. The new enum
member must not make generic strings acceptable.

## Pipeline Log
