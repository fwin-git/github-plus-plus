import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfluenceAPI, allowedSender } from '../src/background/confluence-api.js';
const site='https://team.atlassian.net';
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
function setup(response,overrides={}) {
  const calls=[];
  const api=createConfluenceAPI({fetch:async(...args)=>{calls.push(args);return response;},hasPermission:async()=>true,getSites:async()=>[site],...overrides});
  return {api,calls};
}
test('transport uses the exact configured site, browser credentials and GET without redirects',async()=>{
  const {api,calls}=setup(json({results:[{id:'7',name:'Space'}],_links:{}}));
  const result=await api.request({operation:'spaces',site});
  assert.equal(result.items[0].title,'Space');
  assert.equal(calls[0][0],site+'/wiki/api/v2/spaces?limit=100');
  assert.equal(calls[0][1].method,'GET');
  assert.equal(calls[0][1].credentials,'include');
  assert.equal(calls[0][1].redirect,'error');
  assert.equal(calls[0][1].headers.Authorization,undefined);
});
test('unconfigured or unpermitted sites and arbitrary operations never reach fetch',async()=>{
  for(const overrides of [{getSites:async()=>[]},{hasPermission:async()=>false}]) {
    const {api,calls}=setup(json({}),overrides);
    await assert.rejects(api.request({operation:'spaces',site})); assert.equal(calls.length,0);
  }
  const {api,calls}=setup(json({}));
  await assert.rejects(api.request({operation:'delete',site}));
  await assert.rejects(api.request({operation:'page',site,id:'../spaces'}));
  assert.equal(calls.length,0);
});
test('pagination extracts cursors only from the same site and endpoint',async()=>{
  const {api}=setup(json({results:[],_links:{next:'/wiki/api/v2/spaces?cursor=abc%2B123&limit=100'}}));
  assert.equal((await api.request({operation:'spaces',site})).nextCursor,'abc+123');
  for(const next of ['https://evil.test/wiki/api/v2/spaces?cursor=x','/wiki/api/v2/pages?cursor=x']) {
    const {api}=setup(json({results:[],_links:{next}}));
    await assert.rejects(api.request({operation:'spaces',site}),/pagination/i);
  }
});
test('session errors, HTML login pages and rate limits are actionable without retries',async()=>{
  for(const status of [401,403,404]) {
    const {api}=setup(json({},status));
    await assert.rejects(api.request({operation:'spaces',site}),e=>e.code==='SESSION');
  }
  const {api,calls}=setup(json({},429,{'retry-after':'60'}));
  await assert.rejects(api.request({operation:'spaces',site}),e=>e.code==='RATE_LIMIT'&&e.retryAfter===60);
  assert.equal(calls.length,1);
  const html=setup(new Response('<html>Log in</html>',{headers:{'content-type':'text/html'}}));
  await assert.rejects(html.api.request({operation:'spaces',site}),e=>e.code==='SESSION');
});
test('page response returns rendered HTML and a canonical original URL',async()=>{
  const {api}=setup(json({id:'42',spaceId:'7',title:'Read me',body:{view:{value:'<p>hello</p>'}}}));
  const page=await api.request({operation:'page',site,id:'42'});
  assert.equal(page.html,'<p>hello</p>');
  assert.equal(page.url,site+'/wiki/pages/viewpage.action?pageId=42');
});
test('only this extension and its GitHub content scripts can call the broker',()=>{
  const ext={id:'ours',url:'chrome-extension://ours/'};
  assert.equal(allowedSender({id:'ours',url:'https://github.com/a/b'},ext),true);
  assert.equal(allowedSender({id:'ours',url:'chrome-extension://ours/options.html'},ext),true);
  assert.equal(allowedSender({id:'other',url:'https://github.com/a/b'},ext),false);
  assert.equal(allowedSender({id:'ours',url:'https://github.com.evil.test/a'},ext),false);
});
