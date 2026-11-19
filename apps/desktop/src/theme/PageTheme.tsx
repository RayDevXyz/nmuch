import { Check, CornerLeftUp, Palette, PaintBucket } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { updatePage } from '../state/actions'
import { setState, useApp } from '../state/store'
import type { Page } from '../lib/types'
import { BUILTIN, findTheme, themeVars, type ThemeDef } from './themes'
import { Popover } from '../components/Popover'

/**
 * A page's own theme: a property of the page (`theme`), shown in the page header. Sub-pages
 * (and a database's rows) follow it unless they pick their own; "App theme" stops that.
 */

const APP = 'app'

/** The theme a page shows in, and the page it comes from (itself or an ancestor). Null: the app's. */
export function resolvePageTheme(pageId: string, pages: Record<string, Page>, custom: ThemeDef[]): { theme: ThemeDef; from: string } | null {
  let id: string | null = pageId
  for (let depth = 0; id && depth < 32; depth++) {
    const p: Page | undefined = pages[id]
    if (!p) return null
    const t = p.theme ?? ''
    if (t === APP) return null
    if (t) {
      const theme = findTheme(t, custom)
      if (theme) return { theme, from: id }
    }
    id = p.parentId ?? p.databaseId ?? null
  }
  return null
}

/** The CSS variables for a page's theme, or nothing when it uses the app's. */
export function usePageThemeStyle(pageId: string | null): { style?: React.CSSProperties; theme?: ThemeDef } {
  const pages = useApp((s) => s.pages)
  const custom = useApp((s) => s.themes)
  if (!pageId) return {}
  const r = resolvePageTheme(pageId, pages, custom)
  return r ? { style: themeVars(r.theme) as React.CSSProperties, theme: r.theme } : {}
}

/** Ask the open page's theme chip to show its menu (from the page's ⋯ menu). */
export const openPageThemeMenu = () => window.dispatchEvent(new CustomEvent('bw-page-theme-menu'))

/** The page header's Theme property: what the page shows in, and a menu to change it. */
export function PageThemeChip({ page }: { page: Page }) {
  const pages = useApp((s) => s.pages)
  const custom = useApp((s) => s.themes)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const r = resolvePageTheme(page.id, pages, custom)
  const own = page.theme ?? ''
  const inherited = r && r.from !== page.id ? pages[r.from] : null
  useEffect(() => {
    const open = () => {
      const b = btn.current?.getBoundingClientRect()
      if (b) setMenu({ x: b.left, y: b.bottom + 4 })
    }
    window.addEventListener('bw-page-theme-menu', open)
    return () => window.removeEventListener('bw-page-theme-menu', open)
  }, [])
  const set = (theme: string) => {
    updatePage(page.id, { theme })
    setMenu(null)
  }
  const all = [...BUILTIN, ...custom]
  const row = (t: ThemeDef) => (
    <button key={t.id} className={`pt-item ${own === t.id ? 'on' : ''}`} onClick={() => set(t.id)}>
      <span className="pt-swatch" style={{ background: t.colors.editorBg, borderColor: t.colors.line }}>
        <i style={{ background: t.colors.accent }} />
        <i style={{ background: t.colors.foreground }} />
      </span>
      <span className="pt-name">{t.name}</span>
      {own === t.id && <Check size={13} />}
    </button>
  )
  return (
    <>
      <button
        ref={btn}
        className={`page-prop ${r ? 'set' : ''}`}
        title="The page's theme (its sub-pages follow it)"
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: b.left, y: b.bottom + 4 })
        }}
      >
        <Palette size={13} />
        {r ? (
          <>
            <span>{r.theme.name}</span>
            {inherited && <small>from {inherited.title || 'Untitled'}</small>}
          </>
        ) : (
          <span>Theme</span>
        )}
      </button>
      {menu && (
        <Popover x={menu.x} y={menu.y} onClose={() => setMenu(null)} className="pt-pop">
          <div className="pt-title">Page theme</div>
          <button className={`pt-item ${own === '' ? 'on' : ''}`} onClick={() => set('')}>
            <span className="pt-icon">
              <CornerLeftUp size={14} />
            </span>
            <span className="pt-name">
              Follow {page.parentId || page.databaseId ? 'the parent page' : 'the app'}
              {own === '' && inherited ? <small> · {r?.theme.name}</small> : null}
            </span>
            {own === '' && <Check size={13} />}
          </button>
          <button className={`pt-item ${own === APP ? 'on' : ''}`} onClick={() => set(APP)}>
            <span className="pt-icon">
              <PaintBucket size={14} />
            </span>
            <span className="pt-name">App theme</span>
            {own === APP && <Check size={13} />}
          </button>
          <div className="pt-sep">Dark</div>
          {all.filter((t) => t.base === 'dark').map(row)}
          <div className="pt-sep">Light</div>
          {all.filter((t) => t.base === 'light').map(row)}
          <button
            className="pt-item edit"
            onClick={() => {
              setMenu(null)
              setState({ themeEditor: true })
            }}
          >
            <span className="pt-icon">
              <Palette size={14} />
            </span>
            <span className="pt-name">Make or edit themes…</span>
          </button>
        </Popover>
      )}
    </>
  )
}
