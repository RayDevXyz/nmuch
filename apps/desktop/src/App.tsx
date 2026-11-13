import { useEffect } from 'react'
import { PanelRight } from 'lucide-react'
import { closeTab, createPage, init } from './state/actions'
import { getState, setState, useApp } from './state/store'
import { TopBar } from './components/TopBar'
import { LeftRail } from './components/LeftRail'
import { Sidebar } from './components/Sidebar'
import { EditorPanel } from './components/EditorPanel'
import { RightPanel } from './components/RightPanel'
import { QuickFind } from './components/QuickFind'
import { HelpModal } from './components/HelpModal'
import { ImportDialog } from './components/ImportDialog'
import { WidgetsDialog } from './widgets/WidgetsDialog'
import { ModulesDialog } from './modules/ModulesDialog'
import { CompendiumHost, openCompendium } from './dnd/Compendium'

export default function App() {
  const ready = useApp((s) => s.ready)
  const theme = useApp((s) => s.theme)
  const fontSize = useApp((s) => s.fontSize)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const rightOpen = useApp((s) => s.rightOpen)
  const quickFind = useApp((s) => s.quickFind)
  const help = useApp((s) => s.help)
  const importDialog = useApp((s) => s.importDialog)
  const widgetsDialog = useApp((s) => s.widgetsDialog)
  const modulesDialog = useApp((s) => s.modulesDialog)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    init().catch((e) => {
      console.error(e)
      setState({ ready: true, saveError: String(e), save: 'error' })
    })
  }, [])

  useEffect(() => {
    document.documentElement.style.colorScheme = theme
    document.body.style.background = theme === 'dark' ? '#111214' : '#f3f1f7'
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      const s = getState()
      if (k === 'k' || k === 'p') {
        e.preventDefault()
        setState({ quickFind: !s.quickFind })
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault()
        createPage({ open: 'tab' })
      } else if (e.code === 'Backslash') {
        e.preventDefault()
        if (e.shiftKey) setState({ rightOpen: !s.rightOpen })
        else setState({ sidebarOpen: !s.sidebarOpen })
      } else if (k === '/' && !e.shiftKey) {
        e.preventDefault()
        setState({ help: !s.help })
      } else if (k === 'd' && e.shiftKey) {
        e.preventDefault()
        openCompendium()
      } else if (k === 'e' && e.shiftKey) {
        const page = s.activeId ? s.pages[s.activeId] : undefined
        if (page && page.kind !== 'database') {
          e.preventDefault()
          setState({ edgeless: { ...s.edgeless, [page.id]: !s.edgeless[page.id] } })
        }
      } else if (k === 'w') {
        if (s.activeId) {
          e.preventDefault()
          closeTab(s.activeId)
        }
      } else if (e.key === 'Tab') {
        if (s.tabs.length > 1 && s.activeId) {
          e.preventDefault()
          const i = s.tabs.indexOf(s.activeId)
          const n = (i + (e.shiftKey ? -1 : 1) + s.tabs.length) % s.tabs.length
          setState({ activeId: s.tabs[n] })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className={`workspace theme-${theme} fs-${fontSize}`}>
      <TopBar />
      <div className="app-shell">
        <LeftRail />
        {sidebarOpen && <Sidebar />}
        {ready ? (
          <EditorPanel />
        ) : (
          <section className="editor-panel loading">
            <div className="empty-state">
              <div className="empty-mark spin">✦</div>
              <p>Opening your notes…</p>
            </div>
          </section>
        )}
        {rightOpen && <RightPanel />}
        {!rightOpen && (
          <button className="expand-right" aria-label="Open graph panel" title="Open graph panel (Ctrl Shift \)" onClick={() => setState({ rightOpen: true })}>
            <PanelRight />
          </button>
        )}
      </div>
      {quickFind && <QuickFind />}
      {help && <HelpModal />}
      {importDialog && <ImportDialog />}
      {widgetsDialog && <WidgetsDialog />}
      {modulesDialog && <ModulesDialog />}
      <CompendiumHost />
      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
