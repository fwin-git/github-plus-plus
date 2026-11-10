import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<input id="confluence-site"><button id="connect-confluence">Connect</button><p id="confluence-status"></p><ul id="confluence-sites"></ul>');
globalThis.document=dom.window.document;
const data={},calls=[];let grant=true,session=true;
globalThis.chrome={
  storage:{local:{async get(key){calls.push(['get']);return key==null?{...data}:{[key]:data[key]};},async set(patch){Object.assign(data,patch);},async remove(keys){for(const key of [keys].flat())delete data[key];}}},
  permissions:{async request(input){calls.push(['permission',input]);return grant;},async remove(input){calls.push(['remove',input]);return true;}},
  runtime:{async sendMessage(input){calls.push(['request',input]);return session?{ok:true,data:{items:[]}}:{ok:false,error:{message:'Sign in to Confluence.'}};}},
};
const {initConfluenceOptions}=await import('../src/options/confluence-options.js');
const {CONFLUENCE_SITES_KEY,ATTACHMENT_PREFIX,pageKey}=await import('../src/common/confluence.js');
const site='https://team.atlassian.net';
const waitFor=async(fn)=>{for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Options state did not settle');};
initConfluenceOptions();
test('connect requests only the chosen origin in the click gesture and keeps sign-in recovery available',async()=>{
  await new Promise(r=>setTimeout(r,0));calls.length=0;session=false;
  document.getElementById('confluence-site').value=site+'/wiki';
  document.getElementById('connect-confluence').click();
  assert.deepEqual(calls[0],['permission',{origins:[site+'/*']}]);
  await waitFor(()=>document.getElementById('confluence-status').textContent.includes('Sign in'));
  assert.deepEqual(data[CONFLUENCE_SITES_KEY],[site]);
  assert.equal(document.querySelector('#confluence-sites a').href,site+'/wiki');
});
test('denied permission does not save a new site or request its pages',async()=>{
  grant=false;calls.length=0;
  document.getElementById('confluence-site').value='https://denied.atlassian.net';
  document.getElementById('connect-confluence').click();
  await waitFor(()=>document.getElementById('confluence-status').textContent.includes('not granted'));
  assert.deepEqual(data[CONFLUENCE_SITES_KEY],[site]);
  assert.equal(calls.some(c=>c[0]==='request'),false);
});
test('removing a site revokes its permission and clears its personal attachments',async()=>{
  const key=ATTACHMENT_PREFIX+pageKey(site,'42');
  data[key]={site,id:'42',spaceId:'7',title:'Guide',repository:'acme/widget'};
  [...document.querySelectorAll('#confluence-sites button')].find(b=>b.textContent==='Remove').click();
  await waitFor(()=>document.getElementById('confluence-status').textContent.includes('Site removed'));
  assert.deepEqual(calls.find(c=>c[0]==='remove'),['remove',{origins:[site+'/*']}]);
  assert.deepEqual(data[CONFLUENCE_SITES_KEY],[]);assert.equal(data[key],undefined);
});
