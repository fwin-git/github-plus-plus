import { ext } from '../common/browser.js';
import { groupPages, normalizeRepository, pageKey, pageTreeRows } from '../common/confluence.js';
import { confluenceStorage, requestConfluence } from '../common/confluence-storage.js';
import { buildConfluenceHash } from '../common/route.js';
import { searchFiles } from '../common/search.js';

const node = (tag, text, className) => Object.assign(document.createElement(tag), { ...(text == null ? {} : {textContent:text}), ...(className ? {className} : {}) });
function button(text, action) { const b=node('button',text,'gdt-btn gdt-btn-sm'); b.type='button'; b.addEventListener('click',action); return b; }
function link(text, href) { const a=node('a',text); a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; return a; }

export function createConfluenceViewer({ sites, repository, onChange, request = requestConfluence, storage = confluenceStorage }) {
  const siteStates = new Map(sites.map(site => [site,{spaces:[],loading:false,loaded:false,error:null}]));
  const spaceStates = new Map(), pages = new Map(), expanded = new Set();
  let attachments = {}, alive = true, knownRepos = new Set([repository]);
  const changed = () => { if (alive) onChange(); };
  const activeAttachments = () => Object.fromEntries(Object.entries(attachments).filter(([,p]) => sites.includes(p.site)));

  async function collection(operation, site, id, max) {
    const items=[], cursors=new Set(); let cursor, requests=0;
    do {
      const result = await request(operation,site,{id,cursor});
      requests++;
      items.push(...result.items);
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Confluence repeated a pagination cursor. Retry the listing.');
      cursors.add(cursor);
    } while (cursor && items.length < max && requests < 50 && alive);
    return { items:items.slice(0,max), truncated:items.length > max || Boolean(cursor) };
  }
  async function loadSite(site) {
    const state=siteStates.get(site); if (state.loading) return;
    state.loading=true;state.error=null;changed();
    try { const result=await collection('spaces',site,undefined,500); state.spaces=result.items;state.truncated=result.truncated;state.loaded=true; }
    catch(error){state.error=error.message;}
    finally {state.loading=false;changed();}
  }
  async function loadSpace(space) {
    const key=pageKey(space.site,space.id);
    const state=spaceStates.get(key)||{}; if(state.loading)return;
    spaceStates.set(key,state);state.loading=true;state.error=null;changed();
    try {
      const result=await collection('pages',space.site,space.id,5000);
      for(const [key,page] of pages) if(page.site===space.site && page.spaceId===space.id) pages.delete(key);
      for(const page of result.items)pages.set(pageKey(page.site,page.id),page);
      state.loaded=true;state.truncated=result.truncated;
    } catch(error){state.error=error.message;}
    finally{state.loading=false;changed();}
  }
  function recovery(message,site,retry) {
    const box=node('div',null,'gdt-confluence-note');box.append(node('p',message));
    box.append(link('Open Confluence and sign in',site+'/wiki'),document.createTextNode(' · '));
    box.append(button('Connection settings',()=>ext.runtime.openOptionsPage()));
    if(retry)box.append(button('Retry',retry));
    return box;
  }
  function group(title,key,open=false) {
    const details=node('details',null,'gdt-confluence-group');details.open=expanded.has(key)||open;
    const summary=node('summary',title);details.append(summary);
    details.addEventListener('toggle',()=>{if(details.open)expanded.add(key);else expanded.delete(key);});
    return details;
  }
  function pageList(list,filter,route) {
    const ul=node('ul',null,'gdt-tree-list gdt-confluence-pages');
    for(const {page,depth} of pageTreeRows(list)) {
      if(filter && !filter.split(/\s+/).every(t=>page.title.toLowerCase().includes(t)))continue;
      const li=node('li'); const a=node('a',page.title,'gdt-file');
      const key=pageKey(page.site,page.id);a.dataset.gdtConfluencePage=key;
      a.href=buildConfluenceHash({site:page.site,pageId:page.id});
      a.title=page.title;
      if(route?.source==='confluence' && pageKey(route.site,route.pageId)===key)a.setAttribute('aria-current','page');
      a.style.paddingInlineStart=`${12+depth*14}px`;
      li.append(a);ul.append(li);
    }
    return ul;
  }
  async function reloadAttachments() { attachments=await storage.loadAttachments();changed(); }

  return {
    async start() {
      alive=true;
      await reloadAttachments();
      try {
        const all=await ext.storage.local.get(null);
        for(const key of Object.keys(all))if(key.startsWith('gdt:tree:'))knownRepos.add(key.slice(9).toLowerCase());
      }catch{/* the current repo remains available */}
      await Promise.all(sites.map(site=>siteStates.get(site).loaded ? null : loadSite(site)));
    },
    stop(){alive=false;},
    reloadAttachments,
    async fetchPage(route) {
      if(!sites.includes(route.site))throw new Error('Add this Confluence site in extension Options first.');
      const page=await request('page',route.site,{id:route.pageId});
      // Only metadata is retained. Every page open rechecks the browser session.
      const {html,...metadata}=page;
      pages.set(pageKey(page.site,page.id),metadata);changed();return page;
    },
    recovery,
    decorate(treeEl,repoBodies,filter,route) {
      const groups=groupPages([...pages.values()],activeAttachments());
      for(const [repo,list] of groups.repositories) {
        knownRepos.add(repo);
        let body=repoBodies.get(repo.toLowerCase());
        if(!body){body=group(repo,'repo:'+repo,true);body.append(link('Open repository docs',`https://github.com/${repo}#docs`));treeEl.append(body);}
        const section=node('div',null,'gdt-confluence-attached');
        section.append(node('div','Confluence','gdt-confluence-label'),pageList(list,filter,route));body.append(section);
      }
      for(const [site,state] of siteStates) {
        const siteGroup=node('section',null,'gdt-confluence-site');
        siteGroup.append(node('div','Confluence · '+new URL(site).hostname,'gdt-confluence-label'));
        treeEl.append(siteGroup);
        if(state.loading)siteGroup.append(node('p','Loading spaces…','gdt-confluence-note'));
        if(state.error)siteGroup.append(recovery(state.error,site,()=>loadSite(site)));
        if(state.loaded && !state.spaces.length)siteGroup.append(node('p','No accessible spaces.','gdt-confluence-note'));
        if(state.truncated)siteGroup.append(node('p','Space listing is incomplete. Open Confluence for all spaces.','gdt-confluence-note'));
        for(const space of state.spaces) {
          const key=pageKey(site,space.id),list=groups.spaces.get(key)||[],s=spaceStates.get(key)||{};
          const details=group(space.title,key,Boolean(filter && list.some(p=>p.title.toLowerCase().includes(filter))));
          details.dataset.gdtConfluenceSpace=key;
          details.addEventListener('toggle',()=>{if(details.open&&!s.loaded&&!s.loading&&!s.error)loadSpace(space);});
          if(s.loading)details.append(node('p','Loading pages…','gdt-confluence-note'));
          if(s.error)details.append(recovery(s.error,site,()=>loadSpace(space)));
          details.append(pageList(list,filter,route));
          if(s.loaded&&!list.length)details.append(node('p','No unattached pages in this space.','gdt-confluence-note'));
          if(s.truncated)details.append(node('p','Page listing is incomplete. Open the space in Confluence for more.','gdt-confluence-note'));
          if(s.loaded)details.append(button('Refresh space',()=>loadSpace(space)));
          siteGroup.append(details);
        }
      }
    },
    search(parsed) {
      const all=new Map([...Object.entries(activeAttachments()),...pages]);
      const docs=[...all.values()].map(p=>({...p,path:pageKey(p.site,p.id)}));
      return searchFiles(docs,new Map(),parsed).slice(0,10).map(({doc})=>({title:doc.title,subtitle:'Confluence · '+new URL(doc.site).hostname,href:buildConfluenceHash({site:doc.site,pageId:doc.id})}));
    },
    controls(page) {
      const key=pageKey(page.site,page.id),current=attachments[key]?.repository;
      const form=node('form',null,'gdt-confluence-controls');
      const label=node('label','Repository ');const input=node('input');input.type='text';input.value=current||repository;
      input.placeholder='owner/repository';input.setAttribute('aria-label','Repository for this page');
      const list=node('datalist');list.id='gdt-confluence-repos';input.setAttribute('list',list.id);
      for(const repo of knownRepos)list.append(Object.assign(node('option'),{value:repo}));
      label.append(input);form.append(label,list);
      const save=node('button',current?'Move to repository':'Attach to repository','gdt-btn gdt-btn-sm');save.type='submit';
      const status=node('span',current?'Attached to '+current:'Only you see these attachments.','gdt-confluence-note');status.setAttribute('role','status');
      const detach=button('Detach',async()=>{
        detach.disabled=true;
        try{await storage.saveAttachment(page.site,page,null);delete attachments[key];status.textContent='Returned to its Confluence space.';save.textContent='Attach to repository';detach.hidden=true;changed();}
        catch(e){status.textContent=e.message;}finally{detach.disabled=false;}
      });detach.hidden=!current;
      form.addEventListener('submit',async event=>{
        event.preventDefault();save.disabled=true;
        try{
          const repo=normalizeRepository(input.value);
          await storage.saveAttachment(page.site,page,repo);
          attachments[key]={site:page.site,id:page.id,spaceId:page.spaceId,title:page.title,repository:repo};
          knownRepos.add(repo);status.textContent='Attached to '+repo;save.textContent='Move to repository';detach.hidden=false;changed();
        }catch(e){status.textContent=e.message;}finally{save.disabled=false;}
      });
      form.append(save,detach,status);return form;
    },
  };
}
