// Line-based Myers diff + unified-patch rendering (git apply compatible).
// Missing trailing newlines are tracked by suffixing the final line with a
// \x00 sentinel, so newline-state changes surface as real line changes and
// emit "\ No newline at end of file" markers.

export function diffLines(aLines, bLines) {
  const N = aLines.length;
  const M = bLines.length;
  const MAX = N + M;
  const v = { 1: 0 };
  const trace = [];
  outer: for (let d = 0; d <= MAX; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) x = v[k + 1] ?? 0;
      else x = (v[k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < N && y < M && aLines[x] === bLines[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= N && y >= M) break outer;
    }
  }

  const ops = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && (vd[k - 1] ?? 0) < (vd[k + 1] ?? 0))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ op: ' ', text: aLines[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ op: '+', text: bLines[y - 1] });
        y--;
      } else {
        ops.push({ op: '-', text: aLines[x - 1] });
        x--;
      }
    }
  }
  return ops.reverse();
}

function prep(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  else if (lines.length) lines[lines.length - 1] += '\x00';
  return lines;
}

export function buildUnifiedPatch(path, oldText, newText, context = 3) {
  if (oldText === newText) return '';
  const ops = diffLines(prep(oldText), prep(newText));
  if (!ops.some((o) => o.op !== ' ')) return '';

  let aLine = 1;
  let bLine = 1;
  const annotated = ops.map((o) => {
    const rec = { ...o, aLine, bLine };
    if (o.op === ' ') {
      aLine++;
      bLine++;
    } else if (o.op === '-') {
      aLine++;
    } else {
      bLine++;
    }
    return rec;
  });

  const hunks = [];
  let i = 0;
  while (i < annotated.length) {
    if (annotated[i].op === ' ') {
      i++;
      continue;
    }
    let start = i;
    for (let back = 0; back < context && start > 0 && annotated[start - 1].op === ' '; back++) start--;
    let lastChange = i;
    let j = i;
    while (j < annotated.length) {
      if (annotated[j].op !== ' ') {
        lastChange = j;
        j++;
        continue;
      }
      let k = j;
      while (k < annotated.length && annotated[k].op === ' ') k++;
      if (k < annotated.length && k - j <= 2 * context) {
        j = k; // equal run is short: merge into this hunk
        continue;
      }
      break;
    }
    const end = Math.min(lastChange + context, annotated.length - 1);
    hunks.push(annotated.slice(start, end + 1));
    i = end + 1;
  }

  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const aCount = h.filter((o) => o.op !== '+').length;
    const bCount = h.filter((o) => o.op !== '-').length;
    const aStart = aCount ? h.find((o) => o.op !== '+').aLine : h[0].aLine - 1;
    const bStart = bCount ? h.find((o) => o.op !== '-').bLine : h[0].bLine - 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of h) {
      const noNL = o.text.endsWith('\x00');
      out.push(o.op + (noNL ? o.text.slice(0, -1) : o.text));
      if (noNL) out.push('\\ No newline at end of file');
    }
  }
  return out.join('\n') + '\n';
}
