---
title: Frontmatter Reference
description: Every YAML frontmatter property the viewer understands.
tags: [reference, frontmatter]
order: 6
---

# Frontmatter Reference

All properties are optional; documents without frontmatter work fine. This very file uses `title`, `description`, `tags`, and `order` — compare the sidebar with the raw file to see them in action.

| Property | Type | Effect |
| --- | --- | --- |
| `title` | string | Document title: sidebar tree, pinned section, breadcrumbs, prev/next links, search results, browser tab. Beats the headline-derived title, and resolves `[[wiki links]]` by name. |
| `description` | string | Shown under the title at the top of the document. |
| `tags` | array or comma string | Clickable chips that run `tag:` searches; `keywords` and `categories` are accepted as aliases and merged. |
| `order` | number | Sort position within the folder (ascending). `sidebar_position` is a Docusaurus-compatible alias. README/index files always sort first. |
| `pinned` | `true` / `"yes"` / `"1"` | Puts the doc in the highlighted **Pinned** section stuck to the top of the sidebar — the [[Installation Guide]] demonstrates it. `pin` is an alias. |

Anything else (`author`, `date`, custom keys, …) appears in the collapsible **Metadata** panel at the top of the document. Frontmatter is never rendered as raw text.

## Example

```yaml
---
title: Getting Started
description: How to get going quickly.
tags: [guide, intro]
order: 1
pinned: true
---
```

## Title precedence

With the sidebar in title mode (the **H** toggle), each document's label resolves as:

1. Frontmatter `title`
2. First **highest** headline in the content — an `# h1` anywhere beats the first `## h2`, and so on (ATX and setext forms, code fences ignored)
3. The filename

Filename mode shows plain filenames, full stop.

> [!IMPORTANT]
> The built-in YAML parser covers the constructs real docs use: scalars (strings, numbers, booleans, null), quoted strings, inline arrays (`[a, b]`), dash lists, comments, and simple nested maps. Exotic YAML (anchors, multi-line block scalars) is tolerated but shown as plain text in the metadata panel.
