---
status: done
---

# SGC-008: [DOC] Document smarter generation context

## Goal

Document the user-facing behavior of format-aware generation context after the engine changes land.

## Target Page

- Path: `docs/how-to/generate-format-aware-posts.md`
- Diataxis quadrant: How-To

## Implementation Details

Create a how-to page that explains:

- choosing a generate category in the compose rail;
- how the clicked format selects a small playbook slice;
- how imported/captured original posts supply a compact voice sample;
- that generation still works when no KB or corpus exists;
- that x-builder never auto-posts;
- that generation does not send the full KB after this epic.

Mention user-facing settings fields only where they exist in the current UI. Treat `voiceProfileId` as implementation detail unless it has a concrete user-facing control by the time this ticket starts.

## Integration Point

Producer: docs page under `docs/how-to/`. Consumer: users and maintainers learning how generated drafts are grounded. User entry point: a user clicks a generate category in the compose rail. Terminal outcome: the user understands what context is used for generation and what happens when context sources are missing.

## Scope Boundaries / Out of Scope

In scope: one how-to page, links to existing relevant docs if helpful, and plain-language explanation of fail-open behavior.

Out of scope: no marketing copy, API reference, Linear references, claims about prompt internals beyond user-visible behavior, or docs for future voice-profile UI unless implemented.

## Test Strategy & Fixture Ownership

Coverage level: docs review. Owning workspace: docs. Fixture strategy: no fixtures. Dependency category: none. Isolation boundary: no generated screenshots or live app required.

## Definition of Done

- The how-to page exists at the target path.
- It says generation uses the clicked format plus a small voice sample, not the full KB.
- It says generation still works without KB/corpus context.
- It preserves the never-auto-post boundary.

## Acceptance Criteria

- Given the doc page, when a user reads it, then they understand that generation uses the clicked format plus a small voice sample, not the full KB.
- Given no KB or corpus is configured, when a user reads the page, then they understand generation still works with the base prompt.
- Given the user is concerned about posting, when they read the page, then they see that x-builder fills the composer only on their click and never auto-posts.

## Edge Cases

- Knowledge-base path setting absent.
- Corpus contains no original posts.
- Future UI exposes additional context controls.

## Pipeline Log

- 2026-06-27: RGB audit tightened ticket contract before implementation.
- 2026-06-28: White/docs lane completed `docs/how-to/generate-format-aware-posts.md`; page covers clicked format context, compact playbook slice, compact original-post voice sample, missing-context fail-open behavior, and the never-auto-post boundary.
