# Product Screens - X Builder

Stage: product-design-system / Stage 5 COMPOSE.

Status: draft for final approval.

Companion preview:

- [Product Screens HTML](./product-screens.html)

## Screen Inventory

Day-one routes:

- Writer.
- Voice.
- Post Library.
- Settings.

Deferred routes:

- My Analytics.
- Signals.

## Navigation Model

The app uses a persistent shell:

- Top status bar for engine, Codex adapter, storage, and last run.
- Sidebar for route navigation.
- Main route content.
- Right inspector when the route needs comparison or diagnostics.

The URL model should follow:

- `/writer`
- `/voice`
- `/library`
- `/settings`

Route state that should persist:

- Selected route.
- Sidebar collapsed state.
- Density preference.
- Last selected candidate.
- Last active Post Library filter.

## Writer Route

Primary job:

Generate, compare, judge, and select X post candidates.

First read:

The selected candidate text and its deterministic score.

Primary action:

Generate candidates.

Secondary actions:

- Generate more in selected format.
- Copy candidate.
- Save to library.
- Mark used.
- Retry Codex judge.

Panels:

- Idea and generation controls.
- Candidate comparison board.
- Judge inspector.
- Evidence drawer or tab.

States:

- Empty: idea input is empty; generate disabled; prompt user to paste a raw idea.
- Loading: candidate cards skeleton; idea input remains usable.
- Populated: first-pass candidates plus selected candidate.
- Partial: deterministic candidates visible, Codex judge unavailable.
- Error: deterministic engine failed; route banner with retry.

## Voice Route

Primary job:

Inspect and edit the extracted writing voice profile.

First read:

Voice confidence, freshness, and accepted traits.

Primary action:

Extract voice profile.

Secondary actions:

- Accept trait.
- Reject trait.
- Add phrase to avoid.
- Save manual overrides.

States:

- Empty: no source posts are available; link to Post Library import.
- Loading: section skeletons for traits and phrases.
- Populated: accepted traits, phrase keep/avoid lists, source examples.
- Partial: low evidence warning when fewer than the required examples are available.
- Error: extraction failed; source posts remain visible.

## Post Library Route

Primary job:

Manage known posts and source evidence for voice, signal, and generation examples.

First read:

Filtered known posts table.

Primary action:

Import posts.

Secondary actions:

- Mark used.
- Use as signal.
- Add to voice.
- Exclude.
- Bulk tag.

States:

- Empty: no posts; import CTA.
- Loading: table skeleton rows.
- Populated: table with usage, source, metrics, freshness, and actions.
- Partial: some import rows failed or metrics are stale.
- Error: storage error; rows remain visible when cached.

## Settings Route

Primary job:

Configure local engine, Codex adapter, storage, and writer defaults.

First read:

Codex adapter status.

Primary action:

Save settings.

Secondary actions:

- Test Codex adapter.
- Reveal command path.
- Reset writer defaults.

States:

- Default: valid saved config.
- Dirty: save bar visible.
- Testing: adapter test button pending.
- Partial: Codex unavailable but deterministic engine ready.
- Error: invalid command path or storage path with inline recovery.

## Responsive Behavior

Desktop:

- Sidebar visible.
- Writer uses main board plus right inspector.
- Tables use sticky headers and horizontal overflow only inside table containers.

Tablet:

- Sidebar collapses to rail.
- Inspector becomes below-content panel.
- Candidate cards can wrap to two columns.

Mobile:

- Sidebar is hidden.
- Route navigation becomes compact top tabs in implementation.
- Candidate cards stack.
- Judge and evidence become tabs.

## Visual Critique Notes

The first screen artifact was checked against:

- hierarchy
- composition
- typography
- brand consistency
- density
- localization resilience

Result:

- Writer route now treats candidate text and score as the main read.
- Judge is subordinate, not a chat surface.
- Post Library looks like product memory rather than admin afterthought.
- Settings is functional and low decoration.
