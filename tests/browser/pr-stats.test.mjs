// Real DOM integration with intercepted GitHub responses; no account or network needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';

let browser, content;
before(async () => {
  content = (await build({ entryPoints: ['src/content/index.js'], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined) });
});
after(async () => { await browser?.close(); });

const modern = `<div data-component="PH_Navigation"><div class="summary-wrapper"><div class="d-flex flex-items-center gap-1" id="native"><span aria-hidden="true" class="f6 fgColor-success text-bold">+15</span><span aria-hidden="true" class="f6 fgColor-danger text-bold">-3</span><span class="sr-only">Lines changed: 15 additions &amp; 3 deletions</span><div class="d-flex"><div data-testid="addition diffstat"></div></div></div></div><div><nav aria-label="Pull request navigation"><a href="/acme/widget/pull/42/files">Files changed</a></nav></div></div>`;
const legacy = `<div class="pr-toolbar"><div id="diffstat"><span class="color-fg-success">+15</span><span class="color-fg-danger">−3</span><span class="diffstat"></span></div><nav aria-label="Pull request tabs"><a href="/acme/widget/pull/42/files">Files changed</a></nav></div>`;
// Overview moves totals into PageHeader.Description and renames the nav.
const overview = `<div data-component="PageHeader"><div data-component="PageHeader.Description"><div class="branchGroup"><a href="/acme/widget/tree/main">main</a><div id="native"><span class="fgColor-success">+15</span><span class="fgColor-danger">-3</span><span class="sr-only">Lines changed: 15 additions &amp; 3 deletions</span><div class="d-flex"><div data-testid="addition diffstat"></div></div></div></div></div><div data-component="PH_Navigation"><nav aria-label="Pull request"><a href="/acme/widget/pull/42">Overview</a><a href="/acme/widget/pull/42/changes">Files changed</a></nav></div></div><div id="file-stat"><span class="fgColor-success">+15</span><span class="fgColor-danger">-3</span><div><div data-testid="addition diffstat"></div></div></div>`;
const files = [{ filename: 'src/app.js', additions: 5, deletions: 2 }, { filename: 'tests/app.js', additions: 10, deletions: 1 }];
const meta = { head: { sha: 'a' }, base: { sha: 'b' }, changed_files: 2, additions: 15, deletions: 3 };

for (const [layout, markup, counter] of [
  ['modern', modern, '<span data-component="counter"><span data-component="CounterLabel">2</span><span class="sr-only"> (2)</span></span>'],
  ['legacy', legacy, '<span class="Counter">2</span>'],
  ['overview', overview, '<span data-component="counter"><span data-component="CounterLabel">2</span></span>'],
]) {
  test(`${layout}: Files changed splits code and test files and restores on changed native total`, async (t) => {
    const { page, calls } = await fixture(t, { markup: markup.replace('Files changed</a>', `Files changed${counter}</a>`) });
    await page.waitForSelector('[data-gdt-pr-files]', { timeout: 3000 });
    assert.match(await page.$eval('[data-gdt-pr-files]', el => el.textContent), /1\s*\|\s*1/);
    assert.equal(await page.$$eval('[data-gdt-pr-files] svg', els => els.length), 2);
    assert.equal(await page.$eval('[data-gdt-pr-files]', el => el.previousElementSibling.getAttribute('href')), layout === 'overview' ? '/acme/widget/pull/42/changes' : '/acme/widget/pull/42/files');
    assert.equal(calls.filter(url => url.includes('/files')).length, 1);
    await page.evaluate(() => {
      const native = document.querySelector('[data-gdt-pr-files-native]');
      const replacement = native.cloneNode(true);
      replacement.removeAttribute('data-gdt-pr-files-native');
      native.replaceWith(replacement);
    });
    await page.waitForSelector('[data-gdt-pr-files-native]', { timeout: 1500 });
    await page.evaluate(() => {
      const native = document.querySelector('[data-gdt-pr-files-native]');
      (native.querySelector('[data-component="CounterLabel"]') || native).textContent = '3';
    });
    await page.waitForFunction(() => !document.querySelector('[data-gdt-pr-files]'));
    assert.equal(await page.$('[data-gdt-pr-files-native]'), null);
  });
}

async function fixture(t, { markup = modern, reply, nav = '<ul></ul>', path = '/acme/widget/pull/42' } = {}) {
  const page = await browser.newPage();
  if (process.env.DEBUG_BROWSER) {
    page.on('console', (message) => console.log(message.text()));
    page.on('pageerror', (error) => console.log(error.message));
  }
  t.after(() => page.close());
  const calls = [];
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (request.isNavigationRequest()) {
      return request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<html><head><meta charset="utf-8"></head><body><nav aria-label="Repository">${nav}</nav><main>${markup}</main></body></html>` });
    }
    if (url.hostname === 'api.github.com') {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Accept, Authorization, X-GitHub-Api-Version', 'access-control-allow-methods': 'GET, OPTIONS' };
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers });
      if (url.pathname.includes('/pulls/') || url.pathname === '/search/issues') calls.push(url.pathname + url.search);
      const custom = await reply?.(url);
      const body = custom?.body ?? (url.pathname.endsWith('/files') ? files : meta);
      return request.respond({ status: custom?.status || (url.pathname.includes('/git/trees/') ? 403 : 200), contentType: 'application/json', headers, body: JSON.stringify(body) }).catch(() => {});
    }
    return request.respond({ status: 404, body: '' });
  });
  await page.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: (fn) => listeners.push(fn) } } };
    window.changeToken = () => listeners.forEach((fn) => fn({ 'gdt:settings': { newValue: { token: 'changed' } } }, 'local'));
  });
  await page.goto('https://github.com' + path);
  await page.addStyleTag({ path: 'src/content/viewer.css' });
  await page.addScriptTag({ content });
  return { page, calls };
}

for (const [layout, markup, native] of [['modern', modern, '#native'], ['legacy', legacy, '#diffstat'], ['overview', overview, '#native']]) {
  test(`${layout}: displays accessible icons, retains original totals, and survives rerenders without request loops`, async (t) => {
    const { page, calls } = await fixture(t, { markup });
    await page.waitForSelector('[data-gdt-pr-stats]', { timeout: 3000 });
    const result = await page.$eval('[data-gdt-pr-stats]', (el) => ({ text: el.textContent, title: el.title }));
    assert.match(result.text, /\+5\s*[−-]2.*\+10\s*[−-]1/);
    assert.doesNotMatch(result.text, /Code|Tests/);
    assert.equal(await page.$$eval('[data-gdt-pr-stats] svg', (els) => els.filter(el => el.getAttribute('aria-hidden') === 'true').length), 2);
    assert.match(await page.$eval('.gdt-pr-stats-group', el => el.title), /Code/);
    assert.match(result.title, /15.*3/);
    const links = await page.$$eval('[data-gdt-pr-stats] a', els => els.map(el => el.href));
    assert.equal(links.length, 2);
    for (const [index, href] of links.entries()) {
      const url = new URL(href);
      assert.equal(url.pathname, layout === 'overview' ? '/acme/widget/pull/42/changes' : '/acme/widget/pull/42/files');
      assert.equal(url.searchParams.get('gdt-files'), index === 0 ? 'code' : 'tests');
    }
    const session = await page.createCDPSession();
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    assert.ok(nodes.some((node) => !node.ignored && node.name?.value === 'Code: 5 additions, 2 deletions'));
    assert.ok(nodes.some((node) => !node.ignored && node.name?.value === 'Tests: 10 additions, 1 deletions'));
    await session.detach();
    assert.equal(await page.$eval(native, (el) => getComputedStyle(el).display), 'none');
    if (layout === 'overview') assert.notEqual(await page.$eval('#file-stat', el => getComputedStyle(el).display), 'none');
    const initial = calls.length;
    await page.evaluate(() => {
      document.querySelector('[data-gdt-pr-stats]').remove();
      document.dispatchEvent(new Event('turbo:load'));
      document.body.append(document.createElement('div'));
    });
    await page.waitForSelector('[data-gdt-pr-stats]', { timeout: 3000 });
    assert.equal(await page.$$eval('[data-gdt-pr-stats]', (els) => els.length), 1);
    assert.equal(calls.length, initial);
    await page.evaluate(() => { history.pushState({}, '', '/acme/widget/issues/42'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForFunction(() => !document.querySelector('[data-gdt-pr-stats]'));
    assert.notEqual(await page.$eval(native, (el) => getComputedStyle(el).display), 'none');
  });
}

test('keeps native counts on API failure and does not retry on every mutation', async (t) => {
  const { page, calls } = await fixture(t, { reply: () => ({ status: 403, body: { message: 'Forbidden' } }) });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-gdt-pr-error'), { timeout: 3000 });
  const initial = calls.length;
  await page.evaluate(() => { for (let i = 0; i < 20; i++) document.body.append(document.createElement('div')); });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(calls.length, initial);
  assert.equal(await page.$('[data-gdt-pr-stats]'), null);
  assert.notEqual(await page.$eval('#native', (el) => getComputedStyle(el).display), 'none');
});

const modernRepoNav = `<ul><li><a href="/acme/widget/pulls" data-tab-item="pull-requests"><span>Pull requests</span><span data-component="counter"><span data-component="CounterLabel" aria-hidden="true">126</span><span class="sr-only"> (126)</span></span></a></li></ul>`;
const legacyRepoNav = `<ul><li><a href="/acme/widget/pulls" id="pull-requests-tab"><span>Pull requests</span> <span class="Counter" title="126">126</span></a></li></ul>`;
const countsReply = (url) => url.pathname === '/search/issues'
  ? { body: { total_count: url.searchParams.get('q').includes('draft:true') ? 26 : 100, incomplete_results: false, items: [] } }
  : undefined;

test('PR count pill aligns with the label despite GitHub tab margins', async (t) => {
  const nav = `<style>nav[aria-label="Repository"] li { display:flex; flex-direction:column; align-items:flex-start; width:max-content; } nav[aria-label="Repository"] li > a { display:flex; align-items:center; padding:6px 8px; margin-bottom:8px; font:14px/20px sans-serif; }</style>${modernRepoNav}`;
  const { page } = await fixture(t, { nav, path: '/acme/widget', reply: countsReply });
  await page.waitForSelector('[data-gdt-pr-counts]');
  const geometry = await page.evaluate(() => {
    const label = document.querySelector('.gdt-pr-counts-tab > span').getBoundingClientRect();
    const pill = document.querySelector('[data-gdt-pr-counts]').getBoundingClientRect();
    const items = [...document.querySelectorAll('[data-gdt-pr-counts] a, [data-gdt-pr-counts] svg')].map(el => { const r = el.getBoundingClientRect(); return r.y + r.height / 2; });
    return { labelCenter: label.y + label.height / 2, pillCenter: pill.y + pill.height / 2, gap: pill.left - label.right, items };
  });
  assert.ok(Math.abs(geometry.labelCenter - geometry.pillCenter) < 0.5, JSON.stringify(geometry));
  assert.ok(geometry.gap >= 8, JSON.stringify(geometry));
  assert.ok(geometry.items.every(center => Math.abs(center - geometry.pillCenter) < 0.5), JSON.stringify(geometry));
});

for (const [title, total, split] of [['3,200', 3200, true], ['3,200', 20, false], ['', 3200, false]]) {
  test(`abbreviated PR totals require a matching exact total (title=${title}, search=${total})`, async (t) => {
    const nav = legacyRepoNav.replace('title="126">126', `title="${title}">3.2k`);
    const { page } = await fixture(t, { nav, path: '/acme/widget', reply: () => ({ body: { total_count: total / 2, incomplete_results: false, items: [] } }) });
    await page.waitForFunction(() => document.querySelector('[data-gdt-pr-counts]') || document.documentElement.hasAttribute('data-gdt-pr-counts-error'));
    assert.equal(Boolean(await page.$('[data-gdt-pr-counts]')), split);
    assert.equal(await page.$eval('.Counter', el => getComputedStyle(el).display === 'none'), split);
  });
}

for (const [layout, nav] of [['modern', modernRepoNav], ['legacy', legacyRepoNav]]) {
  test(`${layout}: repository PR badge splits open and draft counts without changing the tab link`, async (t) => {
    const { page, calls } = await fixture(t, { nav, path: '/acme/widget', reply: countsReply });
    await page.waitForSelector('[data-gdt-pr-counts]', { timeout: 3000 });
    assert.match(await page.$eval('[data-gdt-pr-counts]', el => el.textContent), /100\s*\|\s*26/);
    assert.equal(await page.$$eval('[data-gdt-pr-counts] svg', els => els.length), 2);
    const links = await page.$$eval('[data-gdt-pr-counts] a', els => els.map(el => ({ href: el.href, nested: !!el.parentElement.closest('a') })));
    assert.equal(links.length, 2);
    for (const [index, link] of links.entries()) {
      assert.equal(link.nested, false);
      assert.equal(new URL(link.href).pathname, '/acme/widget/pulls');
      assert.equal(new URL(link.href).searchParams.get('q'), `is:pr is:open draft:${index === 1}`);
    }
    assert.equal(await page.$eval('[data-gdt-pr-counts-native]', el => getComputedStyle(el).display), 'none');
    await page.evaluate(() => {
      const native = document.querySelector('[data-gdt-pr-counts-native]');
      const replacement = native.cloneNode(true);
      replacement.removeAttribute('data-gdt-pr-counts-native');
      native.replaceWith(replacement);
    });
    await page.waitForSelector('[data-gdt-pr-counts-native]', { timeout: 1500 });
    const session = await page.createCDPSession();
    const { nodes } = await session.send('Accessibility.getFullAXTree');
    assert.ok(nodes.some(node => !node.ignored && node.name?.value?.includes('100 open pull requests, excluding drafts')));
    assert.ok(nodes.some(node => !node.ignored && node.name?.value?.includes('26 draft pull requests')));
    await session.detach();
    const initial = calls.length;
    await page.evaluate(nav => {
      history.pushState({}, '', '/acme/widget/issues');
      document.querySelector('nav[aria-label="Repository"]').innerHTML = nav;
      document.dispatchEvent(new Event('turbo:load'));
    }, nav);
    await page.waitForSelector('[data-gdt-pr-counts]', { timeout: 3000 });
    assert.equal(calls.length, initial);
    assert.equal(await page.$$eval('[data-gdt-pr-counts]', els => els.length), 1);
    await page.evaluate(() => { history.pushState({}, '', '/other/repo'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForFunction(() => !document.querySelector('[data-gdt-pr-counts]'), { timeout: 3000 });
  });
}

test('repository PR badge retains the total when search counts are incomplete or stale', async (t) => {
  const { page, calls } = await fixture(t, { nav: modernRepoNav, path: '/acme/widget', reply: () => ({ body: { total_count: 10, incomplete_results: false, items: [] } }) });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-gdt-pr-counts-error'), { timeout: 3000 });
  assert.equal(await page.$('[data-gdt-pr-counts]'), null);
  assert.notEqual(await page.$eval('[data-component="counter"]', el => getComputedStyle(el).display), 'none');
  const initial = calls.length;
  await page.evaluate(() => { document.body.append(document.createElement('div')); });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(calls.length, initial);
});

test('repository PR badge ignores a late result from the previous repository', async (t) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  const { page } = await fixture(t, { nav: modernRepoNav, path: '/acme/widget', reply: async (url) => {
    if (url.pathname === '/search/issues' && url.searchParams.get('q').includes('repo:acme/widget')) await gate;
    return countsReply(url);
  } });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-gdt-pr-counts-loading'), { timeout: 3000 });
  await page.evaluate(nav => {
    history.pushState({}, '', '/other/repo');
    document.querySelector('nav[aria-label="Repository"]').innerHTML = nav.replaceAll('/acme/widget', '/other/repo');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, modernRepoNav);
  await page.waitForSelector('[data-gdt-pr-counts]', { timeout: 3000 });
  release();
  assert.equal(await page.$eval('[data-gdt-pr-counts] a', el => new URL(el.href).pathname), '/other/repo/pulls');
});

for (const feature of ['lines', 'repository']) {
  for (const fail of [false, true]) {
    test(`${feature}: shows a spinner before native counts while loading and removes it on ${fail ? 'failure' : 'success'}`, async (t) => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      t.after(release);
      const isRepo = feature === 'repository';
      const { page } = await fixture(t, {
        nav: isRepo ? modernRepoNav : '<ul></ul>', path: isRepo ? '/acme/widget' : '/acme/widget/pull/42',
        reply: async (url) => {
          if (url.pathname === '/search/issues' || /\/pulls\/42$/.test(url.pathname)) {
            await gate;
            if (fail) return { status: 401, body: { message: 'Bad credentials' } };
          }
          return countsReply(url);
        },
      });
      const spinner = isRepo ? '[data-gdt-pr-counts-spinner]' : '[data-gdt-pr-stats-spinner]';
      await page.waitForSelector(spinner, { timeout: 3000 });
      assert.equal(await page.$eval(spinner, el => el.getAttribute('role')), 'status');
      assert.match(await page.$eval(spinner, el => el.getAttribute('aria-label')), /Loading/);
      assert.notEqual(await page.$eval(spinner, el => getComputedStyle(el.parentElement).display), 'none');
      assert.match(await page.$eval(spinner, el => el.parentElement.textContent), isRepo ? /126/ : /\+15/);
      if (isRepo) assert.equal(await page.$eval(spinner, el => el.parentElement.getAttribute('data-component')), 'CounterLabel');
      release();
      await page.waitForFunction(selector => !document.querySelector(selector), { timeout: 3000 }, spinner);
      assert.equal(!!(await page.$(isRepo ? '[data-gdt-pr-counts]' : '[data-gdt-pr-stats]')), !fail);
    });
  }
}

test('reinjects after header hydration and restores native totals when the PR changes', async (t) => {
  const { page, calls } = await fixture(t);
  await page.waitForSelector('[data-gdt-pr-stats]', { timeout: 3000 });
  const initial = calls.length;
  await page.evaluate((markup) => { document.querySelector('main').innerHTML = markup; }, modern);
  await page.waitForSelector('[data-gdt-pr-stats]', { timeout: 3000 });
  assert.equal(calls.length, initial);
  await page.evaluate(() => { document.querySelector('#native .fgColor-success').textContent = '+16'; });
  await page.waitForFunction(() => !document.querySelector('[data-gdt-pr-stats]'), { timeout: 3000 });
  assert.notEqual(await page.$eval('#native', (el) => getComputedStyle(el).display), 'none');
  assert.match(await page.$eval('#native', (el) => el.textContent), /\+16/);
});

test('keeps native totals when a complete API result disagrees with the page', async (t) => {
  const { page } = await fixture(t, { markup: modern.replace('+15', '+100') });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gdt-pr-loading'), { timeout: 3000 });
  assert.equal(await page.$('[data-gdt-pr-stats]'), null);
  assert.notEqual(await page.$eval('#native', (el) => getComputedStyle(el).display), 'none');
});

test('discards a late response after same-repository navigation to another PR', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(release);
  const { page, calls } = await fixture(t, { reply: async (url) => {
    if (url.pathname.endsWith('/42')) await gate;
    if (url.pathname.endsWith('/43/files')) return { body: [{ filename: 'fixtures/a.json', additions: 15, deletions: 3 }] };
    if (url.pathname.endsWith('/43')) return { body: { ...meta, changed_files: 1 } };
  } });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-gdt-pr-loading') === 'true', { timeout: 3000 });
  assert.ok(calls.some((url) => url.endsWith('/42')));
  await page.evaluate(() => { history.pushState({}, '', '/acme/widget/pull/43'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('[data-gdt-pr-stats]', { timeout: 3000 });
  release();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.match(await page.$eval('[data-gdt-pr-stats]', (el) => el.textContent), /\+0\s*[−-]0.*\+15\s*[−-]3/);
});

for (const layout of ['modern', 'legacy']) {
  test(`${layout}: file count links filter panels, lazy files, and tree entries and can show all again`, async t => {
    const markup = overview.replace('Files changed</a>', 'Files changed<span class="Counter">2</span></a>') + (layout === 'modern'
      ? `<div role="tree"><li role="treeitem" id="src"><li role="treeitem" id="src/app.js">app.js</li></li><li role="treeitem" id="tests"><li role="treeitem" id="tests/app.js">app.js</li></li></div><div data-testid="progressive-diffs-list"><div id="code-panel"><div role="region" id="diff-code"><button data-file-path="src/app.js">src/app.js</button></div></div><div id="test-panel"><div role="region" id="diff-tests"><button data-file-path="tests/app.js">tests/app.js</button></div></div></div>`
      : `<div id="files"><div class="file" data-path="src/app.js" id="code-panel">src/app.js</div><div class="file" data-path="tests/app.js" id="test-panel">tests/app.js</div></div>`);
    const { page, calls } = await fixture(t, { markup, path: '/acme/widget/pull/42/changes' });
    await page.waitForSelector('[data-gdt-pr-files] a', { timeout: 2000 });
    assert.equal(await page.$eval('[data-gdt-pr-files]', el => el.closest('a')), null);
    await page.click('[data-gdt-file-category="tests"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#code-panel')).display === 'none');
    assert.notEqual(await page.$eval('#test-panel', el => getComputedStyle(el).display), 'none');
    assert.equal(new URL(page.url()).searchParams.get('gdt-files'), 'tests');
    if (layout === 'modern') {
      assert.equal(await page.$eval('[id="src"]', el => getComputedStyle(el).display), 'none');
      assert.notEqual(await page.$eval('[id="tests/app.js"]', el => getComputedStyle(el).display), 'none');
    }
    const initial = calls.length;
    // Hydration can replace an entire diff entry after the filter was applied.
    await page.evaluate(() => { const old = document.querySelector('#code-panel'); const copy=old.cloneNode(true); copy.removeAttribute('data-gdt-file-hidden'); old.replaceWith(copy); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#code-panel')).display === 'none');
    await page.click('[data-gdt-file-category="code"]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#test-panel')).display === 'none');
    assert.notEqual(await page.$eval('#code-panel', el => getComputedStyle(el).display), 'none');
    assert.equal(calls.length, initial);
    await page.click('[data-gdt-file-category="all"]');
    await page.waitForFunction(() => !document.querySelector('[data-gdt-file-hidden]'));
    assert.equal(new URL(page.url()).searchParams.has('gdt-files'), false);
  });
}

test('Files changed category links from Overview point to the filtered files page', async t => {
  const { page } = await fixture(t, { markup: overview.replace('Files changed</a>', 'Files changed<span class="Counter">2</span></a>') });
  await page.waitForSelector('[data-gdt-file-category="tests"]', { timeout: 2000 });
  const url = new URL(await page.$eval('[data-gdt-file-category="tests"]', el => el.href));
  assert.equal(url.pathname, '/acme/widget/pull/42/changes');
  assert.equal(url.searchParams.get('gdt-files'), 'tests');
});

test('filters unloaded file regions by hash while keeping GitHub’s pagination placeholder', async t => {
  const hash = createHash('sha256').update('src/app.js').digest('hex');
  const markup = overview.replace('Files changed</a>', 'Files changed<span class="Counter">2</span></a>') + `<div data-testid="progressive-diffs-list"><div id="lazy-code"><div role="region" id="diff-${hash}"></div></div><div id="loader"><div id="diff-placeholder">Loading more files</div></div></div>`;
  const { page } = await fixture(t, { markup, path: '/acme/widget/pull/42/changes?gdt-files=tests' });
  await page.waitForSelector('[data-gdt-file-filter-banner]');
  assert.equal(await page.$eval('#lazy-code', el => getComputedStyle(el).display), 'none');
  assert.notEqual(await page.$eval('#loader', el => getComputedStyle(el).display), 'none');
});

test('an unknown legacy file restores all files and explains the fallback', async t => {
  const markup = overview.replace('Files changed</a>', 'Files changed<span class="Counter">2</span></a>') + `<div id="files"><div class="file" data-path="src/app.js">known code</div><div class="file" data-path="src/new.js">new code</div></div>`;
  const { page } = await fixture(t, { markup, path: '/acme/widget/pull/42/changes?gdt-files=tests' });
  await page.waitForSelector('[data-gdt-file-filter-banner]');
  assert.equal(await page.$('[data-gdt-file-hidden]'), null);
  assert.match(await page.$eval('[data-gdt-file-filter-banner]', el => el.textContent), /could not be classified/);
});

test('line-count links switch the file filter in place and retain diff preferences', async t => {
  const markup = overview + '<div id="files"><div class="file" data-path="src/app.js" id="code-panel">code</div><div class="file" data-path="tests/app.js" id="test-panel">tests</div></div>';
  const { page, calls } = await fixture(t, { markup, path: '/acme/widget/pull/42/changes?w=1' });
  await page.waitForSelector('[data-gdt-pr-stats] a', { timeout: 2000 });
  const initial = calls.length;
  await page.click('[data-gdt-pr-stats] [data-gdt-file-category="tests"]');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#code-panel')).display === 'none');
  assert.notEqual(await page.$eval('#test-panel', el => getComputedStyle(el).display), 'none');
  assert.equal(new URL(page.url()).searchParams.get('w'), '1');
  await page.click('[data-gdt-pr-stats] [data-gdt-file-category="code"]');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#test-panel')).display === 'none');
  assert.notEqual(await page.$eval('#code-panel', el => getComputedStyle(el).display), 'none');
  assert.equal(calls.length, initial);
});

for (const group of ['[data-gdt-pr-stats]', '[data-gdt-pr-files]']) {
  test(`${group}: selected filter is synchronized, stays aligned, and toggles off`, async t => {
    const markup = overview.replace('Files changed</a>', 'Files changed<span class="Counter">2</span></a>') + '<div id="files"><div class="file" data-path="src/app.js" id="code-panel">code</div><div class="file" data-path="tests/app.js">tests</div></div>';
    const { page } = await fixture(t, { markup, path: '/acme/widget/pull/42/changes?w=1' });
    const selector = `${group} [data-gdt-file-category="tests"]`;
    await page.waitForSelector(selector);
    const before = await page.$eval(selector, el => { const r=el.getBoundingClientRect(); return {width:r.width,height:r.height}; });
    await page.click(selector);
    await page.waitForFunction(() => document.querySelectorAll('[data-gdt-file-category="tests"][aria-current="true"]').length === 2, { timeout: 2000 });
    const selected = await page.$eval(selector, el => { const r=el.getBoundingClientRect(),s=getComputedStyle(el); return {width:r.width,height:r.height,background:s.backgroundColor,shadow:s.boxShadow,href:el.href,title:el.title}; });
    assert.equal(selected.width, before.width);
    assert.equal(selected.height, before.height);
    assert.notEqual(selected.background, 'rgba(0, 0, 0, 0)');
    assert.notEqual(selected.shadow, 'none');
    assert.equal(new URL(selected.href).searchParams.has('gdt-files'), false);
    assert.match(selected.title, /show all files/i);
    // Keyboard activation of the same selected count must clear the filter.
    await page.focus(selector); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-gdt-file-hidden]'));
    assert.equal(new URL(page.url()).searchParams.has('gdt-files'), false);
    assert.equal(new URL(page.url()).searchParams.get('w'), '1');
    assert.equal(await page.$$eval('[data-gdt-file-category][aria-current="true"]', els => els.length), 0);
    await page.goBack();
    await page.waitForFunction(() => document.querySelectorAll('[data-gdt-file-category="tests"][aria-current="true"]').length === 2);
    assert.equal(await page.$eval('#code-panel', el => getComputedStyle(el).display), 'none');
  });
}
