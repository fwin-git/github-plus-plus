// Fixture repository for the local harness. Installs stubs for chrome.storage
// and fetch BEFORE dist/content.js executes.
(() => {
  const FILES = {
    'README.md': `# Widget

The **acme widget** does things. See [[Getting Started]] or the [setup guide](docs/guide/setup.md#prerequisites).

> [!NOTE]
> This is a harness fixture, not a real project.

## Features

- [x] Fast
- [ ] Documented
- Linked to https://example.com

## Code

\`\`\`js
function greet(name) {
  return "Hello " + name;
}
\`\`\`

| Col A | Col B |
| ----- | ----- |
| 1     | 2     |

A footnote[^1].

[^1]: The footnote text.
`,
    'CONTRIBUTING.md': `# Contributing

Please read the [Getting Started](docs/getting-started.md) guide first. Broken wiki: [[No Such Page]].
`,
    'docs/getting-started.md': `---
title: Getting Started
tags: [guide, intro]
order: 1
pinned: true
description: How to get going quickly.
---

# Getting Started

Install the widget, then read [[setup#Install Steps|the install steps]].

## First run

Run \`widget --init\`.
`,
    'docs/guide/setup.md': `---
title: Setup Guide
tags: [guide]
---

# Setup

## Prerequisites

You need node.

## Install Steps

1. Download
2. Extract
3. Enjoy

## Troubleshooting

See [[Getting Started]] or go [back to the README](../../README.md).
`,
    'docs/guide/advanced.md': `---
title: Advanced Topics
tags: [internals]
sidebar_position: 9
---

# Advanced

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

![architecture](../img/arch.png)
`,
    'docs/api/index.md': `---
title: API Reference
tags: [api]
pin: true
---

# API

## widget.create()

Makes a widget.
`,
    '.github/PULL_REQUEST_TEMPLATE.md': `## What

## Why
`,
  };

  const GADGET_FILES = {
    'README.md': '# Gadget\n\nCompanion tool to the widget.\n',
    'docs/usage.md': '---\ntitle: Gadget Usage\ntags: [guide]\n---\n\n# Usage\n\nUse the gadget zorblax carefully.\n',
  };

  const enc = new TextEncoder();
  const entries = [];
  const dirs = new Set();
  for (const path of Object.keys(FILES)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    entries.push({ path, mode: '100644', type: 'blob', sha: 'blob-' + path, size: enc.encode(FILES[path]).length });
  }
  for (const dir of dirs) entries.push({ path: dir, mode: '040000', type: 'tree', sha: 'tree-' + dir });
  entries.push({ path: 'src', type: 'tree', sha: 'tree-src' });
  entries.push({ path: 'src/main.js', type: 'blob', sha: 'blob-src', size: 10 });

  // ---- chrome.storage shim --------------------------------------------------
  // Backed by localStorage so state survives page navigations (needed for the
  // "Propose via GitHub editor" handoff, which crosses a page load).
  const store = new Map(JSON.parse(localStorage.getItem('gdt-harness-store') || '[]'));
  const persist = () => localStorage.setItem('gdt-harness-store', JSON.stringify([...store.entries()]));
  // Seed a token so the propose-PR flow (and token-mode content fetching via
  // the contents API) can be exercised against the stubbed endpoints below.
  if (!store.has('gdt:settings')) store.set('gdt:settings', { token: 'harness-token' });
  const storageArea = {
    async get(keys) {
      const out = {};
      const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      for (const k of list) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
      persist();
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
      persist();
    },
  };
  window.chrome = {
    storage: { local: storageArea, onChanged: { addListener() {} } },
    runtime: { openOptionsPage() {} },
  };

  // ---- fetch stub -----------------------------------------------------------
  const realFetch = window.fetch.bind(window);
  window.__gdtHarness = { requests: [] };
  const json = (obj, status = 200, headers = {}) =>
    new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const accept = ((init && init.headers && init.headers.Accept) || '').toString();
    window.__gdtHarness.requests.push(`${method} ${url}`);

    let m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/HEAD\?recursive=1$/.exec(url);
    if (m) {
      if (m[2] === 'gadget') {
        const t = Object.keys(GADGET_FILES).map((path) => ({ path, type: 'blob', sha: 'g-' + path, size: 200 }));
        t.push({ path: 'docs', type: 'tree', sha: 'g-docs' });
        return json({ sha: 'gadget-tree', truncated: false, tree: t }, 200, { etag: 'W/"gfixture"' });
      }
      return json({ sha: 'root-tree-sha', truncated: false, tree: entries }, 200, { etag: 'W/"fixture"' });
    }
    m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/HEAD\/(.+)$/.exec(url);
    if (m) {
      const path = m[3].split('/').map(decodeURIComponent).join('/');
      if (path in FILES) return new Response(FILES[path], { status: 200 });
      if (path.endsWith('.png')) return new Response(new Blob([new Uint8Array(0)]), { status: 200 });
      return new Response('nope', { status: 404 });
    }

    // ---- token-mode + propose-PR endpoints ----------------------------------
    m = /^https:\/\/api\.github\.com\/repos\/acme\/(widget|gadget)\/contents\/([^?]+)\?ref=([^&]+)$/.exec(url);
    if (m && method === 'GET') {
      const files = m[1] === 'gadget' ? GADGET_FILES : FILES;
      const path = m[2].split('/').map(decodeURIComponent).join('/');
      if (accept.includes('raw')) {
        return path in files ? new Response(files[path], { status: 200 }) : new Response('nope', { status: 404 });
      }
      return path in files ? json({ sha: 'blob-' + path, path }) : json({ message: 'Not Found' }, 404);
    }
    if (/^https:\/\/api\.github\.com\/orgs\/acme\/repos\?/.test(url) && method === 'GET') {
      return json([
        { name: 'widget', description: 'The main widget', archived: false, private: false },
        { name: 'gadget', description: 'Companion tool', archived: false, private: false },
        { name: 'attic', description: 'Old stuff', archived: true, private: false },
      ]);
    }
    if (url === 'https://api.github.com/repos/acme/widget' && method === 'GET') {
      return json({ name: 'widget', default_branch: 'main', permissions: { push: true } });
    }
    if (url === 'https://api.github.com/repos/acme/widget/git/ref/heads%2Fmain' && method === 'GET') {
      return json({ object: { sha: 'base-sha' } });
    }
    if (url === 'https://api.github.com/repos/acme/widget/git/refs' && method === 'POST') {
      return json({ ref: JSON.parse(init.body).ref }, 201);
    }
    m = /^https:\/\/api\.github\.com\/repos\/acme\/widget\/contents\/([^?]+)$/.exec(url);
    if (m && method === 'PUT') {
      window.__gdtHarness.lastPut = JSON.parse(init.body);
      return json({ commit: { sha: 'new-commit' } });
    }
    if (url === 'https://api.github.com/repos/acme/widget/pulls' && method === 'POST') {
      window.__gdtHarness.lastPull = JSON.parse(init.body);
      return json({ html_url: 'https://github.com/acme/widget/pull/42', number: 42 }, 201);
    }

    if (url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/')) {
      return json({ message: 'unexpected ' + method + ' ' + url }, 404);
    }
    return realFetch(input, init);
  };

  // ---- fake GitHub file editor ---------------------------------------------
  // On /owner/repo/edit/... URLs, provide the textarea GitHub's editor exposes
  // so the "Propose via GitHub editor" handoff can be exercised end to end.
  if (/^\/[^/]+\/[^/]+\/edit\//.test(location.pathname)) {
    const ta = document.createElement('textarea');
    ta.name = 'value';
    ta.setAttribute('data-harness-editor', '');
    ta.style.cssText = 'display:block;width:90%;height:120px;margin:12px';
    document.body.appendChild(ta);
  }
})();
