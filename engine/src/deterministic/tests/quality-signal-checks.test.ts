import { describe, expect, it } from "vitest";

import { evaluateQualitySignalChecks } from "../quality-signal-checks";
import { countWords, getNonEmptyLines } from "../text-metrics";
import { bannedClaimPattern, findCheck } from "./test-helpers";

function evaluate(text: string, id: string) {
  return findCheck(
    evaluateQualitySignalChecks({
      trimmed: text.trim(),
      lines: getNonEmptyLines(text),
      wordCount: countWords(text),
    }),
    id,
  );
}

describe("quality-signal-checks", () => {
  it.each([
    [
      "quality_answerable_question",
      "pass",
      "Builders, which setup step would you remove first: profile import or workspace invite?",
      /answer|reply|question|choice/i,
    ],
    [
      "quality_answerable_question",
      "warn",
      "I rewrote the onboarding checklist after 12 user calls. Thoughts?",
      /vague|specific|answer|reply|question/i,
    ],
    [
      "quality_answerable_question",
      "fail",
      "What should we ship next? Why are users stuck? Should pricing change? Who owns the docs?",
      /too many|stack|one question|focus/i,
    ],
    [
      "quality_vague_curiosity",
      "pass",
      "This onboarding teardown changed how I write activation emails for B2B teams.",
      /specific|concrete|curiosity|anchor/i,
    ],
    [
      "quality_vague_curiosity",
      "warn",
      "This changed everything. Nobody talks about this enough.",
      /vague|concrete|curiosity|anchor/i,
    ],
    [
      "quality_standalone_context",
      "pass",
      "Onboarding emails fail when the first task is hidden behind three clicks.",
      /context|standalone|subject|opener/i,
    ],
    [
      "quality_standalone_context",
      "warn",
      "This changed everything after we looked at the signup flow.",
      /context|standalone|subject|opener/i,
    ],
    [
      "quality_claim_evidence",
      "pass",
      "In 14 onboarding calls, pricing confusion showed up before feature confusion.",
      /evidence|proof|claim|specific/i,
    ],
    [
      "quality_claim_evidence",
      "pass",
      "For example, Acme has the best checkout flow because it shows one clear next step.",
      /evidence|proof|claim|specific/i,
    ],
    [
      "quality_claim_evidence",
      "warn",
      "Everyone should always remove friction because it is the only way to grow.",
      /evidence|proof|claim|sweeping/i,
    ],
    [
      "quality_profile_click_reason",
      "pass",
      "I shipped the trial reset flow last week and learned activation improves when support can replay it.",
      /experience|project|author|profile|reason/i,
    ],
    [
      "quality_profile_click_reason",
      "warn",
      "You should write better hooks and provide more value every day.",
      /specific|experience|author|generic|reason/i,
    ],
    [
      "quality_one_idea_focus",
      "pass",
      "Activation improved when we moved workspace invites after the first successful run.",
      /focus|one idea|single/i,
    ],
    [
      "quality_one_idea_focus",
      "warn",
      "Activation needs better invites. Also pricing is confusing. Plus docs need a rewrite. One more thing: support macros matter.",
      /focus|one idea|pivots|too many/i,
    ],
    [
      "line_length",
      "pass",
      "Short lines scan cleanly.\n\nEach point gets room.",
      /line|scan|read/i,
    ],
    [
      "line_length",
      "warn",
      "This onboarding note keeps every caveat, result, setup detail, audience qualifier, and example in one dense line that is deliberately long enough to cross the scanability threshold for the deterministic checker.",
      /line|dense|scan|break/i,
    ],
    [
      "link_density",
      "pass",
      "The teardown stands on its own without making readers leave the post.",
      /link|click|self-contained|useful/i,
    ],
    [
      "link_density",
      "warn",
      "I wrote the full teardown here: https://example.com/onboarding",
      /link|click|useful|without/i,
    ],
    [
      "link_density",
      "fail",
      "Launch notes: https://example.com/a docs: https://example.com/b demo: https://example.com/c",
      /links|link-heavy|too many/i,
    ],
    [
      "mention_density",
      "pass",
      "Thanks @maya for pushing the onboarding teardown into real examples.",
      /mention|read|scan|restrained/i,
    ],
    [
      "mention_density",
      "warn",
      "Thanks @maya @lee @sam for the launch notes and signup teardown.",
      /mention|read|scan|too many/i,
    ],
  ] as const)("%s returns %s for a deterministic text fixture", (id, expectedStatus, text, labelPattern) => {
    const check = evaluate(text, id);

    expect(check).toMatchObject({
      id,
      status: expectedStatus,
    });
    expect(check.label).toMatch(labelPattern);
    expect(check.label).not.toMatch(bannedClaimPattern);
  });
});
