---
status: done
---

# SGC-007: [INT] Verify generation context wiring across engine entry points

## User Flows to Verify

- Given equivalent HTTP and runner repositories with a KB fixture and original posts, when format generation is invoked through each entry point, then both paths use the requested format slice and tight voice samples.
- Given a KB fixture containing unrelated sections, when format generation runs, then unrelated section text is absent from the structured LLM prompt.
- Given missing KB and empty corpus, when format generation is invoked, then generation still reaches the base LLM prompt.
- Given three generated candidates and one judge failure, when response returns, then candidate count remains three and only successful judge verdicts are attached.
- Given the existing overlay request shape, when runner validates it, then no new request field is required.

## Architectural Invariants

- The whole knowledge base is never appended to the generation prompt.
- HTTP and runner default generation use the same engine-owned resolver.
- `GenerateIdeaRequest` and `GenerateIdeaResponse` schemas remain unchanged.
- Idea-only generation does not call the guidance resolver.
- Injected generation overrides are not wrapped by the resolver.

## Modules Under Test

- `buildServer`
- `GenerateIdeasService`
- `createGenerationGuidanceResolver`
- `createBoundEngineServices`
- structured LLM fake used for prompt capture

## Test Strategy & Fixture Ownership

Coverage level: engine/runner integration tests. Owning suites: engine server tests and runner transport/bound-service integration tests. Fixture strategy: temp settings root, temp markdown KB, in-memory or temp post library repository seeded with original and non-original posts, fake structured LLM prompt capture, and fake judge outcomes. Dependency category: local-substitutable repositories and in-process fakes. Isolation boundary: no real X account, no real LLM provider, no user KB path, and no persisted user corpus.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
- 2026-06-27: RGB `[INT]` pipeline started after pre-flight confirmed SGC-006 done, named engine/runner symbols resolvable, unchanged request/response schemas present, and integration surfaces testable in local suites.
- 2026-06-27: Purple committed passing integration coverage in `1b6e233`; Blue rejected missing entry-point one-judge-failure coverage and source-inspection proxy assertions.
- 2026-06-27: Purple fixed the rejection in `ae9df81` by removing source-inspection proxy tests and adding HTTP default-path one-judge-failure coverage that preserves three candidates while attaching verdicts only to successful judge outcomes.
- 2026-06-27: Blue approved after `git diff --check c6c3828..HEAD` passed, test scope remained limited to engine/runner test files, source-proxy/ticket scans returned no matches, engine targeted tests passed 17/17, runner integration tests passed 14/14, and engine/runner typechecks passed.
