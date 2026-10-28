# BrainWaves

**A modular, block-based, local-first workspace.**

An extensible, local-first knowledge management environment designed to combine structured block editing with powerful custom workflows. Inspired by tools like **Obsidian** and **SiYuan**, this platform bridges the gap between note-taking, plugin customization, and full-featured local app modules.

---

## 🌟 Introduction

Modern productivity tools often force a choice between local privacy, structured block editing, and workflow-specific capabilities. 

This project provides a **local-first, highly extensible workspace** built around granular block editing and modular logic. Beyond standard templates, widgets, and lightweight plugins, it introduces **Modules**—standalone, data-driven applications that execute complex logic directly over your local notes and files. 

Whether you are tracking learning progress through an integrated Course Module, managing dynamic project pipelines, or orchestrating local file systems, the platform empowers you to tailor your environment entirely to your needs while keeping full ownership of your data.

---

## ✨ Feature List

### Core Block-Based & Local-First Features (Inspired by SiYuan & Obsidian)

- **Granular Block Architecture**: Everything is a block (paragraphs, headings, code snippets, widgets, lists). Move, fold, link, and reference at the block level.
- **Local-First & Data Sovereignty**: All data is stored locally in human-readable formats (e.g., Markdown/JSON/SQLite) for maximum privacy, longevity, and offline capability.
- **Bi-Directional Linking & Block References**: Effortlessly connect concepts using `[[links]]` or directly embedding reference blocks across documents.
- **Graph Visualization**: Interactive graph views to visualize connections between notes, blocks, tags, and modules.
- **Flexible Layouts & Canvas**: Support for multi-window splitting, tabbed navigation, and visual canvas layouts.

---

## 🏗️ Architecture & Ecosystem

The system uses a tiered approach to customization, allowing users and developers to extend functionality at different levels of complexity.

```
+-------------------------------------------------------------------+
|                           USER INTERFACE                          |
|    [ Block Editor ]   [ Graph View ]   [ Canvas ]   [ Dashboards ] |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                          EXTENSION LAYER                          |
|  [ Templates ]  |  [ Widgets ]  |  [ Plugins ]  |   [ MODULES ]    |
+-------------------------------------------------------------------+
                                  |
+-------------------------------------------------------------------+
|                            CORE SYSTEM                            |
|     - Local Data Store (Markdown / JSON / SQLite DB)              |
|     - Block Graph Engine & Indexer                                |
|     - Event Bus & Lifecycle Manager                               |
|     - Extension Sandbox Runtime                                   |
+-------------------------------------------------------------------+
```

### Extension Ecosystem Spectrum

1. **Templates**
   - Pure structural scaffolding for pages or blocks with variable substitution.
   - *Example:* Daily logs, meeting agendas, project charters.

2. **Widgets**
   - Embedded UI components rendered inline within the editor canvas.
   - *Example:* Interactive sliders, embedded calculators, audio players.

3. **Plugins**
   - Extensions that hook into editor events, command palettes, and shortcut handlers to adjust behavior or UI themes.
   - *Example:* Custom keybindings, syntax highlighters, exporter tools.

4. **Modules (Application Level)**
   - High-level logic providers that aggregate, index, state-manage, and process local block data to build tailored workflows.
   - **Course Module**: Ingests local course folders/files, builds interactive learning tracks, manages video/text playlists, and saves progression states directly into block metadata.
   - **Project Management Module**: Parses task blocks across the vault to construct Kanban boards, Gantt charts, and resource allocation dashboards.
   - **File Organization Module**: Automates local file sorting, tagging, rule-based archiving, and metadata management.

---

## 🚀 Getting Started

```
crates/bw-core       Rust core: block model on yrs, SQLite update log (truth), rebuildable SQL index
crates/bw-api        the command surface the frontend uses (shared by Tauri and the dev server)
crates/bw-devserver  bw-api over HTTP, so the UI can run in a browser during development
packages/editor      @brainwaves/editor: the Tiptap block engine (schema, nodes, menus)
apps/desktop         the BrainWaves desktop app (Tauri + React)
docs/                architecture.md (the plan), spike-01-block-model.md, phase-02-editor.md
```

**Windows, from scratch:** double-click `scripts\install-windows.cmd`. It installs everything
that's missing (Git, the C++ build tools, WebView2, Rust, Node.js, pnpm), installs the
project's packages and compiles it once. Options: `-Run` starts the app afterwards, `-Build`
builds the installer, `-Check` runs the tests.

```powershell
scripts\install-windows.cmd -Run
```

**Already have the tools:**

```bash
pnpm install
cargo test --workspace && pnpm -r test     # tests
cd apps/desktop && pnpm tauri dev          # desktop app
```

See `apps/desktop/README.md` for running the UI in a browser.
