import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const bundle=await build({entryPoints:['src/content/index.js'],bundle:true,write:false,format:'iife',loader:{'.css':'empty'},logLevel:'silent'});
const html=readFileSync(new URL('../harness/harness.html',import.meta.url),'utf8');
const fixture=readFileSync(new URL('../harness/harness-data.js',import.meta.url),'utf8');
const waitFor=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Timed out waiting for entrypoint');};
function open(repo,{sessionError=false,hash='#docs',position='last'}={}) {
  const dom=new JSDOM(html,{url:`https://github.com/acme/${repo}?confluence=1${hash}`,runScripts:'outside-only'});
  const w=dom.window;
  w.fetch=async()=>{throw new Error('Unexpected external request');};w.Response=Response;w.Request=Request;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.IntersectionObserver=class{observe(){}disconnect(){}};
  w.localStorage.setItem('gdt-harness-store',JSON.stringify([['gdt:settings',{token:'harness-token',docsTabPosition:position}]]));
  w.eval(fixture);w.__gdtHarness.confluenceError=sessionError;w.eval(bundle.outputFiles[0].text);
  return dom;
}
for(const repo of ['empty','private'])test(`Confluence remains usable when GitHub repository is ${repo}`,async()=>{
  const dom=open(repo),w=dom.window,d=w.document;
  try {
    await waitFor(()=>d.querySelector('[data-gdt-confluence-space]'));
    assert.ok(d.querySelector('[data-gdt-tab]'));
    assert.match(d.querySelector('[data-gdt-article]').textContent,/Choose a document/);
    w.location.hash='#docs?source=confluence&site=https%3A%2F%2Fexample.atlassian.net&page=101';
    await waitFor(()=>d.querySelector('.gdt-confluence-controls'));
    assert.match(d.querySelector('[data-gdt-article]').textContent,/Platform overview/);
  }finally{w.close();}
});
for(const modifier of ['ctrlKey','metaKey'])test(`${modifier}+K opens search for a Confluence-only repository and preserves the configured tab position`,async()=>{
  const dom=open('empty',{hash:'',position:1}),w=dom.window,d=w.document;
  try {
    await waitFor(()=>d.querySelector('[data-gdt-tab]'));
    assert.ok(d.querySelector('nav[aria-label="Repository"] li:first-child').hasAttribute('data-gdt-tab'));
    assert.equal(d.querySelector('[data-gdt-count]').hidden,true);
    const key=new w.KeyboardEvent('keydown',{key:'k',[modifier]:true,bubbles:true,cancelable:true});
    w.dispatchEvent(key);
    await waitFor(()=>d.activeElement?.hasAttribute('data-gdt-palette-input'));
    assert.equal(key.defaultPrevented,true);
    assert.equal(d.querySelector('#gdt-root'),null);
    assert.equal(w.location.hash,'');
    assert.ok(d.querySelector('#gdt-command-palette[open]'));
    assert.equal(d.querySelector('.gdt-toast'),null);
    d.querySelector('[data-gdt-palette-close]').click();
    await new Promise(resolve=>setTimeout(resolve,20));
  }finally{w.close();}
});
test('Confluence sign-in errors leave GitHub docs usable',async()=>{
  const dom=open('widget',{sessionError:true}),w=dom.window,d=w.document;
  try {
    await waitFor(()=>d.querySelector('.gdt-confluence-site')?.textContent.includes('Sign in'));
    assert.match(d.querySelector('[data-gdt-article]').textContent,/acme widget/);
    assert.equal(d.querySelector('[data-gdt-live-edit]').disabled,false);
    w.location.hash='#docs?source=confluence&site=https%3A%2F%2Fexample.atlassian.net&page=101';
    await waitFor(()=>d.querySelector('[data-gdt-article]')?.textContent.includes('Cannot read Confluence page'));
    w.location.hash='#docs/README.md';
    await waitFor(()=>d.querySelector('[data-gdt-article]')?.textContent.includes('acme widget'));
    assert.equal(d.querySelector('[data-gdt-live-edit]').disabled,false);
  }finally{w.close();}
});
test('personal attachments persist across repository soft navigation',async()=>{
  const dom=open('widget'),w=dom.window,d=w.document;
  try {
    await waitFor(()=>d.querySelector('[data-gdt-confluence-space]'));
    w.location.hash='#docs?source=confluence&site=https%3A%2F%2Fexample.atlassian.net&page=101';
    await waitFor(()=>d.querySelector('.gdt-confluence-controls'));
    d.querySelector('.gdt-confluence-controls input').value='acme/gadget';
    d.querySelector('.gdt-confluence-controls').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>d.querySelector('.gdt-confluence-attached a'));
    w.history.pushState({},'', '/acme/gadget?confluence=1#docs');
    d.dispatchEvent(new w.Event('turbo:load'));
    await waitFor(()=>d.title.endsWith('acme/gadget')&&d.querySelector('.gdt-confluence-attached a'));
    assert.match(d.querySelector('.gdt-confluence-attached').parentElement.textContent,/gadget/);
    assert.equal(d.querySelectorAll('a[data-gdt-confluence-page]').length,1);
  }finally{w.close();}
});

test('opening Docs after palette indexing retains tag chips and inline search',async()=>{
  const dom=open('widget',{hash:''}),w=dom.window,d=w.document;
  try {
    await waitFor(()=>d.querySelector('[data-gdt-tab]'));
    w.dispatchEvent(new w.KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true}));
    await waitFor(()=>d.querySelector('#gdt-palette-results .gdt-sr-item')&&!d.querySelector('#gdt-palette-results .gdt-sr-note'));
    d.querySelector('[data-gdt-palette-close]').click();
    w.location.hash='#docs';
    await waitFor(()=>d.querySelector('[data-gdt-article]'));
    assert.ok(d.querySelector('.gdt-tag-chip'));
    d.querySelector('.gdt-tag-chip').click();
    assert.equal(d.querySelector('[data-gdt-search]').getAttribute('aria-expanded'),'true');
  } finally {w.close();}
});
