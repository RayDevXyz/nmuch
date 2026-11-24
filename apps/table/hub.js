// BrainWaves table: the players' hub around the battle map. Four tabs:
//   Table      the battle map (table.js)
//   Journal    pages the DM published from BrainWaves: expedition logs, the story so far, handouts
//   Compendium the player-facing part of the DM's 5etools (spells, items, races, classes,
//              backgrounds, feats, conditions), published from BrainWaves; no monsters
//   Characters your own characters, read-only sheets, and building new ones (characters.js)
// Plain JavaScript, no build step, served by bw-table.
;(() => {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const room = () => (location.pathname.match(/^\/join\/([A-Za-z0-9]+)/) || [])[1] || ''

  // ---------------------------------------------------------------- tabs

  const TABS = ['table', 'journal', 'compendium', 'characters']
  let tab = 'table'
  function show(t, push = true) {
    if (!TABS.includes(t)) t = 'table'
    tab = t
    $('table').className = `screen view-${t}`
    for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === t)
    for (const v of document.querySelectorAll('.hub-view')) v.hidden = v.id !== `view-${t}`
    if (t === 'journal') { unread = false; badge() ; if (!opened && journal.length) openPage(defaultPage()) }
    if (t === 'compendium') loadCompendium()
    if (t === 'table') window.dispatchEvent(new Event('resize'))
    if (push && location.hash !== `#${t}`) history.replaceState(null, '', t === 'table' ? location.pathname : `#${t}`)
  }
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => show(b.dataset.tab))
  window.addEventListener('hashchange', () => show(location.hash.slice(1), false))

  // ---------------------------------------------------------------- messages

  let journal = []
  let comp = null // { publishedAt, sources, counts }
  let unread = false
  let opened = null

  function onMessage(m) {
    if (m.t === 'welcome') {
      journal = m.journal || []
      comp = m.compendium || null
      renderJournal()
      renderCompMeta()
      if (location.hash) show(location.hash.slice(1), false)
    } else if (m.t === 'journal') {
      const before = new Set(journal.map((p) => `${p.id}@${p.updated}`))
      journal = m.journal || []
      const fresh = journal.filter((p) => !before.has(`${p.id}@${p.updated}`))
      if (fresh.length && tab !== 'journal') {
        unread = true
        window.bwTable?.toast(`New in the journal: ${fresh[0].title}`)
      }
      renderJournal()
      if (opened && fresh.some((p) => p.id === opened)) openPage(opened)
      if (opened && !journal.some((p) => p.id === opened)) { opened = null; $('journal-page').innerHTML = emptyPage() }
    } else if (m.t === 'compendium') {
      comp = m.compendium || null
      cache.clear()
      renderCompMeta()
      if (tab === 'compendium') loadCompendium()
      if (comp) window.bwTable?.toast('The compendium was updated')
    }
    badge()
  }
  function badge() {
    $('tab-journal-dot').hidden = !unread
  }

  // ---------------------------------------------------------------- journal

  const KIND = { story: 'The story so far', log: 'Expedition logs', page: 'Handouts & pages' }
  const day = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const defaultPage = () => (journal.find((p) => p.kind === 'story') || [...journal].sort((a, b) => b.published - a.published)[0] || {}).id

  function renderJournal() {
    const box = $('journal-list')
    if (!journal.length) {
      box.innerHTML = `<p class="muted">Nothing published yet. Your DM publishes expedition logs and the story so far from BrainWaves; they show up here.</p>`
      $('journal-page').innerHTML = emptyPage()
      return
    }
    let html = ''
    for (const kind of ['story', 'log', 'page']) {
      const list = journal.filter((p) => p.kind === kind).sort((a, b) => b.published - a.published)
      if (!list.length) continue
      html += `<h3>${KIND[kind]}</h3><ul>`
      for (const p of list)
        html += `<li><button class="jl-item ${opened === p.id ? 'on' : ''}" data-page="${esc(p.id)}"><span class="jl-icon">${esc(p.icon || (kind === 'log' ? '📜' : kind === 'story' ? '🗺' : '📄'))}</span><span class="jl-title">${esc(p.title || 'Untitled')}</span><small>${day(p.published)}${p.updated - p.published > 60000 ? ' · updated' : ''}</small></button></li>`
      html += `</ul>`
    }
    box.innerHTML = html
    for (const b of box.querySelectorAll('[data-page]')) b.onclick = () => openPage(b.dataset.page)
  }
  const emptyPage = () => `<div class="jp-empty">📜<p>Choose a page to read it.</p></div>`

  async function openPage(id) {
    if (!id) return
    opened = id
    renderJournal()
    const box = $('journal-page')
    box.innerHTML = `<p class="muted">Opening…</p>`
    try {
      const r = await fetch(`/api/rooms/${room()}/journal/${encodeURIComponent(id)}`)
      if (!r.ok) throw new Error()
      const p = await r.json()
      box.innerHTML = `<article class="jp"><header><span class="jp-kind">${esc(KIND[p.kind] || '')}</span><h2>${esc(p.icon ? p.icon + ' ' : '')}${esc(p.title || 'Untitled')}</h2><small>${day(p.published)}${p.updated - p.published > 60000 ? ` · updated ${day(p.updated)}` : ''}</small></header><div class="jp-body">${sanitize(p.html || '')}</div></article>`
      box.scrollTop = 0
      document.body.classList.add('reading')
    } catch {
      box.innerHTML = `<p class="muted">This page isn't on the table any more.</p>`
    }
  }
  $('journal-back').onclick = () => document.body.classList.remove('reading')

  /** Keep only harmless HTML: the DM's text, never scripts or event handlers. */
  const OK_TAGS = new Set('p h1 h2 h3 h4 h5 h6 strong b em i u s code pre blockquote ul ol li br hr a img table thead tbody tr th td figure figcaption div span mark sub sup label input'.split(' '))
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const walk = (el) => {
      for (const c of [...el.children]) {
        const tag = c.tagName.toLowerCase()
        if (!OK_TAGS.has(tag)) {
          c.replaceWith(...[...c.childNodes])
          continue
        }
        for (const a of [...c.attributes]) {
          const n = a.name.toLowerCase()
          const keep =
            n === 'class' || n === 'colspan' || n === 'rowspan' || n === 'alt' ||
            n.startsWith('data-') ||
            (n === 'href' && /^(https?:|mailto:)/i.test(a.value)) ||
            (n === 'src' && tag === 'img' && /^(data:image\/|https?:)/i.test(a.value)) ||
            ((n === 'type' || n === 'checked' || n === 'disabled') && tag === 'input')
          if (!keep) c.removeAttribute(a.name)
        }
        if (tag === 'a' && c.getAttribute('href')) c.setAttribute('target', '_blank'), c.setAttribute('rel', 'noopener noreferrer')
        if (tag === 'input') {
          if (c.getAttribute('type') !== 'checkbox') { c.remove(); continue }
          c.setAttribute('disabled', '')
        }
        walk(c)
      }
    }
    const root = doc.body.firstElementChild
    walk(root)
    return root.innerHTML
  }

  // Links into the compendium (5e cards in a page, spells on a sheet).
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.hub-ref, a[data-ref-cat]')
    if (!a) return
    e.preventDefault()
    openRef({ cat: a.dataset.cat || a.dataset.refCat, name: a.dataset.name || a.dataset.refName, source: a.dataset.source || '' })
  })

  // ---------------------------------------------------------------- compendium

  const CATS = [
    { id: 'spell', label: 'Spells', icon: '✨' },
    { id: 'item', label: 'Items', icon: '⚔' },
    { id: 'race', label: 'Races', icon: '🧝' },
    { id: 'class', label: 'Classes', icon: '🛡' },
    { id: 'background', label: 'Backgrounds', icon: '📜' },
    { id: 'feat', label: 'Feats', icon: '★' },
    { id: 'condition', label: 'Conditions', icon: '☠' },
  ]
  const cache = new Map() // cat -> Promise<entries[]>
  let compCats = []
  let compQ = ''
  let stack = []

  function category(cat) {
    if (!cache.has(cat)) {
      const p = fetch(`/api/rooms/${room()}/compendium/${cat}?v=${comp?.publishedAt || 0}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x.name === 'string').map((raw) => ({ cat, name: raw.name, source: String(raw.source || ''), raw })).sort((a, b) => a.name.localeCompare(b.name)))
        .catch(() => [])
      cache.set(cat, p)
    }
    return cache.get(cat)
  }
  const available = () => CATS.filter((c) => comp?.counts?.[c.id] > 0)

  function renderCompMeta() {
    const has = available()
    $('comp-chips').innerHTML = has.map((c) => `<button class="chip ${compCats.includes(c.id) ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${c.label} <small>${comp.counts[c.id]}</small></button>`).join('')
    for (const b of $('comp-chips').querySelectorAll('[data-cat]'))
      b.onclick = () => {
        const c = b.dataset.cat
        compCats = compCats.length === 1 && compCats[0] === c ? [] : [c]
        renderCompMeta()
        search()
      }
    $('comp-empty').hidden = !!comp
    $('comp-main').hidden = !comp
    $('comp-sources').textContent = comp ? `From ${comp.sources.length} book${comp.sources.length === 1 ? '' : 's'}: ${comp.sources.slice(0, 16).join(', ')}${comp.sources.length > 16 ? '…' : ''}` : ''
  }

  let searchTimer
  $('comp-q').addEventListener('input', (e) => {
    compQ = e.target.value
    clearTimeout(searchTimer)
    searchTimer = setTimeout(search, 120)
  })
  function loadCompendium() {
    renderCompMeta()
    if (comp) search()
  }
  let seq = 0
  async function search() {
    if (!comp) return
    const n = ++seq
    const cats = (compCats.length ? compCats : available().map((c) => c.id))
    $('comp-results').innerHTML = `<li class="muted">Loading…</li>`
    const lists = await Promise.all(cats.map(category))
    if (n !== seq) return
    const q = compQ.trim().toLowerCase()
    let all = lists.flat()
    if (q) {
      const starts = all.filter((e) => e.name.toLowerCase().startsWith(q))
      const has = all.filter((e) => !e.name.toLowerCase().startsWith(q) && e.name.toLowerCase().includes(q))
      all = [...starts, ...has]
    }
    const shown = all.slice(0, 200)
    $('comp-results').innerHTML =
      shown.map((e, i) => `<li><button data-i="${i}" class="${stack.length && stack[stack.length - 1] === e ? 'on' : ''}"><span>${CATS.find((c) => c.id === e.cat).icon}</span><b>${esc(e.name)}</b><small>${esc(meta(e))}</small><em>${esc(e.source)}</em></button></li>`).join('') ||
      `<li class="muted">Nothing found${q ? ` for “${esc(compQ)}”` : ''}.</li>`
    if (all.length > 200) $('comp-results').insertAdjacentHTML('beforeend', `<li class="muted small">${all.length - 200} more: search to narrow it down.</li>`)
    for (const b of $('comp-results').querySelectorAll('[data-i]')) b.onclick = () => openEntry(shown[+b.dataset.i], true)
  }

  async function find(ref) {
    if (!comp || !comp.counts?.[ref.cat]) return null
    const list = await category(ref.cat)
    const name = String(ref.name || '').toLowerCase()
    const same = list.filter((e) => e.name.toLowerCase() === name)
    if (!same.length) return null
    return same.find((e) => ref.source && e.source.toLowerCase() === ref.source.toLowerCase()) || same.sort((a, b) => rank(a.source) - rank(b.source))[0]
  }
  const rank = (s) => { const i = ['xphb', 'phb', 'dmg', 'xdmg'].indexOf(s.toLowerCase()); return i < 0 ? 99 : i }

  async function openRef(ref) {
    const e = await find(ref)
    if (!e) return window.bwTable?.toast(`${ref.name} isn't in the table's compendium`)
    if (tab !== 'compendium') show('compendium')
    openEntry(e, false)
  }

  function openEntry(e, fresh) {
    stack = fresh ? [e] : [...stack, e]
    renderEntry()
    document.body.classList.add('reading')
  }
  function renderEntry() {
    const e = stack[stack.length - 1]
    const box = $('comp-entry')
    if (!e) return (box.innerHTML = `<div class="jp-empty">📖<p>Search, then choose an entry to read it.</p></div>`)
    const back = stack.length > 1 ? `<button class="small" id="comp-back">← ${esc(stack[stack.length - 2].name)}</button>` : ''
    box.innerHTML = `${back}${card(e)}`
    box.scrollTop = 0
    $('comp-back')?.addEventListener('click', () => (stack.pop(), renderEntry()))
    for (const a of box.querySelectorAll('a.fv-link')) a.onclick = (ev) => (ev.preventDefault(), openRef({ cat: a.dataset.cat, name: a.dataset.name, source: a.dataset.source }))
    for (const b of $('comp-results').querySelectorAll('button')) b.classList.remove('on')
  }
  $('comp-close').onclick = () => document.body.classList.remove('reading')

  // ---------------------------------------------------------------- 5etools' entry format, as HTML

  const REF = { spell: 'spell', item: 'item', race: 'race', class: 'class', background: 'background', feat: 'feat', condition: 'condition', disease: 'condition', status: 'condition' }
  const DEF_SRC = { spell: 'PHB', item: 'DMG', race: 'PHB', class: 'PHB', background: 'PHB', feat: 'PHB', condition: 'PHB' }
  const ATK = { mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', 'mw,rw': 'Melee or Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:', m: 'Melee Attack:', r: 'Ranged Attack:' }

  function tokens(text) {
    const out = []
    let i = 0, plain = ''
    while (i < text.length) {
      if (text.startsWith('{@', i)) {
        let depth = 0, j = i
        for (; j < text.length; j++) {
          if (text[j] === '{') depth++
          else if (text[j] === '}' && --depth === 0) break
        }
        if (j >= text.length) break
        if (plain) out.push({ t: plain }), (plain = '')
        const inner = text.slice(i + 2, j)
        const sp = inner.indexOf(' ')
        out.push(sp < 0 ? { tag: inner, body: '' } : { tag: inner.slice(0, sp), body: inner.slice(sp + 1) })
        i = j + 1
      } else plain += text[i++]
    }
    plain += text.slice(i)
    if (plain) out.push({ t: plain })
    return out
  }
  function tagText(tag, body) {
    const p = body.split('|')
    switch (tag) {
      case 'atk': return ATK[body] || 'Attack:'
      case 'h': return 'Hit: '
      case 'hit': return Number(body) >= 0 ? `+${body}` : body
      case 'dc': return `DC ${p[0]}`
      case 'recharge': return body ? `(Recharge ${body}–6)` : '(Recharge 6)'
      case 'chance': return p[1] || `${p[0]} percent`
      case 'scaledamage': case 'scaledice': return p[2] || p[0]
      case 'd20': return p[1] || (/^[+-]?\d+$/.test(p[0]) ? (Number(p[0]) >= 0 ? `+${p[0]}` : p[0]) : p[0])
      case 'filter': return p[0]
      default: return p[2] || p[0]
    }
  }
  const plain = (text) => tokens(String(text)).map((x) => ('t' in x ? x.t : tagText(x.tag, x.body))).join('')
  function inline(text) {
    return tokens(String(text)).map((x) => {
      if ('t' in x) return esc(x.t)
      const { tag, body } = x
      const p = body.split('|')
      switch (tag) {
        case 'b': case 'bold': return `<strong>${inline(body)}</strong>`
        case 'i': case 'italic': return `<em>${inline(body)}</em>`
        case 's': case 'strike': return `<s>${inline(body)}</s>`
        case 'u': case 'underline': return `<u>${inline(body)}</u>`
        case 'note': return `<span class="fv-note">${inline(body)}</span>`
        case 'atk': case 'h': return `<em>${esc(tagText(tag, body))} </em>`
        case 'dice': case 'damage': case 'hit': case 'd20': case 'scaledamage': case 'scaledice': case 'dc': case 'chance': case 'recharge':
          return `<span class="fv-roll">${esc(tagText(tag, body))}</span>`
      }
      const cat = REF[tag]
      if (cat) return `<a href="#" class="fv-link" data-cat="${cat}" data-name="${esc(p[0])}" data-source="${esc(p[1] || DEF_SRC[cat] || '')}">${esc(p[2] || p[0])}</a>`
      if (tag === 'creature') return esc(p[2] || p[0]) // monsters stay with the DM
      return esc(tagText(tag, body))
    }).join('')
  }
  function entries(list, depth = 0) {
    if (list == null) return ''
    return (Array.isArray(list) ? list : [list]).map((e) => entry(e, depth)).join('')
  }
  function entry(e, depth) {
    if (typeof e === 'string') return `<p>${inline(e)}</p>`
    if (typeof e === 'number') return `<p>${e}</p>`
    if (!e || typeof e !== 'object') return ''
    switch (e.type) {
      case 'list':
        return `<ul class="fv-list">${(e.items || []).map((it) => `<li>${typeof it === 'string' ? inline(it) : listItem(it, depth)}</li>`).join('')}</ul>`
      case 'item': case 'itemSub': case 'itemSpell':
        return `<p>${listItem(e, depth)}</p>`
      case 'table':
        return table(e)
      case 'inset': case 'insetReadaloud':
        return `<aside class="fv-inset ${e.type === 'insetReadaloud' ? 'readaloud' : ''}">${e.name ? `<div class="fv-inset-title">${esc(e.name)}</div>` : ''}${entries(e.entries, depth + 1)}</aside>`
      case 'quote':
        return `<blockquote>${entries(e.entries, depth + 1)}${e.by ? `<footer>— ${esc(e.by)}${e.from ? `, ${esc(e.from)}` : ''}</footer>` : ''}</blockquote>`
      case 'abilityDc':
        return `<p class="fv-center"><strong>${esc(e.name)} save DC</strong> = 8 + your proficiency bonus + your ${esc((e.attributes || []).join('/'))} modifier</p>`
      case 'abilityAttackMod':
        return `<p class="fv-center"><strong>${esc(e.name)} attack modifier</strong> = your proficiency bonus + your ${esc((e.attributes || []).join('/'))} modifier</p>`
      case 'link':
        return `<span>${inline(e.text || '')}</span>`
      case 'image': case 'gallery':
        return ''
      default: {
        const h = depth === 0 ? 'h4' : 'h5'
        return `<section>${e.name ? `<${h}>${esc(plain(e.name))}</${h}>` : ''}${entries(e.entries ?? e.entry ?? e.items, depth + 1)}</section>`
      }
    }
  }
  function listItem(it, depth) {
    return `${it.name ? `<strong>${inline(it.name)}</strong> ` : ''}${typeof it.entry === 'string' ? inline(it.entry) : entries(it.entry ?? it.entries, depth + 1)}`
  }
  function cell(c) {
    if (typeof c === 'string') return inline(c)
    if (typeof c === 'number') return String(c)
    if (c && typeof c === 'object') {
      if (c.roll) return esc(c.roll.exact ?? (c.roll.min === c.roll.max ? c.roll.min : `${c.roll.min}–${c.roll.max}`))
      if (c.entry) return inline(c.entry)
      return entries(c)
    }
    return ''
  }
  function table(t) {
    return `<div class="fv-table-wrap"><table class="fv-table">${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}${t.colLabels ? `<thead><tr>${t.colLabels.map((l) => `<th>${inline(l)}</th>`).join('')}</tr></thead>` : ''}<tbody>${(t.rows || []).map((r) => `<tr>${(Array.isArray(r) ? r : r.row || []).map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  }

  // ---- cards: a header line per category, then the entries

  const SCHOOL = { A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment', V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation', P: 'Psionic' }
  const SIZE = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', V: 'Varies' }
  const DMG = { A: 'acid', B: 'bludgeoning', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', P: 'piercing', I: 'poison', Y: 'psychic', R: 'radiant', S: 'slashing', T: 'thunder' }
  const ITEM_TYPE = { M: 'Melee weapon', R: 'Ranged weapon', A: 'Ammunition', LA: 'Light armor', MA: 'Medium armor', HA: 'Heavy armor', S: 'Shield', P: 'Potion', RG: 'Ring', RD: 'Rod', WD: 'Wand', SC: 'Scroll', G: 'Adventuring gear', W: 'Wondrous item', INS: 'Instrument', T: 'Tools', AT: "Artisan's tools", GS: 'Gaming set', MNT: 'Mount', VEH: 'Vehicle', FD: 'Food and drink', TG: 'Trade good', $: 'Treasure' }
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`)
  const lvl = (n) => (n === 0 ? 'Cantrip' : `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} level`)
  const itemType = (r) => (r.wondrous ? 'Wondrous item' : ITEM_TYPE[String(r.type || '').split('|')[0]] || (r.weaponCategory ? `${r.weaponCategory} weapon` : 'Item'))
  const time = (t) => `${t.number} ${t.unit === 'bonus' ? 'bonus action' : t.unit}${t.number > 1 && t.unit !== 'bonus' ? 's' : ''}${t.condition ? `, ${plain(t.condition)}` : ''}`
  function range(r) {
    if (!r) return ''
    const d = r.distance || {}
    if (r.type === 'special') return 'Special'
    const area = ['cone', 'line', 'radius', 'sphere', 'cube', 'hemisphere'].includes(r.type)
    if (['self', 'touch', 'sight', 'unlimited'].includes(d.type)) {
      const base = d.type[0].toUpperCase() + d.type.slice(1)
      return area ? `${base} (${d.amount}-foot ${r.type})` : base
    }
    if (area) return `Self (${d.amount}-${d.type === 'miles' ? 'mile' : 'foot'} ${r.type})`
    return `${d.amount} ${d.type}`
  }
  const components = (c) => (c ? [c.v && 'V', c.s && 'S', c.m && `M (${typeof c.m === 'string' ? c.m : c.m.text})`].filter(Boolean).join(', ') : '')
  function duration(d) {
    if (d.type === 'instant') return 'Instantaneous'
    if (d.type === 'permanent') return 'Until dispelled'
    if (d.type === 'special') return 'Special'
    if (d.type === 'timed') { const n = d.duration?.amount ?? 1; return `${d.concentration ? 'Concentration, up to ' : ''}${n} ${d.duration?.type || ''}${n > 1 ? 's' : ''}` }
    return String(d.type || '')
  }
  function speed(s) {
    if (typeof s === 'number') return `${s} ft.`
    if (!s || typeof s !== 'object') return ''
    return Object.entries(s).filter(([k]) => k !== 'canHover' && k !== 'choose').map(([k, v]) => { const n = typeof v === 'object' ? v.number : v; return k === 'walk' ? `${n} ft.` : `${k} ${n} ft.` }).join(', ')
  }
  const coins = (cp) => (cp >= 100 && cp % 100 === 0 ? `${cp / 100} gp` : cp >= 10 && cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`)
  const asi = (ab) => ab.map((a) => Object.entries(a).filter(([k]) => k !== 'choose').map(([k, v]) => `${k.toUpperCase()} ${signed(Number(v))}`).concat(a.choose ? [`choose ${a.choose.count ?? 1} ${signed(a.choose.amount ?? 1)}`] : []).join(', ')).join('; ')
  const prereq = (p) => p.map((x) => [x.ability?.map((a) => Object.entries(a).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' or ')).join(', '), x.level ? `level ${typeof x.level === 'object' ? x.level.level : x.level}` : '', x.race?.map((r) => r.name).join(' or '), x.spellcasting ? 'the ability to cast at least one spell' : '', x.other].filter(Boolean).join(', ')).join('; or ')

  function meta(e) {
    const r = e.raw
    switch (e.cat) {
      case 'spell': return `${lvl(Number(r.level ?? 0))} ${(SCHOOL[r.school] || '').toLowerCase()}`.trim()
      case 'item': return r.rarity && r.rarity !== 'none' ? r.rarity : itemType(r)
      case 'class': return r.hd ? `d${r.hd.faces}` : ''
      case 'race': return (r.size || []).map((s) => SIZE[s] || s).join('/')
      default: return ''
    }
  }
  function subtitle(e) {
    const r = e.raw
    switch (e.cat) {
      case 'spell': { const l = Number(r.level ?? 0), sc = SCHOOL[r.school] || r.school || ''; return l === 0 ? `${sc} cantrip` : `${lvl(l)} ${sc.toLowerCase()}${r.meta?.ritual ? ' (ritual)' : ''}` }
      case 'item': return [itemType(r), r.rarity && r.rarity !== 'none' ? r.rarity : '', r.reqAttune ? `(requires attunement${typeof r.reqAttune === 'string' ? ' ' + r.reqAttune : ''})` : ''].filter(Boolean).join(', ')
      case 'race': return [(r.size || []).map((s) => SIZE[s] || s).join(' or '), r.parentRace ? `${r.parentRace} subrace` : 'Race'].filter(Boolean).join(' · ')
      case 'class': return r.hd ? `Hit die d${r.hd.faces}` : 'Class'
      case 'feat': return r.prerequisite ? `Prerequisite: ${prereq(r.prerequisite)}` : 'Feat'
      default: return CATS.find((c) => c.id === e.cat)?.label.replace(/s$/, '') || ''
    }
  }
  const prop = (k, v) => (v ? `<div><dt>${esc(k)}</dt><dd>${inline(v)}</dd></div>` : '')
  function body(e) {
    const r = e.raw
    switch (e.cat) {
      case 'spell':
        return `<dl class="fv-props">${prop('Casting time', (r.time || []).map(time).join(' or '))}${prop('Range', range(r.range))}${prop('Components', components(r.components))}${prop('Duration', (r.duration || []).map(duration).join(' or '))}</dl>${entries(r.entries)}${entries(r.entriesHigherLevel)}${(r.classes?.fromClassList || []).length ? `<p class="fv-classes">Classes: ${r.classes.fromClassList.map((c) => esc(c.name)).join(', ')}</p>` : ''}`
      case 'item':
        return `<dl class="fv-props">${r.dmg1 ? prop('Damage', `${r.dmg1}${r.dmg2 ? ` (${r.dmg2} versatile)` : ''} ${DMG[r.dmgType] || ''}`) : ''}${r.ac != null ? prop('Armor class', String(r.ac)) : ''}${r.weight != null ? prop('Weight', `${r.weight} lb.`) : ''}${r.value != null ? prop('Value', coins(r.value)) : ''}</dl>${entries(r.entries)}`
      case 'race':
        return `<dl class="fv-props">${r.ability?.length ? prop('Ability scores', asi(r.ability)) : ''}${r.speed != null ? prop('Speed', speed(r.speed)) : ''}${r.darkvision ? prop('Darkvision', `${r.darkvision} ft.`) : ''}</dl>${entries(r.entries)}`
      case 'class': {
        const sp = r.startingProficiencies || {}
        const profs = (l) => (l || []).map((x) => plain(String(typeof x === 'string' ? x : x.proficiency || ''))).join(', ')
        const feats = [...(r.features || [])].sort((a, b) => a.level - b.level)
        return `<dl class="fv-props">${r.proficiency ? prop('Saving throws', r.proficiency.map((a) => a.toUpperCase()).join(', ')) : ''}${r.spellcastingAbility ? prop('Spellcasting', `${r.spellcastingAbility.toUpperCase()} (${r.casterProgression || 'full'} caster)`) : ''}${sp.armor ? prop('Armor', profs(sp.armor)) : ''}${sp.weapons ? prop('Weapons', profs(sp.weapons)) : ''}</dl>${feats.map((f) => `<section><h5><span class="fv-level">${f.level}</span> ${esc(f.name)}</h5>${entries(f.entries, 1)}</section>`).join('')}${(r.subclasses || []).length ? `<p class="fv-classes">${esc(r.subclassTitle || 'Subclasses')}: ${r.subclasses.map((s) => esc(s.name)).join(', ')}</p>` : ''}`
      }
      default:
        return entries(r.entries)
    }
  }
  const card = (e) => `<article class="fv-card"><header><h2>${esc(e.name)}</h2><p>${esc(subtitle(e))}<span class="fv-src">${esc(e.source)}${e.raw.page ? `, p. ${e.raw.page}` : ''}</span></p></header><div class="fv-body">${body(e)}</div></article>`

  window.bwHub = { onMessage, show, openRef }
})()
