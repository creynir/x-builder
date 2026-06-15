import { classifyPostFormat } from "@x-builder/engine";

import type { CalibrationRow } from "./schema.js";

// X-archive-style raw export. One account, a follower snapshot (current count),
// and the account's posts with public metrics plus the `entities` block X
// attaches (urls rewritten as t.co with an expanded_url; media as bare t.co).
export type RawMediaEntity = { url: string };
export type RawUrlEntity = { url: string; expanded_url: string };
export type RawEntities = { media?: RawMediaEntity[]; urls?: RawUrlEntity[] };
export type RawPost = {
  account?: string;
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
export type RawExport = { account: string; followers: number; posts: RawPost[] };

export type NormalizeOptions = { pinnedIds: Record<string, string[]> };

const DAY_MS = 86_400_000;
const TRAILING_WINDOW_DAYS = 14;

// "1.2k followers in 90 days" / "3,400 followers on day 12" — a parsed count and
// the day index it was reached. Drives follower interpolation between anchors.
const milestonePattern = /([\d.,k]+)\s*followers?\s*(?:in|on day)\s*(\d+)/i;

type Milestone = { day: number; count: number };

function parseFollowerCount(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.endsWith("k")) {
    const numeric = Number.parseFloat(trimmed.slice(0, -1).replace(/,/g, ""));
    return Math.round(numeric * 1000);
  }
  return Math.round(Number.parseFloat(trimmed.replace(/,/g, "")));
}

function parseMilestone(text: string): { count: number; day: number } | null {
  const match = milestonePattern.exec(text);
  if (match === null) {
    return null;
  }
  const countToken = match[1];
  const dayToken = match[2];
  if (countToken === undefined || dayToken === undefined) {
    return null;
  }
  const count = parseFollowerCount(countToken);
  const day = Number.parseInt(dayToken, 10);
  if (Number.isNaN(count) || Number.isNaN(day)) {
    return null;
  }
  return { count, day };
}

// Linear interpolation across sorted milestone anchors. A post whose own day is
// an anchor resolves exactly to that anchor's count; between anchors the count
// is interpolated; outside the anchor span the nearest anchor's count is held.
function interpolateFollowers(dayIndex: number, anchors: Milestone[]): number | null {
  if (anchors.length === 0) {
    return null;
  }
  const sorted = [...anchors].sort((a, b) => a.day - b.day);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return null;
  }
  if (dayIndex <= first.day) {
    return first.count;
  }
  if (dayIndex >= last.day) {
    return last.count;
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lower = sorted[i];
    const upper = sorted[i + 1];
    if (lower === undefined || upper === undefined) {
      continue;
    }
    if (dayIndex >= lower.day && dayIndex <= upper.day) {
      const span = upper.day - lower.day;
      if (span === 0) {
        return lower.count;
      }
      const fraction = (dayIndex - lower.day) / span;
      return Math.round(lower.count + fraction * (upper.count - lower.count));
    }
  }
  return last.count;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

// A post carries an external link when it has a non-t.co destination. A t.co url
// listed in entities.media is media, not a link. A t.co-only post with no
// entities at all is ambiguous (X stripped the metadata) -> null, excluded from
// the link-penalty fit downstream.
function resolveExternalLink(post: RawPost): boolean | null {
  const tcoInText = /https?:\/\/t\.co\/\S+/i.test(post.text);
  const entities = post.entities;

  if (entities === undefined) {
    return tcoInText ? null : false;
  }

  const mediaUrls = new Set((entities.media ?? []).map((entity) => entity.url));
  const urlEntities = entities.urls ?? [];

  for (const urlEntity of urlEntities) {
    const expanded = urlEntity.expanded_url;
    if (!/^https?:\/\/t\.co\//i.test(expanded) && !mediaUrls.has(urlEntity.url)) {
      return true;
    }
  }

  // No external destination among the url entities. A bare t.co in the text that
  // matches a media entity is media (false); anything else with entities present
  // and no external url is also a non-link.
  return false;
}

/**
 * Normalize a raw account export into one CalibrationRow per ORIGINAL post.
 * Excludes retweets, zero-impression posts, and pinned ids. Derives the
 * follower snapshot (interpolated from milestone posts when present, else the
 * post's own snapshot), the trailing-14-day median, the escape label, the
 * detected format, and the repeat/recency counters.
 */
export function normalizeExportToRows(
  rawExport: RawExport,
  opts: NormalizeOptions,
): CalibrationRow[] {
  const account = rawExport.account;
  const pinned = new Set(opts.pinnedIds[account] ?? []);

  const originals = rawExport.posts.filter(
    (post) =>
      post.isRetweet !== true &&
      post.impressions > 0 &&
      !pinned.has(post.postId),
  );

  if (originals.length === 0) {
    return [];
  }

  const sorted = [...originals].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );

  const firstMs = Date.parse(sorted[0]?.time ?? rawExport.posts[0]?.time ?? "");
  const dayIndexOf = (post: RawPost): number =>
    Math.floor((Date.parse(post.time) - firstMs) / DAY_MS);

  const milestoneAnchors: Milestone[] = [];
  for (const post of sorted) {
    const milestone = parseMilestone(post.text);
    if (milestone !== null) {
      milestoneAnchors.push({ day: milestone.day, count: milestone.count });
    }
  }

  const formatCounts = new Map<string, number>();
  const lastFormatDay = new Map<string, number>();
  const sortedTimes = sorted.map((post) => Date.parse(post.time));
  let trailingWindowStart = 0;

  const rows: CalibrationRow[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const post = sorted[index];
    if (post === undefined) {
      continue;
    }
    const postMs = Date.parse(post.time);
    const dayIndex = dayIndexOf(post);
    const format = classifyPostFormat(post.text);

    const followersAtPost =
      interpolateFollowers(dayIndex, milestoneAnchors) ?? post.followers;

    // Prior-14-day trailing window over this account's originals. Null until the
    // post sits past a full 14-day window from the account's first post.
    let trailingMedian: number | null = null;
    if (dayIndex >= TRAILING_WINDOW_DAYS) {
      const windowStartMs = postMs - TRAILING_WINDOW_DAYS * DAY_MS;
      while (
        trailingWindowStart < index &&
        (sortedTimes[trailingWindowStart] ?? 0) < windowStartMs
      ) {
        trailingWindowStart += 1;
      }

      const windowImps = sorted
        .slice(trailingWindowStart, index)
        .map((other) => other.impressions);
      if (windowImps.length > 0) {
        trailingMedian = median(windowImps);
      }
    }

    const escapeLabel =
      trailingMedian === null ? null : post.impressions > 3 * trailingMedian;

    const repeatCount = formatCounts.get(format) ?? 0;
    const priorFormatDay = lastFormatDay.get(format);
    const daysSinceSameFormat =
      priorFormatDay === undefined ? 0 : dayIndex - priorFormatDay;
    formatCounts.set(format, repeatCount + 1);
    lastFormatDay.set(format, dayIndex);

    const date = new Date(postMs);

    rows.push({
      account,
      postId: post.postId,
      time: post.time,
      text: post.text,
      impressions: post.impressions,
      likes: post.likes,
      reposts: post.reposts,
      replies: post.replies,
      bookmarks: post.bookmarks,
      followers: post.followers,
      followers_at_post: followersAtPost,
      trailing_median_imps: trailingMedian,
      detected_format: format,
      repeat_count: repeatCount,
      days_since_same_format: daysSinceSameFormat,
      has_external_link: resolveExternalLink(post),
      hour_utc: date.getUTCHours(),
      weekday: date.getUTCDay(),
      escape_label: escapeLabel,
    });
  }

  return rows;
}
