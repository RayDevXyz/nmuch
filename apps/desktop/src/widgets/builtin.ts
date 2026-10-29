import chart from './builtin/chart.html?raw'
import courseDashboard from './builtin/course-dashboard.html?raw'
import progress from './builtin/progress.html?raw'
import quickAdd from './builtin/quick-add.html?raw'
import { installWidget, listWidgets, loadWidget, refreshWidgets, type Manifest } from './api'
import { manifestFromHtml } from './runtime'

/** The widgets that ship with the app. Each is one HTML file with its manifest inside. */
const BUILTIN = [progress, quickAdd, chart, courseDashboard]

/**
 * Install (or update) the built-in widgets in the core, then load the list the slash menu and
 * the widgets manager show. A built-in is reinstalled when its version changes.
 */
export async function registerBuiltinWidgets() {
  const have = new Map((await listWidgets()).map((w) => [w.manifest.id, w]))
  for (const html of BUILTIN) {
    const manifest = manifestFromHtml(html) as Manifest
    const old = have.get(manifest.id)
    if (old && old.builtin && old.manifest.version === manifest.version) continue
    await installWidget(manifest, html, true)
    void loadWidget(manifest.id, true)
  }
  await refreshWidgets()
}
