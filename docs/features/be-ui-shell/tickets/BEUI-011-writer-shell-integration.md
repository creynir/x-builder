# BEUI-011: [FE] Writer Shell Integration

## Goal

Wrap the existing Writer page in the shell and connect generation to the typed API boundary with recoverable error handling.

## In Scope

- Writer route inside App Shell.
- Idea form validation.
- `POST /ideas/generate` through `EngineApiClient`.
- Generate loading state.
- Candidate result rendering for exactly three candidates.
- Field-level validation errors.
- Route banner for backend, server, timeout, and schema errors.
- Retry with preserved payload.
- Preserve idea text after failure.

## Out Of Scope

- Full CandidateCard design beyond basic shell integration.
- LLM judge UI.
- Save to library.
- Voice profile selection UI.

## Acceptance Criteria

- Given idea is empty, when Generate is clicked, then no backend request is sent and a field error appears.
- Given a valid idea is submitted, then the client calls `/ideas/generate`.
- Given the response has three valid candidates, then candidates render.
- Given the backend is unavailable, then the idea remains and Route Error Banner offers Retry and Settings.
- Given Retry is clicked, then the same payload is sent again.
- Given response schema is invalid, then route error shows `invalid_response`.

## Test Strategy

- Suite: client Vitest with mocked API client; existing writer tests should be expanded.
- Fixture strategy: valid three-candidate response, validation failure, network failure, invalid response.
- Dependency category: local mocks; no live engine.

## Dependencies

- BEUI-005.
- BEUI-008.
- BEUI-009.
