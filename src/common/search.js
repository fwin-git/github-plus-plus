// Pure search: filename fuzzy matching + lazily-built full-text index.

export function fuzzyScore(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  let first = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -Infinity;
    score += 1;
    if (idx === prev + 1) score += 3;
    if (idx === 0 || /[-_ /.]/.test(t[idx - 1])) score += 2;
    if (first === -1) first = idx;
    prev = idx;
    ti = idx + 1;
  }
  score += Math.max(0, 2 - first * 0.05); // earlier starts read as better matches
  return score;
}

export function parseQuery(q) {
  const terms = [];
  const phrases = [];
  const tags = [];
  if (q) {
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      if (m[1] !== undefined) {
        const p = m[1].trim().toLowerCase();
        if (p) phrases.push(p);
      } else {
        const tag = /^tag:(.*)$/i.exec(m[2]);
        if (tag) {
          if (tag[1]) tags.push(tag[1].toLowerCase());
        } else {
          terms.push(m[2].toLowerCase());
        }
      }
    }
  }
  return { terms, phrases, tags };
}

export function searchFiles(docs, metaByPath, query) {
  const { terms, phrases, tags } = typeof query === 'string' ? parseQuery(query) : query;
  const needle = [...terms, ...phrases].join(' ');
  const out = [];
  for (const doc of docs) {
    const meta = metaByPath.get(doc.path);
    if (tags.length) {
      const docTags = (meta && meta.tags ? meta.tags : []).map((t) => String(t).toLowerCase());
      if (!tags.every((t) => docTags.includes(t))) continue;
    }
    const title = (meta && meta.title) || doc.title || '';
    const score = needle ? fuzzyScore(needle, `${title} ${doc.path}`) : 0;
    if (score === -Infinity) continue;
    out.push({ doc, score });
  }
  out.sort((a, b) => b.score - a.score || (a.doc.path < b.doc.path ? -1 : 1));
  return out;
}

export class ContentIndex {
  #entries = new Map();

  get size() {
    return this.#entries.size;
  }

  add(path, { text = '', title = '', headings = [], tags = [] }) {
    this.#entries.set(path, {
      text,
      textLower: text.toLowerCase(),
      titleLower: String(title).toLowerCase(),
      headings: headings.map((h) => String(h)),
      headingsLower: headings.map((h) => String(h).toLowerCase()),
      tagsLower: tags.map((t) => String(t).toLowerCase()),
    });
  }

  remove(path) {
    this.#entries.delete(path);
  }

  // Fold another index's entries into this one (later entries win on collision).
  merge(other) {
    if (!other || !(other instanceof ContentIndex)) return this;
    for (const [path, entry] of other.#entries) this.#entries.set(path, entry);
    return this;
  }

  allTags() {
    const m = new Map();
    for (const e of this.#entries.values()) {
      for (const t of e.tagsLower) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return m;
  }

  search(parsed, { limit = 20 } = {}) {
    const { terms, phrases, tags } = parsed;
    const needles = [...terms, ...phrases];
    const results = [];
    for (const [path, e] of this.#entries) {
      if (tags.length && !tags.every((t) => e.tagsLower.includes(t))) continue;
      if (!needles.length) {
        if (!tags.length) continue;
        results.push({ path, score: 1, snippet: snippetOf(e, [], -1), matchedIn: 'tag', matchedHeading: null });
        continue;
      }
      let score = 0;
      let firstBodyHit = -1;
      let matchedHeading = null;
      let ok = true;
      for (const n of needles) {
        let tier = 0;
        if (e.titleLower.includes(n)) {
          score += 100;
          tier = 3;
        }
        const hi = e.headingsLower.findIndex((h) => h.includes(n));
        if (hi !== -1) {
          score += 50;
          tier = Math.max(tier, 2);
          if (matchedHeading === null) matchedHeading = e.headings[hi];
        }
        const bi = e.textLower.indexOf(n);
        if (bi !== -1) {
          score += 10;
          tier = Math.max(tier, 1);
          if (firstBodyHit === -1) firstBodyHit = bi;
        }
        if (!tier) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const matchedIn = score >= 100 ? 'title' : score >= 50 ? 'heading' : 'body';
      results.push({ path, score, snippet: snippetOf(e, needles, firstBodyHit), matchedIn, matchedHeading });
    }
    results.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
    return results.slice(0, limit);
  }
}

function snippetOf(e, needles, firstHit) {
  const WINDOW = 160;
  let start = firstHit > 40 ? firstHit - 40 : 0;
  if (start > 0) {
    const sp = e.text.indexOf(' ', start);
    if (sp !== -1 && sp < start + 20) start = sp + 1;
  }
  const text = e.text.slice(start, start + WINDOW);
  const textLower = text.toLowerCase();
  const ranges = [];
  for (const n of needles) {
    let idx = 0;
    while (ranges.length < 8 && (idx = textLower.indexOf(n, idx)) !== -1) {
      ranges.push([idx, idx + n.length]);
      idx += n.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { text, ranges };
}
