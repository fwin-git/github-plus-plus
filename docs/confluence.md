---
title: Confluence Cloud
description: Read Confluence pages using your browser login and organize them with personal repository attachments.
tags: [guide, confluence]
order: 3
---

# Confluence Cloud

The Docs tab can show GitHub documentation and Confluence Cloud pages together.

## Connect a site

1. Sign in to your Confluence Cloud site in the same browser profile as the extension.
2. Open the extension toolbar icon → **Options**.
3. Under **Confluence Cloud**, enter a site URL such as `https://team.atlassian.net` and click **Connect**.
4. Allow access to that site in the browser prompt. The connection check reads the space list using your existing login.
5. Open a repository's **Docs** tab. Expand a Confluence space to browse its pages.

No Confluence API token is needed. You can connect several sites. Connecting a site keeps the Docs tab available even on repositories without readable GitHub documentation.

## Read and organize pages

Confluence pages initially appear in their own site and space groups, independent of repositories. Open a page to read its text, tables, headings, and links inside the viewer. **Open in Confluence** opens the original page.

To attach a page, enter or choose an `owner/repository` in its **Repository** field and click **Attach to repository**. The entry moves out of the space group and into that repository's group. You can choose the current repository, a known repository, or type another repository name. **Move to repository** changes the assignment; **Detach** returns the page to its space.

Attachments affect only your browser profile. They do not modify Confluence, add files to GitHub, or change what teammates see. Each page has its own assignment: attaching a parent page does not move its children. Another browser profile or device has its own settings.

## Search and navigation

The sidebar filter and search include titles of pages from spaces you have opened, plus attached pages. Confluence bodies are fetched on demand and are not added to full-text search. Open additional spaces to include their page titles.

Deep links identify the Confluence site and page. Recipients need the extension, access to that site, and their own browser login. Repository attachments are not included in shared links.

## Limits and recovery

- Confluence Cloud on `*.atlassian.net` only; Data Center and custom domains are not supported.
- Reading only. Images, interactive macros, comments, and editing use the original Confluence page. Embedded images become explicit links instead of loading remote content automatically.
- Up to 500 spaces per site and 5,000 pages per expanded space, with at most 50 requests per listing. Listings show a notice when limited. **Refresh space** reloads its pages.
- If your session expires, use **Open Confluence and sign in**, then **Retry**. Browser privacy settings, containers, or separate profiles can prevent sharing the login.
- If site permission was revoked, use **Options → Reconnect** to grant it again.
- **Remove** in Options revokes site permission and deletes that site's personal attachments. It does not log you out of Confluence or change any pages.

The session approach was verified against a real Confluence Cloud login in Zen's Firefox engine. Chrome has a separate service-worker package; a real logged-in Chrome session still needs compatibility verification.

## Privacy

The extension makes read-only API requests to configured sites. The browser sends its session cookies; the extension does not read or store cookie values or Confluence tokens. Site URLs and attachment metadata (page ID, title, space ID, repository) are saved in local extension storage. Page bodies are not persisted, and all HTML passes through DOMPurify before display.
