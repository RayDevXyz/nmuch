import { useEffect, useMemo, useState } from 'react'
import { closeTab, createPage, init, openPage } from './state/actions'
import { getState, setState, useApp } from './state/store'
import { LeftRail } from './components/LeftRail'
import { Sidebar } from './components/Sidebar'
import { EditorPanel } from './components/EditorPanel'
import { RightPanel } from './components/RightPanel'
import { QuickFind } from './components/QuickFind'
import { HelpModal } from './components/HelpModal'
import { SyncDialog } from './sync/SyncDialog'
import { AccountHost } from './components/TopBar'
import { openTemplateDialog, TemplateDialog } from './templates/TemplateDialog'
import { CalloutStyleMenu } from './callouts/CalloutStyle'
import { LinkDatabaseDialog } from './database/LinkDatabase'
import { ImportDialog } from './components/ImportDialog'
import { WidgetsDialog } from './widgets/WidgetsDialog'
import { ModulesDialog } from './modules/ModulesDialog'
import { ParaDialogs } from './para/ParaDialogs'
import { PublishHost } from './dnd/PublishDialog'
import { CompendiumHost, openCompendium } from './dnd/Compendium'
import { CharacterWizardHost } from './dnd/CharacterWizard'
import { getRoles, showsCanvas } from './dnd/api'
import { AzgaarImportHost } from './dnd/AzgaarImport'
import { activeTheme, themeVars as themeVarsOf } from './theme/themes'
import { ThemeEditorHost } from './theme/ThemeEditor'
import { BurrowPickerHost } from './burrow/Burrow'
import { SaveToBurrowHost } from './burrow/Save'
import { flushShares, inboxPage, readShare, ShareSheet } from './mobile/share'
import { isNarrow, useNarrow } from './mobile/narrow'
import { MobileBottom } from './mobile/MobileChrome'

export default function App() {
  const ready = useApp((s) => s.ready)
  // Phones: the sidebar is a drawer over the page; it closes once a page is open.
  const narrow = useNarrow()
  const activeId = useApp((s) => s.activeId)
  useEffect(() => {
    if (narrow) setState({ rightOpen: false })
  }, [narrow])
  useEffect(() => {
    if (isNarrow()) setState({ sidebarOpen: false })
  }, [activeId])
  // Shared from another app (Android's share menu), and the home-screen shortcuts.
  const [shared, setShared] = useState(readShare)
  useEffect(() => {
    if (!ready) return
    void flushShares()
    const q = new URLSearchParams(location.search)
    if (q.has('new') || q.has('inbox')) {
      history.replaceState(null, '', '/')
      if (q.has('new')) void createPage()
      else void inboxPage().then((id) => openPage(id, 'replace'))
    }
  }, [ready])
  // A #/p/<id> link (from Burrow, a bookmark, another app) opens that page.
  useEffect(() => {
    if (!ready) return
    const openLinked = () => {
      const m = location.hash.match(/^#\/p\/([\w-]{6,64})$/)
      if (!m) return
      history.replaceState(null, '', location.pathname + location.search)
      if (getState().pages[m[1]]) openPage(m[1], 'replace')
      else setState({ toast: "That page isn't in this BrainWaves" })
    }
    openLinked()
    window.addEventListener('hashchange', openLinked)
    return () => window.removeEventListener('hashchange', openLinked)
  }, [ready])
  const theme = useApp((s) => s.theme)
  // The theme this mode uses, as CSS variables on the workspace (and the window behind it).
  const themes = useApp((s) => s.themes)
  const themeFor = useApp((s) => s.themeFor)
  const themeStyle = useMemo(() => themeVarsOf(activeTheme(theme, themeFor, themes)) as React.CSSProperties, [theme, themeFor, themes])
  useEffect(() => void (document.body.style.background = String((themeStyle as Record<string, string>)['--app-bg'] ?? '')), [themeStyle])
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
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A browser keeps Ctrl N, Ctrl W and Ctrl Tab for itself (no web page gets them), so the
      // tab and page shortcuts also work with Alt: Alt N, Alt Shift N, Alt W, Alt ] and Alt [.
      if (e.altKey && !e.ctrlKey && !e.metaKey && altShortcut(e)) return
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
      } else if (k === 'n' && e.shiftKey) {
        // Ctrl+Shift+N: a new page from a template.
        e.preventDefault()
        openTemplateDialog({ parentId: null })
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
          setState({ edgeless: { ...s.edgeless, [page.id]: !showsCanvas(page.id, s.edgeless, getRoles()) } })
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

  /** Alt versions of the shortcuts a browser keeps (matched by key position, so Option works on a Mac). */
  function altShortcut(e: KeyboardEvent): boolean {
    const s = getState()
    const next = (by: number) => {
      if (s.tabs.length < 2 || !s.activeId) return
      const i = s.tabs.indexOf(s.activeId)
      setState({ activeId: s.tabs[(i + by + s.tabs.length) % s.tabs.length] })
    }
    switch (e.code) {
      case 'KeyN':
        if (e.shiftKey) openTemplateDialog({ parentId: null })
        else createPage({ open: 'tab' })
        break
      case 'KeyW':
        if (!s.activeId) return false
        closeTab(s.activeId)
        break
      case 'BracketRight':
        next(1)
        break
      case 'BracketLeft':
        next(-1)
        break
      default:
        return false
    }
    e.preventDefault()
    e.stopPropagation()
    return true
  }

  return (
    <main className={`workspace theme-${theme} fs-${fontSize} ${narrow ? 'is-narrow' : ''}`} style={themeStyle}>
      <div className="app-shell">
        {!narrow && <LeftRail />}
        {sidebarOpen && <Sidebar />}
        {narrow && sidebarOpen && <div className="drawer-scrim" onClick={() => setState({ sidebarOpen: false })} />}
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
      </div>
      {narrow && ready && <MobileBottom />}
      {quickFind && <QuickFind />}
      {help && <HelpModal />}
      {importDialog && <ImportDialog />}
      <SyncDialog />
      <AccountHost />
      <TemplateDialog />
      <ParaDialogs />
      <PublishHost />
      <CalloutStyleMenu />
      <LinkDatabaseDialog />
      {widgetsDialog && <WidgetsDialog />}
      {modulesDialog && <ModulesDialog />}
      <CompendiumHost />
      <CharacterWizardHost />
      <AzgaarImportHost />
      <ThemeEditorHost />
      {ready && shared && <ShareSheet shared={shared} done={() => setShared(null)} />}
      <BurrowPickerHost />
      <SaveToBurrowHost />
      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
