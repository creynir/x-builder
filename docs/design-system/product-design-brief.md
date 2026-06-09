# Product Design Brief — X Builder

Stage: product-design-system / Stage 1 EXTRACT.

Status: restarted draft for review.

Restart reason:

The previous design-system pass produced token-compliant artifacts, but the visual output still read as a generic dark component gallery. This restart raises the bar: the design system must produce an unmistakably product-specific ops console for X post recommendation, not a themed component demo.

## Source Inputs

No marketing design system, brand strategy, or `tokens.css` exists for this product. Brand DNA is therefore inferred from the product's job, target user, and the approved direction from prior review.

Approved constraints:

- Accent hue: X-adjacent blue/cyan.
- Product feel: ops console.
- Default density: 32px controls.
- Font direction: Geist for UI, JetBrains Mono for data.
- Product purpose: internal local-first app for generating, judging, and learning from X posts.

## Brand DNA

### Accent

X-adjacent blue/cyan.

It should feel connected to X without copying X's consumer social UI. Use accent as operational signal:

- active navigation
- selected candidate
- primary generation action
- focus ring
- Codex-ready status

Do not use accent for:

- decorative backgrounds
- big blue panels
- generic “AI glow”
- gradients
- large hero-like surfaces

### Fonts

- Display: Geist, used rarely for route-level titles only.
- Body: Geist, used for navigation, labels, controls, candidate metadata, and product copy.
- Mono: JetBrains Mono, used for scores, ranks, timestamps, provider status, IDs, metrics, and JSON/CLI output.

The mono font is the product's evidence voice. If something is factual, measured, ranked, imported, or produced by a system boundary, mono is allowed.

### Personality

- precise
- skeptical of fake certainty
- founder-led
- quiet but opinionated
- analytical without becoming sterile
- fast to scan

### Neutral Tint

Cool neutral, tinted toward blue/cyan. Never pure gray. The UI should feel dark and focused, but not black-terminal cosplay.

### Icon Style

Simple stroked icons, consistent optical weight, no decorative icon art.

Default icon size: 16px.

Product-specific icon meanings must be stable:

- deterministic engine
- Codex judge
- voice profile
- known post
- signal evidence
- imported metric
- unavailable / partial / stale

## Product Classification

Type: data-dense workflow and analysis console.

Not a social media scheduler.
Not a writing notebook.
Not a dashboard template.
Not a landing page.
Not a generic AI chat app.

The closest mental model:

```txt
an ops console for founder writing decisions
```

The UI must help the user answer:

1. What should I post?
2. Why this version?
3. What does my history say?
4. What did the judge catch?
5. What evidence did we use?
6. What have we not used yet?

## Product Design Principles

### 1. Recommendations Need Evidence

Brand attributes: skeptical, precise, analytical.

What it means:

The app never presents a post as “best” without showing the layers that produced that recommendation. Deterministic rank, Codex judge, voice match, known-post references, and later analytics evidence must remain inspectable.

Token and UI implications:

- Score displays must use mono values plus plain-language bands.
- Candidate cards need room for reasons and risks, not just a pretty score.
- Codex output uses an `info` treatment, never primary CTA styling.
- Warning/uncertain states are first-class, not hidden in tooltip copy.
- Product copy must say “Heuristic rank, not prediction.”

### 2. The Writer Controls The Machine

Brand attributes: founder-led, quiet but opinionated.

What it means:

The product is not an AI autopilot. The writer sees the machine's work and decides. Codex judge may critique or rank, but deterministic generation and scoring still stand on their own.

Token and UI implications:

- Candidate selection is visually stronger than judge recommendation.
- Primary actions are user actions: Generate, Select format, Copy, Save, Mark used.
- LLM failure is a partial state, not a product failure.
- “Codex judge unavailable” must preserve the candidate board.
- No chat-style centered conversation as the main interaction model.

### 3. Memory Is A Product Surface

Brand attributes: practical, evidence-first.

What it means:

The Post Library is not admin plumbing. It is where the product accumulates taste, voice, and signal. Imported posts must show source, usage state, evidence role, and freshness.

Token and UI implications:

- Tables are dense, first-class, and polished.
- Used/unused/excluded states need icon + text + muted/semantic treatment.
- Source labels use mono badges.
- Row actions must support bulk work.
- Empty states guide the user toward importing or selecting evidence.

### 4. Density With A Reading Rhythm

Brand attributes: precise, calm.

What it means:

The UI should fit a lot of useful information into one viewport without equalizing everything. Every panel needs a clear primary read, then secondary details, then diagnostics.

Token and UI implications:

- Default control height: 32px.
- Candidate board should fit three formats on desktop.
- Right inspector should be subordinate, not a fourth equal card.
- Panel padding may vary by purpose; do not use identical padding everywhere.
- Use borders and alignment more than shadows.

### 5. No Generic AI Aesthetic

Brand attributes: skeptical, product-specific, professional.

What it means:

If the UI could belong to any AI SaaS product, it fails. X Builder must visually center the actual work: post text, evidence, ranks, judge notes, import state, and usage state.

Anti-slop constraints:

- No hero sections.
- No decorative gradients.
- No big glowing AI panels.
- No generic “AI assistant” chat layout as the default.
- No component-gallery page as proof of design quality.
- No cards floating in endless dark space.
- No equal-weight panels where hierarchy is needed.
- No placeholder icons or emoji-style symbols in final mocks.
- No lorem ipsum or abstract demo content.

## Product Color Balance

Viewport target:

- 85% cool neutral surfaces and text.
- 5-8% X-adjacent blue/cyan accent.
- 5-10% semantic states.

Accent usage:

- Generate button.
- Active route indicator.
- Focus ring.
- Selected candidate outline.
- Active tab underline.
- Small readiness/status details.

Semantic roles:

- Success: imported, saved, copied, judge complete, valid.
- Warning: partial import, low evidence, heuristic uncertainty, stale data.
- Danger: invalid input, failed import, judge failure, excluded/destructive.
- Info: Codex judge, provider status, explanatory system note.
- Uncertain: missing metrics, deterministic-only, not enough evidence.

Color rules:

- Score bars can use semantic bands, but must include labels.
- Source/category colors cannot compete with state colors.
- Imported metric confidence must be encoded with text and badge, not color alone.

## Typography Mapping

- Display: Geist → route title only.
- Body: Geist → almost all UI.
- Mono: JetBrains Mono → factual/system/data values.

Base:

- 14px body.
- 13px compact table/body small.
- 12px labels, helpers, controls metadata.
- 11px badges and dense status only.
- 16-18px panel/section headings.
- 20-24px rare page headings.

Rules:

- No viewport-based font scaling.
- Letter spacing is 0 for normal text.
- Uppercase labels are rare and must use a token.
- Long post text uses readable line height and constrained measure.
- Candidate text gets visual priority over generic UI chrome.

## Density Target

Product type: data-dense workflow and analysis console.

- Default control height: 32px.
- Default table row: 36px.
- Compact mode: later.
- Comfortable mode: later.
- User-switchable density: later.

Day-one layout target:

- Desktop-first.
- Three candidate formats visible at once on wide desktop.
- Post Library table supports dense scanning.
- Voice profile editor should not feel like a form-heavy settings page.

## Product Readiness

### Success Criteria

The design system must make these workflows faster and clearer:

- Generate first useful candidate set in under 30 seconds after app open.
- Compare three formats without scrolling on desktop.
- Understand deterministic score vs. Codex judge at a glance.
- See which known posts are unused, used for voice, used for signal, or excluded.
- Recover from Codex failure without losing deterministic candidates.
- Import posts and understand valid, invalid, skipped, and duplicate rows.

### Information Architecture

Phase 1 navigation:

- Writer.
- Voice.
- Post Library.
- Settings.

Phase 2 navigation:

- My Analytics.
- Signals.

Core nouns:

- Idea.
- Candidate.
- Variant.
- Format.
- Heuristic rank.
- Codex judge.
- Voice profile.
- Known post.
- Signal.
- Evidence.
- Import.
- Generation run.
- Published result.

Copy rules:

- Say “Codex judge,” not “AI judge.”
- Say “Heuristic rank, not prediction.”
- Say “Known posts,” not “dataset.”
- Say “Evidence,” not “training data.”
- Say “Signals,” not “inspiration.”
- Avoid motivational empty-state copy.

### Localization Scope

Day one:

- English-only.
- Long post text and long labels must not break layout.
- Date/time/number formatting must be locale-safe.

Later:

- Pseudo-localization.
- RTL if product need appears.

### Accessibility Scope

Target: WCAG 2.1 AA.

Required from first UI implementation:

- Keyboard candidate selection.
- Visible focus ring.
- Score labels and values readable without color.
- Live regions for generation and judging completion.
- Inline errors connected to inputs.
- Modal/drawer focus trap if overlays are used.
- Table row selection via keyboard.
- Reduced motion support.

### Governance

Owner: product engineering.

Contribution rule:

- Root design-system docs define reusable tokens/components/patterns.
- Feature folders define feature-specific flows/specs/tickets/architecture.
- New shared UI patterns must update root design system before feature specs depend on them.

Versioning:

- Prototype: direct docs updates.
- After first implementation: maintain design debt register.

## Product-Specific Challenges

1. The app must make generated text feel central without becoming a writing notebook.
2. Deterministic engine and Codex judge must be visually separate but comparable.
3. Candidate comparison needs hierarchy: selected candidate > other candidates > judge notes > diagnostics.
4. Post Library needs dense table polish because it is a memory surface, not admin.
5. Signals must show borrowed structure and evidence without encouraging copying.
6. X metrics later will have mixed confidence and freshness; the state model must support partial/stale/missing data.
7. The UI has to be skeptical about prediction while still helping the user make a decision.

## Stage 1 Approval Questions

The previously approved choices are preserved:

1. X-adjacent blue/cyan accent.
2. 32px default controls.
3. Ops-console feel.
4. Geist + JetBrains Mono.

New approval question:

Is the stricter positioning approved?

```txt
X Builder should look like an ops console for founder writing decisions,
not a generic AI component gallery or chat app.
```
