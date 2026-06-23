// @x-builder/overlay — ComposeGenerateRail test fixtures (ticket-owned)
//
// These are the canonical `GenerateCategory[]` shapes the ticket's Test Strategy
// pins for the rail tests. They use the REAL `GenerateCategory` type from
// `@x-builder/shared` (no Zod dup) so the fixtures stay in lockstep with the
// schema (`id, label, format, basis, cooldownStatus, sampleCount` — there is NO
// `windowDays` or server message field on this shape).
//
// `defaultCategories` is the cold-start set (all `basis: "default"`,
// `sampleCount: 0`, `cooldownStatus: "clear"`). `cooldownCategory` is a single
// corpus-backed (`basis: "top_performer"`) category in cooldown, used to drive
// the warning-badge annotation case.

import type { GenerateCategory } from "@x-builder/shared";

/** The 4 cold-start categories returned before any corpus exists. */
export const defaultCategories: GenerateCategory[] = [
  {
    id: "hot_take",
    label: "Hot take",
    format: "hot_take",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
  },
  {
    id: "founder_story",
    label: "Build-in-public",
    format: "founder_story",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
  },
  {
    id: "audience_question",
    label: "Question",
    format: "audience_question",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
  },
  {
    id: "story",
    label: "Story",
    format: "story",
    basis: "default",
    cooldownStatus: "clear",
    sampleCount: 0,
  },
];

/** A corpus-backed category in cooldown — drives the warning-badge annotation. */
export const cooldownCategory: GenerateCategory = {
  id: "hot_take",
  label: "Hot take",
  format: "hot_take",
  basis: "top_performer",
  cooldownStatus: "cooldown",
  sampleCount: 4,
};
