import { describe, expect, it } from "vitest";

import { assessEngagementReadiness } from "../engagement-readiness";

describe("engagement-readiness", () => {
  it("recognizes matching question prefixes and rejects empty prefixed drafts", () => {
    expect(
      assessEngagementReadiness(
        "genuine question: why do handoffs fail?",
        ["genuine question: why do handoffs fail?"],
      ),
    ).toMatchObject({
      engageable: true,
    });

    expect(
      assessEngagementReadiness("genuine question:", ["genuine question:"]),
    ).toMatchObject({
      engageable: false,
      reason: expect.stringContaining("no content"),
    });
  });
});
