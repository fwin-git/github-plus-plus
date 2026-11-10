---
title: Development & Releases
description: Build, test, the browser harness, CI, and cutting releases.
tags: [contributing]
order: 9
---

# Development & Releases

## Scripts

```bash
npm install
npm test           # unit tests (node:test) for all pure logic
npm run test:browser # PR summary integration tests in temporary headless Chrome
npm run build      # bundle to dist/
npm run zip        # build + store zips in artifacts/
npm run watch      # rebuild bundles on change
npm run media      # regenerate the README screenshots from local example data
npm run icons      # regenerate icons (deterministic, dependency-free)
node harness/serve.mjs   # http://localhost:8631/acme/widget — fixture repo page
```

## Architecture

Pure logic (path resolution, frontmatter, slugs, docs collection, wiki-link resolution, search, markdown plugins, cache policy) lives in ESM modules under `src/common/` and `src/content/`, and is covered by unit tests. Browser integration (tab injection, viewer, routing) is verified through the harness.

> [!NOTE]
> The **harness** serves a fake GitHub repo page with stubbed `chrome.storage` and GitHub APIs, so the full content script can be exercised in a plain browser tab — no extension install needed.

The `docs/` folder is user documentation **and** doubles as the extension's live showcase: every feature in these pages (frontmatter titles, tags, pinned docs, wiki links, alerts) renders when you open this repo's own Docs tab.

Development requires Node.js 22.12 or newer. They intercept GitHub requests locally and cover both summary layouts, navigation races, and API failures. They use Puppeteer's Chrome, the installed Chrome on macOS, or the executable specified by `CHROME_PATH`.

## Continuous integration

Every push and pull request runs the **CI** workflow (`.github/workflows/ci.yml`): unit tests, browser tests, a full build, bundle syntax checks, and manifest validation.

## Releases

The **Release** workflow (`.github/workflows/release.yml`) builds the Chrome and Firefox zips, generates change notes from the commits since the previous tag, and publishes a GitHub Release with the zips attached. Two ways to cut one:

- **Tag push** — bump `version` in `manifest.json` and `package.json`, commit, then:
  ```bash
  git tag v0.2.1 && git push origin v0.2.1
  ```
  The workflow verifies the tag matches the manifest version, then builds and publishes.
- **Manual dispatch** — **Actions → Release → Run workflow**, enter a version (e.g. `0.2.1`). It bumps the version files, commits, tags, builds, and publishes in one go.

Grab the attached zip from any release and load it — see [[Installation Guide]].
