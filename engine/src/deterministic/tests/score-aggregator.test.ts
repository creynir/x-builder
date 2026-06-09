import { describe, expect, it } from "vitest";

import { calculateDeterministicScore } from "../score-aggregator";
import type { VoiceCheck } from "../voice-check";

describe("score-aggregator", () => {
  it("combines standard and quality checks with caps for short drafts", () => {
    const checks: VoiceCheck[] = [
      { id: "standard-pass", label: "Standard pass", status: "pass" },
      { id: "standard-warn", label: "Standard warn", status: "warn" },
      { id: "quality-pass", kind: "quality", label: "Quality pass", status: "pass" },
      { id: "quality-fail", kind: "quality", label: "Quality fail", status: "fail" },
    ];

    expect(calculateDeterministicScore({
      checks,
      isEmpty: false,
      isTooShort: false,
      isThin: false,
    })).toBe(70);
    expect(calculateDeterministicScore({
      checks,
      isEmpty: false,
      isTooShort: true,
      isThin: false,
    })).toBe(25);
  });
});
