# X Builder — UI Uplift Brief

> **Purpose of this document.** A single, self-contained handoff for an agent/designer tasked with a visual + interaction uplift of X Builder. It captures what the product does, how it works, what is actually shipped today, what flows and screens must be supported, which components exist vs. must be built, and the visual/interaction language to design within. It reconciles the **aspirational product docs** with the **current shipped reality** — that gap is the most important thing to understand before designing.
>
> Sources synthesized: `docs/what-we-are-building.md`, `docs/component-breakdown.md`, the full `docs/design-system/*` set (brief, foundations, tokens, components, patterns, screens, validation), all `docs/features/*` folders, and the live client code under `client/src/`.

---

## 0. TL;DR for the uplift agent

- X Builder is a **local, single-user, desktop-web ops console** for one founder deciding what to post on X. Dense, fast, evidence-first. **Not** a marketing dashboard, content calendar, scheduler, or AI chat app.
- **The shipped product has pivoted** from the original "generate 3 candidate formats" vision toward a **single-draft evaluation "Studio"**: paste a draft → it auto-scores (deterministic) → a "Draft Review" coach + an engagement/reach prediction → optionally run an LLM **Judge**. Generation of candidate variants still exists in code but is no longer the primary loop. The route is literally labelled **"Studio"** in the UI even though navigation/IA still call it "Writer".
- A strong, complete **design system already exists** (tokens, components spec, patterns, validated static HTML). The **implemented UI is much sparser** than that system — a single scrolling column, only ~13 primitive components, placeholder Voice/Library routes, no Tabs/DataTable/Select-as-component/Switch-as-component yet. **The uplift's job is to close the gap between the validated design system and the thin shipped UI**, and to absorb the in-flight reach-model upgrade.
- Visual direction is locked and approved: **dark cool-neutral ops console, X-adjacent blue/cyan accent used sparingly, Geist + JetBrains Mono, 32px controls / 36px rows, borders over shadows, no gradients/glow/hero/chat.**
- An in-flight epic (`reach-model-upgrade`, the current git branch) adds: a **two-regime reach prediction**, an **Advanced context** panel, **13 judge rubric dimensions**, an **account-profile** input, a **two-pass judge→reach refinement**, and **per-provider judge selection** (Codex / Claude / Cursor). Design must accommodate these.

---

## 1. What the product does, and how

### 1.1 One-line definition
A local internal workbench for deciding what to post on X: take a draft (or an idea), score it deterministically, optionally have an LLM "Judge" critique it, predict its reach, and — eventually — learn from real outcomes so future recommendations improve.

### 1.2 Who it's for
A single founder ("the writer"). Local-first, no auth, no multi-user, no hosting. The writer is in control; the machine advises. This is an **operator console**, and the user is an operator who wants to scan evidence fast and decide.

### 1.3 The mental model (locked positioning)
> "An ops console for founder writing decisions."

The UI must help the user answer: *What should I post? Why this version? What does my history say? What did the judge catch? What evidence did we use? What haven't we used yet?*

### 1.4 The core loop (aspirational, from product docs)
```
idea → candidate generation → deterministic scoring → Codex/LLM judge
     → user selection → saved/copied/marked published
     → later: X metrics imported → feedback loop improves recommendations
```

### 1.5 The core loop (as actually shipped today)
```
paste a DRAFT → (500ms debounce) auto deterministic analysis
   → "Draft Review" coach card (checks: flagged / nudges / on-point)
   → Engagement/Reach prediction card (needs follower count)
   → [Judge draft] → LLM verdict (band + confidence + dimension scores + strengths/improvements)
   → open "Deterministic details" drawer for the full breakdown
```
The shipped loop is **evaluate-a-draft**, not **generate-candidates**. Treat the draft-evaluation Studio as the product's center of gravity for the uplift.

### 1.6 Two hard product rules that drive the UI
1. **Deterministic scoring always runs and stands alone.** The LLM judge is *additive*. If the judge/provider is unavailable, the deterministic results must remain fully usable. The two channels must be **visually separate and comparable** — the judge must never look like the source of truth and must never use primary-CTA styling.
2. **Honesty about confidence.** Scores are labelled **"Heuristic rank, not prediction."** Predictions are "predicted, not measured." Signals are "signals, not verdicts." Missing data is a first-class state, never hidden.

### 1.7 Architecture (context, not a UI concern but explains the status bar)
```
Client (React + Vite)  →  Engine (Fastify)  →  deterministic engine
                                              →  LLM provider via CLI (codex / claude / cursor exec)
                                              →  local storage (settings JSON only, today)
Shared (Zod schemas)  ← contract used by both client and engine
```
Engine routes today: `GET /health`, `GET /status`, `GET/PATCH /settings`, `POST /ideas/generate`, `POST /posts/analyze`, `POST /drafts/judge`. The UI surfaces engine/scorer/judge/storage readiness in a top status bar.

---

## 2. Current shipped UI — the uplift's starting point

This is what exists in `client/src/` **today**. The uplift starts here.

### 2.1 App shell (`shell/app-shell.tsx`)
A persistent two-region frame:
- **Left:** `SidebarNav` — brand wordmark "x-builder", a collapse toggle (`<` / `>`), and four route links each with a hand-drawn SVG icon + label + active marker: **Writer, Voice, Post Library, Settings**. Active route uses `aria-current="page"` and a marker element. Collapsed state persists in localStorage.
- **Right (`main`):** a skip link, then a **TopStatusBar**, then a route `<header>` with the route `<h1>` (focus target on navigation), then the route outlet `<section>`.
- **Route error boundary** wraps each route; a render failure shows a `RouteErrorBanner` ("This route could not render." + Retry + Open Settings) without unmounting shell/nav.
- **Settings dirty-guard:** navigating away from a dirty Settings route raises an unsaved-changes warning (in-app alert + `beforeunload`).
- Routing is hand-rolled (history abstraction), paths `/writer` `/voice` `/library` `/settings`; unknown paths canonicalize to `/writer`.

### 2.2 Top status bar (`shell/status-bar.tsx`)
A single `aria-live="polite"` strip showing four subsystem badges — **Engine, Deterministic scorer, Judge, Storage** — each rendered as a `Badge` reading "`<Label> <state>`" (e.g. "Judge ready"), color-mapped (success/warning/danger/info/uncertain) but always with text. Plus a **Last run** value (idea id / timestamp / "No runs yet" / "Checking"), a "Refreshing" indicator, a conditional **Open Settings** button (shown on partial/unavailable/invalid), and a **Refresh** button. States: checking / ready / partial / unavailable / invalid / refreshing.

### 2.3 Writer = "Studio" route (`features/writer/writer-page.tsx`)
A **single scrolling column** (`.xb-writer-workspace`), top to bottom:
1. `RouteErrorBanner` slot (engine/generation failure; preserves the draft).
2. **Idea/Draft form** — a `<textarea>` labelled "Draft", placeholder "Paste a draft post to evaluate…", helper "Paste or edit a post. Studio scores it automatically.", `aria-busy` while generating, field error slot.
3. **Results stack**:
   - **`ManualScoringContextPanel`** — "Manual account context" with a Followers number input, a "Prediction needs refresh." stale notice + "Recompute prediction" button when stale, and a KeyValueList showing context source (manual/missing) and whether prediction context is included/skipped.
   - **Studio evaluation** (`aria-live="polite"`): while generating → three candidate skeletons. Otherwise, for the pasted draft → **`DraftDeterministicEvaluation`** = an `EngagementPredictionCard` + a compact `PostCoachCard` ("Draft Review"). For generated variants (secondary path) → `CandidateDeterministicSummary` cards with a "Details" button. Empty → `DraftEvaluationEmptyState` ("Paste a draft and add followers to estimate impressions.").
4. **`JudgePanel`** — header "Draft Judge" + a single button (Judge draft / Judging… / Try judging again), an unavailable hint, skeleton while loading, a danger alert on failure, and on success a verdict block: a band `Badge` (Post now / Slight rework / Major rework / Do not post), confidence text, "Judged by {provider}" attribution, a headline, a `<dl>` of 8 score rows (Overall, Replies, Profile clicks, Impressions, Bookmark value, Dwell, Voice match, Negative risk), and Strengths / Improvements lists.
5. **`Drawer`** ("Deterministic details") — opened from a candidate's "Details" button; hosts the **`DeterministicDetailInspector`** (full Post Coach card + full Engagement Prediction card + KeyValueList of source/detected format, analyzed-at, analyzer version; states empty/loading/error/failed/ready; Escape closes and returns focus).

### 2.4 Deterministic display components (`features/writer/deterministic/components.tsx`)
- **`EngagementPredictionCard`** — today shows Range (low–high), Midpoint, Confidence as a KeyValueList, plus a "Prediction signals" list (label + multiplier per signal). Disabled state → warning Alert + "Add followers" recovery. *(The reach-model upgrade replaces this internal layout — see §5.)*
- **`PostCoachCard`** ("Draft Review") — a `ScoreBar` + a tone `Badge` (Top/Ship/Almost/needs-review), check counts (Flagged / Nudges / On point), an engageability badge + reason, and collapsible `<details>` groups of checks (each check = status badge pass/warn/fail + label). Has compact and full densities. Footer + learning caveat copy.
- **`CandidateDeterministicSummary`** — post text + "Static score" ScoreBar + counts + top-2 checks + a prediction badge. (Secondary/generated-candidate path.)
- **`ManualScoringContextPanel`**, **`DraftEvaluationEmptyState`**, **`DeterministicDetailInspector`** as described above.

### 2.5 Settings route (`shell/settings-route.tsx`)
A single form section: heading "Settings" + source badge (Using defaults / Persisted settings) + dirty "Unsaved changes" badge + "Back to Studio". Fields: **Engine URL** (validated to local http(s)), **Storage path**, **Judge provider** (`<select>`: Codex judge / Claude judge / Cursor judge), three optional model text fields (**Codex model / Claude model / Cursor model**, helper "Leave empty to use the provider's default."), and a **Show deterministic details** switch (native checkbox). Actions: **Save settings** (enabled when dirty+valid), **Test readiness** (enabled when clean). Below: a live-region row of readiness badges. Error alerts for load/save/status with tailored recovery. Unsaved-navigation warning alert with Stay / Discard.

### 2.6 Voice & Post Library routes
**Placeholders only.** Each renders an `EmptyState` ("… workspace") with honest copy ("Voice profile setup is not part of this shell pass." / "Post memory is reserved for the library feature pass.") and a "Back to Studio" button. No real functionality.

### 2.7 Shipped primitive library (`ui/foundation.tsx`)
Implemented and token-styled: **Button** (primary/secondary/ghost/danger, sm/md, loading, leading/trailing icon), **IconButton** (label+tooltip+icon), **Badge** (neutral/accent/success/warning/danger/info/uncertain + usage-unused/voice/signal/generation/excluded), **Tooltip** (CSS hover/focus), **Alert** (warning/danger + recovery slot), **EmptyState**, **Skeleton**, **ScoreBar** (progressbar role, value+band+help), **Input** (label/helper/error), **Drawer** (dialog/aria-modal), **KeyValueList**, **PageHeader**, **ToastRegion** (an empty live region — toasts not really wired).

### 2.8 Honest assessment of the current UI (what the uplift must improve)
- It is **functional but visually thin**: one long column, cards stacked, little hierarchy, no real layout grid, inspector is a basic drawer, status bar is a row of text badges.
- **Components specified in the design system but NOT yet built:** `Tabs` (the Writer Candidates/Judge/Evidence and Library tabs), `DataTable`/`KnownPostsTable`, `Select` (as a styled component — Settings uses a raw `<select>`), `Switch` (as a component — uses raw checkbox; being extracted in RMU-003), `Slider`, `Dialog`, `Status Dot`, `Divider`, real `Toast`, `CandidateCard` (proper), `PostTextPreview`, `UsageStateBadge`, `VoiceProfileEditor`, `ImportPreviewTable`, command palette (`Cmd+K`).
- **Naming drift:** IA says "Writer"; the page calls itself "Studio"; coach is "Draft Review"; judge panel is "Draft Judge". Decide and harmonize the product vocabulary during the uplift.
- **No tabs / no inspector-as-aside on desktop:** the design system wants Writer = idea-left / candidates-center / judge-inspector-right, with Candidates/Judge/Evidence tabs. The shipped page is a vertical stack. This is the single biggest structural uplift opportunity.

---

## 3. Information architecture & navigation

### 3.1 Routes
| Phase | Route | Path | Status today |
|---|---|---|---|
| 1 | Writer ("Studio") | `/writer` | **Built** (draft-evaluation studio) |
| 1 | Voice | `/voice` | Placeholder |
| 1 | Post Library | `/library` | Placeholder |
| 1 | Settings | `/settings` | **Built** |
| 2 | My Analytics | `/analytics` | Not built (planned) |
| 2 | Signals | `/signals` | Not built (planned) |

### 3.2 Persistent shell regions (keep across all routes)
- Sidebar navigation (expanded 224px / collapsed 48px rail).
- Top status bar (engine / deterministic / judge / storage / last run) — height target 22–40px.
- Route content (`main`).
- Route-local error banner.
- Optional right inspector / drawer (collapses first on narrow screens).

### 3.3 Navigation behavior to preserve
- Shell renders before backend readiness (never a full-screen blocker).
- Backend unavailable does **not** disable nav links.
- Focus moves to the route `<h1>` on navigation.
- Sidebar collapsed + last route persist locally.
- Planned: command palette `Cmd+K`; route shortcuts `G W / G V / G L / G S`.

---

## 4. Flows to support

Each flow lists steps and the **five required state treatments** (Ideal / Empty / Loading / Error / Partial) the design system mandates for every screen.

### 4.1 App boot & readiness (built)
Render shell immediately → resolve route (unknown → `/writer`) → `GET /status` independently → status badges reflect ready/partial/unavailable. **Partial** (e.g. judge unavailable, deterministic ready) keeps everything usable and surfaces "Open Settings". No whole-app loader.

### 4.2 Evaluate a draft — the primary flow (built; the heart of the product)
1. User pastes/edits a draft in the textarea.
2. After a 500ms pause, the client calls `POST /posts/analyze` automatically.
3. **Draft Review** coach card renders (score band, engageability, checks grouped flagged/nudges/on-point).
4. **Engagement/Reach prediction** card renders — *requires a follower count*; without it, show the "Prediction needs follower count" + "Add followers" recovery (this is **not** an error; the coach still works).
5. User optionally opens **Deterministic details** drawer for the full breakdown.
6. User optionally clicks **Judge draft** → LLM verdict renders (see §4.4).
- **States:** Empty (paste a draft / add followers prompts), Loading (skeletons, draft stays editable), Error (score failed → per-card "Retry score", draft preserved), Partial (coach ready, prediction disabled for missing followers, or judge unavailable). Editing the draft marks analysis **stale** ("Prediction needs refresh.").

### 4.3 Generate candidates (secondary; in code, de-emphasized)
Idea → `POST /ideas/generate` → first-pass candidates (originally one per format: one-liner / mini-framework / debate-question) → deterministic scoring per candidate → select a format → generate variants → copy / save / mark used. The design-system "candidate comparison board" (3 columns, selected-candidate outline outranks judge) describes the *intended* shape; the uplift should decide whether to revive this as a first-class board or keep evaluation-first.

### 4.4 Judge a draft (built; extended by RMU)
Deterministic results render first → user clicks **Judge draft** → async LLM call (~60s, codex/claude/cursor CLI) → verdict band + confidence + dimension scores + headline + strengths/improvements + "Judged by {provider}". States: idle / loading (skeleton) / ready / failed (danger alert + "Try judging again") / unavailable (button disabled + "The judge is unavailable right now. Check the provider in Settings."). **Never blocks or replaces deterministic output.**

### 4.5 Two-pass reach refinement (in-flight, RMU-013)
After the judge verdict publishes, the client silently re-issues `POST /posts/analyze` with two scalars from the verdict (`judgeSignals: {impressions, replies}`). The refined prediction **replaces** the static one (different scale, no before/after diff). UI: an `info` "Refining reach…" badge in the live region during the pass; on success the reach block gains an `accent` badge **"Refined with judge signal"** (`qualityBasis: static → judge`). On failure, the static prediction and judge verdict remain. Stale races dropped by requestId + draft-text equality.

### 4.6 Repair missing context / failure (built)
Distinguish *missing context* (followers absent → enter inline, recompute prediction only — never regenerates text) from *system failure* (engine unreachable → route banner + retry + Open Settings). Score retry ≠ generation retry. Work is never lost on failure.

### 4.7 Configure & test readiness (built)
Edit Settings → Save → status auto-refreshes → Test readiness shows per-subsystem badges. Choose judge provider + optional model. Dirty-guard on navigate-away.

### 4.8 Planned flows (Phase 1 completion + Phase 2 + Later)
- **Manual import** (`/library`): paste / CSV / JSON → `ImportPreviewTable` classifies rows (parsed / duplicate / missing-metrics / partial / invalid) → import valid rows while invalid stay for repair → persisted to `KnownPostsTable`.
- **Voice extraction** (`/voice`): select known posts → extract → review/accept/reject traits, edit keep/avoid phrase lists, see example sources, confidence + freshness, save manual overrides (user-owned, survive re-extraction).
- **Known-posts management** (`/library`): dense table with usage states (unused / voice / signal / generation / excluded), bulk tag/exclude/mark-used, filters, row actions, keyboard selection.
- **My analytics & feedback** (`/analytics`, Phase 2): X API auth, import own posts+metrics, profile-readiness scorecard, compare generated vs published, learned weights.
- **Signals** (`/signals`, Phase 2): import external accounts, extract hooks/structures/angles as signals ("borrow structure, not content"), convert to generation constraints.
- **Publish/export** (Later): copy to clipboard, mark published, paste X URL, connect candidate→real post→imported metrics.

---

## 5. The reach-model upgrade (in-flight) — new UI surface to design

The current branch (`feat/RMU-reach-model-upgrade`) reshapes prediction and judging. Design must absorb:

### 5.1 New reach-regime display (replaces Range/Midpoint/Confidence)
`ReachRegimeBlock` renders these server-supplied fields, in order:
| Label | Field | Format |
|---|---|---|
| Expected reach | `predictedMidImpressions` | integer, thousands sep ("1,500") — the honest point estimate |
| Escape likelihood | `escapeProbability` | percentage in an `info` badge ("12%") |
| Typical reach | `stallRange.low–high` | "800 – 2,400" |
| If it breaks out | `escapeRange.low–high` | "6,000 – 40,000" |
| Expected replies | `expectedReplies` | integer ("9") |
| (provenance) | `qualityBasis` | `accent` badge "Refined with judge signal" when `"judge"`; nothing when `"static"` |
Legacy `rangeLow/rangeHigh/midpoint/confidence` are removed. Sub-labels are `<dt>/<p>`, not headings. No number animation; constant card height regardless of badge (no layout shift).

### 5.2 Advanced context panel (RMU-010)
A collapsed `<details>` "Advanced context (optional)" below the Manual context panel, containing: `trailingMedianImpressions` (number; helper "Median views of your last 20 original posts — exclude pinned and RTs. Find in X Analytics."), a **RepeatHistoryControl** (checkbox "I posted something similar in the last 7 days" → reveals a date input), `plannedHourUtc` (0–23 with inline validation), `willAttachMedia` (**Switch**), `accountAgeYears` (number). Entering values triggers re-analysis (debounced).

### 5.3 Judge rubric — 13 dimensions (LJ-005 + RMU-012)
Existing 8 numeric rows (Overall, Replies, Profile clicks, Impressions, Bookmark value, Dwell, Voice match, Negative risk) **plus 5 new**:
- **Answer effort** (100 = one-word reply ↔ 0 = essay)
- **Stranger answerability** (100 = anyone reacts ↔ 0 = insiders only)
- **Status dependency** (100 = needs famous bio ↔ 0 = self-evident/humor)
- **Audience match** (0–100 **or null**; null → "Needs account profile" + ghost "Add account profile" button → opens Settings)
- **Reply vs quote orientation** — a **display-only labeled 0–100 scale** ("Reply-oriented ↔ Quote-oriented"), NOT a progress bar, NOT an enum.
Verdict band is derived from `overall` (≥85 Post now / 70–84 Slight rework / 40–69 Major rework / <40 Do not post); confidence is low/medium/high.

### 5.4 Account profile (RMU-014) & provider selection (CAD-012)
Settings gains an **Account profile** textarea (3–4 rows, helper "Describe your audience and niche. The judge uses this to score audience match."). Judge provider select + per-provider model fields already shipped. Provider labels: Codex judge / Claude judge / Cursor judge. Verdict attribution maps the response model id through a shared catalog.

### 5.5 Calibration workspace (RMU-015/016) — note, not a UI
`@x-builder/calibration` is a developer CLI tool (no UI surface). Ignore for visual design unless a future internal "calibration" view is requested.

---

## 6. Component inventory for the uplift

### 6.1 Design-system baseline vocabulary (reference these by name)
`AppShell, SidebarNav, TopStatusBar, PageHeader, Button, IconButton, Textarea, Input, Select, Tabs, Dialog, Drawer, Tooltip, Badge, ProgressBar, ScoreBar, DataTable, Switch, Slider, Toast, EmptyState, Skeleton, InlineError, CandidateCard, JudgePanel, PostTextPreview, UsageStateBadge, KnownPostsTable, VoiceProfileEditor, ImportPreviewTable` — plus `Status Dot, Divider, Alert, KeyValueList` from the component spec.

### 6.2 State coverage every component must define
default, hover, active, focus, disabled, loading, selected, empty, error, partial. Every **screen** must cover Ideal / Empty / Loading / Error / Partial.

### 6.3 Build/uplift priority
- **Exists, polish only:** Button, IconButton, Badge, Tooltip, Alert, EmptyState, Skeleton, ScoreBar, Input, Drawer, KeyValueList, PageHeader, sidebar, status bar.
- **Exists raw, needs componentizing:** Select (raw `<select>` in Settings), Switch (raw checkbox; RMU-003 extracts it), Textarea (raw), Toast (empty region).
- **Specified, not built — high value for uplift:** Tabs (Writer: Candidates/Judge/Evidence; Library: Known Posts/Unused Signal/Imports), DataTable / KnownPostsTable, CandidateCard (proper, with selection outline), PostTextPreview, UsageStateBadge, ImportPreviewTable, VoiceProfileEditor, Dialog, Slider, Status Dot, command palette.
- **Product-specific composites:** EngagementPredictionCard → ReachRegimeBlock, PostCoachCard ("Draft Review"), DeterministicDetailInspector, ManualScoringContextPanel, AdvancedContextPanel, JudgePanel (13 dims), AccountProfileField.

### 6.4 Product-specific component rules (do not violate)
- **Candidate selection must visually outrank judge recommendation** (selection = outline/ring channel).
- **Judge uses `info` treatment, never primary CTA styling.** Raw output collapsed by default.
- **Score bars always show numeric value + band text** (never color-only), with "Heuristic rank, not prediction." near the aggregate.
- **Tables are dense, first-class memory surfaces** (not admin afterthoughts): usage state via icon+text+semantic tint, mono source badges (`MANUAL`, `X API`, `CODEX`, `HEURISTIC`), bulk actions, row-local errors.
- **No nested cards, no page sections as floating cards.** Borders + alignment + surface steps carry layout; shadows only for true overlays.

---

## 7. Visual & interaction language (locked)

### 7.1 Brand DNA
Personality: precise, skeptical of fake certainty, founder-led, quiet but opinionated, analytical without being sterile, fast to scan. Mental model: ops console.

### 7.2 Color
- **Surfaces/text:** ~85% cool neutral, blue/cyan-tinted (never pure gray, never pure black/white). Dark default theme; a light theme token set exists.
- **Accent (X-adjacent blue/cyan):** only ~5–8% of viewport — primary action, active route marker, selected candidate outline, focus ring, active tab underline, small readiness states. **Never** decorative backgrounds, big panels, AI glow, or gradients.
- **Semantic roles:** success (saved/imported/copied/judge-complete/valid), warning (partial/low-evidence/stale/heuristic-uncertainty), danger (invalid/failed/excluded/destructive), info (judge/provider/system note), uncertain (deterministic-only/missing-metrics/insufficient-evidence). ~5–10% of viewport.
- **Usage-state family:** usage-unused / usage-voice / usage-signal / usage-generation / usage-excluded (for the post library).
- Color never the sole channel — always pair with text/icon/shape.

### 7.3 Typography
- **Geist** for display (route titles only, rare) and body (almost all UI).
- **JetBrains Mono** is the **"evidence voice"** — scores, ranks, timestamps, provider status, IDs, metrics, JSON/CLI output. If it's factual/measured/ranked/imported/system-produced, it's mono.
- Scale: 11 (dense badges/status) · 12 (labels/helpers/captions) · 13 (compact rows/secondary) · 14 (default body/controls) · 16 (panel titles) · 18 (dialog/section) · 20 (page section) · 24 (route title max). No viewport-based font scaling. Letter-spacing 0 except rare tokenized uppercase labels.

### 7.4 Density & layout
- **Controls 32px, table rows 36px, nav items 32px** (default density; compact/comfortable exist as tokens only).
- Dimensions: header 40px, status bar 22px, sidebar 224/48px, inspector 340px (min 280 / max 420).
- Panel priority: main work surface > candidate board > inspector > sidebar > status bar.
- **Responsive collapse order:** inspector → drawer first, sidebar → icon rail next, status bar compresses, main surface always remains. Desktop-first; aim to fit 3 candidate formats without horizontal scroll on wide screens.
- Purpose-specific padding (writer input default, candidate board compact, judge inspector compact, library table dense, settings default) — **do not use identical padding everywhere.**

### 7.5 Elevation, borders, radius, motion
- Dark mode uses surface steps + light borders before shadows; shadows reserved for overlays. No decorative shadows.
- Radius: 3px dense controls/badges · 4px buttons/inputs/rows · 6px panels/dropdowns · 8px overlays. No nested cards.
- Motion functional only (50–400ms), animate only transform/opacity, reduced-motion disables animation but preserves state changes.

### 7.6 Anti-slop constraints (the design fails if violated)
No hero sections, no decorative gradients, no glowing AI panels, no chat layout as the default interaction, no component-gallery-as-proof, no cards floating in endless dark space, no equal-weight panels where hierarchy is needed, no placeholder/emoji icons, no lorem ipsum. If the UI could belong to any generic AI SaaS, it has failed.

---

## 8. Copy rules (use these exact strings)

- Aggregate scores: **"Heuristic rank, not prediction."**
- LLM output labelled: **"Codex judge"** (provider-neutral surface uses **"Draft Judge"** / "Judged by {Codex|Claude|Cursor} judge"). Never "AI judge".
- Judge unavailable: **"Codex judge unavailable. Deterministic scoring still ran."** (shipped variant: "The judge is unavailable right now. Check the provider in Settings.")
- Reach refinement badge: **"Refined with judge signal"**; in-progress: **"Refining reach…"**.
- Missing followers: **"Prediction needs follower count."** / recovery **"Add followers"**; stale: **"Prediction needs refresh."**
- Vocabulary: say "Known posts" not "dataset", "Evidence" not "training data", "Signals" not "inspiration". Avoid motivational empty-state copy. Action labels are verbs (Generate, Copy, Save, Import, Mark used, Judge draft, Recompute prediction).
- Verdict bands: "Post now" / "Slight rework" / "Major rework" / "Do not post". Confidence: Low / Medium / High.

---

## 9. Accessibility baseline (WCAG 2.1 AA)
- One `<h1>` per route; `header` / `nav` / `main` / `aside` landmarks; skip link to `main`.
- Generation/judging results in `aria-live="polite"`; blocking errors `assertive`.
- Icon-only buttons need label + tooltip. Score bars expose value + band as text (never color-only). State indicators pair icon/text with color.
- Visible 2px focus ring (2px offset). Keyboard candidate selection, table row selection, drawer/dialog focus trap + Escape returns focus. Reduced-motion + high-contrast token overrides exist. Min touch target 24px (44px ideal for future mobile).

---

## 10. Recommended uplift focus (synthesis)

1. **Give the Studio a real layout.** Move from a single scroll column to the design-system intent: draft input + context controls on the left, deterministic evaluation as the center read, judge + reach as a subordinate right inspector (collapsible to drawer). Consider `Tabs` (Evaluate / Judge / Details) instead of a tall stack.
2. **Make deterministic vs. judge separation unmistakable** through layout + the info-vs-neutral channels, not just headings.
3. **Land the reach-regime block** as a scannable, mono-forward evidence panel (Expected reach hero number, escape likelihood, two ranges, expected replies, provenance badge) — honest, no false precision.
4. **Componentize the gaps**: Tabs, Select, Switch, Toast, Status Dot, DataTable — so Voice/Library/Analytics/Signals routes can be built consistently.
5. **Design the placeholder routes' real screens** (Post Library table + import, Voice profile editor) per §4.8 so the IA stops being half-empty.
6. **Harmonize vocabulary** (Writer vs Studio; Draft Review; Draft Judge) and apply the mono "evidence voice" consistently to every score/metric/timestamp/provider.
7. **Hold the line on the ops-console aesthetic** — dense, bordered, low-decoration, accent-disciplined, anti-slop.

---

## 11. Reference artifacts in the repo
- Validated static visual contract: `docs/design-system/product-screens.html`, `docs/design-system/product-components.html`.
- Tokens (authoritative): `docs/design-system/product-tokens.css`.
- Deterministic-engine spec mockups (HTML): `docs/features/deterministic-engine/spec/mockups/{writer-route-deterministic-workbench,candidate-deterministic-summary,deterministic-detail-inspector,manual-scoring-context-panel}.html`.
- Card reference images: `docs/features/deterministic-engine/assets/{post-coach-card-reference,engagement-prediction-card-reference}.png`.
- Live code to uplift: `client/src/shell/`, `client/src/features/writer/`, `client/src/ui/foundation.tsx`.
- Treat the static HTML as a **contract, not production code** — final UI must use the shared client component CSS/tokens, not duplicated inline styles.
```
