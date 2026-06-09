import { describe, expect, it } from "vitest";

import { classifyPostFormat } from "../format-classifier";

describe("format-classifier", () => {
  it("detects supported post formats from observable text structure", () => {
    expect(classifyPostFormat("Hot take: most dashboards are just procrastination")).toBe("hot_take");
    expect(classifyPostFormat("genuine question: why do agents fail at handoffs?")).toBe("genuine_question");
    expect(classifyPostFormat("Founders, what changed your onboarding?")).toBe("audience_question");
    expect(classifyPostFormat("My goal is to ship 3 experiments by end of June")).toBe("goal_share");
    expect(classifyPostFormat("Ship the uncomfortable version")).toBe("one_liner");
  });
});
