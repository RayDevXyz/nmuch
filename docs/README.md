# BrainWaves documentation

**New to BrainWaves?** Take [the BrainWaves course](course/README.md): 18 hands-on lessons, from your first page to a complete second brain. In the app: the app menu (the BrainWaves icon) → **Learn BrainWaves**.

## Using BrainWaves

**Writing**
- [Pages and blocks](guide/editor.md): the `/` menu and Markdown shortcuts, plus tables, columns, callouts and toggles
- [Page headers](guide/page-headers.md): a cover with a picture, gradient or colour, breadcrumbs and sub-page links
- [Page properties](guide/page-properties.md): status, dates, tags and more on any page; in a pop-up or under the title
- [Buttons](guide/buttons.md): a button that makes a note, adds a to-do or a row, or opens a page, with your own label, colour and steps
- [Templates](guide/templates.md): pages and sub-pages from a template, with fields to fill in (`{{Client}}`, `{{date}}`)
- [Formulas](guide/formulas.md): live values in your text, from properties and databases, with logic
- [Themes](guide/themes.md): the theme editor, and a theme per page

**Organising**
- [Databases](guide/databases.md): tables, boards and galleries whose rows are pages; turning a page into a database; showing one on other pages
- [Maps of content](guide/maps-of-content.md): lists of pages (sub-pages, a tag, a database) that keep themselves up to date
- [The canvas](guide/canvas.md): a page as a board of notes, shapes and pictures; splitting a page into parts

**Modules**
- [PARA](guide/para.md): an Inbox to capture into, and Projects, Areas, Resources and an Archive to sort it into
- [Courses](guide/courses.md): follow a course from a folder of lessons and track your progress
- [Dungeons & Dragons](guide/dnd.md): the compendium, campaigns, characters and world maps
- [Gemini](guide/gemini.md): build your D&D world with Google Gemini: NPCs, places, sessions, maps, or paste from the Gemini app
- [Battle maps](guide/battlemap.md): draw, light and generate maps: rooms, walls, doors, props, line of sight
- [The table](guide/table.md): battle maps your players join from their own devices

**Running it**
- [Hosting](guide/hosting.md): BrainWaves on your own server (Docker, Cosmos Cloud) with your own login
- [Sync](guide/sync.md): the desktop app and your server, in sync both ways and offline-friendly
- [Android](guide/android.md): install it as an app, with a place in the share menu
- [Burrow](guide/burrow.md): bookmarks from Burrow in your pages, and pages saved to Burrow

## Extending BrainWaves

- [Writing a widget](develop/widgets.md): a small HTML app in a page, connected to your databases
- [Writing a module](develop/modules.md): a larger add-on with its own data, commands and blocks (example: [develop/examples/](develop/examples/))

## How it's built

These are the design notes written while building BrainWaves, phase by phase. They explain the decisions; the guides above say how things work today.

- [Architecture](design/architecture.md): the plan, with a single Rust core, Yjs documents and a rebuildable index
- [Spike 1: the block model](design/spike-01-block-model.md): yrs persistence and rebuilding the index
- [Phase 2: the editor](design/phase-02-editor.md): Tiptap on the Rust core
- [Phase 3: databases](design/phase-03-databases.md): columns, relations, rollups and the query engine
- [Phase 4: widgets](design/phase-04-widgets.md): the sandboxed widget runtime and its data API
- [Phase 5: the canvas](design/phase-05-edgeless.md): edgeless mode and its model
- [Phase 6: modules](design/phase-06-modules.md): the capability host and the Course module
