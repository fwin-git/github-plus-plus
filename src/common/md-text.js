// Cheap markdown -> plain text conversion for the search index. Approximate by
// design: full rendering is reserved for viewed documents.

export function mdToPlainText(src) {
  return (
    src
      // fence markers (keep the code text itself)
      .replace(/^ {0,3}(```|~~~).*$/gm, '')
      // headings / blockquotes / list markers / task boxes
      .replace(/^ {0,3}#{1,6}\s+/gm, '')
      .replace(/^ {0,3}>\s?/gm, '')
      .replace(/^ {0,3}([-*+]|\d+[.)])\s+\[( |x|X)\]\s+/gm, '')
      .replace(/^ {0,3}([-*+]|\d+[.)])\s+/gm, '')
      // images and links -> their labels
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      // wiki links -> label or target
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      // html tags
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      // emphasis and inline code markers
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      // tables and separators
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/^ {0,3}([-*_]\s*){3,}$/gm, '')
      .replace(/[ \t]+/g, ' ')
  );
}

function cleanInline(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .trim();
}

// Title for a document: the first heading of the highest level present —
// an h1 anywhere beats the first h2, which beats the first h3, and so on.
export function bestHeadingTitle(src) {
  const lines = src.split('\n');
  let best = null; // {level, text}
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    let level = null;
    let text = null;
    const atx = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) {
      level = atx[1].length;
      text = atx[2];
    } else if (i + 1 < lines.length && line.trim() && !/^ {0,3}[#>\-*+|]/.test(line)) {
      const next = lines[i + 1];
      if (/^ {0,3}={2,}\s*$/.test(next)) {
        level = 1;
        text = line.trim();
      } else if (/^ {0,3}-{2,}\s*$/.test(next)) {
        level = 2;
        text = line.trim();
      }
    }
    if (level == null) continue;
    const cleaned = cleanInline(text);
    if (!cleaned) continue;
    if (!best || level < best.level) {
      best = { level, text: cleaned };
      if (level === 1) break; // nothing can beat the first h1
    }
  }
  return best ? best.text : null;
}

export function extractHeadings(src) {
  const out = [];
  let inFence = false;
  for (const line of src.split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push(m[2].replace(/`([^`]*)`/g, '$1').trim());
  }
  return out;
}
