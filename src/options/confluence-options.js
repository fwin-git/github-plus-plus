import { ext } from '../common/browser.js';
import { normalizeSite } from '../common/confluence.js';
import { confluenceStorage, requestConfluence } from '../common/confluence-storage.js';

export function initConfluenceOptions() {
  const input = document.getElementById('confluence-site');
  const status = document.getElementById('confluence-status');
  const list = document.getElementById('confluence-sites');
  function show(message) { status.textContent = message; }
  async function connect(value) {
    // Request in the click gesture, before any storage/network awaits (Firefox).
    try {
      const site = normalizeSite(value);
      const granted = await ext.permissions.request({ origins: [site + '/*'] });
      if (!granted) { show('Site access was not granted.'); return; }
      await confluenceStorage.saveSites([...(await confluenceStorage.listSites()), site]);
      await render();
      show('Checking your browser login…');
      try {
        await requestConfluence('spaces', site);
        show('Connected. Open the Docs tab to browse Confluence spaces.');
      } catch (error) { show(error.message + ' Use Open and sign in, then Reconnect.'); }
    } catch (error) { show(error.message); }
  }
  async function render() {
    list.replaceChildren();
    for (const site of await confluenceStorage.listSites()) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.textContent = new URL(site).hostname + ' — Open and sign in';
      link.href = site + '/wiki'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const reconnect = document.createElement('button');
      reconnect.type = 'button'; reconnect.textContent = 'Reconnect';
      reconnect.addEventListener('click', () => connect(site));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        try {
          await ext.permissions.remove({ origins: [site + '/*'] });
          await confluenceStorage.removeSite(site);
          show('Site removed, including its personal repository attachments.');
          await render();
        } catch (error) { show(error.message); }
      });
      row.append(link, reconnect, remove); list.append(row);
    }
  }
  document.getElementById('connect-confluence').addEventListener('click', () => connect(input.value));
  render().catch(error => show(error.message));
}
