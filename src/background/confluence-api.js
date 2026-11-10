import { normalizeSite, validId, pageUrl } from '../common/confluence.js';

export function allowedSender(sender, extension) {
  if (sender?.id !== extension.id) return false;
  try {
    const url = new URL(sender.url);
    return url.href.startsWith(extension.url) || (url.origin === 'https://github.com' && (sender.frameId === undefined || sender.frameId === 0));
  } catch { return false; }
}

function failure(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }

export function createConfluenceAPI({ fetch: fetcher, hasPermission, getSites }) {
  return {
    async request({ operation, site: inputSite, id, cursor }) {
      const site = normalizeSite(inputSite);
      if (!(await getSites()).includes(site)) throw failure('CONFIG', 'Add this Confluence site in extension Options first.');
      if (!(await hasPermission(site))) throw failure('PERMISSION', 'Site access was removed. Reconnect this site in extension Options.');
      let path;
      if (operation === 'spaces') path = '/wiki/api/v2/spaces';
      else if (operation === 'pages') path = `/wiki/api/v2/spaces/${validId(id)}/pages`;
      else if (operation === 'page') path = `/wiki/api/v2/pages/${validId(id)}`;
      else throw failure('REQUEST', 'Unsupported Confluence operation.');
      const url = new URL(site + path);
      if (operation === 'page') url.searchParams.set('body-format', 'view');
      else {
        url.searchParams.set('limit', '100');
        if (cursor != null) {
          if (typeof cursor !== 'string' || cursor.length > 8000) throw failure('REQUEST', 'Invalid pagination cursor.');
          url.searchParams.set('cursor', cursor);
        }
      }
      let response;
      try {
        response = await fetcher(url.href, { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      } catch {
        throw failure('NETWORK', 'Cannot reach Confluence. Open the site, sign in in this browser profile, and retry.');
      }
      if (response.status === 429) {
        const value = response.headers.get('retry-after');
        const seconds = Number(value);
        const retryAfter = value && Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
        throw failure('RATE_LIMIT', `Confluence is limiting requests. Try again in ${Math.ceil(retryAfter)} seconds.`, { retryAfter });
      }
      if ([401, 403, 404].includes(response.status)) throw failure('SESSION', 'Sign in to Confluence in this browser profile and check that you can view this page or space.');
      if (!response.ok) throw failure('SERVER', `Confluence returned HTTP ${response.status}. Try again later.`);
      if (!response.headers.get('content-type')?.includes('application/json')) throw failure('SESSION', 'Confluence returned a sign-in page. Open the site and sign in, then retry.');
      const data = await response.json();
      if (operation === 'page') {
        if (String(data.id) !== String(id)) throw failure('RESPONSE', 'Confluence returned a different page.');
        const html = data.body?.view?.value;
        if (typeof html !== 'string') throw failure('RESPONSE', 'This page has no readable HTML. Open it in Confluence.');
        if (html.length > 2_000_000) throw failure('RESPONSE', 'This page is too large for the viewer. Open it in Confluence.');
        return { site, id: validId(data.id), spaceId: validId(data.spaceId), title: String(data.title || 'Untitled'), html, url: pageUrl(site, id) };
      }
      if (!Array.isArray(data.results)) throw failure('RESPONSE', 'Confluence returned an invalid listing.');
      let nextCursor = null;
      if (data._links?.next) {
        const next = new URL(data._links.next, site);
        if (next.origin !== site || next.pathname !== path || next.username || next.password) throw failure('RESPONSE', 'Unsafe Confluence pagination link.');
        nextCursor = next.searchParams.get('cursor');
        if (!nextCursor) throw failure('RESPONSE', 'Invalid Confluence pagination link.');
      }
      const items = data.results.map(item => operation === 'spaces'
        ? { site, id: validId(item.id), title: String(item.name || item.key || 'Untitled space') }
        : { site, id: validId(item.id), spaceId: validId(id), parentId: item.parentId ? validId(item.parentId) : null, title: String(item.title || 'Untitled') });
      return { items, nextCursor };
    },
  };
}
