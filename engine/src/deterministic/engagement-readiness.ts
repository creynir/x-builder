import type { EngagementReadiness } from "./types.js";

export function assessEngagementReadiness(
  trimmedText: string,
  visibleLines: string[],
): EngagementReadiness {
  if (trimmedText.length === 0) {
    return {
      engageable: false,
      reason: "Start typing to see how engageable this is.",
    };
  }

  const prefixMatch =
    /^(hot take|genuine question|popular opinion|unpopular opinion|real talk|fun fact|reminder):\s*/i.exec(trimmedText);

  if (prefixMatch) {
    const prefix = prefixMatch[1]?.toLowerCase() ?? "";
    const bodyAfterPrefix = trimmedText.slice(prefixMatch[0].length).trim();

    if (bodyAfterPrefix.length === 0) {
      return {
        engageable: false,
        reason: `"${prefix}:" prefix used, but the post has no content after the prefix - drop the prefix or change the content to match.`,
      };
    }

    if (prefix === "genuine question") {
      const hasQuestionMark = bodyAfterPrefix.includes("?");
      const readsLikeQuestion =
        /\b(why|how|what|when|where|who|which|does|do|did|is|are|was|were|can|should|would|will)\b/i.test(bodyAfterPrefix);

      if (!hasQuestionMark) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post isn't actually a question (no '?') - drop the prefix or change the content to match.`,
        };
      }

      if (!readsLikeQuestion) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post doesn't read as a real question - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (
      prefix === "hot take" ||
      prefix === "unpopular opinion" ||
      prefix === "popular opinion" ||
      prefix === "real talk"
    ) {
      const readsLikeTake =
        /\b(but|not|never|always|every|no one|nobody|everyone|most|actually|instead|over|than|vs\.?|beats|outperforms?|will|won't|stop|skip|forget|kill|nail|crush)\b/i.test(bodyAfterPrefix);

      if (!readsLikeTake) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post reads as a neutral statement, not an actual take - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (prefix === "fun fact") {
      const hasFact = /\d/.test(bodyAfterPrefix) || /\b[A-Z][a-z]{2,}\b/.test(bodyAfterPrefix);

      if (!hasFact) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post has no specific fact (number, name, or proper noun) - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    if (prefix === "reminder") {
      const addressesReader =
        /\b(you|your|don't|stop|start|remember|always|never|keep|drop|skip|forget)\b/i.test(bodyAfterPrefix);

      if (!addressesReader) {
        return {
          engageable: false,
          reason: `"${prefix}:" prefix used, but the post doesn't address the reader as a reminder - drop the prefix or change the content to match.`,
        };
      }

      return {
        engageable: true,
        reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
      };
    }

    return {
      engageable: true,
      reason: `"${prefix}:" prefix matches the content - clear invitation to react.`,
    };
  }

  if (/^(founders|builders|creators|solo founders|indie hackers|makers|operators|marketers),/i.test(trimmedText)) {
    return {
      engageable: true,
      reason: "Audience-named opener - calls a group directly.",
    };
  }

  if (/^(are you|name a|name one|why does|what does|what's the|who else|how many)\b/i.test(trimmedText)) {
    return {
      engageable: true,
      reason: "Prompt opener - the post asks a direct question.",
    };
  }

  if (trimmedText.endsWith("?")) {
    return {
      engageable: true,
      reason: "Ends on a question - reply-friendly by design.",
    };
  }

  if (/(drop your handle|comment what|reply with|tell me|let me know|share your)/i.test(trimmedText)) {
    return {
      engageable: true,
      reason: "Explicit ask - readers know exactly what to do.",
    };
  }

  if (
    /\d/.test(trimmedText) &&
    /\b(today|yesterday|this week|this month|just|finally|shipped|launched|hit|crossed|reached|passed|joined|started|done|released)\b/i.test(trimmedText) &&
    trimmedText.length < 240
  ) {
    return {
      engageable: true,
      reason: "Milestone moment - readers react to journey, not just info.",
    };
  }

  const hasContrast =
    /\b(but|yet|never|actually|instead|however|rather|despite|even if|until|supposed to|used to)\b/i.test(trimmedText);

  if (visibleLines.length >= 2 && hasContrast) {
    return {
      engageable: true,
      reason: "Contrast across lines - drives quotes + saves.",
    };
  }

  return {
    engageable: false,
    reason:
      'No clear engagement hook. Add a "hot take:" / "genuine question:" prefix, end on a question, share a milestone moment, or call out an audience.',
  };
}
