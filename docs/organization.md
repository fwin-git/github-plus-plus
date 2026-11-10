---
title: Organization-wide Search
description: Index and search the docs of many repositories from one place.
tags: [guide, search, organization]
order: 3
---

# Organization-wide Search

Documentation for an organization is usually spread across many repositories. The **building icon** in the sidebar header lets you browse and search all of it from one place.

## 1. Pick repositories

A dialog lists every repository in the organization (or user account). It has:

- a **filter field** that matches name and description,
- **All / None** buttons that act on the currently *filtered* rows,
- memory of your last selection.

Archived repos are listed but unchecked by default.

## 2. Watch it index

Each selected repository gets its own row with a **progress bar** — listing → files indexed → done, turning green on success or red (with the error) on failure — above an **overall progress bar**. Listings reuse the per-repo ETag cache, so re-indexing later is mostly free `304`s.

## 3. Browse and search across everything

The sidebar switches to a view **grouped by repository** (collapsible, current repo first, with per-repo doc counts and a small **index ring**). Live search grows an **Organization** results group; selecting any cross-repo hit opens that document in its own repository's Docs tab — instant, because the listing is already cached.

The sidebar header shows the organization name and an org-wide count (`📄 2,341 · 🔀 12/12`). The **×** next to the org name returns to single-repo view.

## 4. It sticks — without the request storm

> [!IMPORTANT]
> Opening the Docs tab on *any* repository of an organization you've indexed restores the grouped sidebar automatically — but content is **never** re-fetched on every page load.

The index ring tells you each repo's state:

| Ring | Meaning |
| --- | --- |
| Faded / empty | Available, not indexed — no content fetched |
| Filling | Indexing now (live per-file progress) |
| Green ✓ | Indexed and searchable |
| Red ! | Failed (hover for the error) |

Repos whose content is already in the [[Caching & Performance|persistent cache]] come back **already indexed** with zero network — the extension checks the cached blob SHAs and skips the prompt. You index the rest on demand:

- the **refresh button** in the sidebar header (a re-index control in org mode) reopens the picker to change the selection and re-index;
- **expanding an unindexed repo** prompts *"Index this repo, or just browse?"* — "Index" fetches only that one; "Just browse" navigates its files from the cached listing with no content fetch;
- the repository you're currently viewing is folded into the index for free.

> [!NOTE]
> A GitHub token is effectively required here — indexing dozens of repositories uses their share of requests. See [[Options & Configuration]] to add one (a classic token with the `repo` scope is simplest).
