# My X Data Import

Purpose: import and persist the user's own X posts and metrics through X API.

## Research Notes: Profile Connection And Deterministic Scoring

X connection should enrich deterministic scoring with account context and later calibration data. It should not make the deterministic engine claim that it knows the live X ranking algorithm.

### What X Connection Can Add

- Current follower count for heuristic prediction scaling.
- User profile fields: handle, display name, bio, profile URL, verified/subscription signals if exposed, pinned post if available.
- User-authored posts and post metadata.
- Post metrics when available: impressions, replies, reposts, quotes, likes, bookmarks, profile clicks, link clicks, follows, and followers at post time.
- Post context flags: media, links, hashtags, mentions, reply/repost/original post type, language, posted time, and topic/category if available or inferred.
- Recent posting cadence and recent format/topic history.

### Product-Facing Profile Readiness

This feature should eventually produce a local "profile readiness" view. This is not the same as true X account health.

Profile readiness can evaluate:

- Bio clarity: can a visitor understand what the user is building or thinking about?
- Niche consistency: recent posts, bio, pinned post, and profile promise point at the same audience.
- Follow reason: profile gives a plausible reason to follow after reading one good post.
- Pinned post support: pinned post reinforces the topics the writer wants to be known for.
- Recent activity baseline: enough recent posts exist to establish basic performance context.
- Metrics availability: imported post metrics are complete enough for calibration.
- Profile-click continuity: posts that imply expertise lead to a profile that confirms it.

### True X Profile Health

True X profile health may include recommendation eligibility, safety labels, spam classification, negative feedback, blocks, mutes, reports, reach suppression, or account-level trust signals.

Do not claim to know true X profile health unless X exposes a specific field or endpoint for it. If X does not expose it, the app can only infer risk indirectly from observable data, such as:

- sudden impression drops relative to the account baseline.
- repeated low distribution across multiple posts despite normal cadence.
- unusually high negative/low-quality engagement if such metrics are available.
- missing or incomplete metrics.
- known policy or account status fields if exposed.

Any inferred state should be labeled as `inferred`, `low evidence`, or `needs review`, not as a definitive account-health diagnosis.

### Deterministic Engine Hand-Off

The deterministic engine can consume profile-connected context, but should keep the same honesty boundary:

- With followers: scale heuristic prediction using explicit follower count.
- With recent post history: add variety and fatigue checks for repeated formats/topics.
- With profile readiness: warn when a post creates a profile-click promise the profile does not support.
- With imported outcomes: calibrate score bands and prediction ranges later.

The deterministic engine should still avoid claims like "this will rank on X" or "this matches the X algorithm."

### LLM Phase Hand-Off

The LLM judge can use profile-connected context for judgments that are too semantic for deterministic rules:

- whether the post fits the user's desired audience.
- whether the post creates a real profile-click reason.
- whether the profile backs up the promise made by the post.
- whether the topic is consistent with the user's current positioning.
- whether a specific rewrite preserves voice while improving the post.

### Open Research Questions

- Which X API fields expose profile/account status, if any?
- Which engagement metrics are available per post and at what retention window?
- Are profile clicks/bookmarks available through the user's own analytics access?
- Can pinned post and recent profile data be fetched reliably?
- How should the app represent inferred profile readiness without implying X-side eligibility?
