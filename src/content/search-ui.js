// Live search dropdown: instant filename fuzzy results + full-text results
// once the background index is ready. All result DOM is built with
// createElement/textContent — never innerHTML with remote content.
import { parseQuery, searchFiles } from '../common/search.js';
import { githubSlug } from '../common/slugger.js';
import { basename } from '../common/paths.js';

export function createSearchUI({ input, panel, getDocs, getMeta, getIndex, getIndexState, getOrgResults, getConfluenceResults, onNavigate, subscribe, showSuggestions = false, onDismiss, onResults = () => {} }) {
  let items = [];
  let active = -1;
  let timer = 0;
  let lastQuery = null;
  const events = new document.defaultView.AbortController();
  const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: events.signal });
  const resultId = panel.id || (panel.id = 'gdt-search-results');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', resultId);
  input.setAttribute('aria-expanded', 'false');
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Documentation results');

  function close() {
    clearTimeout(timer);
    timer = 0;
    panel.hidden = true;
    panel.textContent = '';
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function pick(item) {
    close();
    input.blur();
    onNavigate(item);
  }

  function setActive(i) {
    if (active >= 0 && items[active]) {
      items[active].el.classList.remove('gdt-active');
      items[active].el.setAttribute('aria-selected', 'false');
    }
    active = i;
    if (active >= 0 && items[active]) {
      items[active].el.classList.add('gdt-active');
      items[active].el.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', items[active].el.id);
      items[active].el.scrollIntoView({ block: 'nearest' });
    }
  }

  function move(delta) {
    if (!items.length) return;
    setActive((active + delta + items.length) % items.length);
  }

  listen(input, 'input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  listen(input, 'keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onDismiss) onDismiss();
      else { close(); input.blur(); }
      e.stopPropagation();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      if (timer) run();
      const item = items[active >= 0 ? active : 0];
      if (item) {
        e.preventDefault();
        pick(item);
      }
    }
  });
  listen(input, 'focus', () => {
    if (input.value.trim() || showSuggestions) run();
  });
  listen(document, 'click', (e) => {
    if (showSuggestions) return;
    if (panel.hidden || panel.contains(e.target) || e.target === input) return;
    // Chips and broken wiki links open the panel from within the same click.
    if (e.target.closest && e.target.closest('.gdt-tag-chip, .gdt-wikilink-broken')) return;
    close();
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function highlighted(text, ranges) {
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [s, e] of ranges) {
      if (s < pos) continue;
      if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
      const mark = el('mark', 'gdt-mark', text.slice(s, e));
      frag.appendChild(mark);
      pos = e;
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }

  function addGroup(title) {
    panel.appendChild(el('div', 'gdt-sr-group', title));
  }

  function addItem({ path, heading, href, title, subtitle, snippet }) {
    const row = el('button', 'gdt-sr-item');
    row.type = 'button';
    row.id = `${resultId}-${items.length}`;
    row.tabIndex = -1;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.appendChild(el('span', 'gdt-sr-title', title));
    if (subtitle) row.appendChild(el('span', 'gdt-sr-path', subtitle));
    if (snippet) {
      const sn = el('span', 'gdt-sr-snippet');
      sn.appendChild(highlighted(snippet.text, snippet.ranges));
      row.appendChild(sn);
    }
    const item = { path, heading: heading ?? null, href: href ?? null, el: row };
    row.addEventListener('click', () => pick(item));
    row.addEventListener('mousemove', () => setActive(items.indexOf(item)));
    panel.appendChild(row);
    items.push(item);
  }

  function run() {
    const q = input.value.trim();
    const selected = q === lastQuery ? items[active] : null;
    lastQuery = q;
    close();
    if (!q && !showSuggestions) return;
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');

    const parsed = parseQuery(q);
    const meta = getMeta();
    const fileResults = searchFiles(getDocs(), meta, parsed).slice(0, 8);
    const index = getIndex();
    const contentResults = q && index && index.size ? index.search(parsed, { limit: 12 }) : [];

    if (fileResults.length) {
      addGroup(q ? 'Files' : 'Documents');
      for (const { doc } of fileResults) {
        const m = meta.get(doc.path);
        addItem({ path: doc.path, title: (m && m.title) || doc.title, subtitle: doc.path });
      }
    }
    if (contentResults.length) {
      addGroup('Content');
      for (const r of contentResults) {
        const m = meta.get(r.path);
        const doc = getDocs().find((d) => d.path === r.path);
        addItem({
          path: r.path,
          heading: r.matchedHeading ? githubSlug(r.matchedHeading) : null,
          title: (m && m.title) || (doc && doc.title) || basename(r.path),
          subtitle: r.matchedHeading ? `${r.path} › ${r.matchedHeading}` : r.path,
          snippet: r.snippet && r.snippet.text ? r.snippet : null,
        });
      }
    }
    const confluenceResults = getConfluenceResults ? getConfluenceResults(parsed) : [];
    if (confluenceResults.length) {
      addGroup('Confluence');
      for (const result of confluenceResults) addItem(result);
    }
    const orgResults = q && getOrgResults ? getOrgResults(parsed) : [];
    if (orgResults.length) {
      addGroup('Organization');
      for (const r of orgResults) addItem(r);
    }

    const state = getIndexState();
    if (!state.finished) {
      const note = state.started
        ? `Indexing content… ${Math.round((state.done / Math.max(1, state.total)) * 100)}% — content results may be incomplete`
        : 'Content index not built yet';
      panel.appendChild(el('div', 'gdt-sr-note', note));
    } else if (!items.length) {
      panel.appendChild(el('div', 'gdt-sr-note', 'No results'));
    }
    const previous = selected ? items.findIndex(item => item.path === selected.path && item.href === selected.href && item.heading === selected.heading) : -1;
    setActive(previous >= 0 ? previous : items.length ? 0 : -1);
    onResults(items.length);
  }

  const unsubscribe = subscribe?.(() => { if (showSuggestions || !panel.hidden) run(); });

  return {
    focus() {
      input.focus();
      input.select();
    },
    close,
    refresh: run,
    destroy({ preserveResults = false } = {}) {
      if (preserveResults) { clearTimeout(timer); timer = 0; }
      else close();
      events.abort();
      unsubscribe?.();
    },
    isOpen: () => !panel.hidden,
    setQuery(q) {
      input.value = q;
      input.focus();
      run();
    },
  };
}
