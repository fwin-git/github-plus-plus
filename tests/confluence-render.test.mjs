import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('',{url:'https://github.com/acme/repo'});
globalThis.window=dom.window;globalThis.document=dom.window.document;
const {renderConfluence}=await import('../src/content/confluence-render.js');
const {parseHash}=await import('../src/common/route.js');
const site='https://team.atlassian.net';
function render(html){return renderConfluence({site,id:'42',html});}
test('Confluence HTML removes executable content, injected viewer controls and remote styling',()=>{
  const {fragment}=render('<script>alert(1)</script><iframe src="https://evil.test"></iframe><form><input name="x"></form><p style="position:fixed" onclick="alert(1)" data-gdt-heading="fake">Hi</p><a href="javascript:alert(1)">bad</a>');
  assert.equal(fragment.querySelector('script,iframe,form,input'),null);
  assert.equal(fragment.querySelector('[onclick],[style],[data-gdt-heading]'),null);
  assert.equal(fragment.querySelector('a').hasAttribute('href'),false);
});
test('headings have unique IDs and in-page anchors resolve to the rewritten IDs',()=>{
  const {fragment,toc}=render('<h2 id="intro">Intro</h2><h2 id="intro">Again</h2><a href="#intro">Jump</a>');
  assert.equal(toc.length,2);assert.notEqual(toc[0].slug,toc[1].slug);
  assert.equal(fragment.querySelector('a').dataset.gdtHeading,toc[0].slug);
});
test('same-site page links remain in the viewer; other sites and attachments open externally',()=>{
  const {fragment}=render('<a href="/wiki/spaces/A/pages/99/Title#Part">Page</a><a href="/wiki/download/attachments/42/file.pdf">File</a><a href="https://other.atlassian.net/wiki/pages/viewpage.action?pageId=99">Other</a>');
  const links=[...fragment.querySelectorAll('a')];
  assert.match(links[0].getAttribute('href'),/^#docs\?source=confluence/);
  assert.equal(links[1].href,site+'/wiki/download/attachments/42/file.pdf');
  assert.equal(links[1].target,'_blank');assert.equal(links[2].target,'_blank');
});
test('images are explicit links, preventing embedded content from contacting arbitrary hosts',()=>{
  const {fragment}=render('<img src="/wiki/download/attachments/42/photo.png" alt="Diagram"><img src="https://tracker.test/x" onerror="alert(1)">');
  assert.equal(fragment.querySelector('img'),null);
  assert.equal(fragment.querySelector('a').href,site+'/wiki/download/attachments/42/photo.png');
});
test('cross-page heading links decode Unicode and tolerate malformed escapes',()=>{
  const {fragment}=render('<a href="/wiki/spaces/A/pages/99/Title#%C3%9Cbersicht">Unicode</a><a href="/wiki/spaces/A/pages/99/Title#bad%escape">Malformed</a>');
  const links=[...fragment.querySelectorAll('a')];
  assert.equal(parseHash(links[0].hash).heading,'Übersicht');
  assert.equal(parseHash(links[1].hash).heading,'bad%escape');
});
