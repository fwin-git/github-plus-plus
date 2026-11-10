import { ext } from './browser.js';
import { CONFLUENCE_SITES_KEY, ATTACHMENT_PREFIX, normalizeSite, normalizeRepository, pageKey, validId } from './confluence.js';

export function createConfluenceStorage(local) {
  const store = {
    async listSites() {
      const value = (await local.get(CONFLUENCE_SITES_KEY))[CONFLUENCE_SITES_KEY];
      return [...new Set((Array.isArray(value) ? value : []).flatMap(site => {
        try { return [normalizeSite(site)]; } catch { return []; }
      }))];
    },
    async saveSites(sites) {
      await local.set({ [CONFLUENCE_SITES_KEY]: [...new Set(sites.map(normalizeSite))] });
    },
    async loadAttachments() {
      const all = await local.get(null), out = {};
      for (const [key, page] of Object.entries(all)) {
        if (!key.startsWith(ATTACHMENT_PREFIX)) continue;
        try {
          const identity = pageKey(page.site, page.id);
          if (key !== ATTACHMENT_PREFIX + identity) continue;
          out[identity] = { site: normalizeSite(page.site), id: validId(page.id), spaceId: validId(page.spaceId), title: String(page.title || 'Untitled'), repository: normalizeRepository(page.repository) };
        } catch { /* skip invalid local data */ }
      }
      return out;
    },
    async saveAttachment(site, page, repository) {
      const key = ATTACHMENT_PREFIX + pageKey(site, page.id);
      if (!repository) return local.remove(key);
      await local.set({ [key]: { site: normalizeSite(site), id: validId(page.id), spaceId: validId(page.spaceId), title: String(page.title || 'Untitled'), repository: normalizeRepository(repository) } });
    },
    async removeSite(site) {
      site = normalizeSite(site);
      await store.saveSites((await store.listSites()).filter(s => s !== site));
      const all = await local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith(ATTACHMENT_PREFIX + site + '|'));
      if (keys.length) await local.remove(keys);
    },
  };
  return store;
}

export const confluenceStorage = ext ? createConfluenceStorage(ext.storage.local) : null;

export async function requestConfluence(operation, site, params = {}) {
  const response = await ext.runtime.sendMessage({ type: 'gdt:confluence', operation, site, ...params });
  if (!response?.ok) throw Object.assign(new Error(response?.error?.message || 'Confluence connection unavailable. Reload the extension and this tab.'), response?.error);
  return response.data;
}
