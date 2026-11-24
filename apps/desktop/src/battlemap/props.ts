/**
 * The built-in props: top-down drawings sized in grid squares, in categories with tags for
 * search. A prop's art is an SVG with a 100-units-per-square view box. Some give light by default.
 */

export type PropCategory = 'furniture' | 'lighting' | 'hazards' | 'nature' | 'dungeon' | 'camp'
export const CATEGORIES: { id: PropCategory; label: string }[] = [
  { id: 'furniture', label: 'Furniture' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'hazards', label: 'Hazards' },
  { id: 'nature', label: 'Nature' },
  { id: 'dungeon', label: 'Dungeon dressing' },
  { id: 'camp', label: 'Camp & ship' },
]

export interface PropDef {
  id: string
  label: string
  cat: PropCategory
  tags: string[]
  /** Size in grid squares. */
  w: number
  h: number
  svg: string
  /** A light preset it gives (see `tools.tsx`). */
  light?: string
  /** Drawn stretched to its box (stairs, rugs, counters) rather than keeping its proportions. */
  stretch?: boolean
}

const O = '#2b2118' // outline
const ow = 'stroke="#2b2118" stroke-width="3" stroke-linejoin="round"'
const wood = '#8a5a32'
const woodL = '#a8743f'
const stone = '#8d877d'
const stoneL = '#aaa49a'
const metal = '#6d7278'

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 100} ${h * 100}">${body}</svg>`
const def = (id: string, label: string, cat: PropCategory, tags: string, w: number, h: number, body: string, extra: Partial<PropDef> = {}): PropDef => ({
  id,
  label,
  cat,
  tags: tags.split(/\s+/).filter(Boolean),
  w,
  h,
  svg: svg(w, h, body),
  ...extra,
})

const flame = (cx: number, cy: number, r: number) =>
  `<circle cx="${cx}" cy="${cy}" r="${r * 1.6}" fill="#ffb347" opacity=".35"/><path d="M${cx},${cy - r}C${cx + r * 0.9},${cy - r * 0.2} ${cx + r * 0.6},${cy + r} ${cx},${cy + r}C${cx - r * 0.6},${cy + r} ${cx - r * 0.9},${cy - r * 0.2} ${cx},${cy - r}Z" fill="#ff8a2a"/><circle cx="${cx}" cy="${cy + r * 0.25}" r="${r * 0.42}" fill="#ffe27a"/>`

const planksH = (x: number, y: number, w: number, h: number, n: number) => {
  let d = ''
  for (let i = 1; i < n; i++) d += `M${x},${y + (h * i) / n}h${w}`
  return `<path d="${d}" stroke="${O}" stroke-width="1.5" opacity=".45"/>`
}

export const BUILTIN: PropDef[] = [
  // ---------------- furniture
  def('table', 'Long table', 'furniture', 'table dining wood tavern', 2, 1, `<rect x="8" y="14" width="184" height="72" rx="6" fill="${woodL}" ${ow}/>${planksH(8, 14, 184, 72, 3)}`),
  def('table-round', 'Round table', 'furniture', 'table round tavern wood', 1, 1, `<circle cx="50" cy="50" r="38" fill="${woodL}" ${ow}/><circle cx="50" cy="50" r="26" fill="none" stroke="${O}" stroke-width="1.5" opacity=".4"/>`),
  def('chair', 'Chair', 'furniture', 'chair seat wood', 0.5, 0.5, `<rect x="8" y="12" width="34" height="32" rx="4" fill="${woodL}" ${ow}/><rect x="6" y="5" width="38" height="10" rx="3" fill="${wood}" ${ow}/>`),
  def('stool', 'Stool', 'furniture', 'stool seat bar', 0.4, 0.4, `<circle cx="20" cy="20" r="14" fill="${woodL}" ${ow}/>`),
  def('bench', 'Bench', 'furniture', 'bench seat wood', 1.5, 0.4, `<rect x="5" y="8" width="140" height="24" rx="4" fill="${woodL}" ${ow}/>`, { stretch: true }),
  def('bed', 'Bed', 'furniture', 'bed sleep inn bedroom', 1, 2, `<rect x="8" y="6" width="84" height="188" rx="6" fill="${wood}" ${ow}/><rect x="14" y="40" width="72" height="148" rx="4" fill="#b44a3c" ${ow}/><rect x="18" y="12" width="64" height="26" rx="8" fill="#efe6d4" ${ow}/><path d="M14,70h72" stroke="${O}" stroke-width="2" opacity=".5"/>`),
  def('bookshelf', 'Bookshelf', 'furniture', 'books shelf library study', 2, 0.5, `<rect x="4" y="6" width="192" height="38" fill="${wood}" ${ow}/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `<rect x="${10 + i * 15}" y="12" width="12" height="26" fill="${['#7b2f2a', '#2f4d7b', '#3e6b3a', '#8a6a2a'][i % 4]}"/>`).join('')}`, { stretch: true }),
  def('chest', 'Chest', 'furniture', 'chest treasure loot box', 0.7, 0.5, `<rect x="5" y="6" width="60" height="38" rx="4" fill="${wood}" ${ow}/><path d="M5,20h60" stroke="${O}" stroke-width="2"/><rect x="30" y="16" width="10" height="10" fill="#d9b44a" stroke="${O}" stroke-width="1.5"/><path d="M15,6v38M55,6v38" stroke="#5a5f66" stroke-width="4"/>`),
  def('wardrobe', 'Wardrobe', 'furniture', 'wardrobe cupboard closet', 1, 0.5, `<rect x="4" y="5" width="92" height="40" rx="3" fill="${wood}" ${ow}/><path d="M50,5v40" stroke="${O}" stroke-width="2"/><circle cx="44" cy="25" r="2.5" fill="#d9b44a"/><circle cx="56" cy="25" r="2.5" fill="#d9b44a"/>`),
  def('desk', 'Desk', 'furniture', 'desk study writing scroll', 1, 0.6, `<rect x="4" y="6" width="92" height="48" rx="3" fill="${woodL}" ${ow}/><rect x="14" y="14" width="30" height="22" fill="#efe6d4" transform="rotate(-8 29 25)" stroke="${O}" stroke-width="1"/><circle cx="72" cy="22" r="5" fill="#222"/>`),
  def('throne', 'Throne', 'furniture', 'throne king seat royal', 1, 1, `<rect x="14" y="10" width="72" height="80" rx="8" fill="#c9a227" ${ow}/><rect x="24" y="30" width="52" height="52" rx="6" fill="#8b1e2d" ${ow}/><rect x="18" y="6" width="64" height="18" rx="6" fill="#d8b43a" ${ow}/>`),
  def('rug', 'Rug', 'furniture', 'rug carpet floor', 2, 1.4, `<rect x="6" y="6" width="188" height="128" rx="4" fill="#8b2f2f" stroke="#5a1d1d" stroke-width="3"/><rect x="20" y="20" width="160" height="100" fill="none" stroke="#d9b44a" stroke-width="4"/><path d="M100,40l30,30l-30,30l-30-30z" fill="#2f4d7b" stroke="#d9b44a" stroke-width="3"/>`, { stretch: true }),
  def('counter', 'Bar counter', 'furniture', 'bar counter tavern inn shop', 3, 0.7, `<rect x="4" y="6" width="292" height="58" rx="6" fill="${wood}" ${ow}/>${planksH(4, 6, 292, 58, 2)}<circle cx="60" cy="30" r="8" fill="#e8d9a8" stroke="${O}" stroke-width="2"/><circle cx="150" cy="34" r="7" fill="#e8d9a8" stroke="${O}" stroke-width="2"/>`, { stretch: true }),

  // ---------------- lighting
  def('torch', 'Wall torch', 'lighting', 'torch light fire sconce', 0.4, 0.4, `<rect x="16" y="4" width="8" height="18" fill="${wood}" stroke="${O}" stroke-width="2"/>${flame(20, 24, 9)}`, { light: 'torch' }),
  def('brazier', 'Brazier', 'lighting', 'brazier fire light coals', 0.8, 0.8, `<circle cx="40" cy="40" r="32" fill="${metal}" ${ow}/><circle cx="40" cy="40" r="22" fill="#3a2418"/>${flame(40, 40, 14)}`, { light: 'brazier' }),
  def('candles', 'Candelabra', 'lighting', 'candle candelabra light', 0.5, 0.5, `<circle cx="25" cy="25" r="16" fill="#c9a227" ${ow}/>${flame(25, 12, 4)}${flame(13, 30, 4)}${flame(37, 30, 4)}`, { light: 'candle' }),
  def('lantern', 'Lantern', 'lighting', 'lantern light hanging', 0.4, 0.4, `<rect x="8" y="8" width="24" height="24" rx="4" fill="#3d3f43" ${ow}/><circle cx="20" cy="20" r="8" fill="#ffd56b"/>`, { light: 'lantern' }),
  def('campfire', 'Campfire', 'lighting', 'campfire fire camp cooking', 1, 1, `${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle cx="${50 + Math.cos((i * Math.PI) / 4) * 34}" cy="${50 + Math.sin((i * Math.PI) / 4) * 34}" r="9" fill="${stone}" stroke="${O}" stroke-width="2"/>`).join('')}<path d="M30,62L70,38M30,38L70,62" stroke="#5a3a1e" stroke-width="9" stroke-linecap="round"/>${flame(50, 50, 16)}`, { light: 'brazier' }),
  def('fireplace', 'Fireplace', 'lighting', 'fireplace hearth fire chimney inn', 1.5, 0.6, `<rect x="4" y="4" width="142" height="52" fill="${stone}" ${ow}/><rect x="35" y="18" width="80" height="38" fill="#2b1a10" stroke="${O}" stroke-width="2"/>${flame(75, 40, 12)}`, { light: 'brazier', stretch: true }),

  // ---------------- hazards
  def('spikes', 'Spike trap', 'hazards', 'trap spikes floor danger', 1, 1, `<rect x="6" y="6" width="88" height="88" fill="#4a4540" stroke="#7a2a22" stroke-width="3" stroke-dasharray="8 5"/>${[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => `<path d="M${22 + i * 28},${14 + j * 28}l7,16h-14z" fill="#c9c4bb" stroke="${O}" stroke-width="1.5"/>`)).join('')}`),
  def('pit-trap', 'Pit trap', 'hazards', 'trap pit hole fall', 1, 1, `<rect x="6" y="6" width="88" height="88" fill="#111" stroke="#7a2a22" stroke-width="3"/><path d="M6,6L94,94M94,6L6,94" stroke="#7a2a22" stroke-width="2" opacity=".7"/>`),
  def('plate', 'Pressure plate', 'hazards', 'trap pressure plate trigger', 0.8, 0.8, `<rect x="8" y="8" width="64" height="64" rx="4" fill="${stoneL}" stroke="#7a2a22" stroke-width="3"/><rect x="20" y="20" width="40" height="40" fill="none" stroke="${O}" stroke-width="1.5" opacity=".5"/>`),
  def('beartrap', 'Bear trap', 'hazards', 'trap bear jaws snare', 0.6, 0.6, `<circle cx="30" cy="30" r="22" fill="none" stroke="${metal}" stroke-width="6"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${30 + Math.cos((i * Math.PI) / 4) * 22},${30 + Math.sin((i * Math.PI) / 4) * 22}L${30 + Math.cos((i * Math.PI) / 4) * 12},${30 + Math.sin((i * Math.PI) / 4) * 12}" stroke="${metal}" stroke-width="3"/>`).join('')}`),
  def('web', 'Spider web', 'hazards', 'web spider sticky', 1.5, 1.5, `<g stroke="#e8e8e8" stroke-width="2" fill="none" opacity=".85">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M75,75L${75 + Math.cos((i * Math.PI) / 4) * 72},${75 + Math.sin((i * Math.PI) / 4) * 72}"/>`).join('')}${[20, 40, 60].map((r) => `<polygon points="${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `${75 + Math.cos((i * Math.PI) / 4) * r},${75 + Math.sin((i * Math.PI) / 4) * r}`).join(' ')}"/>`).join('')}</g>`),
  def('fire', 'Fire', 'hazards', 'fire flames burning hazard', 1, 1, `${flame(35, 55, 18)}${flame(62, 45, 22)}${flame(55, 70, 14)}`, { light: 'brazier' }),
  def('caltrops', 'Caltrops', 'hazards', 'caltrops spikes floor', 1, 1, `${[12, 30, 48, 66, 82].flatMap((x, i) => [18, 50, 80].map((y, j) => `<path d="M${x + ((i + j) % 2) * 6},${y - 6}l5,10h-10z" fill="${metal}" stroke="${O}" stroke-width="1"/>`)).join('')}`),

  // ---------------- nature
  def('tree', 'Tree', 'nature', 'tree oak forest canopy', 2, 2, `<circle cx="100" cy="100" r="88" fill="#3f6b2c" opacity=".35"/><circle cx="100" cy="100" r="78" fill="#4d7d34" ${ow}/><circle cx="72" cy="80" r="34" fill="#5e9440"/><circle cx="125" cy="92" r="38" fill="#5a8d3c"/><circle cx="95" cy="128" r="32" fill="#57893a"/>`),
  def('pine', 'Pine', 'nature', 'tree pine conifer forest', 1.5, 1.5, `<polygon points="${[...Array(16)].map((_, i) => { const r = i % 2 ? 40 : 70; const a = (i * Math.PI) / 8; return `${75 + Math.cos(a) * r},${75 + Math.sin(a) * r}` }).join(' ')}" fill="#2f5a34" ${ow}/><circle cx="75" cy="75" r="22" fill="#3d7042"/>`),
  def('bush', 'Bush', 'nature', 'bush shrub hedge plant', 1, 1, `<circle cx="38" cy="45" r="26" fill="#4f7f37" ${ow}/><circle cx="62" cy="40" r="24" fill="#5b9040" ${ow}/><circle cx="52" cy="64" r="24" fill="#548a3b" ${ow}/>`),
  def('rock', 'Rock', 'nature', 'rock stone small', 0.8, 0.8, `<path d="M14,40L24,14L52,8L70,30L64,62L30,70Z" fill="${stone}" ${ow}/><path d="M24,14L36,36L64,62M36,36L14,40" stroke="${O}" stroke-width="1.5" opacity=".4" fill="none"/>`),
  def('boulder', 'Boulder', 'nature', 'boulder rock large stone', 1.5, 1.5, `<path d="M20,70L35,22L90,10L132,40L138,100L95,138L35,125Z" fill="${stone}" ${ow}/><path d="M35,22L70,60L138,100M70,60L35,125" stroke="${O}" stroke-width="2" opacity=".35" fill="none"/>`),
  def('log', 'Log', 'nature', 'log fallen tree wood', 2, 0.5, `<rect x="6" y="8" width="180" height="34" rx="17" fill="${wood}" ${ow}/><ellipse cx="186" cy="25" rx="10" ry="17" fill="${woodL}" ${ow}/><path d="M30,18h60M70,32h80" stroke="${O}" stroke-width="1.5" opacity=".4"/>`),
  def('stump', 'Stump', 'nature', 'stump tree cut', 0.6, 0.6, `<circle cx="30" cy="30" r="24" fill="${woodL}" ${ow}/><circle cx="30" cy="30" r="15" fill="none" stroke="${O}" stroke-width="1.5" opacity=".5"/><circle cx="30" cy="30" r="7" fill="none" stroke="${O}" stroke-width="1.5" opacity=".5"/>`),
  def('flowers', 'Flowers', 'nature', 'flowers meadow garden plant', 1, 1, `${[[25, 30, '#e05a8a'], [60, 22, '#f2d14b'], [45, 55, '#ffffff'], [75, 65, '#e05a8a'], [22, 72, '#9a6dd7']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="9" fill="${c}" stroke="${O}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="3" fill="#f2b33b"/>`).join('')}`),
  def('mushrooms', 'Mushrooms', 'nature', 'mushroom fungus cave', 0.6, 0.6, `<circle cx="22" cy="24" r="14" fill="#c0473a" ${ow}/><circle cx="40" cy="40" r="10" fill="#c0473a" ${ow}/><circle cx="18" cy="20" r="2.5" fill="#fff"/><circle cx="26" cy="28" r="2.5" fill="#fff"/><circle cx="40" cy="38" r="2" fill="#fff"/>`),
  def('reeds', 'Reeds', 'nature', 'reeds marsh swamp water plant', 1, 1, `<g stroke="#6a8a3a" stroke-width="3" stroke-linecap="round">${[...Array(12)].map((_, i) => `<path d="M${15 + ((i * 23) % 70)},${20 + ((i * 37) % 60)}l${(i % 3) * 4 - 4},-14"/>`).join('')}</g>`),

  // ---------------- dungeon dressing
  def('barrel', 'Barrel', 'dungeon', 'barrel cask storage ale', 0.6, 0.6, `<circle cx="30" cy="30" r="25" fill="${wood}" ${ow}/><circle cx="30" cy="30" r="18" fill="none" stroke="${metal}" stroke-width="3"/><circle cx="30" cy="30" r="5" fill="${O}" opacity=".5"/>`),
  def('crate', 'Crate', 'dungeon', 'crate box storage cargo', 0.7, 0.7, `<rect x="5" y="5" width="60" height="60" fill="${woodL}" ${ow}/><path d="M5,5L65,65M65,5L5,65" stroke="${wood}" stroke-width="4"/><rect x="5" y="5" width="60" height="60" fill="none" stroke="${O}" stroke-width="3"/>`),
  def('sacks', 'Sacks', 'dungeon', 'sack bag grain storage', 0.7, 0.7, `<ellipse cx="26" cy="32" rx="20" ry="22" fill="#c9b07a" ${ow}/><ellipse cx="46" cy="40" rx="18" ry="20" fill="#bda36d" ${ow}/>`),
  def('pillar', 'Pillar', 'dungeon', 'pillar column stone', 1, 1, `<circle cx="50" cy="50" r="42" fill="${stoneL}" ${ow}/><circle cx="50" cy="50" r="30" fill="none" stroke="${O}" stroke-width="2" opacity=".4"/>`),
  def('statue', 'Statue', 'dungeon', 'statue stone figure', 1, 1, `<rect x="10" y="10" width="80" height="80" fill="${stone}" ${ow}/><circle cx="50" cy="40" r="12" fill="${stoneL}" stroke="${O}" stroke-width="2"/><path d="M30,75Q50,48 70,75Z" fill="${stoneL}" stroke="${O}" stroke-width="2"/>`),
  def('altar', 'Altar', 'dungeon', 'altar temple shrine ritual', 1.5, 1, `<rect x="8" y="12" width="134" height="76" rx="4" fill="${stoneL}" ${ow}/><rect x="20" y="24" width="110" height="52" fill="#7a1f2a" opacity=".85"/>${flame(45, 50, 6)}${flame(105, 50, 6)}`, { light: 'candle' }),
  def('rubble', 'Rubble', 'dungeon', 'rubble debris collapsed rocks', 1, 1, `${[[22, 26, 12], [50, 20, 9], [70, 40, 14], [35, 60, 15], [65, 72, 10], [18, 80, 8]].map(([x, y, r]) => `<path d="M${x - r},${y}L${x - r / 2},${y - r}L${x + r},${y - r / 2}L${x + r / 2},${y + r}Z" fill="${stone}" stroke="${O}" stroke-width="2"/>`).join('')}`),
  def('bones', 'Bones', 'dungeon', 'bones skeleton skull remains', 0.8, 0.8, `<circle cx="28" cy="28" r="12" fill="#e8e1cf" ${ow}/><circle cx="24" cy="26" r="3" fill="${O}"/><circle cx="32" cy="26" r="3" fill="${O}"/><path d="M40,46L70,66M44,66L68,44" stroke="#e8e1cf" stroke-width="6" stroke-linecap="round"/>`),
  def('sarcophagus', 'Sarcophagus', 'dungeon', 'sarcophagus tomb coffin crypt', 1, 2, `<path d="M20,8H80L92,40L80,192H20L8,40Z" fill="${stoneL}" ${ow}/><path d="M50,30v140M30,60h40" stroke="${O}" stroke-width="2" opacity=".5"/>`),
  def('well', 'Well', 'dungeon', 'well water village', 1, 1, `<circle cx="50" cy="50" r="42" fill="${stone}" ${ow}/><circle cx="50" cy="50" r="28" fill="#1c3a52" stroke="${O}" stroke-width="2"/><path d="M8,50h84" stroke="${wood}" stroke-width="6"/>`),
  def('fountain', 'Fountain', 'dungeon', 'fountain water square town', 2, 2, `<circle cx="100" cy="100" r="90" fill="${stoneL}" ${ow}/><circle cx="100" cy="100" r="76" fill="#4f86a8" stroke="${O}" stroke-width="2"/><circle cx="100" cy="100" r="22" fill="${stoneL}" ${ow}/><circle cx="100" cy="100" r="9" fill="#9fd4f0"/>`),
  def('stairs', 'Stairs', 'dungeon', 'stairs steps up down', 1, 2, `<rect x="4" y="4" width="92" height="192" fill="${stoneL}" ${ow}/>${[...Array(9)].map((_, i) => `<path d="M4,${24 + i * 20}h92" stroke="${O}" stroke-width="3" opacity="${0.35 + i * 0.07}"/>`).join('')}<path d="M50,170V40M38,55L50,40L62,55" stroke="${O}" stroke-width="3" fill="none" opacity=".55"/>`, { stretch: true }),
  def('ladder', 'Ladder', 'dungeon', 'ladder climb up down', 0.5, 1, `<path d="M12,4V96M38,4V96" stroke="${wood}" stroke-width="6"/>${[...Array(5)].map((_, i) => `<path d="M12,${14 + i * 18}h26" stroke="${woodL}" stroke-width="5"/>`).join('')}`, { stretch: true }),
  def('lever', 'Lever', 'dungeon', 'lever switch mechanism', 0.4, 0.4, `<rect x="8" y="22" width="24" height="12" rx="3" fill="${metal}" ${ow}/><path d="M20,28L30,6" stroke="${O}" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="6" r="4" fill="#c0473a"/>`),
  def('cauldron', 'Cauldron', 'dungeon', 'cauldron potion witch kitchen', 0.8, 0.8, `<circle cx="40" cy="40" r="32" fill="#2e2f33" ${ow}/><circle cx="40" cy="40" r="24" fill="#5fb05a"/><circle cx="32" cy="34" r="5" fill="#9fe08f"/><circle cx="48" cy="46" r="3" fill="#9fe08f"/>`),

  // ---------------- camp & ship
  def('tent', 'Tent', 'camp', 'tent camp shelter', 1.5, 1.5, `<rect x="12" y="12" width="126" height="126" fill="#b59a63" ${ow}/><path d="M12,12L138,138M138,12L12,138" stroke="#8a744a" stroke-width="3"/><path d="M75,12V138" stroke="${O}" stroke-width="3"/>`),
  def('bedroll', 'Bedroll', 'camp', 'bedroll sleeping camp', 0.5, 1, `<rect x="6" y="6" width="38" height="88" rx="10" fill="#5a7d9a" ${ow}/><rect x="10" y="10" width="30" height="20" rx="8" fill="#d8cdb3"/>`),
  def('mast', 'Mast', 'camp', 'mast ship sail', 0.8, 0.8, `<circle cx="40" cy="40" r="20" fill="${wood}" ${ow}/><path d="M4,40H76" stroke="${wood}" stroke-width="7"/><circle cx="40" cy="40" r="8" fill="${woodL}"/>`),
  def('cannon', 'Cannon', 'camp', 'cannon ship weapon', 0.6, 1.2, `<rect x="10" y="60" width="40" height="50" rx="4" fill="${wood}" ${ow}/><rect x="20" y="8" width="20" height="82" rx="8" fill="#2e2f33" ${ow}/>`),
  def('rope', 'Rope coil', 'camp', 'rope coil ship', 0.6, 0.6, `<circle cx="30" cy="30" r="24" fill="#c9a56a" ${ow}/><circle cx="30" cy="30" r="16" fill="none" stroke="#8a6d3e" stroke-width="3"/><circle cx="30" cy="30" r="8" fill="none" stroke="#8a6d3e" stroke-width="3"/>`),
  def('anchor', 'Anchor', 'camp', 'anchor ship harbour', 0.8, 0.8, `<g stroke="${metal}" stroke-width="7" fill="none" stroke-linecap="round"><path d="M40,12V66M24,24H56M14,48Q40,82 66,48"/></g><circle cx="40" cy="10" r="6" fill="none" stroke="${metal}" stroke-width="4"/>`),
  def('helm', 'Ship’s wheel', 'camp', 'helm wheel ship steer', 0.8, 0.8, `<circle cx="40" cy="40" r="26" fill="none" stroke="${wood}" stroke-width="6"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M40,40L${40 + Math.cos((i * Math.PI) / 4) * 36},${40 + Math.sin((i * Math.PI) / 4) * 36}" stroke="${woodL}" stroke-width="4" stroke-linecap="round"/>`).join('')}<circle cx="40" cy="40" r="7" fill="${wood}" ${ow}/>`),
  def('hatch', 'Hatch', 'camp', 'hatch trapdoor cellar ship', 1, 1, `<rect x="10" y="10" width="80" height="80" fill="${wood}" ${ow}/>${planksH(10, 10, 80, 80, 4)}<circle cx="50" cy="50" r="6" fill="none" stroke="${metal}" stroke-width="3"/>`),
  def('cart', 'Cart', 'camp', 'cart wagon wheels travel', 1.5, 2.5, `<rect x="20" y="30" width="110" height="180" fill="${woodL}" ${ow}/>${planksH(20, 30, 110, 180, 6)}<rect x="6" y="70" width="14" height="40" rx="4" fill="${O}"/><rect x="130" y="70" width="14" height="40" rx="4" fill="${O}"/><rect x="6" y="150" width="14" height="40" rx="4" fill="${O}"/><rect x="130" y="150" width="14" height="40" rx="4" fill="${O}"/><path d="M60,30L60,4M90,30L90,4" stroke="${wood}" stroke-width="6"/>`),
]

export const builtinById = new Map(BUILTIN.map((p) => [p.id, p]))
const srcCache = new Map<string, string>()
/** A built-in prop's picture, as a data URL. */
export function builtinSrc(id: string): string {
  let s = srcCache.get(id)
  if (!s) {
    const p = builtinById.get(id)
    s = p ? `data:image/svg+xml;utf8,${encodeURIComponent(p.svg)}` : ''
    srcCache.set(id, s)
  }
  return s
}

// ---------------------------------------------------------------- favourites (per person)

const FAV = 'bw.mapFavourites'
export function favourites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV) || '[]'))
  } catch {
    return new Set()
  }
}
export function toggleFavourite(asset: string): Set<string> {
  const f = favourites()
  if (f.has(asset)) f.delete(asset)
  else f.add(asset)
  try {
    localStorage.setItem(FAV, JSON.stringify([...f]))
  } catch {
    /* not remembered */
  }
  return f
}
