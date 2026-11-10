// Decides how a scan tick reacts to the current page state. The critical case
// is 'wait': during GitHub's Turbo soft navigation the repo nav is briefly
// absent — tearing down then would discard the in-memory docs, viewer, and
// search index and force a cold rebuild (historically the "Docs tab takes a
// while to come back" bug).
export function scanDecision({ repoKey, navPresent, currentKey }) {
  if (!repoKey) return 'teardown';
  if (navPresent) return 'proceed';
  return currentKey === repoKey ? 'wait' : 'teardown-wait';
}
