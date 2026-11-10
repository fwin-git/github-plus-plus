// GitHub-compatible heading slugs: lowercase, drop everything except
// letters/marks/numbers/space/hyphen/underscore, then spaces -> hyphens.

export function githubSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

export function createSlugger() {
  const seen = new Map();
  return {
    slug(text) {
      const base = githubSlug(text);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}-${n}`;
    },
  };
}
