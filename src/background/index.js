import { ext } from '../common/browser.js';
import { confluenceStorage } from '../common/confluence-storage.js';
import { createConfluenceAPI, allowedSender } from './confluence-api.js';

const api = createConfluenceAPI({
  fetch: globalThis.fetch.bind(globalThis),
  getSites: () => confluenceStorage.listSites(),
  hasPermission: site => ext.permissions.contains({ origins: [site + '/*'] }),
});

ext.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== 'gdt:confluence') return false;
  if (!allowedSender(sender, { id: ext.runtime.id, url: ext.runtime.getURL('') })) {
    reply({ ok: false, error: { code: 'SENDER', message: 'Confluence request is not allowed from this page.' } });
    return false;
  }
  api.request(message).then(data => reply({ ok: true, data }), error => reply({
    ok: false, error: { code: error.code || 'REQUEST', message: error.message, retryAfter: error.retryAfter },
  }));
  return true; // callback response also works in Chrome 121
});
