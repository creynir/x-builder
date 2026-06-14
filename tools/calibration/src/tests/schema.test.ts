import { describe, expect, it } from "vitest";

import { CalibrationRowSchema } from "../schema.js";

// A fully-populated row used as the valid baseline; individual tests clone and
// mutate one field to assert each contract column's presence and nullability.
const validRow = {
  account: "acct_a",
  postId: "p1",
  time: "2026-01-01T12:00:00Z",
  text: "a sample post",
  impressions: 500,
  likes: 10,
  reposts: 2,
  replies: 3,
  bookmarks: 1,
  followers: 1000,
  followers_at_post: 980,
  trailing_median_imps: 420,
  detected_format: "hot_take",
  repeat_count: 0,
  days_since_same_format: 7,
  has_external_link: false,
  hour_utc: 12,
  weekday: 4,
  escape_label: false,
};

describe("CalibrationRow schema fixes the calibration input contract", () => {
  it("accepts a fully-populated row", () => {
    const parsed = CalibrationRowSchema.safeParse(validRow);
    expect(parsed.success).toBe(true);
  });

  it("accepts null for trailing_median_imps", () => {
    const parsed = CalibrationRowSchema.safeParse({ ...validRow, trailing_median_imps: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts null for escape_label", () => {
    const parsed = CalibrationRowSchema.safeParse({ ...validRow, escape_label: null });
    expect(parsed.success).toBe(true);
  });

  it("accepts null for has_external_link", () => {
    const parsed = CalibrationRowSchema.safeParse({ ...validRow, has_external_link: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects a row missing the account field", () => {
    const { account, ...withoutAccount } = validRow;
    void account;
    const parsed = CalibrationRowSchema.safeParse(withoutAccount);
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-numeric impressions value", () => {
    const parsed = CalibrationRowSchema.safeParse({ ...validRow, impressions: "lots" });
    expect(parsed.success).toBe(false);
  });
});
