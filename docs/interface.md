---
title: Interface & Shortcuts
description: The sidebar, toolbar icons, deep links, themes, and keyboard shortcuts.
tags: [reference, ui]
order: 8
---

# Interface & Shortcuts

## Sidebar

- **File tree** with folder icons and collapsible directories. README/index files sort first, then by frontmatter `order`, then natural sort.
- **Filter field** narrows the tree as you type.
- **Pinned section** at the top for docs with `pinned: true` (see [[Frontmatter Reference]]).
- **Tag chips** run `tag:` searches.
- **Count row** shows documents (📄) and, in [[Organization-wide Search|org mode]], repositories (🔀) indexed.

### Sidebar header icons

| Icon | Action |
| --- | --- |
| 🏢 building | Open [[Organization-wide Search]] |
| H / file | Toggle title vs. filename mode |
| ↻ refresh | Re-fetch the doc list (re-index picker in org mode) |

**Title mode** shows each document as its title — frontmatter `title` first, otherwise the first highest headline (an `h1` anywhere wins; else the first `h2`, and so on), otherwise the filename — or as its plain filename. The choice persists.

## Top bar actions

| Icon | Action |
| --- | --- |
| 🔗 chain-link | Copy a deep link to the current document (including the heading you're at) |
| ⧉ copy | Copy the document's raw markdown |
| ✎ pencil | Open the in-viewer editor ([[Editing & Publishing]]) |
| ◐ theme | Cycle auto → light → dark (the glyph shows the current mode: half-circle / sun / moon) |
| ↗ | Open / edit the file on GitHub |

## Deep links & sharing

Viewer state lives in the URL fragment:

```
https://github.com/owner/repo#docs/path/to/file.md?h=heading-slug
```

These links reload and share cleanly — with the extension they open straight to that document and heading; without it, the viewer just isn't shown and you see the normal repo. The chain-link button copies exactly this URL for wherever you are.

## Reading aids

- **On this page** table of contents with scroll-spy
- **Breadcrumbs** and **previous/next** navigation
- Relative links, [[Frontmatter Reference|wiki links]], and images all resolve inside the viewer

## Themes

The viewer follows GitHub's active theme automatically — including the dim variants — via GitHub's own CSS variables. The theme button overrides that with a manual auto → light → dark cycle.

## Keyboard

| Key | Action |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Open Docs and focus search from any repository page, including issues, PRs, and settings. If docs are loading, search opens when ready. |
| `/` | Focus search while Docs is open |
| `Esc` | Close search |
| `↑` `↓` `Enter` | Navigate and open search results |
