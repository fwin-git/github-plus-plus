// Per-repo draft store: staged markdown edits that survive reloads until the
// session is published or discarded. Shape: { [path]: {content, baseSha, savedAt} }
import { ext } from '../common/browser.js';

const key = (owner, repo) => `gdt:drafts:${owner}/${repo}`;

export async function loadDrafts(owner, repo) {
  try {
    return (await ext.storage.local.get(key(owner, repo)))[key(owner, repo)] ?? {};
  } catch {
    return {};
  }
}

async function store(owner, repo, drafts) {
  const k = key(owner, repo);
  if (Object.keys(drafts).length) await ext.storage.local.set({ [k]: drafts });
  else await ext.storage.local.remove(k);
}

export async function saveDraft(owner, repo, path, draft) {
  const drafts = await loadDrafts(owner, repo);
  drafts[path] = draft;
  await store(owner, repo, drafts);
  return drafts;
}

export async function removeDraft(owner, repo, path) {
  const drafts = await loadDrafts(owner, repo);
  delete drafts[path];
  await store(owner, repo, drafts);
  return drafts;
}

export async function clearDrafts(owner, repo) {
  await store(owner, repo, {});
  return {};
}
