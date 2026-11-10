---
title: PR Line Counts
description: Separate code changes from tests in a pull request's line-count summary.
tags: [pull-requests, review]
---

# PR Line Counts

On a pull request, including GitHub's new Overview page, the extension replaces the overall line-count summary with two values: a code icon for Code and a test-flask icon for Tests.

For example, Code **+120 −35** and Tests **+480 −12** appear beside their respective icons.

Click either line-count group to open Files changed with only code or test files shown. On Files changed, clicking a group switches the filter in place. These are ordinary links, so they also support keyboard navigation and opening in a new tab.

The active category has a highlighted background, outline, and underline in both the line counts and the Files changed badge. Click the selected count again to show all files. Both controls stay synchronized, including when using browser Back and Forward.

Hover over either group to see its category and the original total. Screen readers announce the category and both counts. The extension uses GitHub's per-file additions and deletions, including files whose diffs are collapsed or not loaded. This works independently of the Docs tab.

The **Files changed** badge also splits into code and test file counts with the same icons. Every changed file counts once, including deleted files, binaries, and renames. It reuses the verified file list and shows a loading spinner until the split is ready.

Click either file count to show only that category in the file panels and file tree. From Overview, the links open the filtered Files changed page. **Show all files** clears the filter. The selection is stored in the URL as `gdt-files=code` or `gdt-files=tests`, so reloads and links preserve it. Progressively loaded files are classified too. If a file cannot be matched to the verified list, all files stay visible with an explanation.

## What counts as Tests

Classification uses each file's path and name. Common conventions include:

- Test directories: `test/`, `tests/`, `__tests__/`, `spec/`, `specs/`, `e2e/`, `cypress/`, and `playwright/`, including nested directories in monorepos.
- Test filenames: `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go`, `WidgetTest.java`, and `WidgetTests.cs`.
- Supporting files: files inside `fixtures/`, `__fixtures__/`, `snapshots/`, `__snapshots__/`, `mocks/`, `__mocks__/`, `testdata/`, `test-utils/`, and `test-helpers/`; also `*.snap`, `*.mock.*`, `*.fixture.*`, and `*.snapshot.*` files.
- Dedicated runner configuration and setup: Jest, Vitest, Playwright, Cypress, Karma, Jasmine, WebdriverIO, AVA, NYC, `.mocharc.*`, `.nycrc.*`, `pytest.ini`, `conftest.py`, `phpunit.xml`, `.rspec`, and `setupTests.*`.

**Code** includes all remaining files, including documentation and shared configuration. Files such as `package.json`, `pyproject.toml`, and CI workflows stay in Code because they can mix application and test settings. Renamed files use their new path; deleted files use the path reported by GitHub.

These are whole-file heuristics, not language-aware analysis. Inline tests inside production source files and unconventional test names remain in Code. The rules are automatic and currently have no per-repository overrides.

## Availability and refresh

Public repositories work without a token, subject to GitHub's anonymous API limits. Private repositories use the token already saved in extension Options. Fine-grained tokens need **Pull requests: read** permission for the repository. See [GitHub's file-list API documentation](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files).

The extension verifies the complete file list and totals before showing the split. GitHub's original summary stays visible while loading or if access fails, a rate limit is reached, statistics are incomplete, or the PR changes during collection. PRs over the API's 3,000-file limit retain the original summary.

Results are cached in memory for up to five minutes and rechecked on page activity or focus after that interval. Changed native totals hide the old split. Failed requests wait at least one minute before retrying on subsequent page activity; rate-limit responses can require a longer wait. Reloading the page fetches fresh data.

The split applies to the overall PR summary on conversation, files, commits, and checks pages. Individual file counts and individual commit comparisons keep GitHub's native display.

## Repository PR counts

The **Pull requests** repository tab also splits its badge into **open, non-draft PRs | drafts**, using a green PR icon and a muted draft PR icon. Hover over either value for its label. Each count is a link to the corresponding filtered PR list; the tab label still opens the unfiltered list. The count links support keyboard navigation and opening in a new tab.

The extension uses two GitHub search counts, restricted to open PRs in the current repository. A draft is counted only in Drafts, so the categories do not overlap. Counts are cached in memory for up to five minutes while browsing the same repository. GitHub's search index can lag behind changes; if the returned counts do not add up to GitHub's exact native total, the native badge stays visible. Abbreviated native totals such as `3.2k` retain the native badge unless an exact total is available in its tooltip or accessibility label.

Both count features show a small spinner directly before GitHub's original counts while loading. For navigation badges it sits inside the native pill, with the same icon-to-count gap as the split. It disappears on success, failure, or navigation away. Reduced-motion preferences disable the spin animation; screen readers receive a loading label.
