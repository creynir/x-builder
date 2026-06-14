// Trending-topic lexicon. Unlike the durable rule lexicons, these terms are
// time-bounded: the model/agent vocabulary that reads as "current" drifts, so
// the list carries an explicit calibration date and is reviewed each release.

export const trendingTopicAsOf = "2026-06-14"; // CALIBRATE — entries EXPIRE; review every release

export const trendingTopicTerms = [
  "claude",
  "codex",
  "gpt",
  "gemini",
  "agent",
  "agents",
  "llm",
  "llms",
  "copilot",
  "cursor",
  "rag",
  "mcp",
] as const; // CALIBRATE

export const trendingTopicBonusPerMatch = 0.15; // CALIBRATE
export const trendingTopicMaxBonus = 0.4; // CALIBRATE
