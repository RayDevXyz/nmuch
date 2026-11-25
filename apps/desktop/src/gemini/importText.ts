import type { WorldItem, WorldKind } from './create'

/**
 * Text from the Gemini app (an answer copied as Markdown, or a saved .html/.txt) split into
 * campaign pages: one per heading, each guessed as an NPC, a location, a faction or lore.
 */

/** HTML (a saved page, Google Takeout) as Markdown-ish text. */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, head').forEach((n) => n.remove())
  const out: string[] = []
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? ''
    if (!(n instanceof HTMLElement)) return ''
    const inner = [...n.childNodes].map(inline).join('')
    const tag = n.tagName
    if (tag === 'STRONG' || tag === 'B') return inner.trim() ? `**${inner.trim()}**` : ''
    if (tag === 'EM' || tag === 'I') return inner.trim() ? `*${inner.trim()}*` : ''
    if (tag === 'BR') return '\n'
    return inner
  }
  const block = (n: Element) => {
    const tag = n.tagName
    const h = /^H([1-6])$/.exec(tag)
    if (h) return void out.push(`${'#'.repeat(Number(h[1]))} ${inline(n).trim()}`, '')
    if (tag === 'P') return void out.push(inline(n).trim(), '')
    if (tag === 'LI') return void out.push(`- ${inline(n).trim()}`)
    if (tag === 'BLOCKQUOTE') return void out.push(`> ${inline(n).trim()}`, '')
    if (tag === 'TR') return void out.push(`| ${[...n.children].map((c) => inline(c).trim()).join(' | ')} |`)
    if (tag === 'UL' || tag === 'OL' || tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'BODY' || tag === 'MAIN') {
      for (const c of n.children) block(c)
      if (tag === 'UL' || tag === 'OL' || tag === 'TABLE') out.push('')
      return
    }
    const t = inline(n).trim()
    if (t) out.push(t, '')
  }
  if (doc.body) block(doc.body)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const NPC = /\b(npc|innkeeper|merchant|captain|priest(ess)?|wizard|lord|lady|sergeant|personality|appearance|mannerism|voice|backstory|he |she |they are a|age\b|race\b|class\b)/i
const LOCATION = /\b(location|town|city|village|hamlet|keep|castle|dungeon|cave|forest|tavern|inn\b|temple|ruins?|district|region|island|tower|harbou?r|map|rooms?\b|area\b)/i
const FACTION = /\b(faction|guild|order|cult|brotherhood|sisterhood|syndicate|cabal|church|consortium|alliance|clan|house\b|company|circle|goals?\b|members?\b|leaders?\b)/i

/** What a section is, from its title and text. */
export function guessKind(title: string, body: string): WorldKind {
  const t = `${title}\n${title}\n${body.slice(0, 800)}`
  const score = (re: RegExp) => (t.match(new RegExp(re.source, 'gi')) ?? []).length + (re.test(title) ? 3 : 0)
  const s: [WorldKind, number][] = [
    ['npc', score(NPC)],
    ['location', score(LOCATION)],
    ['faction', score(FACTION)],
  ]
  s.sort((a, b) => b[1] - a[1])
  return s[0][1] >= 2 ? s[0][0] : 'lore'
}

const cleanTitle = (t: string) =>
  t
    .replace(/[*_`]/g, '')
    .replace(/^\s*(\d+[.)]|[-•])\s*/, '')
    .replace(/^(npc|location|faction|lore|place|character)\s*[:—–-]\s*/i, '')
    .replace(/[:：]\s*$/, '')
    .trim()

export function splitImport(raw: string): WorldItem[] {
  let text = raw.trim()
  if (!text) return []
  if (/<(h[1-6]|p|div|li|br)\b/i.test(text)) text = htmlToMarkdown(text)
  let lines = text.replace(/\r\n?/g, '\n').split('\n')
  // Gemini often marks names with a bold line instead of a heading: treat those as headings.
  if (!lines.some((l) => /^#{1,6}\s/.test(l))) lines = lines.map((l) => (/^\s*\*\*[^*]{2,80}\*\*:?\s*$/.test(l) ? `### ${l.trim()}` : l))
  const counts = [1, 2, 3, 4].map((n) => lines.filter((l) => new RegExp(`^#{${n}}\\s`).test(l)).length)
  // Split at the biggest heading that occurs more than once (one H1 is usually the answer's title).
  const level = [1, 2, 3, 4].find((n, i) => counts[i] >= 2) ?? [1, 2, 3, 4].find((n, i) => counts[i] >= 1)
  if (!level) {
    const first = lines.find((l) => l.trim()) ?? 'From Gemini'
    return [{ kind: guessKind(first, text), title: cleanTitle(first).slice(0, 80) || 'From Gemini', body: lines.slice(lines.indexOf(first) + 1).join('\n').trim(), keep: true }]
  }
  const head = new RegExp(`^#{${level}}\\s+(.*)$`)
  const items: WorldItem[] = []
  let cur: { title: string; body: string[] } | null = null
  for (const l of lines) {
    const m = head.exec(l)
    if (m) {
      if (cur) items.push(finish(cur))
      cur = { title: m[1], body: [] }
    } else if (cur) cur.body.push(l)
  }
  if (cur) items.push(finish(cur))
  return items.filter((x) => x.title)
}

function finish(c: { title: string; body: string[] }): WorldItem {
  const title = cleanTitle(c.title).slice(0, 100)
  const body = c.body.join('\n').trim()
  return { kind: guessKind(title, body), title, body, keep: true }
}
