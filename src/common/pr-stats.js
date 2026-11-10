// Whole-file classification deliberately uses path/name boundaries. Shared
// manifests and CI files stay in Code, even when they contain test settings.
const TEST_DIRECTORIES = new Set([
  'test', 'tests', '__tests__', 'spec', 'specs', '__specs__',
  'fixture', 'fixtures', '__fixtures__', 'snapshot', 'snapshots', '__snapshots__',
  'mock', 'mocks', '__mocks__', 'testdata', 'test-data', 'test-utils', 'test-helpers',
  'e2e', 'cypress', 'playwright', 'integration-tests', 'unit-tests',
]);

export function isTestFile(path) {
  const parts = path.split('/');
  const name = parts.pop();
  if (parts.some((part) => TEST_DIRECTORIES.has(part.toLowerCase()))) return true;
  if (/(?:^|[._-])(?:test|tests|spec|specs)[._-]/i.test(name)) return true;
  if (/[._-](?:mock|mocks|fixture|fixtures|snapshot|snapshots)[._-]/i.test(name)) return true;
  if (/(?:Test|Tests|Spec)\.(?:java|kt|kts|cs|swift|scala|php)$/.test(name)) return true;
  if (/\.snap$/i.test(name)) return true;
  if (/^(?:jest|vitest|playwright|cypress|karma|jasmine|wdio|webdriverio|ava|nyc)(?:\.[\w-]+)*\.(?:config|conf|setup|workspace)(?:\.[\w-]+)*\.(?:[cm]?[jt]s|json)$/i.test(name)) return true;
  return /^(?:\.(?:mocharc|nycrc)(?:\.(?:json|jsonc|ya?ml|[cm]?js))?|\.rspec|pytest\.ini|conftest\.py|phpunit\.xml(?:\.dist)?|setupTests\.[cm]?[jt]sx?)$/i.test(name);
}

export function summarizePrFiles(files) {
  const summary = { code: { additions: 0, deletions: 0 }, tests: { additions: 0, deletions: 0 }, files: { code: 0, tests: 0, total: 0 } };
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file.filename !== 'string' || !file.filename || seen.has(file.filename) ||
        !Number.isSafeInteger(file.additions) || file.additions < 0 ||
        !Number.isSafeInteger(file.deletions) || file.deletions < 0) {
      throw new Error('Incomplete or duplicate PR file statistics');
    }
    seen.add(file.filename);
    // Renames use the destination path, matching GitHub's changed-file list.
    const category = isTestFile(file.filename) ? 'tests' : 'code';
    const bucket = summary[category];
    summary.files[category]++;
    summary.files.total++;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
  }
  return summary;
}

export function parsePullRequest(pathname) {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)(?:\/(?:files|changes|commits|checks))?\/?$/.exec(pathname);
  if (!match) return null;
  const [, owner, repo, value] = match;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  return { owner, repo, number, key: `${owner}/${repo}#${number}` };
}
