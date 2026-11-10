import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConfluenceStorage} from '../src/common/confluence-storage.js';
import {pageKey} from '../src/common/confluence.js';
const site='https://team.atlassian.net';
function setup(){
  const data={};
  const local={async get(key){return key===null?{...data}:{[key]:data[key]};},async set(values){Object.assign(data,values);},async remove(keys){for(const k of [keys].flat())delete data[k];}};
  return {data,store:createConfluenceStorage(local)};
}
test('sites and individual attachments persist locally without overwriting other pages',async()=>{
  const {store,data}=setup();
  await store.saveSites([site,site]);
  assert.deepEqual(await store.listSites(),[site]);
  await Promise.all(['1','2'].map(id=>store.saveAttachment(site,{id,title:id,spaceId:'7'},'Acme/Repo')));
  assert.equal(Object.keys(await store.loadAttachments()).length,2);
  await store.saveAttachment(site,{id:'1',title:'One',spaceId:'7'},'acme/second');
  assert.equal((await store.loadAttachments())[pageKey(site,'1')].repository,'acme/second');
  await store.saveAttachment(site,{id:'1'},null);
  assert.equal(Object.keys(await store.loadAttachments()).length,1);
  assert.ok(Object.keys(data).every(k=>k.startsWith('gdt:confluence')));
});
test('removing a site clears only its personal attachments',async()=>{
  const {store}=setup(),other='https://other.atlassian.net';
  await store.saveSites([site,other]);
  for(const s of [site,other])await store.saveAttachment(s,{id:'1',spaceId:'7',title:'A'},'acme/repo');
  await store.removeSite(site);
  assert.deepEqual(await store.listSites(),[other]);
  assert.deepEqual(Object.keys(await store.loadAttachments()),[pageKey(other,'1')]);
});
