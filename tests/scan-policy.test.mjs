import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDecision } from '../src/common/scan-policy.js';

test('leaving repo context tears down', () => {
  assert.equal(scanDecision({ repoKey: null, navPresent: false, currentKey: 'a/b' }), 'teardown');
  assert.equal(scanDecision({ repoKey: null, navPresent: true, currentKey: null }), 'teardown');
});

test('repo page with nav proceeds', () => {
  assert.equal(scanDecision({ repoKey: 'a/b', navPresent: true, currentKey: null }), 'proceed');
  assert.equal(scanDecision({ repoKey: 'a/b', navPresent: true, currentKey: 'a/b' }), 'proceed');
  assert.equal(scanDecision({ repoKey: 'a/b', navPresent: true, currentKey: 'c/d' }), 'proceed');
});

test('same repo with nav mid-swap waits WITHOUT tearing down state', () => {
  assert.equal(scanDecision({ repoKey: 'a/b', navPresent: false, currentKey: 'a/b' }), 'wait');
});

test('different repo before its nav mounts tears down old state and waits', () => {
  assert.equal(scanDecision({ repoKey: 'c/d', navPresent: false, currentKey: 'a/b' }), 'teardown-wait');
  assert.equal(scanDecision({ repoKey: 'c/d', navPresent: false, currentKey: null }), 'teardown-wait');
});
