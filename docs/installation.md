---
title: Installation Guide
description: Load the extension in Chrome or Firefox — guided, manual, or permanent.
tags: [setup, guide]
order: 1
pinned: true
---

# Installation Guide

The fastest path is the guided installer; manual steps follow for people who prefer doing it by hand. Just want to *see* it first? Use [[Running a Trial|the trial]] instead — zero clicks, nothing installed.

## Guided install (recommended)

```bash
npm install
npm run install-ext
```

The installer builds `dist/` if needed, detects your browsers (Chrome, Brave, Edge, Chromium, Firefox on macOS/Linux/Windows), opens the right extensions page, and puts the exact path in your clipboard — you finish with the 2–3 clicks browsers require for unpacked extensions (there is deliberately no deep link that installs one).

Non-interactive variants:

```bash
npm run install-ext -- --list                # show detected browsers
npm run install-ext -- --browser firefox     # skip the prompt
npm run install-ext -- --dry-run             # print the plan, run nothing
```

## Manual: Chrome, Brave, Edge, Chromium

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder

The extension persists across restarts.

## Manual: Firefox and Zen

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `dist/manifest.json`

> [!WARNING]
> Firefox removes temporary add-ons every time it quits — that is a Firefox rule for unsigned extensions. Reload it the same way after a restart, or make it permanent:

For a permanent Firefox install, submit `artifacts/github-plus-plus-firefox-v*.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/) — choose *self-distribution* to get a signed `.xpi` back without a public listing, then install that file. Firefox ≥ 121.

## After installing

- [ ] Visit any GitHub repository and look for the **Docs** tab next to Code and Issues
- [ ] Optional: add a GitHub token via the toolbar icon → **Options** for private repos and a 5,000 req/h limit
- [ ] Read the [[Frontmatter Reference]] to make your own repo's docs shine

## Upgrade from GitHub Docs Tab

Github++ uses a new Firefox extension ID. Firefox treats it as a separate extension.
Remove the old extension before you use Github++ on the same page.
Enter your settings and token in the new extension’s Options page.
