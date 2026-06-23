// @x-builder/overlay — static explainer copy for every reconciled MetricKey
//
// `overlayExplainerCopy` is the shipped default: real, user-facing prose for
// every metric the overlay surfaces. It is `Record<MetricKey, ExplainerEntry>`,
// so TypeScript fails the build the moment a key is added to the union without
// matching copy here (and vice-versa). No transport at this ticket — a parent
// may pass an `ExplainerSource` override via the `source` prop, but this map is
// the only built-in copy.
//
// Three non-negotiable direction rules (mirrored by copy.test.tsx):
//   - negativeRisk     → goodDirection "lower", howToRead says "lower is better"
//   - statusDependency → goodDirection "lower", howToRead says "lower is better"
//   - replyVsQuoteOrientation → goodDirection "poled", no unqualified "better"
//   - audienceMatch    → goodDirection "higher", notes null = insufficient data
// All other dims default to "higher" with friendly, plain-language framing.

import type { ExplainerSource } from "./types";

/**
 * The shipped, static explainer copy. Every entry is real prose — no
 * placeholders. Scales are added wherever a labelled low/high pair helps the
 * reader place a value.
 */
export const overlayExplainerCopy: ExplainerSource = {
  overall: {
    label: "Overall",
    whatItMeans:
      "A single headline score blending every other dimension into one read on how strong this post is likely to be.",
    howToRead:
      "Higher is better. Treat it as a quick gut-check, then drill into the individual dimensions to see what is pulling the number up or down.",
    scale: { lowLabel: "0 · weak", highLabel: "100 · strong" },
    goodDirection: "higher",
  },
  replies: {
    label: "Replies",
    whatItMeans:
      "How likely this post is to pull people into the comments and start a back-and-forth conversation.",
    howToRead:
      "Higher is better when your goal is engagement. A strong reply pull usually means you left an opening worth answering.",
    scale: { lowLabel: "0 · quiet", highLabel: "100 · chatty" },
    goodDirection: "higher",
  },
  profileClicks: {
    label: "Profile clicks",
    whatItMeans:
      "How much this post makes readers curious enough to tap through to your profile to see who you are.",
    howToRead:
      "Higher is better for growing followers. Posts that hint at more depth behind them tend to earn the click.",
    scale: { lowLabel: "0 · skipped", highLabel: "100 · click-worthy" },
    goodDirection: "higher",
  },
  impressions: {
    label: "Impressions",
    whatItMeans:
      "The predicted size of the audience that will actually see this post in their timeline.",
    howToRead:
      "Higher is better for raw reach. It reflects how far the post is expected to travel before momentum fades.",
    scale: { lowLabel: "0 · narrow", highLabel: "100 · wide" },
    goodDirection: "higher",
  },
  bookmarkValue: {
    label: "Bookmark value",
    whatItMeans:
      "How likely readers are to save this post to come back to it — a strong signal that it carries lasting, reference-worthy value.",
    howToRead:
      "Higher is better. Save-worthy posts keep paying off long after they leave the timeline.",
    scale: { lowLabel: "0 · disposable", highLabel: "100 · keep-worthy" },
    goodDirection: "higher",
  },
  dwellProxy: {
    label: "Dwell time",
    whatItMeans:
      "A proxy for how long readers are likely to pause on this post rather than scrolling straight past.",
    howToRead:
      "Higher is better. Longer dwell tells the algorithm the post earned attention, which helps it spread.",
    scale: { lowLabel: "0 · scrolled", highLabel: "100 · lingered" },
    goodDirection: "higher",
  },
  voiceMatch: {
    label: "Voice match",
    whatItMeans:
      "How closely this post sounds like a real human writing in your own voice, rather than generic or AI-flavoured text.",
    howToRead:
      "Higher is better. The more it reads authentically like you, the more it lands with people who follow you.",
    scale: { lowLabel: "0 · off-voice", highLabel: "100 · unmistakably you" },
    goodDirection: "higher",
  },
  negativeRisk: {
    label: "Negative risk",
    whatItMeans:
      "The chance the post reads as inflammatory, dunk-bait, or likely to draw pile-ons and bad-faith replies.",
    howToRead:
      "Lower is better. Under roughly 30 reads as calm; above 60 it is worth softening the framing before you post.",
    scale: { lowLabel: "0 · calm", highLabel: "100 · risky ↑" },
    goodDirection: "lower",
  },
  answerEffort: {
    label: "Answer effort",
    whatItMeans:
      "How much work a reader has to do to reply meaningfully — the friction between reading the post and joining in.",
    howToRead:
      "Read it against your goal rather than chasing one end. Low effort invites quick, high-volume replies; a higher lift tends to draw fewer but more considered answers. Pick the level that matches the conversation you want.",
    scale: { lowLabel: "effortless reply", highLabel: "heavy lift" },
    goodDirection: "higher",
  },
  strangerAnswerability: {
    label: "Stranger answerability",
    whatItMeans:
      "Whether someone who does not already follow you could still understand the post and reply to it without missing context.",
    howToRead:
      "Higher is better for reaching beyond your circle. Self-contained posts travel further because strangers can engage.",
    scale: { lowLabel: "0 · in-group only", highLabel: "100 · anyone can join" },
    goodDirection: "higher",
  },
  statusDependency: {
    label: "Status dependency",
    whatItMeans:
      "How much the post's reach leans on your existing follower count rather than on the strength of the post itself.",
    howToRead:
      "Lower is better. Posts that travel on their content spread further than posts that rely on who is saying them.",
    scale: { lowLabel: "0 · content-led", highLabel: "100 · status-led ↑" },
    goodDirection: "lower",
  },
  replyVsQuoteOrientation: {
    label: "Reply vs quote orientation",
    whatItMeans:
      "Whether the post is shaped to invite replies and conversation, or to be quote-tweeted and re-shared.",
    howToRead:
      "Neither pole is better — the right orientation depends on your goal. Replies grow conversation; quotes spread reach. Pick the end that matches what you want from this post.",
    scale: { lowLabel: "← replies", highLabel: "quotes →" },
    goodDirection: "poled",
  },
  audienceMatch: {
    label: "Audience match",
    whatItMeans:
      "How well this post fits the audience your account usually reaches — the people most likely to care about it.",
    howToRead:
      "Higher is better: it means the post lands with the right crowd. A null value means there is insufficient data to score the fit yet, not a low score.",
    scale: { lowLabel: "0 · off-audience", highLabel: "100 · on-audience" },
    goodDirection: "higher",
  },
  repetition: {
    label: "Repetition / cooldown",
    whatItMeans:
      "How much this post repeats themes, phrasing, or angles you have used recently — a check against sounding repetitive to your regulars.",
    howToRead:
      "Lower is better. A high reading suggests letting a topic cool down or finding a fresh angle before posting again.",
    scale: { lowLabel: "0 · fresh", highLabel: "100 · repetitive ↑" },
    goodDirection: "lower",
  },
  postCoach: {
    label: "Post coach",
    whatItMeans:
      "An overall read on the deterministic writing checks — clarity, length, structure — that catch easy fixes before you post.",
    howToRead:
      "Higher is better: more of the writing checks are passing. Work down the flagged items to lift it.",
    scale: { lowLabel: "0 · needs work", highLabel: "100 · clean" },
    goodDirection: "higher",
  },
  stallRange: {
    label: "Stall range",
    whatItMeans:
      "The band of reach where a post tends to stall out — gaining little extra distribution no matter how it performs.",
    howToRead:
      "Lower is better: a low stall point means the post is less likely to plateau early. It frames where momentum typically runs dry.",
    scale: { lowLabel: "early stall", highLabel: "late stall" },
    goodDirection: "lower",
  },
  escapeRange: {
    label: "Escape range",
    whatItMeans:
      "The reach band a post needs to cross to break out of your immediate followers and spread to a wider audience.",
    howToRead:
      "Higher is better as an outcome — clearing this range means the post escaped into broader distribution rather than staying local.",
    scale: { lowLabel: "stays local", highLabel: "breaks out" },
    goodDirection: "higher",
  },
  escapeProbability: {
    label: "Escape probability",
    whatItMeans:
      "The estimated chance this post breaks past your usual audience and reaches people who do not already follow you.",
    howToRead:
      "Higher is better. It is the likelihood the post escapes your bubble and finds new readers.",
    scale: { lowLabel: "0 · unlikely", highLabel: "100 · likely" },
    goodDirection: "higher",
  },
};
