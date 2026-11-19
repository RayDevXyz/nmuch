import { useEffect, useState } from 'react'
import { refreshModules } from '../modules/api'
import { ChevronDown, CircleHelp, Download, FilePlus2, HardDrive, Moon, Palette, Search, Settings, Sparkles, Star, Sun, Blocks, Puzzle } from 'lucide-react'
import { createPage, setView } from '../state/actions'
import { getState, setState, useApp } from '../state/store'
import { db } from '../lib/storage'
import { MenuList, Popover } from './Popover'
import { activeTheme, BUILTIN } from '../theme/themes'

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

function SettingsPanel({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
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
    <Popover x={x} y={y} onClose={onClose} className="settings-pop">
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
      <div className="setting-storage">
        <HardDrive size={13} />
        <div>
          <strong>{kind === 'sqlite' ? 'Yjs log + index · SQLite' : 'Dev server · SQLite'}</strong>
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

export function TopBar() {
  const kind = useApp((s) => s.storageKind)
  const theme = useApp((s) => s.theme)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [settings, setSettings] = useState<{ x: number; y: number } | null>(null)
  return (
    <header className="topbar">
      <div className="brand-area">
        <button
          className="brand-trigger"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom })
          }}
        >
          <span className="brand-mark" aria-hidden>
            <Sparkles size={15} />
          </span>
          <span className="brand-name">BrainWaves</span>
          <ChevronDown size={14} className="muted-icon" />
        </button>
      </div>
      <div className="top-actions">
        <IconButton label="Quick find (Ctrl K)" onClick={() => setState({ quickFind: true })}>
          <Search />
        </IconButton>
        <IconButton label="Favorites" onClick={() => setView('favorites')}>
          <Star />
        </IconButton>
        <IconButton
          label="Settings"
          active={!!settings}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setSettings({ x: r.right - 280, y: r.bottom })
          }}
        >
          <Settings />
        </IconButton>
        <span className="storage-chip" title={kind === 'sqlite' ? 'Every edit is a Yjs update in a local SQLite file' : 'Running in a browser against bw-devserver'}>
          <span className="dot" />
          {kind === 'sqlite' ? 'Local · SQLite' : 'Dev · SQLite'}
        </span>
      </div>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuList
            onDone={() => setMenu(null)}
            items={[
              { label: 'New page', icon: <FilePlus2 size={14} />, hint: 'Ctrl N', onSelect: () => createPage() },
              { label: 'Quick find', icon: <Search size={14} />, hint: 'Ctrl K', onSelect: () => setState({ quickFind: true }) },
              'sep',
              {
                label: theme === 'dark' ? 'Light theme' : 'Dark theme',
                icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
                onSelect: () => setState({ theme: getState().theme === 'dark' ? 'light' : 'dark' }),
              },
              { label: 'Theme editor', icon: <Palette size={14} />, onSelect: () => setState({ themeEditor: true }) },
              { label: 'Keyboard shortcuts', icon: <CircleHelp size={14} />, hint: 'Ctrl /', onSelect: () => setState({ help: true }) },
            ]}
          />
        </Popover>
      )}
      {settings && <SettingsPanel x={settings.x} y={settings.y} onClose={() => setSettings(null)} />}
    </header>
  )
}
