import DOMPurify from 'dompurify';
import { buildConfluenceHash } from '../common/route.js';
import { normalizeSite, pageUrl } from '../common/confluence.js';
import { githubSlug } from '../common/slugger.js';

export function renderConfluence({ html, site, id }) {
  site = normalizeSite(site);
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p','div','span','br','hr','h1','h2','h3','h4','h5','h6','a','img','strong','b','em','i','u','s','del','sub','sup','code','pre','blockquote','ul','ol','li','dl','dt','dd','table','thead','tbody','tfoot','tr','th','td','details','summary'],
    ALLOWED_ATTR: ['href','src','alt','title','id','name','colspan','rowspan','scope','start'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  });
  const ids = new Set(), anchors = new Map();
  const unique = base => { let result = base, n = 1; while (ids.has(result)) result = `${base}-${n++}`; ids.add(result); return result; };
  for (const el of fragment.querySelectorAll('[id],[name]')) {
    const old = el.getAttribute('id') || el.getAttribute('name');
    el.removeAttribute('name');
    el.id = unique('gdt-cf-' + old);
    if (!anchors.has(old)) anchors.set(old, el.id);
  }
  const toc = [...fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => {
    if (!el.id) el.id = unique('gdt-cf-' + (githubSlug(el.textContent) || 'section'));
    return { level: Number(el.tagName.slice(1)), text: el.textContent, slug: el.id };
  });
  function safeUrl(raw) {
    try { const url = new URL(raw, pageUrl(site,id)); return ['https:','http:','mailto:'].includes(url.protocol) ? url : null; } catch { return null; }
  }
  for (const a of fragment.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href');
    if (raw.startsWith('#')) {
      let anchor = raw.slice(1);
      try { anchor = decodeURIComponent(anchor); } catch { /* literal malformed anchor */ }
      a.dataset.gdtHeading = anchors.get(anchor) || 'gdt-cf-' + anchor;
      a.href = '#' + a.dataset.gdtHeading;
      continue;
    }
    const url = safeUrl(raw);
    if (!url) { a.removeAttribute('href'); continue; }
    const pageId = /\/pages\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] || (url.pathname === '/wiki/pages/viewpage.action' ? url.searchParams.get('pageId') : null);
    if (url.origin === site && /^\d+$/.test(pageId || '')) {
      let heading = url.hash.slice(1);
      try { heading = decodeURIComponent(heading); } catch { /* literal malformed anchor */ }
      a.href = buildConfluenceHash({ site, pageId, heading: heading || null });
    } else {
      a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    }
  }
  // Media/macros can require Confluence's own authenticated application or CDN.
  // Keep an explicit original link rather than loading third-party tracking URLs.
  for (const img of fragment.querySelectorAll('img')) {
    const url = safeUrl(img.getAttribute('src') || '');
    const link = document.createElement('a');
    link.textContent = img.getAttribute('alt') || 'Open image in Confluence';
    link.href = url?.origin === site ? url.href : pageUrl(site,id);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className = 'gdt-confluence-image'; img.replaceWith(link);
  }
  for (const table of fragment.querySelectorAll('table')) {
    const wrap = document.createElement('div'); wrap.className = 'gdt-table-wrap';
    table.replaceWith(wrap); wrap.append(table);
  }
  return { fragment, toc };
}
