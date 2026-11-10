---
title: Running a Trial
description: See the extension working in a throwaway browser session — nothing installed.
tags: [setup, guide]
order: 2
---

# Running a Trial

A trial launches a disposable browser session with the extension already loaded — your daily profile is untouched and there is nothing to uninstall afterwards.

```bash
npm run install-ext -- --trial                    # prompts for the browser
npm run install-ext -- --browser brave --trial    # Chromium family: instant
npm run install-ext -- --browser firefox --trial  # via `npx web-ext run`
```

> [!NOTE]
> The trial session opens **this repository** — so the Docs tab and this very page are the first thing you see. If you are reading this inside the viewer right now, the showcase worked.

## What happens

1. **Chromium family** (Brave, Edge, Chromium, Chrome): a separate window opens using a throwaway profile in your temp directory, launched with `--load-extension=dist`. Close the window and the profile is inert.
2. **Firefox**: the CLI runs Mozilla's [`web-ext run`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/) (fetched on first use via `npx`), which starts a fresh profile with the extension pre-loaded and live-reloads it when `dist/` changes. Keep the terminal open; `Ctrl+C` ends the session.

## Caveats

| Situation | What to know |
| --- | --- |
| Branded Google Chrome ≥ 137 | Ignores `--load-extension` — use Brave/Edge/Chromium for trials, or the guided install (works in every Chrome) |
| Firefox trials | Session-scoped by design; for anything lasting, see [[Installation Guide#Manual: Firefox\|the Firefox install steps]] |
| Private repositories | Trials use a fresh profile with no token — add one in the extension options inside the trial session if you need private repos |
