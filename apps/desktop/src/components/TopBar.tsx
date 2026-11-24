import { tabKey } from '../lib/storage'
import { useEffect, useState } from 'react'
import { refreshModules } from '../modules/api'
import { CircleHelp, Clock3, GraduationCap, Download, FilePlus2, FileStack, HardDrive, KeyRound, Moon, Palette, Smartphone, Search, Sun, Blocks, Puzzle, RefreshCw } from 'lucide-react'
import { createPage, setView } from '../state/actions'
import { getState, setState, useApp } from '../state/store'
import { db } from '../lib/storage'
import { MenuList, Popover } from './Popover'
import { activeTheme, BUILTIN } from '../theme/themes'
import { AccountDialog } from '../auth/Account'
import { openTemplateDialog } from '../templates/TemplateDialog'
import { hostedUser } from '../state/hosted'
import { useInstall } from '../mobile/pwa'
import { learnBrainWaves } from '../course/learn'

export function IconButton({ children, label, active, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button aria-label={label} title={label} className={`icon-button ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function SettingsPanel({ x, y, anchorTop, onClose, onAccount }: { x: number; y: number; anchorTop?: number; onClose: () => void; onAccount: () => void }) {
  const theme = useApp((s) => s.theme)
  const themes = useApp((s) => s.themes)
  const themeFor = useApp((s) => s.themeFor)
  const width = useApp((s) => s.width)
  const fontSize = useApp((s) => s.fontSize)
  const spellcheck = useApp((s) => s.spellcheck)
  const kind = useApp((s) => s.storageKind)
  const [loc, setLoc] = useState('')
  useEffect(() => {
    db().location().then(setLoc).catch(() => setLoc(''))
  }, [])
  return (
    <Popover x={x} y={y} anchorTop={anchorTop} onClose={onClose} className="settings-pop">
      <div className="settings-title">Settings</div>
      <div className="setting-row">
        <span>Theme</span>
        <Seg value={theme} options={[['dark', 'Dark'], ['light', 'Light']]} onChange={(v) => setState({ theme: v })} />
      </div>
      {(['dark', 'light'] as const).map((mode) => (
        <div className="setting-row" key={mode}>
          <span>{mode === 'dark' ? 'Dark theme' : 'Light theme'}</span>
          <select
            className="setting-select"
            aria-label={mode === 'dark' ? 'Dark theme' : 'Light theme'}
            value={activeTheme(mode, themeFor, themes).id}
            onChange={(e) => setState((s) => ({ theme: mode, themeFor: { ...s.themeFor, [mode]: e.target.value } }))}
          >
            {[...BUILTIN, ...themes]
              .filter((t) => t.base === mode)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
      ))}
      <button
        className="setting-action"
        onClick={() => {
          onClose()
          setState({ themeEditor: true })
        }}
      >
        <Palette size={13} /> Theme editor…
      </button>
      <div className="setting-row">
        <span>Page width</span>
        <Seg value={width} options={[['normal', 'Normal'], ['wide', 'Wide']]} onChange={(v) => setState({ width: v })} />
      </div>
      <div className="setting-row">
        <span>Text size</span>
        <Seg value={fontSize} options={[['small', 'S'], ['normal', 'M'], ['large', 'L']]} onChange={(v) => setState({ fontSize: v })} />
      </div>
      <div className="setting-row">
        <span>Spellcheck</span>
        <Seg value={spellcheck ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']]} onChange={(v) => setState({ spellcheck: v === 'on' })} />
      </div>
      {hostedUser() && (
        <button
          className="setting-action"
          onClick={() => {
            onClose()
            onAccount()
          }}
        >
          <KeyRound size={13} /> Account and API tokens…
        </button>
      )}
      {!hostedUser() && (
        <button
          className="setting-action"
          onClick={() => {
            onClose()
            setState({ syncDialog: true })
          }}
        >
          <RefreshCw size={13} /> Sync with a server…
        </button>
      )}
      <div className="setting-storage">
        <HardDrive size={13} />
        <div>
          <strong>{kind === 'sqlite' ? 'Yjs log + index · SQLite' : hostedUser() ? 'Hosted · SQLite on the server' : 'Dev server · SQLite'}</strong>
          <span title={loc}>{loc || '…'}</span>
        </div>
      </div>
      <button
        className="setting-action"
        onClick={() => {
          onClose()
          setState({ importDialog: true })
        }}
      >
        <Download size={13} /> Import from Nimbus…
      </button>
      <button
        className="setting-action"
        onClick={() => {
          onClose()
          setState({ widgetsDialog: true })
        }}
      >
        <Blocks size={13} /> Widgets…
      </button>
      <button
        className="setting-action"
        onClick={() => {
          onClose()
          void refreshModules()
          setState({ modulesDialog: true })
        }}
      >
        <Puzzle size={13} /> Modules…
      </button>
    </Popover>
  )
}

/** The app menu, opened from the app icon at the top of the left rail. */
export function AppMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const theme = useApp((s) => s.theme)
  const { canInstall, install } = useInstall()
  return (
    <Popover x={x} y={y} onClose={onClose}>
      <MenuList
        onDone={onClose}
        items={[
          { label: 'New page', icon: <FilePlus2 size={14} />, hint: tabKey('N'), onSelect: () => createPage() },
          { label: 'New page from template…', icon: <FileStack size={14} />, hint: tabKey('Shift N'), onSelect: () => openTemplateDialog({ parentId: null }) },
          { label: 'Quick find', icon: <Search size={14} />, hint: 'Ctrl K', onSelect: () => setState({ quickFind: true }) },
          { label: 'Recent pages', icon: <Clock3 size={14} />, onSelect: () => setView('recent') },
          { label: 'Learn BrainWaves', icon: <GraduationCap size={14} />, onSelect: () => void learnBrainWaves() },
          'sep',
          {
            label: theme === 'dark' ? 'Light theme' : 'Dark theme',
            icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
            onSelect: () => setState({ theme: getState().theme === 'dark' ? 'light' : 'dark' }),
          },
          { label: 'Theme editor', icon: <Palette size={14} />, onSelect: () => setState({ themeEditor: true }) },
          ...(canInstall ? [{ label: 'Install app', icon: <Smartphone size={14} />, onSelect: () => void install() }] : []),
          { label: 'Keyboard shortcuts', icon: <CircleHelp size={14} />, hint: 'Ctrl /', onSelect: () => setState({ help: true }) },
        ]}
      />
    </Popover>
  )
}

/**
 * The Settings panel. The account dialog it opens lives with the app (the panel closes as the
 * dialog opens, so the dialog can't belong to it).
 */
export function SettingsHost({ at, onClose }: { at: { x: number; y: number; anchorTop?: number }; onClose: () => void }) {
  return <SettingsPanel x={at.x} y={at.y} anchorTop={at.anchorTop} onClose={onClose} onAccount={() => setState({ accountDialog: true })} />
}

/** The hosted account dialog, when it's open. */
export function AccountHost() {
  const open = useApp((s) => s.accountDialog)
  const user = hostedUser()
  return open && user ? <AccountDialog user={user} onClose={() => setState({ accountDialog: false })} /> : null
}
