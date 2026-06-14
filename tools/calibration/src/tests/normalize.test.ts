import { describe, expect, it } from "vitest";

// Imported from the not-yet-created calibration source. These imports fail
// today (module/function/schema missing) — that is the intended Red failure.
import { CalibrationRowSchema } from "../schema.js";
import { normalizeExportToRows } from "../normalize.js";

// ---------------------------------------------------------------------------
// Minimal synthetic raw-export shape. The export contract is owned by Green;
// these inline objects describe the X-archive-style posts the normalizer reads:
// id, ISO time, text, public metrics, follower snapshot, retweet/pinned markers
// and the `entities` block X attaches (urls + media, both rewritten as t.co).
// Inline (not JSONL) because each AC needs a hand-shaped structural edge case.
// ---------------------------------------------------------------------------
type RawMediaEntity = { url: string };
type RawUrlEntity = { url: string; expanded_url: string };
type RawEntities = { media?: RawMediaEntity[]; urls?: RawUrlEntity[] };
type RawPost = {
  account: string;
  postId: string;
  time: string;
  text: string;
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  bookmarks: number;
  followers: number;
  isRetweet?: boolean;
  entities?: RawEntities;
};
type RawExport = { account: string; followers: number; posts: RawPost[] };

// Structural view of the columns these tests read off a normalized row. The
// real row type is owned by Green (schema.ts); annotating the find/map
// callbacks with this view keeps the test type-clean APART FROM the genuine
// missing-module gap (no implicit-any leaking from the unresolved import).
type NormalizedRowView = {
  postId: string;
  followers_at_post: number;
  trailing_median_imps: number | null;
  has_external_link: boolean | null;
  escape_label: boolean | null;
};

function dayIso(dayIndex: number, hour = 12): string {
  // Days counted from a fixed UTC epoch so trailing-window math is determinate.
  const base = Date.UTC(2026, 0, 1, hour, 0, 0);
  return new Date(base + dayIndex * 86_400_000).toISOString();
}

function basePost(over: Partial<RawPost> & Pick<RawPost, "postId" | "time">): RawPost {
  return {
    account: "acct_a",
    text: "a plain original post with no links",
    impressions: 500,
    likes: 5,
    reposts: 0,
    replies: 1,
    bookmarks: 0,
    followers: 1000,
    ...over,
  };
}

describe("normalizeExportToRows derives one calibration row per original post", () => {
  it("interpolates followers_at_post toward a parsed milestone post", () => {
    const milestonePost = basePost({
      postId: "m1",
      time: dayIso(90),
      text: "Just crossed 1.2k followers in 90 days — thank you all",
      impressions: 800,
    });
    const earlyPost = basePost({ postId: "p0", time: dayIso(0), impressions: 400 });
    const exportData: RawExport = {
      account: "acct_a",
      followers: 1200,
      posts: [earlyPost, milestonePost],
    };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    const milestoneRow = rows.find((r: NormalizedRowView) => r.postId === "m1");
    expect(milestoneRow).toBeDefined();
    // The interpolation curve must pass through its own anchor: the milestone
    // post is dated at the "90 days" mark and parses to 1.2k = 1200 followers.
    expect(milestoneRow?.followers_at_post).toBe(1200);
  });

  it("marks the first 14 days with null trailing median and null escape label", () => {
    const posts: RawPost[] = [];
    // 16 daily originals; days 0..13 precede a full 14-day trailing window.
    for (let day = 0; day < 16; day += 1) {
      posts.push(basePost({ postId: `p${day}`, time: dayIso(day), impressions: 300 + day }));
    }
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    const day0 = rows.find((r: NormalizedRowView) => r.postId === "p0");
    const day13 = rows.find((r: NormalizedRowView) => r.postId === "p13");
    expect(day0?.trailing_median_imps).toBeNull();
    expect(day0?.escape_label).toBeNull();
    expect(day13?.trailing_median_imps).toBeNull();
    expect(day13?.escape_label).toBeNull();
  });

  it("yields only null escape labels for an account with under 14 days of posts", () => {
    const posts: RawPost[] = [];
    // The account's entire history spans days 0..9 — never a full 14-day window.
    for (let day = 0; day < 10; day += 1) {
      posts.push(basePost({ postId: `s${day}`, time: dayIso(day), impressions: 300 + day }));
    }
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    expect(rows.length).toBeGreaterThan(0);
    const everyLabelNull = rows.every(
      (r: NormalizedRowView) => r.escape_label === null,
    );
    expect(everyLabelNull).toBe(true);
  });

  it("treats a t.co url matching entities.media as media, not an external link", () => {
    const mediaPost = basePost({
      postId: "media1",
      time: dayIso(0),
      text: "growth chart https://t.co/abc123",
      entities: { media: [{ url: "https://t.co/abc123" }] },
    });
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts: [mediaPost] };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    const row = rows.find((r: NormalizedRowView) => r.postId === "media1");
    expect(row).toBeDefined();
    expect(row?.has_external_link).toBe(false);
  });

  it("leaves has_external_link null for a t.co-only post with no entities", () => {
    // No `entities` key at all — X stripped it, so link-vs-media is unknown.
    // basePost never sets `entities`, so this post carries a t.co url with no
    // entity metadata to disambiguate link-vs-media.
    const ambiguousPost = basePost({
      postId: "tco1",
      time: dayIso(0),
      text: "look at this https://t.co/zzz999",
    });
    expect(ambiguousPost.entities).toBeUndefined();
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts: [ambiguousPost] };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    const row = rows.find((r: NormalizedRowView) => r.postId === "tco1");
    expect(row).toBeDefined();
    expect(row?.has_external_link).toBeNull();
  });

  it("flags a non-t.co expanded url as an external link", () => {
    const linkPost = basePost({
      postId: "ext1",
      time: dayIso(0),
      text: "my essay https://t.co/short",
      entities: { urls: [{ url: "https://t.co/short", expanded_url: "https://example.com/essay" }] },
    });
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts: [linkPost] };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    const row = rows.find((r: NormalizedRowView) => r.postId === "ext1");
    expect(row?.has_external_link).toBe(true);
  });

  it("excludes retweets, zero-impression posts, and pinned ids", () => {
    const retweet = basePost({ postId: "rt1", time: dayIso(0), isRetweet: true });
    const zeroImps = basePost({ postId: "zero1", time: dayIso(1), impressions: 0 });
    const pinned = basePost({ postId: "pin1", time: dayIso(2) });
    const kept = basePost({ postId: "keep1", time: dayIso(3) });
    const exportData: RawExport = {
      account: "acct_a",
      followers: 1000,
      posts: [retweet, zeroImps, pinned, kept],
    };

    const rows = normalizeExportToRows(exportData, { pinnedIds: { acct_a: ["pin1"] } });

    const keptIds = rows.map((r: NormalizedRowView) => r.postId);
    expect(keptIds).toContain("keep1");
    expect(keptIds).not.toContain("rt1");
    expect(keptIds).not.toContain("zero1");
    expect(keptIds).not.toContain("pin1");
  });

  it("returns an empty array for an empty export without throwing", () => {
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts: [] };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    expect(rows).toEqual([]);
  });

  it("emits rows that satisfy the CalibrationRow schema", () => {
    const posts: RawPost[] = [];
    for (let day = 0; day < 3; day += 1) {
      posts.push(basePost({ postId: `p${day}`, time: dayIso(day) }));
    }
    const exportData: RawExport = { account: "acct_a", followers: 1000, posts };

    const rows = normalizeExportToRows(exportData, { pinnedIds: {} });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const parsed = CalibrationRowSchema.safeParse(row);
      expect(parsed.success).toBe(true);
    }
  });
});
