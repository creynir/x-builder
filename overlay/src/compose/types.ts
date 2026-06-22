// @x-builder/overlay — compose-cockpit shared local types (XOB-029)
//
// The single local alias the cockpit and its machine share for the analyze
// result. It is the `status: "scored"` variant of the real shared
// `AnalyzedPostItem` union — the same alias `static-engine-column.tsx` and the
// XOB-025 fixtures derive, so the cockpit, the machine, and the column all read
// one definition rather than re-deriving the Extract at each call site.

import type { AnalyzedPostItem } from "@x-builder/shared";

/** The `status: "scored"` variant of the real analyzed-post-item union. */
export type ScoredPostItem = Extract<AnalyzedPostItem, { status: "scored" }>;
