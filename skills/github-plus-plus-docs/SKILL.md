---
name: github-plus-plus-docs
description: Use when creating, reviewing, or reorganizing repository documentation for the Github++ browser extension, or when documents, titles, links, or search results do not appear as expected in its Docs tab.
---

# Repository docs for Github++

Make documentation readable in GitHub and in the Github++ Docs tab. Preserve existing project conventions and working links.
Change only the documentation within the user's request. This skill does not authorize publishing, changing browser settings, or reorganizing unrelated files.

To invoke this skill, point an agent to this file and identify the repository and documentation to check.

## Folder structure

Use this small structure for new documentation. Add folders only when the content needs them.

```text
README.md
docs/
  README.md
  getting-started.md
  reference/
    configuration.md
  images/
    settings.png
```

Keep the root README short. Use `docs/README.md` as an index with relative links to the main guides.
Keep package documentation near its package when that structure already exists, such as `packages/api/docs/`.

The default discovery rules are:

- Include Markdown files at the repository root.
- Include descendants of `docs`, `doc`, `documentation`, `wiki`, `guides`, `guide`, `handbook`, `manual`, and `.github` at any depth.
- Also recognize the consecutive folder path `website/docs` at any depth.
- Match folder names without regard to case. Accept `.md`, `.markdown`, `.mdown`, and `.mdx`, without regard to case.

Prefer `.md` for new files. Do not rename supported extensions merely for this extension.
`notes/` is not a default documentation folder. For existing custom folders, explain the **Options → Documentation folders** setting before proposing a move.
Folder settings belong to the browser extension. A repository configuration file does not change discovery.

The default collection limit is 500 documents. Automatic content indexing skips files above 200 KiB.
These limits are configurable. Large documents can still open, but automatic search omits their content. Their metadata may remain unavailable until opened.
The viewer requests the remote repository's default branch through `HEAD`. Selecting another GitHub branch or PR does not change that source.
Uncommitted local files do not appear in the viewer.

## Document format

Frontmatter is optional. Use it when a document needs a stable title, description, tags, position, or pin.
Place it at the start of the file, between two `---` lines.

Save this example as `docs/getting-started.md`:

```markdown
---
title: Getting started
description: Install the project and run the first check.
tags: [setup, guide]
order: 1
pinned: true
---

# Getting started

## Requirements

Install the tools listed in the project README.

## Check the installation

Run the project's documented test command.

See the [documentation index](README.md) for the next guide.
```

| Field | Supported value and effect |
| --- | --- |
| `title` | String. Supplies the document title and a wiki-link target. |
| `description` | Single-line string. Appears below the title. |
| `tags` | String array or comma-separated string. Supplies clickable search tags. `keywords` and `categories` also contribute tags. |
| `order` | Number. Sorts documents within their folder in ascending order. `sidebar_position` is an alias. |
| `pinned` | Boolean `true`. Adds the document to the pinned section. `pin` is an alias. |

Keep YAML simple: strings, numbers, booleans, inline arrays, or dash lists. Avoid block scalars, anchors, aliases, and escaped quotes.
The limited parser does not interpret these constructs as a full YAML parser would. Preserve unrelated metadata required by another documentation tool.

README and index files sort before other files, even when their `order` value is larger.
After index files and numeric order, the tree sorts by label. Frontmatter cannot order folders.
Title mode uses `title`, then the first highest-level heading, then the filename. Filename mode ignores these display titles.

Use one H1 and descriptive H2/H3 headings. Use short paragraphs, numbered procedures, and fenced code blocks with language names.
Keep wording direct. Do not add unsupported claims or generic marketing text.

## Links and rendering

- Prefer relative Markdown links with explicit filenames: `[Configuration](reference/configuration.md#settings)`.
- Resolve relative images from the current document: `![Settings](images/settings.png)`. Keep image files in the repository.
- Use GitHub-style heading anchors. Check duplicate headings and their numeric suffixes.
- Wiki links support `[[Getting started]]` and `[[docs/getting-started.md#Requirements|Requirements]]`.
- For repeated filenames or titles, use a complete repository-relative wiki target or an explicit relative Markdown link.

Wiki-link ambiguity does not produce an error. The resolver prefers the current folder, then shallower and shorter paths.
Title-based wiki links depend on loaded metadata. Path-based links avoid that dependency and remain easier to check.

Tables, task lists, footnotes, GitHub alerts, and syntax highlighting work.
Mermaid displays source. Math does not receive KaTeX rendering. MDX displays as Markdown without executing JSX.
Use a static diagram image when readers must see a diagram. Do not depend on scripts, interactive components, or site-specific plugins.

## Check the result

1. List tracked Markdown files from the target repository root:

   ```sh
   git ls-files -- ':(icase)*.md' ':(icase)*.markdown' ':(icase)*.mdown' ':(icase)*.mdx'
   ```

2. Compare the changed paths with the discovery rules. Check any custom folder settings separately.
3. Check frontmatter types and the expected title, pin, tags, and order. Do not apply full-YAML assumptions.
4. Resolve each changed local link and image from its source file. Check target files and heading anchors, including links affected by moves.
5. Check the collection size and large files. Explain any discovery or content-search limits.
6. When the changed files reach the default branch, open Docs and check the tree, links, images, and `tag:` search.

Report the changed paths and the checks performed. State when browser checks remain pending because the files exist only locally or on a branch.
