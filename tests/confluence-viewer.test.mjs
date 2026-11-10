import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<main><div>GitHub</div></main>',{url:'https://github.com/acme/widget#docs'});
for(const key of ['window','document','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
const data={}, listeners=[];
const local={async get(key){return key==null?{...data}:{[key]:data[key]};},async set(patch){Object.assign(data,patch);},async remove(keys){for(const k of [keys].flat())delete data[k];}};
const site='https://team.atlassian.net';
let resolvePage=null;
globalThis.chrome={storage:{local,onChanged:{addListener:fn=>listeners.push(fn)}},runtime:{openOptionsPage(){},async sendMessage({operation,id}){
  if(operation==='spaces')return {ok:true,data:{items:[{site,id:'7',title:'Engineering'}],nextCursor:null}};
  if(operation==='pages')return {ok:true,data:{items:[{site,id:'42',spaceId:'7',title:'Cloud guide'}],nextCursor:null}};
  if(resolvePage)return resolvePage;
  return {ok:true,data:{site,id,spaceId:'7',title:'Cloud guide',html:'<h2 id="intro">Introduction</h2><p>Cloud body</p>',url:site+'/wiki/pages/viewpage.action?pageId='+id}};
}}};
const {createViewer}=await import('../src/content/viewer.js');
const {pageKey}=await import('../src/common/confluence.js');
const {confluenceStorage}=await import('../src/common/confluence-storage.js');
const {parseHash}=await import('../src/common/route.js');
const {createConfluenceViewer}=await import('../src/content/confluence-viewer.js');
const docs=[{path:'README.md',name:'README.md',dir:'',title:'README',sha:'1',size:20}];
const client={owner:'acme',repo:'widget',getRawText:async()=> '# GitHub guide\n\nGitHub body',blobUrl:p=>'https://github.com/acme/widget/blob/main/'+p,editUrl:p=>'https://github.com/acme/widget/edit/main/'+p};
const waitFor=async(fn)=>{for(let i=0;i<60;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for viewer state');};
const make=()=>createViewer({client,settings:{theme:'auto'},docs:[...docs],total:1,confluenceSites:[site]});

test('reads a Confluence page with read-only toolbar and returns to GitHub editing',async()=>{
  const viewer=make();
  try {
    await viewer.open({source:'confluence',site,pageId:'42',heading:null});
    assert.match(document.querySelector('[data-gdt-article]').textContent,/Cloud body/);
    assert.equal(document.querySelector('[data-gdt-live-edit]').disabled,true);
    assert.equal(document.querySelector('[data-gdt-edit-gh]').hidden,true);
    assert.equal(document.querySelector('[data-gdt-open-gh]').href,site+'/wiki/pages/viewpage.action?pageId=42');
    assert.ok(document.querySelector('form.gdt-confluence-controls'));
    await viewer.open({path:'README.md',heading:null});
    assert.match(document.querySelector('[data-gdt-article]').textContent,/GitHub body/);
    assert.equal(document.querySelector('[data-gdt-live-edit]').disabled,false);
    assert.equal(document.querySelector('[data-gdt-edit-gh]').hidden,false);
  }finally{viewer.close();}
});
test('attaching moves page into the repository and detaching restores the space, with persistence',async()=>{
  const viewer=make();
  try {
    await viewer.open({source:'confluence',site,pageId:'42'});
    await waitFor(()=>document.querySelector('[data-gdt-confluence-space]'));
    const form=document.querySelector('form.gdt-confluence-controls');
    form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    await waitFor(()=>document.querySelector('.gdt-confluence-attached a'));
    const key=pageKey(site,'42');
    assert.equal((await confluenceStorage.loadAttachments())[key].repository,'acme/widget');
    assert.equal(document.querySelectorAll('a[data-gdt-confluence-page]').length,1);
    assert.equal(document.querySelector('[data-gdt-confluence-space] a[data-gdt-confluence-page]'),null);
    [...form.querySelectorAll('button')].find(b=>b.textContent==='Detach').click();
    await waitFor(()=>!document.querySelector('.gdt-confluence-attached a'));
    assert.equal((await confluenceStorage.loadAttachments())[key],undefined);
    assert.ok(document.querySelector('[data-gdt-confluence-space] a[data-gdt-confluence-page]'));
  }finally{viewer.close();}
});
test('a delayed Confluence response cannot overwrite a later GitHub navigation',async()=>{
  const viewer=make();let finish;
  resolvePage=new Promise(r=>finish=r);
  try{
    const pending=viewer.open({source:'confluence',site,pageId:'42'});
    await viewer.open({path:'README.md'});
    finish({ok:true,data:{site,id:'42',spaceId:'7',title:'Late',html:'<p>Late body</p>'}});
    await pending;
    assert.match(document.querySelector('[data-gdt-article]').textContent,/GitHub body/);
    assert.doesNotMatch(document.querySelector('[data-gdt-article]').textContent,/Late body/);
  }finally{resolvePage=null;viewer.close();}
});

test('Confluence table-of-contents links preserve the page route',async()=>{
  const viewer=make();
  resolvePage=Promise.resolve({ok:true,data:{site,id:'42',spaceId:'7',title:'Guide',html:'<h2 id="one">One</h2><h2 id="two">Two</h2>'}});
  try {
    await viewer.open({source:'confluence',site,pageId:'42'});
    const links=[...document.querySelectorAll('a[data-gdt-toc-slug]')];
    assert.equal(links.length,2);
    for(const link of links) assert.deepEqual(parseHash(link.hash),{source:'confluence',site,pageId:'42',heading:link.dataset.gdtTocSlug});
  }finally{resolvePage=null;viewer.close();}
});

test('empty pagination responses have a request cap and show an incomplete-list notice',async()=>{
  let calls=0;
  const controller=createConfluenceViewer({sites:[site],repository:'acme/widget',onChange(){},storage:{loadAttachments:async()=>({})},
    request:async()=>{calls++;if(calls>60)throw new Error('Unbounded requests');return {items:[],nextCursor:String(calls)};}});
  await controller.start();
  const tree=document.createElement('div');controller.decorate(tree,new Map(),'',null);controller.stop();
  assert.ok(calls<=50,`Made ${calls} requests`);
  assert.match(tree.textContent,/listing is incomplete/i);
});
