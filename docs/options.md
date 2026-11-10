---
title: Options & Configuration
description: Settings, the toolbar popup, and how to set up a GitHub token.
tags: [reference, config]
order: 7
---

# Options & Configuration

Open the extension's toolbar icon → **Options**.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Access token | — | Enables private repos and 5,000 req/h. Stored only in local extension storage; sent only to `api.github.com`. |
| Documentation folders | `docs, doc, documentation, wiki, guides, guide, handbook, manual, .github, website/docs` | One per line; matched case-insensitively at any depth; `a/b` patterns match consecutive path segments. |
| Include root markdown files | on | README, CONTRIBUTING, etc. |
| Docs tab count badge | on | The number next to the Docs tab. |
| Docs tab position | Last | Choose position 1–12 in the repository tab row. Applies immediately when saved; a position beyond the available tabs puts Docs last. |
| Maximum documents | 500 | Larger repos show a truncation notice. |
| Content-index size limit | 200 KB/file | Larger files are skipped by full-text search (still viewable). |

## Setting up a token

You only need a token for **private repositories**, the higher rate limit, or the automatic pull-request flow.

**Classic token** (simplest) — create one at [github.com/settings/tokens/new](https://github.com/settings/tokens/new) with the **`repo`** scope. That single scope covers reading private repos *and* the create-PR editing flow.

**Fine-grained token** (alternative):

| You want | Permissions |
| --- | --- |
| Read private repos | Resource owner = your org · repositories selected · Contents: **Read** |
| Split PR line counts | + Pull requests: **Read** |
| That + automatic PRs | + Contents: **Read and write** · Pull requests: **Read and write** |

> [!WARNING]
> For an organization, a fine-grained token must have the **org as resource owner** (not your personal account), and the org must allow fine-grained tokens. If your org enforces SAML SSO, click **Configure SSO** on the token afterwards.

Then paste it in Options → **Test** → **Save token**, and confirm the *"Currently saved:"* line shows the right token type. Reload any open GitHub tabs.

## The popup

The toolbar popup shows token status, a list of [[Caching & Performance|cached repositories]] (each links to its Docs tab, with age and per-repo eviction), the file-content cache size, and a button to clear the caches.
