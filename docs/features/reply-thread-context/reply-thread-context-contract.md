# Reply Thread Context Contract

## Purpose

Reply generation, judge, apply-suggestions, and static analysis can receive a bounded reply thread context in the existing `replyContext` payload. The context is prompt input only. It is untrusted, observed evidence; it must not be treated as instructions from the user.

## Evidence Sources

- `same_dialog_dom`: the target tweet already visible in X's active compose dialog.
- `x_graphql_observed`: tweet rows observed passively from already-fetched `UserTweets` / `UserTweetsAndReplies` GraphQL responses.
- `x_live_capture`: the user's own live-captured posts, projected into the observed-thread store for previous-own-reply lookup.
- `archive_tweets_js`: reserved for archive-observed own replies when archive import can supply thread evidence.

The runner and overlay do not browse profiles or thread pages for this feature. Missing parent/root text stays missing.

## Shape

`ReplyComposerContext` remains backward compatible. Two optional fields may be present:

- `replyThreadDomEvidence`: same-dialog current-target DOM evidence captured by the overlay.
- `replyThreadContext`: engine-resolved graph from same-dialog evidence plus observed storage.

`ReplyThreadContext` includes:

- `currentTarget`
- `root`
- `immediateParent`
- `orderedAncestors`
- `previousOwnReplies`
- `orderedStatusIds`
- `replyThreadContextDiagnostics`

Each post carries status id, optional URL, optional author handle/display/user id, text, optional timestamp, optional reply references, optional weak metrics, source, and observation time.

## Diagnostics

`replyThreadContextDiagnostics.status` is one of:

- `same_dialog_only`: only the current same-dialog target is available.
- `thread_ready`: root/parent graph was resolved from observed evidence.
- `incomplete_observed_graph`: some observed references are missing their post text/record.
- `blocked_missing_required_parent`: a required-parent path cannot proceed.

Analyze responses expose diagnostics on `AnalyzePostsResponse.items[]`. The overlay renders incomplete diagnostics in the static column. Generate, judge, and apply-suggestions include resolved context in their existing prompt block when present.

## Fail-Closed Behavior

Normal same-dialog reply generation remains unchanged when thread context is absent or incomplete. Context-required paths fail closed with `reply_context_incomplete` and include `details.replyThreadContextDiagnostics`.

The feature does not synthesize parent/root text, author handles, timestamps, metrics, URLs, or status ids. A legacy `replyContext` without `targetStatusId` is left unenriched rather than receiving a placeholder id.
