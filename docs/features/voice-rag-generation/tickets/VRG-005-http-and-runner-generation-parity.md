---
status: done
---

# VRG-005: [INT] HTTP and runner generation parity

## User Flows to Verify

- Given a seeded local corpus and a format generation request, when `POST /ideas/generate` runs through the default HTTP service construction, then the writer prompt contains Voice RAG-selected own voice samples.
- Given the same seeded local corpus and request, when runner bound engine services handle `generateIdeas`, then the writer prompt contains equivalent Voice RAG-selected own voice samples.
- Given the voice index provider fails or the index is unavailable, when HTTP or runner generation runs, then generation still reaches the LLM with playbook and/or fallback voice guidance.
- Given transport binding keys are enumerated, when this epic is complete, then no new `EngineTransport` method exists for voice retrieval.
- Given external pattern guidance is present, when generation resolves guidance, then external patterns remain rendered as derived constraints before own voice samples and are not treated as voice.

## Architectural Invariants

- The canonical corpus remains reachable through the existing `PostLibraryRepository` method surface; no voice method is added.
- `GenerateIdeaRequest`, `GenerateIdeaResponse`, and overlay transport schemas remain unchanged.
- Runner construction passes `voiceSampleProvider?: VoiceSampleProvider` explicitly through `EngineServices` / `CreateBoundEngineServicesOptions` or an equivalent typed construction seam. It must not recover the private DB handle from `SqlitePostLibraryRepository`.
- HTTP construction creates the voice provider from the same host-owned `Database` handle used for storage.
- Feedback actuals continue to read canonical metric snapshots and do not read `voice_post_embedding`.

## Modules Under Test

- `buildServer`
- `createBoundEngineServices`
- runner default service construction
- `GenerateIdeasService`
- `createGenerationGuidanceResolver`
- `ENGINE_TRANSPORT_BINDINGS`
- `PostLibraryRepository` implementation surface

## Pipeline Log

- 2026-06-29: Wired HTTP and runner default construction through an explicit `voiceSampleProvider` seam. Engine HTTP generation tests, runner transport integration, runner host storage integration, runner typecheck, and full runner tests pass.
