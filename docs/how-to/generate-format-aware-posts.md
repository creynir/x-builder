---
title: Generate format-aware posts
description: Use the compose rail to generate drafts grounded in the clicked format, a compact local playbook slice, and your own original-post voice samples.
---

## Generate format-aware posts

The compose rail can generate draft candidates for a specific post format, such as a hot take or founder story. When you click a generate category, X Builder uses that clicked format as the grounding signal. It does not send the whole local knowledge base to the writer.

Generation works best after X Builder has local context from your playbook and your own original posts, but it still works without either one. Missing context falls back to the base generation prompt instead of blocking the flow.

## Generate from the compose rail

1. Run the overlay browser and open X. See [Run X Overlay Browser](run-x-overlay-browser.md) if you need the launch steps.
2. Open a composer on X.
3. In the compose rail, choose the generate category that matches the draft you want.
4. Review the generated candidates.
5. Click the candidate you want to use.
6. Edit it in the composer, then press X's **Post** button yourself when you are ready.

X Builder never auto-posts. It can fill the composer only after you choose a generated draft, and publishing remains your action in X.

## What context generation uses

For a format-based generation request, X Builder builds a small context pack from local data:

| Context source | What is used | What is not used |
| --- | --- | --- |
| Clicked generate category | The format attached to the category you clicked | Other generate categories |
| Local playbook | Only the sections mapped to that format | The full knowledge base |
| Local post corpus | A compact sample of your original posts, prioritizing known selected posts when available | Replies, repost references, blank posts, and unrelated corpus data |

The generated candidates still go through the same response shape as before: three draft candidates, with judge verdicts attached when judging succeeds. If one judge pass fails, the other candidates can still keep their verdicts.

## When context is missing

Generation does not require a local playbook or a populated corpus.

| Missing input | What happens |
| --- | --- |
| No local playbook is configured | Generation uses the base format prompt without playbook guidance. |
| The playbook file is missing, unreadable, empty, or too large | Generation skips playbook guidance and continues. |
| No original posts are available | Generation skips the voice sample and continues. |
| The corpus contains only replies or blank posts | Those posts are ignored for voice sampling, and generation continues. |

This fail-open behavior is intentional: context should improve generated drafts, not make the compose flow brittle.

## Privacy and boundaries

Generation uses local context that X Builder already has: the clicked format, a bounded playbook slice, and a small sample of original posts from the local corpus. It does not attach the whole knowledge base to the prompt.

The local corpus can come from browsing with the overlay or from importing your X archive. To import an archive, use the Archive section in Settings, described in [Run X Overlay Browser](run-x-overlay-browser.md#importing-your-x-archive-optional).

If future builds add more visible context controls, this page should be updated to name those controls directly. Today, there is no separate voice-profile control in the UI, so voice selection is handled automatically from local original posts.

<!-- Tickets: SGC-008 — last verified against codebase 2026-06-28 -->
