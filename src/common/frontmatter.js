// Dependency-free YAML-lite frontmatter parser. Handles the constructs that
// appear in real-world docs frontmatter (scalars, quoted strings, inline
// arrays, dash lists, nested maps); degrades tolerantly on anything else.

export function parseFrontmatter(src) {
  const s = src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
  if (!/^---[ \t]*\r?\n/.test(s)) return { data: null, content: s, raw: null };
  const lines = s.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: null, content: s, raw: null };
  const rawLines = lines.slice(1, end).map((l) => l.replace(/\r$/, ''));
  return {
    data: parseYamlLite(rawLines),
    content: lines.slice(end + 1).join('\n'),
    raw: rawLines.join('\n'),
  };
}

function parseYamlLite(lines) {
  const items = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    items.push({ indent: /^ */.exec(line)[0].length, text: line.trim() });
  }
  if (!items.length) return {};
  const [value] = parseNodes(items, 0, items.length, items[0].indent);
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

// Parses items[i..end) at the given indent level. Returns [value, nextIndex].
function parseNodes(items, i, end, indent) {
  if (items[i].text === '-' || items[i].text.startsWith('- ')) {
    const arr = [];
    while (i < end && items[i].indent === indent && (items[i].text === '-' || items[i].text.startsWith('- '))) {
      const v = items[i].text === '-' ? '' : items[i].text.slice(2).trim();
      arr.push(parseScalar(stripComment(v)));
      i++;
      while (i < end && items[i].indent > indent) i++; // tolerate nested structures under a dash
    }
    return [arr, i];
  }
  const obj = {};
  while (i < end && items[i].indent === indent) {
    const m = /^([^:]+):(.*)$/.exec(items[i].text);
    if (!m) {
      i++;
      continue;
    }
    const key = stripQuotes(m[1].trim());
    const val = m[2].trim();
    i++;
    if (val === '') {
      if (i < end && items[i].indent > indent) {
        const childIndent = items[i].indent;
        let j = i;
        while (j < end && items[j].indent >= childIndent) j++;
        const [child] = parseNodes(items, i, j, childIndent);
        obj[key] = child;
        i = j;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(stripComment(val));
    }
  }
  return [obj, i];
}

function stripComment(v) {
  if (v[0] === '"' || v[0] === "'" || v[0] === '[') return v;
  const m = /\s#/.exec(v);
  return m ? v.slice(0, m.index).trim() : v;
}

function stripQuotes(v) {
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) return v.slice(1, -1);
  return v;
}

function parseScalar(v) {
  if (v === '') return null;
  const q = v[0];
  if (q === '"' || q === "'") {
    const close = v.indexOf(q, 1);
    if (close !== -1) return v.slice(1, close);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner).map((x) => parseScalar(x.trim()));
  }
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

function splitTopLevel(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function normalizeTags(data) {
  if (!data || typeof data !== 'object') return [];
  const out = [];
  for (const key of ['tags', 'keywords', 'categories']) {
    const v = data[key];
    if (v == null) continue;
    const arr = Array.isArray(v) ? v : String(v).split(',');
    for (const item of arr) {
      const t = String(item).trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export function isPinned(data) {
  if (!data || typeof data !== 'object') return false;
  const v = data.pinned ?? data.pin;
  if (v === true) return true;
  if (typeof v === 'string') return /^(true|yes|1)$/i.test(v.trim());
  return false;
}

export function docTitle(data, fallback) {
  const t = data && data.title != null ? String(data.title).trim() : '';
  return t || fallback;
}
