---
title: Caching & Performance
description: How the extension avoids re-downloads and stays inside rate limits.
tags: [reference, performance]
order: 5
---

# Caching & Performance

The extension is designed to make as few GitHub requests as possible, so it stays fast and comfortably within API rate limits.

## Repository listings (mutable)

Each repo's file listing comes from one `git/trees` API call, cached in `storage.local` per `owner/repo` with an **ETag**. It's fresh for 15 minutes; after that it revalidates conditionally — GitHub answers `304 Not Modified` for free (no rate-limit cost) if nothing changed. A stale listing is served instantly while revalidation happens in the background.

## File contents (content-addressed)

File contents are cached in `storage.local` keyed by their git **blob SHA**.

> [!TIP]
> A blob SHA *is* a hash of the file's content, so a cache hit is always exact and never stale — no TTL guessing. If a file didn't change, its SHA is identical and the download is skipped entirely.

This means:

- **Re-opening a document** you've viewed before costs zero requests.
- **Re-indexing an organization** re-downloads only the files whose content actually changed; unchanged files are free — even across browser restarts.
- Newly-changed files (new SHA) are the only ones fetched.

The cache is byte-bounded (LRU-evicted at ~24 MB) and enabled by the `unlimitedStorage` permission. You can see its size and clear it from the extension popup.

## Rate limits & tokens

| Mode | Limit | Repos |
| --- | --- | --- |
| Anonymous | 60 requests/hour | Public only |
| With a token | 5,000 requests/hour | Public + private (per token access) |

Thanks to the caches above, anonymous browsing of a few public repos stays well under the 60/hour limit. For private repos, organization indexing, or heavy use, add a token — see [[Options & Configuration]].

## Cache controls (popup)

The toolbar popup lists **cached repositories** (each links straight to its Docs tab, with age and a per-repo evict button), shows the **file-content cache size**, and has a single button to clear both listings and content.
