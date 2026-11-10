---
title: Editing & Publishing
description: Edit docs in a live editor, stage drafts, and publish as pull requests.
tags: [guide, editing]
order: 4
---

# Editing & Publishing

The **pencil** button in the viewer's toolbar opens a **live editor**: markdown source on the left, an instantly updating preview on the right — rendered by exactly the same pipeline as the viewer (wiki links, alerts, highlighting, all of it) — plus a formatting toolbar (bold, italic, code, headings, lists, task items, links, wiki links).

> [!NOTE]
> It's deliberately a source editor with live preview rather than contentEditable WYSIWYG: HTML→markdown round-trips corrupt formatting and produce noisy diffs, which matters when the output becomes a commit.

## Saving — three routes

Saving is always an explicit, confirmed step.

1. **Propose via GitHub editor** — no token needed. Your edit is stashed locally and the extension navigates to GitHub's own file editor (`/edit/…`), where it pre-fills your changes; you review and press GitHub's native **Commit changes…** button, so the commit/branch/fork/PR flow runs entirely through GitHub's UI under your logged-in account. If auto-fill ever fails, a toast offers your edited content for one-click copy.
2. **Create pull request…** — fully automatic, requires an API token (see [[Options & Configuration]]) with *Contents* and *Pull requests* write permission. Creates a branch from the default branch, commits the change, and opens a PR — using your fork automatically when you lack push access. You get the PR link when it's done.
3. **Download .patch / Copy patch** — no auth at all. A standard unified diff (`git apply file.patch` or `patch -p1 < file.patch`), generated locally.

> [!IMPORTANT]
> The extension cannot — and should not — commit directly with your browser session: GitHub's web endpoints are CSRF-protected by design. Route 1 hands off to GitHub's own UI; route 2 uses your API token.

## Drafting & batch publishing

Instead of publishing each file immediately, **Save draft** stages the edit locally (per repository, surviving reloads). Drafted files get a dot in the sidebar tree and collect in a **Drafts** section, where you can keep editing, discard individually, or — once you're done with the whole session — hit **Publish session…**:

- one branch, one commit per file, one pull request (auto-fork as usual), or
- download the entire session as a single multi-file `.patch`.

## Copy document markdown

The **copy** icon in the toolbar copies the current document's raw markdown source to the clipboard in one click — handy for pasting into an issue, chat, or another file.
