# GitHub Discussions

x-builder uses GitHub Discussions for public, open-ended community conversation.
Issues remain the source of truth for scoped work, and pull requests remain the
source of truth for code and docs changes.

## Flow

```txt
Discussion -> decision or enough detail -> GitHub Issue -> PR -> CI -> approval -> merge
```

Use a discussion when the topic needs clarification, examples, product feedback,
or community input before it becomes implementation work. Use an issue when the
work is already scoped enough to build.

## Categories

The repository currently uses GitHub's public discussion categories:

- `Announcements` - maintainer updates, roadmap changes, releases, and process changes.
- `Q&A` - answerable setup and usage questions.
- `Ideas` - RFC-style product ideas before they become issues.
- `Show and tell` - workflows, screenshots, experiments, and examples.
- `General` - feedback, meta discussion, and topics that do not fit elsewhere.
- `Polls` - explicit voting when maintainers need a directional signal.

If the community grows, split `General` into dedicated `Feedback` and
`Contributing` categories in GitHub repository settings.

## What Belongs Where

Use `Q&A` for:

- local setup failures;
- Chrome CDP or overlay injection issues;
- archive import questions;
- provider setup questions;
- "how do I use this?" requests.

Use `Ideas` for:

- product proposals;
- reply generation and RAG design questions;
- feature tradeoffs;
- RFCs that need discussion before an issue.

Use `Show and tell` for:

- generated post/reply workflows;
- examples of useful archive/RAG behavior;
- screenshots or recordings;
- downstream experiments.

Use `General` for:

- broad feedback;
- confusing behavior that is not yet a bug report;
- community/process questions;
- early contributing questions.

Use an issue instead when the post already has:

- a reproducible bug;
- clear acceptance criteria;
- a feature doc or ticket path;
- a concrete implementation plan.

## Maintainer Rules

- Link discussion decisions to the issue that implements them.
- Convert only scoped work into issues.
- Do not use discussions as a hidden backlog.
- When a PR is opened from a discussion, link both the discussion and the issue.
- Keep maintainer announcements short and link to the relevant issue, PR, or doc.
- Close or answer stale Q&A threads when the answer is clear.

## Public Opening Posts

Seed discussions should cover:

1. Welcome and how to use Discussions.
2. How to ask for setup help.
3. Roadmap feedback for replies, RAG, and voice.

These posts should point contributors back to the SDLC:

```txt
Issue -> PR -> approval -> CI / test -> merge to main
```
