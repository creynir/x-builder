---
status: planned
---

# Generation Category Panel

Roadmap note: the left-side post generation section should expose all available generation categories in one bounded box instead of hiding categories behind an awkward overflowing control.

## Requested Behavior

- Show all available post generation categories in the left-side generation button section.
- Keep the category list inside a fixed-size box.
- Use an internal scrollbar when more categories are available than fit in the box.
- Requested sizing note: "fixed width" was requested together with "70% of viewport height". Before implementation starts, confirm whether the intended constraint is `max-height: 70vh` for the category box.

## Product Boundary

- UI layout improvement only.
- No generation prompt, scoring, judge, category taxonomy, or transport behavior changes implied.
- No dedicated tickets yet.

## Existing References

- `docs/features/generation-and-judge-surface/README.md`
- `docs/features/x-overlay-browser/README.md`
- `overlay/src/compose/compose-cockpit.tsx`
- `engine/src/server/server.ts` category endpoint wiring, if category availability needs to be checked during implementation.

## Bookkeeping Notes

This is in the next build queue after `smarter-generation-context`.

The implementation agent should first verify the current category rendering surface and clarify the requested width/height wording before changing UI.
