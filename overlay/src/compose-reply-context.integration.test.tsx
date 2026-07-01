import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "vitest-browser-react";

import { AnchorLayer, useComposeContext } from "./anchor-layer";

const RECONCILE_MS = 150;
const COMPOSE_TEXT_MS = 350;

interface ReplyTargetFixture {
  handle?: string;
  statusId?: string;
  targetText?: string;
  displayName?: string;
  includeStatusLink?: boolean;
  includeTweetText?: boolean;
  includeNestedQuote?: boolean;
}

interface XFixture {
  root: HTMLElement;
  dialog: HTMLElement;
  composer: HTMLElement;
  cleanup(): void;
}

function buildReplyTargetArticle(opts: ReplyTargetFixture): HTMLElement {
  const handle = opts.handle ?? "alice";
  const statusId = opts.statusId ?? "1930000000000000001";
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");

  const displayName = document.createElement("span");
  displayName.textContent = opts.displayName ?? "Alice Example";
  article.append(displayName);

  if (opts.includeStatusLink !== false) {
    const link = document.createElement("a");
    link.href = `https://x.com/${handle}/status/${statusId}`;
    link.textContent = `@${handle}`;
    article.append(link);
  }

  if (opts.includeTweetText !== false) {
    const text = document.createElement("div");
    text.setAttribute("data-testid", "tweetText");
    text.textContent =
      opts.targetText ?? "The boring version is usually the one people can ship.";
    article.append(text);
  }

  if (opts.includeNestedQuote === true) {
    const quote = document.createElement("article");
    quote.setAttribute("data-testid", "tweet");
    const quoteText = document.createElement("div");
    quoteText.setAttribute("data-testid", "tweetText");
    quoteText.textContent = "Nested quote text must not become the reply target.";
    quote.append(quoteText);
    article.append(quote);
  }

  return article;
}

function buildXComposerFixture(opts?: {
  replyTarget?: ReplyTargetFixture;
  outsideTarget?: ReplyTargetFixture;
}): XFixture {
  const root = document.createElement("div");
  root.dataset.xbFixture = "reply-context";

  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");

  if (opts?.replyTarget) {
    dialog.append(buildReplyTargetArticle(opts.replyTarget));
  }

  const composer = document.createElement("div");
  composer.setAttribute("data-testid", "tweetTextarea_0");
  composer.setAttribute("contenteditable", "true");
  composer.append(document.createTextNode(""));

  const button = document.createElement("div");
  button.setAttribute("data-testid", "tweetButton");

  dialog.append(composer, button);
  root.append(dialog);

  if (opts?.outsideTarget) {
    root.append(buildReplyTargetArticle(opts.outsideTarget));
  }

  document.body.append(root);

  return {
    root,
    dialog,
    composer,
    cleanup() {
      root.remove();
    },
  };
}

function typeInto(el: HTMLElement, text: string): void {
  if (el.firstChild) {
    el.firstChild.textContent = text;
  } else {
    el.append(document.createTextNode(text));
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out before the predicate held");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function settleCompose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RECONCILE_MS + COMPOSE_TEXT_MS + 80));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let fixtures: XFixture[] = [];

afterEach(() => {
  cleanup();
  while (fixtures.length > 0) {
    fixtures.pop()?.cleanup();
  }
  document.querySelectorAll('[data-xb-fixture="reply-context"]').forEach((n) => n.remove());
});

function fixture(opts?: {
  replyTarget?: ReplyTargetFixture;
  outsideTarget?: ReplyTargetFixture;
}): XFixture {
  const f = buildXComposerFixture(opts);
  fixtures.push(f);
  return f;
}

function ComposeProbe({ sink }: { sink: (v: ReturnType<typeof useComposeContext>) => void }): null {
  sink(useComposeContext());
  return null;
}

describe("AnchorLayer reply compose context", () => {
  it("publishes reply context and splits the structural target handle from authored body", async () => {
    const f = fixture({
      replyTarget: {
        handle: "alice",
        statusId: "1930000000000000001",
        targetText: "The boring version is usually the one people can ship.",
        displayName: "Alice Example",
        includeNestedQuote: true,
      },
    });
    typeInto(f.composer, "@alice good point");
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await waitUntil(() => latest?.replyContext?.targetStatusId === "1930000000000000001");
    await waitUntil(() => latest?.draftSplit.authoredBody === "good point");

    expect(latest?.mode).toBe("reply");
    expect(latest?.replyContext).toMatchObject({
      source: "same_dialog_dom",
      targetAuthorHandle: "alice",
      targetDisplayName: "Alice Example",
      targetText: "The boring version is usually the one people can ship.",
      targetStatusId: "1930000000000000001",
      targetUrl: "https://x.com/alice/status/1930000000000000001",
      leadingTargetHandle: {
        handle: "alice",
        state: "present",
      },
      replyThreadDomEvidence: {
        source: "same_dialog_dom",
        role: "current_target",
        currentTarget: {
          authorHandle: "alice",
          displayName: "Alice Example",
          statusId: "1930000000000000001",
          url: "https://x.com/alice/status/1930000000000000001",
          text: "The boring version is usually the one people can ship.",
        },
        diagnostics: {
          status: "same_dialog_only",
        },
      },
    });
    expect(latest?.replyContext?.replyThreadDomEvidence?.observedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(latest?.draftSplit).toMatchObject({
      mode: "reply",
      authoredBody: "good point",
      structuralPrefix: "@alice ",
      leadingHandleState: "present",
    });
    expect(latest?.draftSplit.merge("fresh body")).toBe("@alice fresh body");
    expect(latest?.draftSplit.merge("@alice fresh body")).toBe("@alice fresh body");
  });

  it("keeps normal compose in post mode when authored text starts with a handle", async () => {
    const f = fixture();
    typeInto(f.composer, "@alice good point");
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await settleCompose();
    expect(latest?.composerText).toBe("@alice good point");
    expect(latest?.mode).toBe("post");
    expect(latest?.replyContext).toBeUndefined();
    expect(latest?.draftSplit).toMatchObject({
      mode: "post",
      authoredBody: "@alice good point",
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
    });
    expect(latest?.draftSplit.merge("new body")).toBe("new body");
  });

  it("does not infer reply mode from complete target evidence outside the active dialog", async () => {
    const f = fixture({
      outsideTarget: {
        handle: "alice",
        statusId: "1930000000000000001",
        targetText: "A complete tweet outside the dialog is timeline context, not reply context.",
      },
    });
    typeInto(f.composer, "@alice good point");
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await settleCompose();
    expect(latest?.mode).toBe("post");
    expect(latest?.replyContext).toBeUndefined();
    expect(latest?.draftSplit).toMatchObject({
      mode: "post",
      authoredBody: "@alice good point",
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
    });
  });

  it("withholds reply context when the same-dialog target article lacks required evidence", async () => {
    const f = fixture({
      replyTarget: {
        handle: "alice",
        targetText: "This looks like a reply target but has no status URL.",
        includeStatusLink: false,
      },
    });
    typeInto(f.composer, "@alice good point");
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await settleCompose();
    expect(latest?.mode).toBe("post");
    expect(latest?.replyContext).toBeUndefined();
    expect(latest?.draftSplit.authoredBody).toBe("@alice good point");
  });

  it("records structural prefix deletion and never restores the target handle while merging", async () => {
    const f = fixture({
      replyTarget: {
        handle: "alice",
        statusId: "1930000000000000001",
        targetText: "Deleting the seeded handle should be respected.",
      },
    });
    typeInto(f.composer, "good point");
    let latest: ReturnType<typeof useComposeContext> | undefined;

    render(
      <AnchorLayer>
        <ComposeProbe sink={(v) => (latest = v)} />
      </AnchorLayer>,
    );

    await waitUntil(() => latest?.replyContext?.leadingTargetHandle.state === "user_deleted");
    await waitUntil(() => latest?.draftSplit.authoredBody === "good point");

    expect(latest?.mode).toBe("reply");
    expect(latest?.draftSplit).toMatchObject({
      mode: "reply",
      authoredBody: "good point",
      structuralPrefix: "",
      leadingHandleState: "user_deleted",
    });
    expect(latest?.draftSplit.merge("fresh body")).toBe("fresh body");
  });
});
