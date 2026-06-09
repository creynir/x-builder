# Flow Spec Checklist: BE + Simple UI Shell

Date: 2026-06-06

Screens specced: 8

Screens mocked up: 0

Overall handoff completeness: 88%

Stage 3 mockups were intentionally skipped for this shell-contract pass. The feature relies on the approved design-system components and patterns instead of separate HTML mockups. Revisit mockups only if implementation review finds ambiguity in App Shell, Settings, or error/status composition.

## Summary

- Screens fully complete as specs: 8/8
- Screens fully complete as spec plus mockup: 0/8
- Missing states: 0 instances
- Undocumented interactions: 0 blocking gaps found
- Forms without validation: 0 blocking gaps found
- Modals without focus management: 0 blocking gaps found
- Missing design-system components: 1 definition gap
- Spec to mockup mismatches: not applicable; mockups skipped
- Content/localization/responsive gaps: 3 non-blocking decisions
- Handoff readiness gaps: 6 open implementation decisions

## State Coverage

| Screen | Ideal | Empty | Loading | Error | Partial | Complete? |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| App Shell | Yes | Yes | Yes | Yes | Yes | Yes |
| Top Status Bar | Yes | Yes | Yes | Yes | Yes | Yes |
| Route Error Banner | Yes | Yes | Yes | Yes | Yes | Yes |
| Sidebar Nav | Yes | Yes | Yes | Yes | Yes | Yes |
| Settings Route | Yes | Yes | Yes | Yes | Yes | Yes |
| Writer Route Shell Integration | Yes | Yes | Yes | Yes | Yes | Yes |
| Voice Route Placeholder | Yes | Yes | Yes | Yes | Yes | Yes |
| Post Library Route Placeholder | Yes | Yes | Yes | Yes | Yes | Yes |

## Interaction Gaps

No blocking interaction gaps found.

Covered interactions include route resolution, sidebar navigation, sidebar collapse, status refresh, Settings navigation, route error retry/dismiss, Settings load/save/test, Writer generation/retry, and placeholder route actions.

Non-blocking decisions still open:

- Whether `/` redirects to `/writer` or renders Writer while preserving `/`.
- Whether global shortcuts such as `G W`, `G V`, `G L`, and `G S` ship in the first shell implementation.
- Whether status refresh runs only on boot/manual repair or also on an interval.

## Modal / Panel Gaps

No required modal or panel gaps found.

- App Shell, Top Status Bar, Route Error Banner, Sidebar Nav, Writer integration, Voice placeholder, and Library placeholder own no modals.
- Settings documents the optional unsaved-changes dialog with trigger, content, actions, focus management, keyboard behavior, dismissal, and focus return.
- Future route inspectors, import drawers, candidate details, and voice editors are explicitly deferred to their owning feature specs.

## Form Gaps

No blocking form gaps found.

| Form | Spec | Fields Listed | Validation | Error Copy | Timing | Submit Success | Submit Failure | Unsaved Changes |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Shell Settings Form | Settings Route | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Idea Generation Form | Writer Route Shell Integration | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

Notes:

- Settings has the stronger unsaved-changes requirement.
- Writer draft persistence across full reload remains an open decision, but in-route preservation on failure is covered.

## Accessibility Gaps

No blocking accessibility gaps found.

Covered:

- Keyboard access for route navigation, status refresh, Settings actions, Writer generation, retry flows, and placeholders.
- Focus movement to route headings after navigation.
- `aria-current` requirement for active nav.
- Accessible labels/tooltips for collapsed sidebar and icon-only controls.
- Polite live announcements for status changes.
- Assertive announcements for blocking route errors.
- Field error association in Settings and Writer forms.
- Reduced-motion fallback notes.
- 200 percent and 400 percent zoom checks where relevant.

Non-blocking accessibility decision:

- Decide whether route navigation should always move focus to the route heading or preserve focus for some in-route navigation cases.

## Content / Localization / Responsive Gaps

No blocking content gaps found.

Covered:

- Copy inventories exist for each screen.
- Error copy includes recovery actions.
- Long route labels, paths, URLs, generated text, and placeholder copy have wrapping/truncation guidance.
- Date/time formatting is called out for status last-run copy.
- RTL or LTR handling is noted where path/URL values matter.
- Responsive collapse behavior is anchored to the design-system shell pattern.

Non-blocking decisions:

- Final placeholder copy for Voice and Post Library should be approved before implementation.
- Decide whether status copy should show the local engine URL in compact UI or only in Settings.
- Decide whether storage readiness failures should appear as optional placeholder notes or only in Top Status Bar and Settings.

## Missing Components

| Component | Referenced in Screens | Exists in Design-System Index? | Defined in `product-components.md`? | Notes |
|---|---|:---:|:---:|---|
| `AppShell` | App Shell, placeholders, Writer | Yes | Yes | Ready |
| `SidebarNav` | App Shell, Sidebar Nav, placeholders | Yes | Yes | Ready |
| `TopStatusBar` | App Shell, Top Status Bar, placeholders | Yes | Yes | Ready |
| `Alert` | Route Error Banner, Settings, placeholders, Writer | Yes by pattern usage | Yes | Used instead of older `InlineError` wording |
| `PageHeader` | Settings, Writer, Voice, Library | Yes | No | Definition gap; add a short component spec before or during implementation |
| `Button` | Most route specs | Yes | Yes | Ready |
| `IconButton` | App Shell, Top Status Bar, Sidebar Nav, Settings | Yes | Yes | Ready |
| `Input` | Settings | Yes | Yes | Ready |
| `Switch` | Settings | Yes | Yes | Ready |
| `Textarea` | Writer | Yes | Yes | Ready |
| `Badge` | Status, errors, placeholders | Yes | Yes | Ready |
| `Tooltip` | Status and sidebar | Yes | Yes | Ready |
| `Toast` | App Shell, Settings, Route Error Banner, Writer | Yes | Yes | Ready |
| `EmptyState` | Voice and Library placeholders | Yes | Yes | Ready |
| `Skeleton` | Loading states | Yes | Yes | Ready |
| `KeyValueList` | Settings | Yes | Yes | Ready |
| `CandidateCard` | Writer integration as future owned component | Yes | Yes | Deferred to writer feature |

## Spec To Mockup Mismatches

Not applicable. Stage 3 mockups were skipped by product decision.

Mockup risk if skipped:

- App Shell spacing and responsive collapse will need implementation QA against the design-system dimensions.
- Settings section density may need visual review in browser.
- Route Error Banner placement should be checked once the shell exists.

## Cross-Screen Visual Issues

No cross-screen mockups exist, so visual consistency must be verified during implementation.

Expected consistency rules from specs:

- `Alert` is the route error pattern across route failures, Settings failures, and backend recovery.
- `TopStatusBar` is summary only; route and field errors remain local.
- `SidebarNav` owns active route and placeholder navigation consistently.
- Placeholder routes must stay utilitarian and avoid decorative coming-soon pages.
- No screen should use a landing-page or marketing layout.

## Consistency Issues

Resolved:

- Stage 1 mentioned `InlineError`; Stage 2 specs use `Alert`, which is defined in `product-components.md` for persistent page feedback.
- Voice and Post Library are consistently treated as shell-owned placeholders.
- Settings repair consistently does not auto-return; it offers explicit back navigation.

Remaining:

- `PageHeader` needs a component definition or implementation-level convention.
- Decide whether placeholder routes are enabled from day one or hidden until their feature epics start.
- Decide whether `/` mutates the URL to `/writer`.

## Heuristic / Design QA Issues

| Issue | Location | Severity | Recommended Fix |
|---|---|---:|---|
| Missing `/status` and `appStatusSchema` blocks status implementation | Top Status Bar, Settings, App Shell | P0 | Define shared status schema and engine endpoint before shell UI implementation |
| Missing `apiErrorSchema` blocks consistent recovery | Route Error Banner, Writer, Settings | P0 | Define error shape with `code`, `message`, `scope`, `retryable`, and `details` |
| Missing `appSettingsSchema` and persistence boundary blocks Settings | Settings Route | P0 | Define settings schema and initial persistence target |
| Route registry contract is open | App Shell, Sidebar Nav, placeholders | P0 | Define route ids, labels, paths, enabled state, and placeholder flags |
| `PageHeader` lacks component definition in detailed component spec | Settings, Writer, placeholders | P1 | Add compact `PageHeader` spec to `product-components.md` or implementation docs |
| Mockups skipped means visual density is unproven | App Shell, Settings, Route Error Banner | P2 | Verify in browser during implementation; create one reference mockup only if ambiguity remains |

## Handoff Readiness Gaps

Required before implementation:

- Define `GET /status` response and `appStatusSchema`.
- Define `apiErrorSchema` and API client classification rules.
- Define `appSettingsSchema` and persistence target.
- Define route registry contract and whether placeholders are enabled.
- Define `/` behavior: redirect to `/writer` or render Writer at root.
- Add or confirm `PageHeader` component behavior.

Nice to decide before implementation:

- Status refresh interval policy.
- Sidebar collapsed persistence from day one.
- Writer draft persistence across full page reload.
- Whether recovered errors show a success toast or simply disappear.
- Whether exact local engine URL is visible outside Settings.

## Recommended Actions

1. Approve Stage 4 with mockups skipped for this shell-contract pass.
2. Move to architecture or ticketing for the six P0 contracts: `/status`, `appStatusSchema`, `apiErrorSchema`, `appSettingsSchema`, route registry, and settings persistence.
3. Add a compact `PageHeader` definition to the design-system component docs, or record the implementation convention in the shell architecture.
4. Decide placeholder enablement for `/voice` and `/library`.
5. Start implementation/TDD from App Shell, Top Status Bar, Route Error Banner, Sidebar Nav, Settings Route, then Writer Route Shell Integration.
