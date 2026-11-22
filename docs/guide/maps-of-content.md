# Maps of content

Type `/map of content` (or `/moc`) to insert one. The block stores only its settings. It works the list of pages out from the workspace every time, so new, renamed, moved, archived or tagged pages show up, or drop out, on their own.

Open the settings with the gear in its top-right corner. The choices:

| Setting | Options |
|---|---|
| Show | sub-pages of this page (default) · pages with a tag (in the text or in a Tags property) · rows of a database · all pages |
| Levels | 1–3: nest sub-pages of sub-pages (for sub-pages and all pages) |
| Sort | as in the sidebar · A–Z · last updated · created |
| Group | none · first letter · parent page |
| Style | list · columns · cards |
| Title | your own heading; otherwise one is chosen from the source |

Clicking a link opens the page. Ctrl or Cmd+click opens it in a new tab.

When the page is copied as Markdown, the map becomes a bulleted list of `[[page]]` links, as it looks at that moment.

**Limit:** the links are worked out live, so the index doesn't store them. They don't appear as backlinks or in the graph.

**In the page schema:** the node is `moc`, and its attribute `settings` is a JSON string (see `apps/desktop/src/moc/MocBlock.tsx`, `MocSettings`).

Tags from a page's **Tags** property count too: see [page properties](page-properties.md#tags).
