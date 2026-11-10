// Render the actual extension against local example data. All requests are
// intercepted. No account, token, or external network is used.
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const content = readFileSync(resolve(root, 'dist/content.js'), 'utf8');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || (existsSync(chrome) ? chrome : undefined) });
const docs = Object.fromEntries(['README.md', 'docs/installation.md', 'docs/pr-line-counts.md', 'docs/interface.md', 'docs/options.md', 'docs/frontmatter.md'].map(path => [path, readFileSync(resolve(root, path), 'utf8')]));
const files = [
  { filename: 'src/search.js', additions: 42, deletions: 8 },
  { filename: 'src/results.js', additions: 18, deletions: 4 },
  { filename: 'tests/search.test.js', additions: 76, deletions: 6 },
  { filename: 'tests/fixtures/results.json', additions: 24, deletions: 0 },
];
const icon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m5 3-4 5 4 5m6-10 4 5-4 5"/></svg>';
const navItem = (label, path, count = '', attrs = '') => `<li><a class="repo-tab" href="/example/search${path}" ${attrs}>${icon}<span data-component="text">${label}</span>${count ? `<span class="Counter">${count}</span>` : ''}</a></li>`;
const styles = `
:root { --fgColor-default:#1f2328; --fgColor-muted:#59636e; --fgColor-accent:#0969da; --bgColor-default:#fff; --bgColor-muted:#f6f8fa; --borderColor-default:#d1d9e0; }
*{box-sizing:border-box} body{margin:0;color:#1f2328;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} a{color:inherit;text-decoration:none} svg{vertical-align:middle}
body > header{padding:20px 32px;background:#f6f8fa;font-size:18px;border-bottom:1px solid #d1d9e0} .example{float:right;color:#59636e;font-size:12px;padding-top:5px}
nav:is([aria-label="Repository"],[aria-label="Pull request"]) ul{display:flex;list-style:none;gap:12px;margin:0;padding:10px 24px 0;border-bottom:1px solid #d1d9e0} nav:is([aria-label="Repository"],[aria-label="Pull request"]) li{display:flex;position:relative} .repo-tab{display:inline-flex;align-items:center;gap:8px;padding:8px;margin-bottom:8px;font-size:14px} .repo-tab[aria-current=page]{font-weight:600} .Counter{background:#afb8c133;border-radius:999px;padding:0 6px;font-size:12px;line-height:20px}
nav[aria-label=Repository]{background:#f6f8fa} main{padding:24px 32px} h1{font-size:28px;font-weight:500;margin:0 0 16px} .number{color:#59636e;font-weight:300} .branchGroup{display:flex;align-items:center;gap:10px;margin-bottom:26px;color:#59636e} .status{background:#1f883d;color:white;border-radius:20px;padding:5px 12px} .branch{background:#ddf4ff;color:#0969da;border-radius:6px;padding:2px 8px;font:12px ui-monospace,monospace}
nav[aria-label="Pull request"] ul{padding:0;gap:20px} .file-layout{display:grid;grid-template-columns:210px 1fr;gap:24px;padding-top:22px} .tree{border-right:1px solid #d1d9e0;font:12px/2.6 ui-monospace,monospace} .tree strong{font-family:system-ui;font-size:13px} .file{border:1px solid #d1d9e0;border-radius:6px;overflow:hidden;margin-bottom:14px} .file h3{font:12px ui-monospace,monospace;padding:12px 16px;background:#f6f8fa;margin:0;border-bottom:1px solid #d1d9e0}.diff{font:12px/1.9 ui-monospace,monospace;margin:0;padding:10px 16px;background:#dafbe1} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)} .fgColor-success{color:#1a7f37}.fgColor-danger{color:#cf222e}
`;
const body = `<header><strong>example / search</strong><span class="example">Github++ · example repository</span></header><nav aria-label="Repository"><ul>${navItem('Code','')}${navItem('Issues','/issues','8')}${navItem('Pull requests','/pulls','24','data-tab-item="pull-requests" aria-current="page"')}${navItem('Actions','/actions')}${navItem('Settings','/settings')}</ul></nav><main><div data-component="PageHeader"><h1>Add search result filters <span class="number">#42</span></h1><div data-component="PageHeader.Description"><div class="branchGroup"><span class="status">Open</span><span>Merge 3 commits into</span><span class="branch">main</span><span>from</span><span class="branch">search-filters</span><div id="native"><span class="fgColor-success">+160</span> <span class="fgColor-danger">−18</span><span class="sr-only">Lines changed: 160 additions &amp; 18 deletions</span><div data-testid="addition diffstat"></div></div></div></div><div data-component="PH_Navigation"><nav aria-label="Pull request"><ul>${navItem('Overview','/pull/42')}${navItem('Commits','/pull/42/commits','3')}${navItem('Files changed','/pull/42/changes','4','aria-current="page"')}</ul></nav></div></div><div class="file-layout"><aside class="tree"><strong>Changed files</strong><div role="tree">${files.map(f=>`<div role="treeitem" data-path="${f.filename}">${f.filename}</div>`).join('')}</div></aside><section><div data-testid="progressive-diffs-list">${files.map(f=>`<div class="file" data-path="${f.filename}"><h3>${f.filename}</h3><pre class="diff">+ export function filterResults(results, query) {\n+   const term = query.trim().toLowerCase();\n+   return results.filter(result =&gt; result.title.toLowerCase().includes(term));\n+ }</pre></div>`).join('')}</div></section></div></main>`;
try {
  mkdirSync(resolve(root, 'media'), { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 760, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', async req => {
    const url = new URL(req.url());
    const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'Accept, Authorization, X-GitHub-Api-Version' };
    const json = value => req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify(value)});
    if (req.isNavigationRequest()) return req.respond({status:200,contentType:'text/html',body:`<!doctype html><html lang="en" data-color-mode="light"><meta charset="utf-8"><title>Github++ examples</title><style>${styles}</style><body>${body}</body></html>`});
    if (req.method() === 'OPTIONS') return req.respond({status:204,headers});
    if (url.pathname.includes('/git/trees/')) return json({ sha:'tree', truncated:false, tree:Object.entries(docs).map(([path,text],i)=>({path,type:'blob',sha:`doc-${i}`,size:Buffer.byteLength(text)})) });
    if (url.pathname === '/search/issues') return json({total_count:url.searchParams.get('q').includes('draft:true') ? 6 : 18,incomplete_results:false,items:[]});
    if (url.pathname.endsWith('/files')) return json(files);
    if (url.pathname.endsWith('/pulls/42')) return json({head:{sha:'head'},base:{sha:'base'},changed_files:4,additions:160,deletions:18});
    if (url.hostname === 'raw.githubusercontent.com') {
      const path = decodeURIComponent(url.pathname.split('/HEAD/')[1] || '');
      return req.respond({status:docs[path] ? 200 : 404,headers,body:docs[path] || ''});
    }
    return req.respond({status:404,headers,body:''});
  });
  await page.evaluateOnNewDocument(() => {
    const data = {};
    window.chrome={storage:{local:{get:async key=>typeof key==='string'?{[key]:data[key]}:data,set:async patch=>Object.assign(data,patch)},onChanged:{addListener(){}}}};
  });
  await page.goto('https://github.com/example/search/pull/42/changes');
  await page.addStyleTag({path:resolve(root,'dist/content.css')});
  await page.addScriptTag({content});
  await page.waitForSelector('[data-gdt-pr-counts]');
  await page.waitForSelector('[data-gdt-pr-files]');
  await page.waitForSelector('[data-gdt-tab]');
  await page.click('[data-gdt-pr-files] [data-gdt-file-category="code"]');
  await page.waitForSelector('[data-gdt-file-filter-banner]');
  await page.screenshot({path:resolve(root,'media/pr-counts.png')});
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#gdt-root [data-gdt-article]');
  await page.evaluate(()=>{location.hash='#docs/docs/frontmatter.md';});
  await page.waitForFunction(()=>document.querySelector('[data-gdt-article] h1')?.textContent.includes('Frontmatter'));
  await page.waitForFunction(()=>document.querySelector('[data-gdt-progress]')?.hidden === true);
  await page.screenshot({path:resolve(root,'media/docs.png')});
  console.log('Saved media/pr-counts.png and media/docs.png');
} finally {
  await browser.close();
}
