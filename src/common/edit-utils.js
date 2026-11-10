// Pure helpers for the edit/propose flows.
import { basename, stripExt, encodePath } from './paths.js';
import { githubSlug } from './slugger.js';

export function defaultCommitMessage(path) {
  return `docs: update ${basename(path)}`;
}

export function branchNameFor(path, rand) {
  const slug = githubSlug(stripExt(basename(path))).replace(/^-+|-+$/g, '');
  return `docs-tab/${slug || 'edit'}-${rand}`;
}

export function editPageUrl(owner, repo, branch, path) {
  // Root-relative: the viewer only runs on github.com, so this stays
  // same-origin there (and inside the local harness for testing). Branch
  // names containing "/" would need to stay unencoded for GitHub's
  // longest-match routing; default branches never do.
  return `/${owner}/${repo}/edit/${encodeURIComponent(branch)}/${encodePath(path)}`;
}

export function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
