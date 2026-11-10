import { loadSettings } from '../common/settings.js';
import { makeClient } from './github-api.js';
import { syncCountSpinners } from './count-loading.js';

const MARKER = '[data-gdt-pr-counts]';
const SPINNER = 'data-gdt-pr-counts-spinner';
const ERROR = 'data-gdt-pr-counts-error';
const LOADING = 'data-gdt-pr-counts-loading';
const TTL = 5 * 60_000;
const RETRY_DELAY = 60_000;

function routeRepo() {
  const match = /^\/([^/]+)\/([^/]+)/.exec(location.pathname);
  return match ? { owner: match[1], repo: match[2], key: `${match[1]}/${match[2]}`.toLowerCase() } : null;
}

function nativeCounters(info) {
  if (!info) return [];
  return [...document.querySelectorAll('nav[aria-label="Repository"] a[href]')].filter(link => {
    const url = new URL(link.href, location.href);
    return url.origin === location.origin && url.pathname.replace(/\/$/, '').toLowerCase() === `/${info.key}/pulls`;
  }).map(link => link.querySelector('[data-component="counter"], .Counter')).filter(Boolean);
}

function nativeTotal(node) {
  const label = node.querySelector('[data-component="CounterLabel"]') || node;
  // Abbreviated labels sometimes retain their exact total in a tooltip.
  for (const raw of [label.textContent, label.getAttribute('title'), node.getAttribute('title'), label.getAttribute('aria-label'), node.getAttribute('aria-label')]) {
    const value = raw?.trim() || '';
    const total = Number(value.replaceAll(',', ''));
    if (/^\d[\d,]*$/.test(value) && Number.isSafeInteger(total)) return total;
  }
  return null;
}

function clearDisplay() {
  document.querySelectorAll(MARKER).forEach(node => node.remove());
  document.querySelectorAll('.gdt-pr-counts-tab').forEach(node => node.classList.remove('gdt-pr-counts-tab'));
  document.querySelectorAll('.gdt-pr-counts-item').forEach(node => node.classList.remove('gdt-pr-counts-item'));
  document.querySelectorAll('[data-gdt-pr-counts-native]').forEach(node => node.removeAttribute('data-gdt-pr-counts-native'));
}

function prIcon(draft) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 16 16', width: '12', height: '12',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add(draft ? 'gdt-pr-draft-icon' : 'gdt-pr-open-icon');
  for (const [cx, cy] of [[4, 3], [4, 13], [12, 13], ...(draft ? [[12, 3]] : [])]) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', '1.5');
    svg.append(circle);
  }
  const stem = document.createElementNS(ns, 'path');
  stem.setAttribute('d', 'M4 4.5v7');
  const branch = document.createElementNS(ns, 'path');
  branch.setAttribute('d', draft ? 'M12 5.5v5' : 'M12 11.5V6a3 3 0 0 0-3-3H8m2-2L8 3l2 2');
  if (draft) branch.setAttribute('stroke-dasharray', '1 2');
  svg.append(stem, branch);
  return svg;
}

function renderCounter(native, counts) {
  const tab = native.closest('a');
  native.setAttribute('data-gdt-pr-counts-native', '');
  tab.classList.add('gdt-pr-counts-tab');
  tab.parentElement.classList.add('gdt-pr-counts-item');
  const align = badge => {
    // GitHub's tab has a bottom margin reserved for its underline. Match its
    // block margins so flex centering uses the label's center, not the li's.
    const style = getComputedStyle(tab);
    badge.style.marginBlockStart = style.marginBlockStart;
    badge.style.marginBlockEnd = style.marginBlockEnd;
  };
  if (tab.nextElementSibling?.matches(MARKER)) {
    align(tab.nextElementSibling);
    return;
  }
  const badge = document.createElement('span');
  badge.className = 'gdt-pr-counts';
  badge.setAttribute('data-gdt-pr-counts', '');
  badge.title = `${counts.open.toLocaleString()} open, excluding drafts | ${counts.drafts.toLocaleString()} drafts. Total: ${counts.total.toLocaleString()}.`;
  for (const draft of [false, true]) {
    if (draft) {
      const separator = document.createElement('span');
      separator.textContent = ' | ';
      separator.setAttribute('aria-hidden', 'true');
      badge.append(separator);
    }
    const group = document.createElement('a');
    group.className = 'gdt-pr-count-group';
    const url = new URL(tab.href);
    url.searchParams.set('q', `is:pr is:open draft:${draft}`);
    group.href = url.href;
    const value = (draft ? counts.drafts : counts.open).toLocaleString();
    const label = draft ? `${value} draft pull requests` : `${value} open pull requests, excluding drafts`;
    group.setAttribute('aria-label', label);
    group.title = label;
    const number = document.createElement('span');
    number.textContent = value;
    number.setAttribute('aria-hidden', 'true');
    group.append(prIcon(draft), number);
    badge.append(group);
  }
  // Sibling links avoid nesting interactive elements inside GitHub's tab link.
  tab.after(badge);
  align(badge);
}

export function startPrCounts() {
  let current = null;
  let timer = 0;
  let token;
  let blockedUntil = 0;
  const spinners = targets => syncCountSpinners(targets, SPINNER, 'Loading open and draft pull request counts');

  function reset() {
    current?.controller?.abort();
    current = null;
    clearDisplay();
    spinners([]);
    document.documentElement.removeAttribute(ERROR);
    document.documentElement.removeAttribute(LOADING);
  }

  function paint(state, natives) {
    document.querySelectorAll(MARKER).forEach(node => {
      if (!natives.some(native => native.closest('a') === node.previousElementSibling)) node.remove();
    });
    spinners(state.loading ? natives : []);
    if (!state.counts) return;
    if (natives.some(native => nativeTotal(native) !== state.counts.total)) {
      state.counts = null;
      clearDisplay();
      document.documentElement.setAttribute(ERROR, 'PR search counts do not match the repository total');
      return;
    }
    natives.forEach(native => renderCounter(native, state.counts));
  }

  async function scan() {
    const info = routeRepo();
    if (current && current.key !== info?.key) reset();
    const natives = nativeCounters(info);
    if (!info || !natives.length) return;
    if (!current) current = { ...info, counts: null, loading: false, fetchedAt: 0, retryAt: 0 };
    const state = current;
    paint(state, natives);
    if (state.loading || Date.now() < Math.max(state.retryAt, blockedUntil)) return;
    if (state.counts && Date.now() - state.fetchedAt < TTL) return;
    state.loading = true;
    state.counts = null;
    clearDisplay();
    spinners(natives);
    state.controller = new AbortController();
    const timeout = setTimeout(() => state.controller.abort(), 30_000);
    document.documentElement.setAttribute(LOADING, 'true');
    try {
      const settings = await loadSettings();
      if (current !== state) return;
      token = settings.token;
      const counts = await makeClient({ ...info, token }).getPullRequestCounts({ signal: state.controller.signal });
      if (current !== state || routeRepo()?.key !== state.key) return;
      state.counts = counts;
      state.fetchedAt = Date.now();
      state.retryAt = Date.now() + RETRY_DELAY;
      document.documentElement.removeAttribute(ERROR);
      paint(state, nativeCounters(info));
    } catch (error) {
      if (current !== state) return;
      state.retryAt = Date.now() + RETRY_DELAY;
      if (error?.name === 'RateLimitError') blockedUntil = Math.max(state.retryAt, error.resetAt || 0);
      document.documentElement.setAttribute(ERROR, String(error?.message || error).slice(0, 300));
    } finally {
      clearTimeout(timeout);
      state.loading = false;
      if (current === state) {
        spinners([]);
        document.documentElement.removeAttribute(LOADING);
      }
    }
  }

  function schedule() {
    if (!timer) timer = setTimeout(() => { timer = 0; void scan(); }, 100);
  }
  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  for (const event of ['turbo:load', 'turbo:render', 'soft-nav:success', 'pjax:end']) document.addEventListener(event, schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('focus', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  void scan();
  return {
    settingsChanged(next) {
      if (next.token === token) return;
      token = next.token;
      blockedUntil = 0;
      reset();
      schedule();
    },
  };
}
