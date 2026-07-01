# x-builder — Engine Knowledge Base

The reach model behind x-builder. This is the faceless, shippable core: a universal
format taxonomy plus a graph-quality-adjusted scoring method that runs on **any
account's own stats as input**. No account is named; every account referenced
appears by role and follower band only. Personal tuning is a user input, never a
hardcoded profile.

Derived from a ~600-post observational study across 11 accounts (1.4k–58k followers)
and 4 niches (devtools/AI, VC, finance, creator), including one full 0→6k growth arc
and several matched format pairs. June 2026, after the Grok-based ranking rewrite.

Every multiplier is an estimate to be refit on the operator's own labeled data.
Scores are heuristic ranks, not guarantees.

---

## General

Use recognition formats when the account does not already have engaged authority.
Favor low answer-effort, concrete recognition, and graph-building replies over
abstract expertise. Do not recommend status-gated substance just because it reads
well.

---

## 0. The closed map: three outcomes, one path

Across every account and niche observed, posting behavior produces exactly three
outcomes, and only one grows reach:

- **Substance-only → dead.** Abstract analysis and expert essays flatline (tens to
  low hundreds of impressions) regardless of how correct or well-written they are.
  Observed on technical founders with 6k+ followers and deep expertise. Neither
  expertise nor follower count rescues it.
- **Bait-only → follower count, dead graph.** Self-RT chains, reciprocity follows,
  and milestone spam build a nominal follower number with a near-flat reach ceiling.
  Observed at 39k followers pulling ~400 impressions — a worse follower-to-reach
  ratio than an engaged 1.4k account.
- **Recognition formats for reach + real engagement/stories for graph quality →
  the only thing that grows.** This is the barbell. Confirmed from BOTH failure
  directions, not asserted.

The barbell is not an aesthetic preference. All-bait caps you at a follower number
with no reach behind it; all-substance never escapes the graph at all.

---

## 1. Core finding

**Format decides reach. Writing quality barely touches it. Recognition beats
substance at low follower counts, every time.**

Evidence pattern (accounts by role):
- A ~2.5k account posted a recognition-anxiety question that hit ~34k, and months of
  thoughtful substance from the same account that sat at 175–435. Same graph, only
  format changed.
- Two different ~2.5k accounts: one ran recognition questions and escaped to 34k;
  one ran substance/analysis and never broke 800. Only variable: format.
- A high-status (58k) account prints on bare aphorisms (24k–42k) that die on every
  small account. The variable is status, not the line.
- Writing quality is uncorrelated with reach: a 10k account writing rough English
  pulled 46k; another account's polished, careful essays died at 150–400 for a month.

---

## 2. Format taxonomy

Multiplier is the P50 reach vs the account's own trailing-median impressions.
Escape probability = chance of >3x trailing median. Both are universal across the
accounts observed; they multiply the account's own base, so a strong format on a
small graph still yields a small absolute number.

| Format | Multiplier | Escape p | Works below ~10k followers? |
|---|---|---|---|
| fill_blank_tribal ("X has A / Y has B / Z has?") | 3.0 | 0.30 | YES — recognition |
| cta_farm ("drop your X", "pitch in 1 word") | 3.0 | 0.30 | YES |
| ai_anxiety_question ("if AI writes all code, is dev still a job?") | 2.5 | 0.25 | YES — recognition |
| fantasy_question ("$100M exit, first move?") | 2.5 | 0.25 | YES |
| third_party_frame ("my friend says X, told him he's crazy") | 2.2 | 0.22 | YES — strong |
| binary_choice ("X or Y?") | 2.0 | 0.20 | YES |
| recognition_roast ("I know a guy who...") | 1.8 | 0.15 | YES — fat tail |
| relatable_log (day-in-the-life log + verbatim detail + absurd escalation) | 2.2* | 0.20* | YES — recognition, high ceiling |
| recognition_list ("the founder's life: punched, pivot, no sleep...") | 1.8 | 0.15 | YES |
| personal_numbers_arc ("my income 2013–2026: 50k → 700k → TBD") | 1.8 | 0.15 | YES — cross-niche |
| founder_story (narrative + stakes + reversal + hard proof) | 2.0* | 0.15* | YES — amplifier-gated, see §10 |
| data_comparison (factual reference, numbers, "context nobody assembled") | 1.5* | 0.12* | YES — but topical-amplifier-gated, see §10 |
| controversy_product_reveal (own product framed as "is this cheating? should I release it?") | 2.5* | 0.20* | YES — but asset-gated, see §10 |
| tactical_howto (specific, usable, bookmark-bait) | 1.3 | 0.10 | YES — beats abstract substance |
| status_take (bare assertion, no hook) | 1.0 | 0.08 | NO until ~10k engaged graph |
| connect (pure "let's connect") | 1.5 | 0.12 | partial — builds a weak graph |
| milestone (number + followers/days/MRR) | 1.0 | 0.05 | YES — low variance, farms Follow |
| hot_take | 1.0 | 0.08 | weak |
| nuanced_question (2+ clauses, self-incriminating) | 0.5 | 0.03 | NO |
| wisdom_one_liner / aphorism | 0.3 | 0.02 | NO — status-gated |
| substance_analysis (abstract, no narrative) | 0.3 | 0.02 | NO — status-gated, dies even at 39k |
| external link in post body | x0.2 on any of the above | cap 0.03 | reach killer |

*founder_story is conditional — see §10. Stripped of a live event, it behaves like a
strong recognition_list (~1.8–2.0x), not a breakout.

*relatable_log: a structured comedic log of a shared daily experience (e.g. a fake
day-in-the-life with timestamps), carrying a VERBATIM recognizable detail as the
payload and an absurd escalation as the punchline. The verbatim detail is the active
ingredient — generic "X is frustrating" dies; the exact recognizable line lands.
Recognition-family, transfers to small accounts, high ceiling (one observed escape
near 1M from a small account). Multiplier/escape are optimistic estimates from few
data points; treat the ceiling as real but rare.

*data_comparison: factual, numbers-heavy reference that assembles context nobody else
bothered to compile. Distinct from substance_analysis (abstract argument, dies) — this
is bookmark-bait reference material people save and quote. Topical-amplifier-gated
(see §10): the one observed escape (~116k) rode a live news hook in its freshness
window. Without a topical hook it flatlines like ordinary substance. High
bookmark-weight.

*controversy_product_reveal: the author's OWN product revealed through a moral/should-I
question ("I built X to grow faster — is this cheating? should I release it?") rather
than a straight announcement. Manufactures debate (people argue both sides) AND demand
(people reply "yes, release it") in one post. Distinct from a dead self-deprecating
product post (e.g. "my tool predicted this post would flop", which died ~50) — the
active ingredients are CONTROVERSY + a DEMAND question, not cleverness. One observed
escape: a 2.6k account, ~221k impressions / 1,111 bookmarks / 370 replies. The
extremely high bookmark count is the tell (people saving because they want the tool).
ASSET-GATED (see §10): the observed escape paired the question with an eye-catching
demo video. Without a compelling visual asset, expect it to behave like an ordinary
product post (low reach) — the controversy frame alone is not enough; the asset is
what stops the scroll. Very high bookmark-weight when it lands.

**The master variable: answer-effort.** Every top format shares one property — a
stranger can respond in under 5 seconds with zero context about the author. That
single property predicts reach better than anything else in the model. When scoring
a draft, estimate seconds-to-reply for a cold viewer; lower is better.

**Generation shape constraints.** Keep the shape matched to the format, not just
under the platform character limit:
- `hot_take`: one sharp claim stated up front; usually one visible line, max two
  short visible lines. Do not turn it into a mini-essay or explanatory thread.
- `wisdom_one_liner`: exactly one line; no setup paragraph.
- `insight_share`: one observation plus one concrete implication; avoid abstract
  analysis blocks.
- Question formats: make the answer possible in under 5 seconds.

---

## 3. Status gate

Recognition formats work at any size — they require no credibility, only that the
reader recognizes themselves. Status-gated formats (aphorisms, bare authority takes,
abstract analysis) require a graph that already grants the author authority, and die
without it.

The gate is continuous, not a hard line, and it keys on **engaged-authority**, not
raw followers:
- A 58k engaged graph prints aphorisms.
- A 39k passive/farmed graph dies on the same aphorisms.

So the status-interaction term should scale on trailing-median impressions (a proxy
for engaged-authority), not on follower count. The trap to encode: a big account
winning with a one-liner is its standing talking, not the format. The model must not
recommend status-gated formats to a small account just because they score well on a
large one.

---

## 4. Growth loop

The clearest single-account attribution observed (the 0→6k arc): roughly 55% of
follower growth came from replying, not from posts. Self-reported split:
posts/discovery ~35%, replying on own posts ~45%, replying on others' posts ~10%,
profile visits ~10%.

- **Posts** generate reach and a pool of warm people (the thread).
- **Replies** convert that attention into follows. Follow is the heaviest positive
  signal in the current ranking model.
- They compound: replying under bigger accounts borrows their audience and grows the
  next post's first wave.

Hooks without the reply grind = reach, no growth. Reply grind without hooks = growth,
no leverage. Both, daily, for weeks. The observed arc needed ~33 days for its first
1k followers while running both legs from day one.

Four legs the engine should treat as the real machine, in order of leverage:
1. Escape-format posts (manufacture reply-threads — raw material for everything else).
2. Reply-magnet formats specifically (threads of hand-raisers, not just impressions).
3. Fast first-hour replies into your own threads (convert hand-raisers → follows).
4. Replies under bigger accounts (borrow new audience — the only leg that expands the
   graph past its current ceiling).

Posting frequency alone is not a leg. The failed accounts posted often, into closed
reply loops among the same small mutuals, with bottom-tier formats. Frequency does
not rescue a bad format or a closed loop.

---

## 5. Graph quality

Follower count is a poor unit. Accounts at the same follower count showed 5–10x
different reach ceilings depending on how the graph was built:
- **Earned graph**: followers acquired by converting strangers who engaged. They
  respond fast, which triggers distribution. High ceiling. (An engaged 1.4k account
  reached 16k–21k on its best posts.)
- **Follow-loop / RT-network graph**: followers acquired via reciprocity and mutual
  RTs. They don't drive cold-audience engagement. Low ceiling (a 1.5k farmed account
  capped near 1.7k; a 39k farmed account capped near 400).

**Engine consequence:** the prediction base is `trailingMedianImpressions`, not
`followers × constant`. The median already encodes graph quality; raw followers
don't. Collect followers for context, but never let it drive the base when median is
available.

---

## 6. The ranking algorithm (Grok-based, open-sourced Jan 2026, major update May 15)

- Hand-engineered features eliminated. No coded boosts for length, media type, or
  posting time. Everything is a learned per-viewer engagement prediction — so the
  format multipliers measure emergent model behavior and can drift on each ~4-week
  update. Treat multipliers as refit-on-a-schedule, not constants.
- Engagement weights (public): Like 0.5, Reply 0.3, Repost 1.0, Quote 1.0, Share 1.0,
  **Follow 4.0**. Negatives: Not Interested −1.0, Mute −2.0, Block −3.0, Report −5.0.
  Implications: a reply is worth less than a like per event but generates new
  conversation candidates; Follow is the heavyweight, so milestone/Follow-farming is
  underrated; sustained ragebait accrues negative signals that suppress future reach.
- Per-account reputation is learned from volume over time. This is the slow variable
  — only consistent engagement over weeks moves it, and it's why a new account can
  run the exact playbook and still wait weeks to compound.
- Diversity/saturation filter on content embeddings suppresses the Nth near-identical
  post on a hot topic. A trending term helps only in roughly the first 48h of a wave,
  then inverts. Encode topic terms with a freshness window, not a flat bonus.
- Premium gets a coded ranking boost and higher reply rank — a structural handicap for
  unsubscribed accounts, especially reply-heavy strategies.
- Starter packs / mutual-follow graphs are candidate sources; thread completion is a
  dwell signal. Niche starter-pack inclusion and instant self-replies (thread depth)
  both help.

---

## 7. Account profile = user input, not a fixed persona

The engine personalizes on inputs the operator supplies, so the same model serves any
account:
- `followers` (required) — context only.
- `trailingMedianImpressions` (strongly recommended) — the prediction base; encodes
  graph quality.
- `niche` — for topic-term freshness and audience-match scoring.
- `eventContext` (optional) — launch / YC / acquisition / milestone wave; gates the
  founder_story upper tail (§10).
- `repeatHistory` (optional) — recent formats/topics, for the dedup/decay penalty.

Generalized expectation by graph size (apply to ANY account, using its own median as
the base):
- **Sub-2k earned graph**: outcomes are binary — most posts stall near the trailing
  median; a small fraction of recognition-format posts escape. Substance and
  aphorisms die. Kill (until ~10k): hashtags, in-body links, inside jokes, wisdom
  one-liners, nuanced multi-clause questions.
- **2k–10k**: recognition formats still carry; tactical_howto starts to travel;
  status_take and abstract substance still weak.
- **10k–50k engaged**: status_take and tactical_howto become viable; abstract
  substance still underperforms unless wrapped in narrative.
- **50k+ engaged**: aphorisms and authority takes print; the status gate is open.

---

## 8. Daily playbook

- 3–5 posts, SPACED across the day. Posts stacked in a tight window cannibalize the
  same capped graph (the 4th+ post in a cluster re-serves the same audience).
- Suggested lineup, each slot a different format: milestone (farms Follow) →
  fill_blank_tribal → ai_anxiety or fantasy → recognition_roast or binary → optional
  anchor/substance.
- 60–90 min/day replying under mid-to-large accounts. This is the actual growth
  engine (leg 4).
- Reply to every commenter in the first hour of each post (dwell + Follow conversion).
- Rotate topic-shapes so no two posts are semantic twins — the algorithm dedups on
  embeddings, not exact text. A format resets after ~2–3 days.
- Grade the week, not the post. Expect weeks of capped posts before the graph
  compounds (reputation is the slow variable).

---

## 9. Calibration & validation method (faceless)

The shipped engine uses anonymized calibration data — accounts referenced only by
**role + follower band + niche**, never by handle. Roles observed:

| Role | Band | Niche | Calibration use |
|---|---|---|---|
| full-arc primary | 0→6k | devtools/AI | followers-at-post reconstructable from milestone posts |
| earned-graph small | 1.4k | devtools/AI | low-end deployment reference |
| mid-size validation | 10k | devtools/AI | mid-band fit |
| mid-brand | 26.5k | creator/brand | where status_take + tactical_howto emerge |
| status reference | 58k | VC | aphorisms viable only here |
| follow-loop control | 2k | devtools/AI | low ceiling despite count |
| RT-network control | 1.5k | devtools/AI | low ceiling, no escape formats |
| bait-only control | 5k | creator | farmed graph, ~300 imp ceiling |
| high-count/low-quality control | 39k | finance | 400 imp at 39k — graph-quality proof |
| same-account format pair | 2.5k | devtools/AI | one escape + months of substance flatline |
| substance-only negative | 1.5k | indie | 40+ flatline labels |
| founder_story escape | 2.2k | devtools/AI | event-amplified outlier (see §10) |
| emotional-amplifier + self-RT recycler | 8.7k | creator | emotional-amplified founder_story escapes; dedup self-RTs before counting |
| data_comparison escape | 1.3k | devtools/AI | sharp takes flatline at 78–500; one topical data_comparison escaped to ~116k |
| relatable_log escape | small | devtools/AI | day-in-the-life coding-frustration bit, verbatim detail, ~1M |
| controversy_product_reveal escape | 2.6k | indie/SaaS | "is this cheating? should I release it?" tool reveal + demo video, ~221k / 1,111 bookmarks |
| substance_analysis negative | 6.3k | devtools/AI | expert analysis dies at 70–300 |

**Matched pairs that isolate the active variable:**
- founder_story escape vs substance_analysis negative: both technical founders,
  similar size, same niche, same underlying thesis. One wrapped it in
  narrative+stakes+proof and escaped; one posted it as analysis and died. Isolates
  narrative-stakes as the active ingredient.
- The same-account pair: one escape + months of flatline on one graph. Isolates
  format from graph.
- High-count/low-quality control vs status reference: 39k passive vs 58k engaged.
  Isolates engaged-authority from raw follower count for the status term.

**Validation:** leave-one-account-out, Spearman rank correlation per held-out account
(target ρ ≥ 0.5), plus escape-label AUC. NOT RMSE — absolute outcomes are
lottery-dominated; rank order is the testable claim. Exclude pinned posts, RTs, and
0-impression rows from fitting.

**Known data gap:** first-hour velocity (15/30/60-min replies + likes) is not
obtainable by scraping and must be logged first-party by the operator. It's the input
the t+30 posterior model needs and the one piece no public dataset provides.

---

## 10. founder_story is real but amplifier-gated

Amplifier-gated formats include founder_story, data_comparison, and
controversy_product_reveal. Do not overfit to outliers.

Four substance/product-adjacent formats can escape weak graphs at small size, but only
with an external/contextual amplifier. Without it they perform like ordinary substance,
a strong recognition post, or a dead product post — not a breakout. The amplifier
widens the UPPER TAIL of the prediction interval, never the median.

**founder_story** (personal narrative + stakes + reversal + hard proof). Observed
escaping in four niches. Portable where abstract analysis is not, because the story
itself is the entertainment. Two amplifier types:
- **Event amplifier** — a live launch / YC / acquisition / milestone wave. Largest
  observed: a devtools founder, ~339k impressions at ~2.2k followers, riding a product
  launch (1M+ views, #1 Product Hunt, #1 GitHub trending, rejection-reversal hook) the
  same week. A VC's version rode 58k status (status acts like a standing event).
- **Emotional amplifier** — genuine, first-disclosure personal stakes (real failure
  named plainly, family, loss). Observed: a creator's stroke/father disclosure did
  ~23.7k and a non-linear career-failure arc did ~46k, both with NO event behind them.
  The amplifier was authentic vulnerability.

**data_comparison** (factual, numbers-heavy reference that assembles context nobody
else compiled — distinct from abstract substance_analysis). One amplifier type:
- **Topical amplifier** — a live news hook in its freshness window. Observed: a ~1.3k
  account's $1T-valuation comparison (lining up Apple/Amazon/MSFT/Alphabet/Meta at
  their $1T crossing vs an AI lab's run-rate) did ~116k riding the live valuation
  story, with its highest-ever bookmark count. Same post without the news hook
  flatlines like ordinary substance. High bookmark-weight.

**controversy_product_reveal** (own product framed as a moral/should-I question, not a
straight announcement). One amplifier type:
- **Asset amplifier** — a compelling visual (demo video, eye-catching before/after).
  Observed: a 2.6k account's "I built a tool to grow on X — is this cheating? should I
  release it?" did ~221k / 1,111 bookmarks / 370 replies, paired with a slick demo
  video. The controversy frame (debate) + the demand question ("should I release it")
  drive replies and bookmarks; the visual asset is what stops the scroll. The same
  category WITHOUT a strong asset behaves like an ordinary product post — confirmed by
  a self-deprecating, asset-less version on the deployment account ("my tool predicted
  this post would flop") that died at ~50. Asset is the gate; controversy+demand are
  the mechanic.

Strip the amplifier and founder_story → strong recognition_list band; data_comparison
→ substance_analysis band (dead); controversy_product_reveal → ordinary product-post
band (low).

**Engine design (the `amplifier` input).** Type ∈ {event, emotional, topical, asset,
none}. It widens the prediction interval's UPPER TAIL only — it does not raise the
median, and it is never surfaced as a suggestion. Rules:

- **Asymmetric caps.** Event opens the tail furthest (external proof, ~50–150x
  potential). Topical opens it next (~20–90x, but only inside the ~48h freshness
  window — after that it inverts via the saturation filter). Asset opens it
  (~20–90x for a controversy_product_reveal, gated on a genuinely compelling visual,
  not just any image). Emotional opens it least
  (internal, noisier, ~5–15x). The caps mean past a threshold, more signal adds
  nothing — so there is no gradient that rewards escalating emotion or news-jacking.
- **First-use only, steep repeat-decay.** The amplifier fires on first genuine
  disclosure of a given beat. Reuse of the same emotional/event beat decays hard
  (≥0.55^count) AND should flag "you've resurfaced this beat before." This is the line
  between authentic disclosure and farming: recycling a hardship for a second wave is
  detectable and should be penalized, not rewarded.
- **Firewalled from generation/suggestion.** The model may RECOGNIZE that
  user-supplied text already carries genuine stakes and reflect that in the interval.
  It must NEVER generate, suggest, or prompt for emotional content ("add a personal
  hardship here to boost reach"). Reading stakes is allowed; prescribing them is not.
  This single boundary is the ethical difference.

**Operator guidance:** post a founder_story as a pinned anchor. Its breakout potential
comes from a genuine amplifier — a real event, or honest stakes you actually hold —
never a manufactured one. Self-RT recycling of a winner is fine for formats and takes;
recycling an emotional beat for a second wave is the line, and the audience that
rewards authenticity punishes performance.
