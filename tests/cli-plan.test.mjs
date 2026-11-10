import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowsers, findOnPath } from '../cli/browsers.js';
import { buildPlan, DEMO_URL } from '../cli/plan.js';

const DIST = '/repo/dist';
const TMP = '/tmp/profile';

test('detectBrowsers finds macOS app binaries', () => {
  const exists = (p) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' || p === '/Applications/Firefox.app/Contents/MacOS/firefox';
  const found = detectBrowsers('darwin', exists, {});
  const ids = found.map((b) => b.id);
  assert.ok(ids.includes('chrome'));
  assert.ok(ids.includes('firefox'));
  assert.ok(!ids.includes('edge'));
  assert.equal(found.find((b) => b.id === 'chrome').bin, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
});

test('detectBrowsers scans PATH on linux', () => {
  const exists = (p) => p === '/usr/bin/google-chrome' || p === '/usr/local/bin/firefox';
  const found = detectBrowsers('linux', exists, { PATH: '/usr/bin:/usr/local/bin' });
  const ids = found.map((b) => b.id);
  assert.ok(ids.includes('chrome'));
  assert.ok(ids.includes('firefox'));
});

test('detectBrowsers returns empty list when nothing exists', () => {
  assert.deepEqual(detectBrowsers('linux', () => false, { PATH: '/usr/bin' }), []);
});

test('findOnPath joins PATH dirs with the binary name', () => {
  const exists = (p) => p === '/opt/bin/brave-browser';
  assert.equal(findOnPath('brave-browser', '/usr/bin:/opt/bin', exists), '/opt/bin/brave-browser');
  assert.equal(findOnPath('missing', '/usr/bin', exists), null);
});

test('guided plan for chromium browsers opens the extensions page with the dist path in clipboard', () => {
  const chrome = { id: 'chrome', name: 'Google Chrome', family: 'chromium', extPage: 'chrome://extensions/', bin: '/bin/chrome' };
  const plan = buildPlan(chrome, { distPath: DIST, mode: 'guided', tmpDir: TMP, platform: 'darwin' });
  assert.equal(plan.kind, 'spawn');
  assert.equal(plan.bin, '/bin/chrome');
  assert.deepEqual(plan.args, ['chrome://extensions/']);
  assert.equal(plan.clipboard, DIST);
  assert.ok(plan.steps.some((s) => /Developer mode/i.test(s)));
  assert.ok(plan.steps.some((s) => /Load unpacked/i.test(s)));
  assert.ok(plan.steps.some((s) => /⌘⇧G|Cmd\+Shift\+G/i.test(s)), 'macOS picker hint');
});

test('guided plan for edge uses edge://extensions/', () => {
  const edge = { id: 'edge', name: 'Microsoft Edge', family: 'chromium', extPage: 'edge://extensions/', bin: '/bin/edge' };
  const plan = buildPlan(edge, { distPath: DIST, mode: 'guided', tmpDir: TMP, platform: 'win32' });
  assert.deepEqual(plan.args, ['edge://extensions/']);
  assert.ok(!plan.steps.some((s) => /⌘⇧G/.test(s)), 'no macOS hint on windows');
});

test('guided plan for firefox opens about:debugging and copies the manifest path', () => {
  const firefox = { id: 'firefox', name: 'Firefox', family: 'firefox', extPage: 'about:debugging#/runtime/this-firefox', bin: '/bin/firefox' };
  const plan = buildPlan(firefox, { distPath: DIST, mode: 'guided', tmpDir: TMP, platform: 'linux' });
  assert.deepEqual(plan.args, ['about:debugging#/runtime/this-firefox']);
  assert.equal(plan.clipboard, '/repo/dist/manifest.json');
  assert.ok(plan.steps.some((s) => /Load Temporary Add-on/i.test(s)));
});

test('trial plan for chromium launches a throwaway profile onto the showcase repo', () => {
  const brave = { id: 'brave', name: 'Brave', family: 'chromium', extPage: 'brave://extensions/', bin: '/bin/brave' };
  const plan = buildPlan(brave, { distPath: DIST, mode: 'trial', tmpDir: TMP, platform: 'linux' });
  assert.equal(plan.kind, 'spawn');
  assert.ok(plan.args.includes(`--load-extension=${DIST}`));
  assert.ok(plan.args.includes(`--user-data-dir=${TMP}`));
  assert.ok(plan.args.includes('--no-first-run'));
  assert.ok(plan.args.includes(DEMO_URL), 'opens the demo repo, not the extensions page');
  assert.ok(!plan.args.includes('brave://extensions/'));
});

test('trial plan for branded chrome carries a compatibility note', () => {
  const chrome = { id: 'chrome', name: 'Google Chrome', family: 'chromium', extPage: 'chrome://extensions/', bin: '/bin/chrome' };
  const plan = buildPlan(chrome, { distPath: DIST, mode: 'trial', tmpDir: TMP, platform: 'darwin' });
  assert.ok(plan.note && /Chrome/.test(plan.note));
});

test('trial plan for firefox delegates to web-ext run starting on the showcase repo', () => {
  const firefox = { id: 'firefox', name: 'Firefox', family: 'firefox', extPage: 'about:debugging#/runtime/this-firefox', bin: '/bin/firefox' };
  const plan = buildPlan(firefox, { distPath: DIST, mode: 'trial', tmpDir: TMP, platform: 'darwin' });
  assert.equal(plan.kind, 'webext');
  assert.deepEqual(plan.args, ['run', '--source-dir', DIST, '--start-url', DEMO_URL, '--firefox', '/bin/firefox']);
});

test('trial plan for firefox without a known binary omits --firefox', () => {
  const firefox = { id: 'firefox', name: 'Firefox', family: 'firefox', extPage: 'about:debugging#/runtime/this-firefox', bin: null };
  const plan = buildPlan(firefox, { distPath: DIST, mode: 'trial', tmpDir: TMP, platform: 'darwin' });
  assert.deepEqual(plan.args, ['run', '--source-dir', DIST, '--start-url', DEMO_URL]);
});
