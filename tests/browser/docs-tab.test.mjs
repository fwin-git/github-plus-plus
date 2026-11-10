import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { build } from 'esbuild';

let browser, content;
before(async () => {
  content = (await build({ entryPoints: ['src/content/index.js'], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined) });
});
after(async () => browser?.close());

async function fixture(t, { path = '/acme/widget', position = 'last', gate, confluence = false } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const nav = `<nav aria-label="Repository"><ul>${['Code', 'Issues', 'Settings'].map((label, i) => `<li class="repo-item"><a class="repo-tab" href="/acme/widget${i ? '/' + label.toLowerCase() : ''}"><span data-component="icon"><svg width="16" height="16"></svg></span><span data-component="text">${label}</span></a></li>`).join('')}</ul></nav>`;
  const css = `nav ul{display:flex;gap:8px;list-style:none} .repo-item{display:flex;flex-direction:column} .repo-tab{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;font:14px/20px sans-serif} .repo-tab [data-component="icon"]{margin-right:8px} .Counter{border-radius:20px;background:#eee;font:12px/20px sans-serif;padding:0 6px}`;
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const url = new URL(req.url());
    if (req.isNavigationRequest()) return req.respond({ status: 200, contentType: 'text/html', body: `<html><head><style>${css}</style></head><body>${nav}<main><h1>Repository page</h1><textarea aria-label="Comment"></textarea></main></body></html>` });
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Accept, Authorization, X-GitHub-Api-Version' };
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers });
    if (url.pathname.includes('/git/trees/')) {
      await gate;
      return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ sha: 'tree', truncated: false, tree: [{ path: 'docs/guide.md', type: 'blob', sha: 'doc', size: 20 }] }) }).catch(() => {});
    }
    if (url.hostname === 'raw.githubusercontent.com') return req.respond({ status: 200, headers, body: '# Guide\nHello docs' });
    return req.respond({ status: 404, headers, contentType: 'application/json', body: '{}' });
  });
  await page.evaluateOnNewDocument(({position,confluence}) => {
    const data = { 'gdt:settings': { docsTabPosition: position } }, listeners = [];
    window.chrome = { storage: { local: { get: async key => typeof key === 'string' ? { [key]: data[key] } : data, set: async patch => Object.assign(data, patch) }, onChanged: { addListener: fn => listeners.push(fn) } } };
    if (confluence) {
      const site='https://example.atlassian.net';
      data['gdt:confluence-sites']=[site];
      window.chrome.runtime={async sendMessage({operation,id}) {
        if(operation==='spaces')return {ok:true,data:{items:[{site,id:'10',title:'Engineering'}],nextCursor:null}};
        if(operation==='pages')return {ok:true,data:{items:[{site,id:'101',spaceId:'10',title:'Cloud guide'}],nextCursor:null}};
        return {ok:true,data:{site,id,spaceId:'10',title:'Cloud guide',html:'<h2 id="one">One</h2><h2 id="two">Two</h2>',url:site+'/wiki/pages/viewpage.action?pageId='+id}};
      }};
    }
    window.changePosition = position => {
      data['gdt:settings'].docsTabPosition = position;
      listeners.forEach(fn => fn({ 'gdt:settings': { newValue: { ...data['gdt:settings'] } } }, 'local'));
    };
  }, {position,confluence});
  await page.goto('https://github.com' + path);
  await page.addStyleTag({ path: 'src/content/viewer.css' });
  await page.addScriptTag({ content });
  return page;
}

test('Confluence hides GitHub editing controls and keeps heading routes inside Docs', async t => {
  const page=await fixture(t,{confluence:true,path:'/acme/widget#docs?source=confluence&site=https%3A%2F%2Fexample.atlassian.net&page=101'});
  await page.setViewport({width:1440,height:900});
  await page.waitForSelector('.gdt-confluence-controls');
  assert.equal(await page.$eval('[data-gdt-edit-gh]',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('[data-gdt-live-edit]',el=>el.disabled),true);
  const headings=await page.$$eval('[data-gdt-toc-slug]',els=>els.map(el=>el.hash));
  assert.equal(headings.length,2);
  assert.ok(headings.every(hash=>hash.includes('source=confluence')&&hash.includes('page=101')));
  await page.click('[data-gdt-toc-slug="gdt-cf-two"]');
  await page.waitForFunction(()=>location.hash.includes('h=gdt-cf-two')&&document.querySelector('.gdt-confluence-controls'));
  await page.click('.gdt-confluence-controls button[type="submit"]');
  await page.waitForSelector('.gdt-confluence-attached a');
  assert.equal(await page.$$eval('a[data-gdt-confluence-page]',els=>els.length),1);
  await page.click('a[data-gdt-tree-path="docs/guide.md"]');
  await page.waitForFunction(()=>document.querySelector('[data-gdt-article]')?.textContent.includes('Hello docs'));
  assert.notEqual(await page.$eval('[data-gdt-edit-gh]',el=>getComputedStyle(el).display),'none');
  assert.equal(await page.$eval('[data-gdt-live-edit]',el=>el.disabled),false);
});

test('Docs tab follows configured position and aligns icon, label, and badge with native tabs', async t => {
  const page = await fixture(t, { position: 2 });
  await page.waitForSelector('[data-gdt-tab]');
  const order = () => page.$$eval('nav li > a', els => els.map(el => el.querySelector('[data-component="text"], [data-content="Docs"]')?.textContent));
  assert.deepEqual(await order(), ['Code', 'Docs', 'Issues', 'Settings']);
  const centers = await page.$$eval('.repo-tab > [data-component="text"], [data-gdt-tab-link] > *', els => els.filter(el => !el.hidden).map(el => { const r=el.getBoundingClientRect(); return r.y+r.height/2; }));
  assert.ok(Math.max(...centers) - Math.min(...centers) < 0.5, JSON.stringify(centers));
  const gap = await page.$eval('[data-gdt-count]', el => el.getBoundingClientRect().left - el.previousElementSibling.getBoundingClientRect().right);
  assert.ok(gap >= 8, String(gap));
  const iconGap = await page.$eval('[data-gdt-tab-link]', el => el.children[1].getBoundingClientRect().left - el.children[0].getBoundingClientRect().right);
  assert.equal(iconGap, 8);
  await page.evaluate(() => window.changePosition(1));
  await page.waitForFunction(() => document.querySelector('nav li').hasAttribute('data-gdt-tab'));
  await page.evaluate(() => window.changePosition('last'));
  await page.waitForFunction(() => document.querySelector('nav li:last-child').hasAttribute('data-gdt-tab'));
  assert.deepEqual(await order(), ['Code', 'Issues', 'Settings', 'Docs']);
});

for (const path of ['/acme/widget/issues/7', '/acme/widget/pull/42/changes', '/acme/widget/settings']) {
  test(`Cmd+K opens a floating fuzzy search without changing ${path}`, async t => {
    const page = await fixture(t, { path });
    await page.waitForSelector('[data-gdt-tab]');
    await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');
    await page.waitForFunction(() => document.activeElement?.matches('[data-gdt-palette-input]'), { timeout: 2000 });
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.$('#gdt-root'), null);
    assert.equal(await page.$eval('main', el => getComputedStyle(el).display), 'block');
    await page.keyboard.type('gde');
    await page.waitForSelector('#gdt-command-palette .gdt-sr-item');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-gdt-article]');
    assert.equal(new URL(page.url()).hash, '#docs/docs/guide.md');
  });
}

test('Ctrl+K waits for documentation loading and does not open it in a different repository', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(release);
  const page = await fixture(t, { gate });
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.evaluate(() => { history.pushState({}, '', '/other/repo'); document.querySelector('nav').remove(); document.dispatchEvent(new Event('turbo:load')); });
  release();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await page.$('#gdt-root'), null);
  assert.equal(new URL(page.url()).hash, '');
});

test('Ctrl+K pressed while the tree loads focuses search when the docs arrive', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(release);
  const page = await fixture(t, { gate });
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('#gdt-command-palette[open]');
  await page.keyboard.type('guide');
  assert.equal(new URL(page.url()).hash, '');
  release();
  await page.waitForFunction(() => document.activeElement?.matches('[data-gdt-palette-input]'), { timeout: 2000 });
  await page.waitForSelector('#gdt-command-palette .gdt-sr-item');
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.$eval('[data-gdt-palette-input]',el=>el.value),'guide');
});

test('Options saves the Docs position and restores Last by default', async t => {
  const page = await browser.newPage(); t.after(() => page.close());
  await page.setContent(readFileSync('src/options/options.html', 'utf8').replace('<script src="options.js"></script>', ''));
  await page.evaluate(() => {
    const data = {};
    window.chrome = { storage: { local: { get: async () => data, set: async patch => Object.assign(data, patch) } } };
    window.savedPosition = () => data['gdt:settings']?.docsTabPosition;
  });
  const options = (await build({ entryPoints: ['src/options/options.js'], bundle: true, write: false, format: 'iife' })).outputFiles[0].text;
  await page.addScriptTag({ content: options });
  await page.select('#docs-tab-position', '2');
  await page.click('#save');
  await page.waitForFunction(() => window.savedPosition() === 2);
  await page.click('#reset');
  await page.waitForFunction(() => window.savedPosition() === 'last');
  assert.equal(await page.$eval('#docs-tab-position', el => el.value), 'last');
});

for (const dismissal of ['Escape', 'shortcut', 'backdrop']) test(`palette ${dismissal} dismissal restores focus without changing the page`, async t => {
  const page=await fixture(t);
  await page.waitForSelector('[data-gdt-tab]');
  await page.click('textarea'); await page.keyboard.type('Unsent comment');
  await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');
  await page.waitForSelector('#gdt-command-palette[open]');
  if(dismissal==='Escape')await page.keyboard.press('Escape');
  else if(dismissal==='shortcut'){await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');}
  else await page.mouse.click(4,4);
  await page.waitForFunction(()=>!document.querySelector('#gdt-command-palette[open]'));
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'TEXTAREA');
  assert.equal(await page.$eval('textarea',el=>el.value),'Unsent comment');
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.$('#gdt-root'),null);
});

test('dismissing a loading palette prevents the completed request reopening it', async t => {
  let release;const gate=new Promise(resolve=>release=resolve);t.after(release);
  const page=await fixture(t,{gate});
  await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');
  await page.waitForSelector('#gdt-command-palette[open]');
  await page.keyboard.press('Escape');release();
  await page.waitForSelector('[data-gdt-tab]');
  await page.waitForFunction(()=>!document.querySelector('#gdt-command-palette'));
  assert.equal(await page.$('#gdt-command-palette[open]'),null);
  assert.equal(await page.$('#gdt-root'),null);
  assert.equal(new URL(page.url()).hash,'');
});

test('palette refresh selects the best match for a new query and Enter flushes pending input', async t => {
  const page=await fixture(t);
  await page.waitForSelector('[data-gdt-tab]');
  await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta');
  await page.waitForFunction(()=>document.querySelector('#gdt-palette-results')?.textContent.includes('Indexing')===false);
  await page.keyboard.type('guide');
  await page.waitForFunction(()=>document.querySelectorAll('#gdt-palette-results .gdt-sr-item').length===2);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('[data-gdt-palette-input]', el=>el.getAttribute('aria-activedescendant')),'gdt-palette-results-1');
  await page.keyboard.down('Meta');await page.keyboard.press('a');await page.keyboard.up('Meta');
  await page.keyboard.type('gde');
  await page.waitForFunction(()=>document.querySelectorAll('#gdt-palette-results .gdt-sr-item').length===1);
  assert.equal(await page.$eval('[data-gdt-palette-input]', el=>el.getAttribute('aria-activedescendant')),'gdt-palette-results-0');
  // Enter must never open a stale result while the 120ms debounce is pending.
  await page.$eval('[data-gdt-palette-input]',el=>{el.value='no-such-document';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  assert.equal(new URL(page.url()).hash,'');
  assert.match(await page.$eval('#gdt-palette-results',el=>el.textContent),/No results/);
});

for(const viewport of [{width:1440,height:900},{width:390,height:700}])test(`palette fits and traps focus at ${viewport.width}px`,async t=>{
  const page=await fixture(t);await page.setViewport(viewport);await page.waitForSelector('[data-gdt-tab]');
  await page.keyboard.down('Control');await page.keyboard.press('k');await page.keyboard.up('Control');
  await page.waitForFunction(()=>document.querySelector('#gdt-command-palette').getAnimations().every(animation=>animation.playState==='finished'));
  const rect=await page.$eval('#gdt-command-palette',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width&&rect.y+rect.height<=viewport.height);
  assert.ok(Math.abs(rect.x+rect.width/2-viewport.width/2)<1);
  assert.ok(Math.abs(rect.y+rect.height/2-viewport.height/2)<1);
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.querySelector('#gdt-command-palette').contains(document.activeElement)),true);
});

test('palette searches loaded Confluence pages and opens their source route',async t=>{
  const page=await fixture(t,{confluence:true,path:'/acme/widget#docs?source=confluence&site=https%3A%2F%2Fexample.atlassian.net&page=101'});
  await page.waitForSelector('.gdt-confluence-controls');
  await page.keyboard.down('Control');await page.keyboard.press('k');await page.keyboard.up('Control');
  await page.keyboard.type('Cloud');
  await page.waitForFunction(()=>document.querySelector('#gdt-palette-results')?.textContent.includes('Cloud guide'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.gdt-confluence-controls');
  assert.ok(new URL(page.url()).hash.includes('source=confluence'));
  assert.equal(await page.$('#gdt-command-palette'),null);
});

for(const reduced of [false,true])test(`palette motion respects reduced motion (${reduced}) and rapid reopening`,async t=>{
  const page=await fixture(t);await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]);
  await page.waitForSelector('[data-gdt-tab]');
  const toggle=async()=>{await page.keyboard.down('Meta');await page.keyboard.press('k');await page.keyboard.up('Meta');};
  await toggle();
  assert.equal(await page.$eval('#gdt-command-palette',el=>getComputedStyle(el).animationName),reduced?'none':'gdt-palette-in');
  await page.waitForSelector('#gdt-palette-results .gdt-sr-item');
  await page.keyboard.press('Escape');
  if(!reduced){
    assert.equal(await page.$eval('#gdt-command-palette',el=>el.classList.contains('gdt-palette-closing')),true);
    assert.ok(await page.$('#gdt-palette-results .gdt-sr-item'));
  }
  await toggle();
  await page.waitForFunction(()=>document.activeElement?.matches('[data-gdt-palette-input]'));
  assert.equal(await page.$$eval('#gdt-command-palette',els=>els.length),1);
  await page.keyboard.type('guide');
  await page.waitForFunction(()=>document.querySelector('#gdt-palette-results')?.textContent.includes('Guide'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-gdt-article]');
  assert.equal(await page.$('#gdt-command-palette'),null);
});
