import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTestFile, summarizePrFiles, parsePullRequest } from '../src/common/pr-stats.js';

test('recognizes tests and their supporting files across common ecosystems', () => {
  for (const path of [
    'tests/unit/a.js', 'src/__tests__/a.ts', 'packages/x/test/helper.js',
    'spec/support/helper.rb', 'src/a.test.tsx', 'src/a.spec.js', 'pkg/a_test.go',
    'test_widget.py', 'widget_test.py', 'WidgetTest.java', 'WidgetTests.cs',
    'src/test/java/Widget.java', 'e2e/login.ts', 'cypress/support/commands.ts',
    'fixtures/input.json', 'src/__fixtures__/data.json', '__snapshots__/a.snap',
    'src/a.spec.ts.snap', '__mocks__/client.js', 'mocks/server.ts',
    'jest.config.ts', 'packages/x/vitest.config.mts', 'playwright.config.js',
    'cypress.config.ts', '.mocharc.yml', 'pytest.ini', 'conftest.py',
    'phpunit.xml.dist', '.rspec', 'karma.conf.js', 'jest.setup.ts', 'setupTests.ts',
    'src/client.mock.ts', 'data/user.fixture.json', 'src/component.snapshot.json',
    'jest.config.json', 'vitest.base.config.ts', 'jest.integration.config.js',
  ]) assert.equal(isTestFile(path), true, path);
});

test('does not classify unrelated names or shared configuration as tests', () => {
  for (const path of [
    'src/contest.js', 'src/latest.ts', 'src/testament.js', 'src/specification.ts',
    'src/mockery.js', 'src/fixturesService.ts', 'src/Snapshot.ts', 'src/Testimonial.java',
    'package.json', 'pyproject.toml', 'vite.config.ts', 'tsconfig.json', 'README.md',
    'docs/testing.md', '.github/workflows/ci.yml',
    'packaging/widget.spec', 'src/vitest.client.ts',
  ]) assert.equal(isTestFile(path), false, path);
});

test('splits additions and deletions including deleted files, binaries, and current rename paths', () => {
  assert.deepEqual(summarizePrFiles([
    { filename: 'src/main.ts', additions: 10, deletions: 3 },
    { filename: 'tests/main.test.ts', status: 'removed', additions: 0, deletions: 20 },
    { filename: '__fixtures__/image.png', additions: 0, deletions: 0 },
    { filename: 'jest.config.ts', additions: 4, deletions: 1 },
    { filename: 'src/helper.ts', previous_filename: 'tests/helper.ts', additions: 2, deletions: 1 },
  ]), { code: { additions: 12, deletions: 4 }, tests: { additions: 4, deletions: 21 }, files: { code: 2, tests: 3, total: 5 } });
  assert.deepEqual(summarizePrFiles([]), { code: { additions: 0, deletions: 0 }, tests: { additions: 0, deletions: 0 }, files: { code: 0, tests: 0, total: 0 } });
});

test('refuses duplicate or malformed file statistics instead of inventing totals', () => {
  const good = { filename: 'src/a.js', additions: 1, deletions: 0 };
  for (const files of [[good, good], [{...good, additions: -1}], [{...good, deletions: null}], [{...good, additions: 1.5}], [{...good, filename: ''}]]) {
    assert.throws(() => summarizePrFiles(files));
  }
});

test('recognizes PR pages without confusing issue pages, lists, or commit comparisons', () => {
  for (const suffix of ['', '/', '/files', '/changes', '/commits', '/checks']) {
    assert.deepEqual(parsePullRequest('/acme/widget/pull/42' + suffix), { owner: 'acme', repo: 'widget', number: 42, key: 'acme/widget#42' });
  }
  for (const path of ['/acme/widget/pulls', '/acme/widget/issues/42', '/acme/widget/pull/0', '/acme/widget/pull/42/files/abc..def', '/acme/widget/pull/42/commits/abc']) {
    assert.equal(parsePullRequest(path), null);
  }
});
