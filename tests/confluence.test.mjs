import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSite, normalizeRepository, pageKey, groupPages, pageTreeRows } from '../src/common/confluence.js';
import { buildConfluenceHash, parseHash, buildHash } from '../src/common/route.js';

const site = 'https://team.atlassian.net';
test('Cloud site normalization accepts page URLs but rejects credentials, ports and lookalike hosts', () => {
  assert.equal(normalizeSite('https://TEAM.atlassian.net/wiki/spaces/A'), site);
  for (const bad of ['http://team.atlassian.net', 'https://team.atlassian.net.evil.test', 'https://user:secret@team.atlassian.net', 'https://team.atlassian.net:444', 'https://atlassian.net', 'https://localhost', 'file:///tmp/x']) {
    assert.throws(() => normalizeSite(bad));
  }
});
test('repository attachments normalize owner/repo, rejecting non-repositories', () => {
  assert.equal(normalizeRepository(' Owner/Repo '), 'owner/repo');
  assert.equal(normalizeRepository('https://github.com/Owner/Repo'), 'owner/repo');
  for (const bad of ['owner', 'owner/repo/extra', 'owner/..', 'https://evil.test/a/b', 'owner/a?x=1']) assert.throws(() => normalizeRepository(bad));
});
test('site and page IDs isolate attachments and reject ambiguous identities', () => {
  assert.notEqual(pageKey(site, '42'), pageKey('https://other.atlassian.net', '42'));
  for (const id of ['../x', '42?x=1', '', '2/3']) assert.throws(() => pageKey(site, id));
});
test('attaching moves exactly one page; detaching restores its space without moving children', () => {
  const pages = [{site,id:'1',spaceId:'7',title:'Parent'}, {site,id:'2',spaceId:'7',parentId:'1',title:'Child'}];
  const key = pageKey(site, '1');
  const groups = groupPages(pages, {[key]:{...pages[0],repository:'owner/repo'}});
  assert.deepEqual(groups.repositories.get('owner/repo').map(p=>p.id), ['1']);
  assert.deepEqual(groups.spaces.get(pageKey(site,'7')).map(p=>p.id), ['2']);
  assert.deepEqual(groupPages(pages, {}).spaces.get(pageKey(site,'7')).map(p=>p.id), ['1','2']);
});
test('stored attachments are visible before loading their space, without duplicates after loading', () => {
  const page={site,id:'1',spaceId:'7',title:'Known',repository:'owner/repo'};
  const attachments={[pageKey(site,'1')]:page};
  assert.equal(groupPages([],attachments).repositories.get('owner/repo').length,1);
  assert.equal(groupPages([page],attachments).repositories.get('owner/repo').length,1);
});
test('Confluence routes roundtrip independently of GitHub paths', () => {
  const route={source:'confluence',site,pageId:'42',heading:'A & B'};
  assert.deepEqual(parseHash(buildConfluenceHash(route)),route);
  assert.deepEqual(parseHash(buildHash({path:'confluence/42.md'})),{path:'confluence/42.md',heading:null});
  assert.equal(parseHash('#docs?source=confluence&site=https%3A%2F%2Fevil.test&page=42'),null);
});

test('page trees keep children with parents and handle cycles and identical IDs on different sites',()=>{
  const list=[{site,id:'1',title:'Zulu'},{site,id:'2',parentId:'1',title:'Alpha'}, {site:'https://other.atlassian.net',id:'2',parentId:'1',title:'Other'}, {site,id:'3',parentId:'4',title:'Cycle A'},{site,id:'4',parentId:'3',title:'Cycle B'}];
  const rows=pageTreeRows(list);
  assert.equal(rows.length,5);
  const parent=rows.findIndex(r=>r.page.id==='1');
  assert.equal(rows[parent+1].page.title,'Alpha');assert.equal(rows[parent+1].depth,1);
  assert.equal(rows.find(r=>r.page.title==='Other').depth,0);
});
