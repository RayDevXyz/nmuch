// BrainWaves table: players' characters. Players build a character from the options their DM
// allows (the room's rules, sent by BrainWaves), submit it, and see their approved characters'
// sheets (the party, sent by BrainWaves). The DM approves or sends back each submission in
// BrainWaves. Talks to the table through window.bwTable (see table.js).
;(() => {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  const ABILITY_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' }
  const SKILLS = [
    ['acrobatics', 'Acrobatics', 'dex'], ['animal handling', 'Animal Handling', 'wis'], ['arcana', 'Arcana', 'int'],
    ['athletics', 'Athletics', 'str'], ['deception', 'Deception', 'cha'], ['history', 'History', 'int'],
    ['insight', 'Insight', 'wis'], ['intimidation', 'Intimidation', 'cha'], ['investigation', 'Investigation', 'int'],
    ['medicine', 'Medicine', 'wis'], ['nature', 'Nature', 'int'], ['perception', 'Perception', 'wis'],
    ['performance', 'Performance', 'cha'], ['persuasion', 'Persuasion', 'cha'], ['religion', 'Religion', 'int'],
    ['sleight of hand', 'Sleight of Hand', 'dex'], ['stealth', 'Stealth', 'dex'], ['survival', 'Survival', 'wis'],
  ]
  const SKILL_LABEL = Object.fromEntries(SKILLS.map(([k, l]) => [k, l]))
  const STANDARD = [15, 14, 13, 12, 10, 8]
  const COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
  const ALIGNMENTS = ['Lawful good', 'Neutral good', 'Chaotic good', 'Lawful neutral', 'True neutral', 'Chaotic neutral', 'Lawful evil', 'Neutral evil', 'Chaotic evil', 'Unaligned']
  const METHOD_NAME = { standard: 'Standard array', pointbuy: 'Point buy (27 points)', manual: 'Rolled or set by your DM (enter your scores)' }

  const mod = (n) => Math.floor((n - 10) / 2)
  const signed = (n) => (n >= 0 ? `+${n}` : `${n}`)
  const key = (o) => (o ? `${o.name}|${o.source}` : '')

  let rules = null
  let party = []
  let subs = []

  const table = () => window.bwTable

  // ---------- messages from the table

  function onMessage(m) {
    if (m.t === 'welcome') {
      rules = m.rules || null
      party = m.party || []
      subs = m.submissions || []
    } else if (m.t === 'rules') rules = m.rules || null
    else if (m.t === 'party') party = m.party || []
    else if (m.t === 'submissions') {
      // Tell the player when the DM decided.
      for (const s of m.submissions || []) {
        const old = subs.find((x) => x.id === s.id)
        if (old && old.status !== s.status) {
          if (s.status === 'approved') table().toast(`Your DM approved ${s.character.name}!`)
          if (s.status === 'returned') table().toast(`Your DM sent ${s.character.name} back with a note.`)
        }
      }
      subs = m.submissions || []
    } else return
    render()
  }

  /** Ids of the characters (pages) that are this player's. */
  const mineIds = () => party.filter((c) => c.mine).map((c) => c.id)

  // ---------- the panel

  function render() {
    const box = $('chars')
    if (!box) return
    const mineChars = party.filter((c) => c.mine)
    const open = subs.filter((s) => s.status !== 'approved')
    const others = party.filter((c) => !c.mine)
    const canCreate = rules && rules.open !== false && (rules.classes || []).length > 0
    let html = ''
    for (const c of mineChars) {
      const s = c.sheet || {}
      html += `<button class="char mine" data-sheet="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc([s.race, s.classLabel || s.class].filter(Boolean).join(' · '))}</span><span class="hp">${s.hp ? `${s.hp.current} / ${s.hp.max} HP` : ''}</span></button>`
    }
    for (const s of open) {
      const ch = s.character || {}
      if (s.status === 'returned')
        html += `<div class="char returned"><b>${esc(ch.name)}</b><span class="state">Sent back by your DM</span>${s.note ? `<q>${esc(s.note)}</q>` : ''}<span class="row"><button class="gold small" data-edit="${esc(s.id)}">Edit &amp; resend</button><button class="small" data-withdraw="${esc(s.id)}">Delete</button></span></div>`
      else
        html += `<div class="char pending"><b>${esc(ch.name)}</b><span class="state">Waiting for your DM to approve</span><span class="row"><button class="small" data-edit="${esc(s.id)}">Edit</button><button class="small" data-withdraw="${esc(s.id)}">Withdraw</button></span></div>`
    }
    if (!mineChars.length && !open.length) html += `<p class="muted">You have no character in this campaign yet.</p>`
    if (canCreate) html += `<button class="gold wide" id="char-new">✦ Create a character</button>`
    else html += `<p class="muted small">${rules ? 'Your DM has closed character creation for now.' : 'Character creation opens once your DM shares the rules.'}</p>`
    box.innerHTML = html
    // The sheet next to the list: the one open, else the first of yours.
    if (!party.some((c) => c.id === shownSheet) && mineChars.length) shownSheet = mineChars[0].id
    if (shownSheet) renderSheet(shownSheet)
    for (const b of box.querySelectorAll('[data-sheet]')) b.classList.toggle('on', b.dataset.sheet === shownSheet)
    box.querySelector('#char-new')?.addEventListener('click', () => openWizard(null))
    for (const b of box.querySelectorAll('[data-sheet]')) b.onclick = () => openSheet(b.dataset.sheet)
    void others
    for (const b of box.querySelectorAll('[data-edit]')) b.onclick = () => openWizard(subs.find((s) => s.id === b.dataset.edit))
    for (const b of box.querySelectorAll('[data-withdraw]'))
      b.onclick = () => {
        const s = subs.find((x) => x.id === b.dataset.withdraw)
        if (s && confirm(`Remove ${s.character.name}?`)) table().send({ t: 'withdraw', id: s.id })
      }
  }

  // ---------- a modal

  function modal(html, wide) {
    $('modal-body').innerHTML = html
    $('modal').querySelector('.modal-card').classList.toggle('wide', !!wide)
    $('modal').hidden = false
    $('modal-body').scrollTop = 0
    return $('modal-body')
  }
  const closeModal = () => ($('modal').hidden = true)
  $('modal').addEventListener('click', (e) => e.target === $('modal') && closeModal())
  $('modal-close').onclick = closeModal
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('modal').hidden && closeModal())

  // ---------- the sheet (read-only: your DM keeps it in BrainWaves)

  let shownSheet = null
  function openSheet(id) {
    shownSheet = id
    window.bwHub?.show('characters')
    render()
    document.body.classList.add('reading')
  }
  const refLink = (cat, name) => `<a href="#" data-ref-cat="${cat}" data-ref-name="${esc(name)}">${esc(name)}</a>`
  $('sheet-back')?.addEventListener('click', () => document.body.classList.remove('reading'))

  function renderSheet(id) {
    const c = party.find((x) => x.id === id)
    const target = $('char-sheet')
    if (!c || !target) return
    const s = c.sheet || {}
    const lvl = s.level || 1
    const prof = Math.ceil(Math.max(1, lvl) / 4) + 1
    const ab = s.abilities || {}
    const save = (a) => mod(ab[a] ?? 10) + ((s.saves || []).includes(a) ? prof : 0)
    const skill = ([k, , a]) => mod(ab[a] ?? 10) + (s.skills?.[k] || 0) * prof
    const perception = 10 + skill(SKILLS.find((x) => x[0] === 'perception'))
    const hp = s.hp || {}
    target.innerHTML = (
      `<div class="sheet">
        <header class="sheet-head">
          <h2>${esc(c.name)}</h2>
          <p>${esc([s.race, s.classLabel || (s.class ? `${s.class} ${lvl}` : ''), s.background, s.alignment].filter(Boolean).join(' · '))}${c.player || s.player ? ` <span class="muted">— played by ${esc(c.player || s.player)}</span>` : ''}</p>
        </header>
        <div class="sheet-stats">
          <div><small>Armor</small><b>${s.ac ?? '—'}</b></div>
          <div><small>Hit points</small><b>${hp.current ?? '—'}<span>/${hp.max ?? '—'}</span></b>${hp.temp ? `<small>+${hp.temp} temp</small>` : ''}</div>
          <div><small>Speed</small><b>${s.speed ?? 30}<span> ft</span></b></div>
          <div><small>Initiative</small><b>${signed(mod(ab.dex ?? 10) + (s.initiativeBonus || 0))}</b></div>
          <div><small>Proficiency</small><b>${signed(prof)}</b></div>
          <div><small>Passive perception</small><b>${perception}</b></div>
        </div>
        <div class="sheet-abilities">
          ${ABILITIES.map((a) => `<div><small>${ABILITY_NAME[a]}</small><b>${signed(mod(ab[a] ?? 10))}</b><span>${ab[a] ?? 10}</span></div>`).join('')}
        </div>
        <div class="sheet-cols">
          <section><h3>Saving throws</h3><ul class="sheet-list">${ABILITIES.map((a) => `<li class="${(s.saves || []).includes(a) ? 'prof' : ''}"><span>${ABILITY_NAME[a]}</span><b>${signed(save(a))}</b></li>`).join('')}</ul></section>
          <section><h3>Skills</h3><ul class="sheet-list">${SKILLS.map((sk) => `<li class="${s.skills?.[sk[0]] ? 'prof' : ''}"><span>${sk[1]} <small>${sk[2]}</small></span><b>${signed(skill(sk))}</b></li>`).join('')}</ul></section>
        </div>
        ${(s.conditions || []).length ? `<section><h3>Conditions</h3><p>${(s.conditions || []).map(esc).join(', ')}</p></section>` : ''}
        ${(s.spells || []).length ? `<section><h3>Spells</h3><p>${s.spells.map((x) => `${refLink('spell', x.name)}${x.prepared ? ' ✦' : ''}`).join(', ')}</p></section>` : ''}
        ${(s.inventory || []).length ? `<section><h3>Equipment</h3><p>${s.inventory.map((x) => `${refLink('item', x.name)}${x.qty > 1 ? ` ×${x.qty}` : ''}`).join(', ')}</p></section>` : ''}
        ${s.backstory ? `<section><h3>Backstory</h3><p class="prose">${esc(s.backstory)}</p></section>` : ''}
        <p class="muted small">Read-only: your DM keeps this sheet in BrainWaves, and changes show up here.</p>
      </div>`
    )
  }

  // ---------- building a character

  function openWizard(sub) {
    if (!rules) return
    const prev = sub?.character || {}
    const methods = rules.method && rules.method !== 'any' ? [rules.method] : ['standard', 'pointbuy', 'manual']
    const d = {
      name: prev.name || '',
      race: prev.race || null,
      class: prev.class || null,
      background: prev.background || null,
      method: methods.includes(prev.method) ? prev.method : methods[0],
      base: prev.base || null,
      skills: prev.skills || [],
      alignment: prev.alignment || '',
      backstory: prev.backstory || '',
    }
    if (!d.base) d.base = startScores(d.method)
    const races = rules.races || []
    const classes = rules.classes || []
    const bgs = rules.backgrounds || []
    const opt = (list, cur) => list.map((o) => `<option value="${esc(key(o))}" ${key(o) === key(cur) ? 'selected' : ''}>${esc(o.name)}${o.source ? ` (${esc(o.source)})` : ''}</option>`).join('')
    const body = modal(
      `<form class="wiz" autocomplete="off">
        <h2>${sub ? 'Edit your character' : 'Create a character'}</h2>
        ${rules.note ? `<p class="wiz-note">${esc(rules.note)}</p>` : ''}
        <p class="muted small">Your DM checks the character before it joins the campaign${rules.level > 1 ? `; it starts at level ${rules.level}` : ''}.</p>
        <label>Name<input name="name" maxlength="60" value="${esc(d.name)}" placeholder="Thorin Oakenshield" /></label>
        <div class="wiz-grid">
          ${races.length ? `<label>Race<select name="race"><option value="">Choose…</option>${opt(races, d.race)}</select><span class="wiz-info" id="race-info"></span></label>` : ''}
          <label>Class<select name="class"><option value="">Choose…</option>${opt(classes, d.class)}</select><span class="wiz-info" id="class-info"></span></label>
          ${bgs.length ? `<label>Background<select name="background"><option value="">Choose…</option>${opt(bgs, d.background)}</select><span class="wiz-info" id="bg-info"></span></label>` : ''}
          <label>Alignment<select name="alignment"><option value="">—</option>${ALIGNMENTS.map((a) => `<option ${a === d.alignment ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        </div>
        <h3>Ability scores</h3>
        ${methods.length > 1 ? `<div class="wiz-methods">${methods.map((m) => `<label class="radio"><input type="radio" name="method" value="${m}" ${m === d.method ? 'checked' : ''}/> ${METHOD_NAME[m]}</label>`).join('')}</div>` : `<p class="muted small">${METHOD_NAME[d.method]}</p>`}
        <div id="wiz-abilities"></div>
        <h3>Skills</h3>
        <div id="wiz-skills"></div>
        <label>Backstory <span class="muted small">(optional)</span><textarea name="backstory" rows="4" maxlength="4000" placeholder="Where they come from, what they want…">${esc(d.backstory)}</textarea></label>
        <p class="error" id="wiz-error"></p>
        <div class="wiz-actions"><button type="button" class="ghost" id="wiz-cancel">Cancel</button><button type="submit" class="gold">${sub ? 'Resend to the DM' : 'Send to the DM'}</button></div>
      </form>`,
      true,
    )
    const form = body.querySelector('form')
    const find = (list, v) => list.find((o) => key(o) === v) || null
    const raceOf = () => find(races, form.race?.value)
    const classOf = () => find(classes, form.class.value)
    const bgOf = () => find(bgs, form.background?.value)
    const bonus = () => raceOf()?.bonus || {}

    function info() {
      const r = raceOf(), c = classOf(), b = bgOf()
      if ($('race-info')) $('race-info').textContent = r ? [bonusText(r.bonus), r.size, r.speed ? `${r.speed} ft` : ''].filter(Boolean).join(' · ') : ''
      $('class-info').textContent = c ? [`d${c.hd} hit die`, c.saves?.length ? `saves: ${c.saves.map((a) => a.toUpperCase()).join(', ')}` : '', c.caster ? 'spellcaster' : ''].filter(Boolean).join(' · ') : ''
      if ($('bg-info')) $('bg-info').textContent = b && b.skills?.length ? `skills: ${b.skills.map((k) => SKILL_LABEL[k] || k).join(', ')}` : ''
    }

    function abilities() {
      const box = $('wiz-abilities')
      const b = bonus()
      const cell = (a) => {
        const v = d.base[a]
        let input
        if (d.method === 'standard')
          input = `<select data-ab="${a}">${STANDARD.map((n) => `<option ${n === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`
        else if (d.method === 'pointbuy')
          input = `<span class="pb"><button type="button" data-dec="${a}" ${v <= 8 ? 'disabled' : ''}>−</button><b>${v}</b><button type="button" data-inc="${a}" ${v >= 15 ? 'disabled' : ''}>+</button></span>`
        else input = `<input type="number" min="3" max="20" data-ab="${a}" value="${v}" />`
        const total = v + (b[a] || 0)
        return `<div class="ab"><small>${ABILITY_NAME[a]}</small>${input}<span class="ab-total">${b[a] ? `${signed(b[a])} → ` : ''}<b>${total}</b> (${signed(mod(total))})</span></div>`
      }
      let foot = ''
      if (d.method === 'pointbuy') {
        const spent = ABILITIES.reduce((n, a) => n + (COST[d.base[a]] ?? 99), 0)
        foot = `<p class="${spent > 27 ? 'error' : 'muted'} small">${27 - spent} of 27 points left</p>`
      }
      if (d.method === 'standard') {
        const used = ABILITIES.map((a) => d.base[a]).sort((x, y) => y - x).join()
        if (used !== STANDARD.join()) foot = `<p class="error small">Use each of 15, 14, 13, 12, 10 and 8 once.</p>`
      }
      box.innerHTML = `<div class="ab-grid">${ABILITIES.map(cell).join('')}</div>${foot}`
      for (const el of box.querySelectorAll('[data-ab]'))
        el.onchange = () => {
          d.base[el.dataset.ab] = Math.max(3, Math.min(20, Number(el.value) || 10))
          abilities()
        }
      for (const el of box.querySelectorAll('[data-inc]')) el.onclick = () => ((d.base[el.dataset.inc] = Math.min(15, d.base[el.dataset.inc] + 1)), abilities())
      for (const el of box.querySelectorAll('[data-dec]')) el.onclick = () => ((d.base[el.dataset.dec] = Math.max(8, d.base[el.dataset.dec] - 1)), abilities())
    }

    function skills() {
      const box = $('wiz-skills')
      const c = classOf()
      const fromBg = bgOf()?.skills || []
      const choice = c?.skills || { from: [], count: 0 }
      d.skills = d.skills.filter((k) => choice.from.includes(k) && !fromBg.includes(k)).slice(0, choice.count)
      if (!c) return (box.innerHTML = '<p class="muted small">Choose a class first.</p>')
      box.innerHTML =
        `<p class="muted small">${fromBg.length ? `From your background: ${fromBg.map((k) => SKILL_LABEL[k] || k).join(', ')}. ` : ''}Choose ${choice.count} from your class (${d.skills.length}/${choice.count}).</p>` +
        `<div class="sk-grid">${choice.from
          .map((k) => {
            const bg = fromBg.includes(k)
            const on = bg || d.skills.includes(k)
            const full = !on && d.skills.length >= choice.count
            return `<label class="sk ${on ? 'on' : ''}"><input type="checkbox" data-sk="${esc(k)}" ${on ? 'checked' : ''} ${bg || full ? 'disabled' : ''}/> ${esc(SKILL_LABEL[k] || k)}</label>`
          })
          .join('')}</div>`
      for (const el of box.querySelectorAll('[data-sk]'))
        el.onchange = () => {
          const k = el.dataset.sk
          d.skills = el.checked ? [...d.skills, k] : d.skills.filter((x) => x !== k)
          skills()
        }
    }

    form.addEventListener('change', (e) => {
      $('wiz-error').textContent = ''
      const n = e.target.name
      if (n === 'race') abilities()
      if (n === 'class' || n === 'background') skills()
      if (n === 'method') {
        d.method = e.target.value
        d.base = startScores(d.method)
        abilities()
      }
      info()
    })
    $('wiz-cancel').onclick = closeModal
    form.onsubmit = (e) => {
      e.preventDefault()
      const ch = {
        name: form.name.value.trim(),
        race: raceOf(),
        class: classOf(),
        background: bgOf(),
        method: d.method,
        base: d.base,
        skills: d.skills,
        alignment: form.alignment.value,
        backstory: form.backstory.value.trim(),
      }
      const problem = check(ch, races, bgs)
      if (problem) return ($('wiz-error').textContent = problem)
      // Only what identifies each option goes back; the DM's BrainWaves looks up the rest.
      const ref = (o) => (o ? { name: o.name, source: o.source } : null)
      table().send({ t: 'submit', id: sub?.id, character: { ...ch, race: ref(ch.race), class: ref(ch.class), background: ref(ch.background) } })
      closeModal()
      table().toast(`${ch.name} is on the way to your DM.`)
    }
    info()
    abilities()
    skills()
    form.name.focus()
  }

  function startScores(method) {
    const s = method === 'pointbuy' ? 8 : 10
    if (method === 'standard') return { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
    return Object.fromEntries(ABILITIES.map((a) => [a, s]))
  }

  function bonusText(b) {
    const parts = Object.entries(b || {}).map(([a, n]) => `${signed(n)} ${a.toUpperCase()}`)
    return parts.join(', ')
  }

  function check(ch, races, bgs) {
    if (!ch.name) return 'Give your character a name.'
    if (races.length && !ch.race) return 'Choose a race.'
    if (!ch.class) return 'Choose a class.'
    if (bgs.length && !ch.background) return 'Choose a background.'
    if (ch.method === 'standard' && ABILITIES.map((a) => ch.base[a]).sort((x, y) => y - x).join() !== STANDARD.join()) return 'Use each number of the standard array once.'
    if (ch.method === 'pointbuy' && ABILITIES.reduce((n, a) => n + (COST[ch.base[a]] ?? 99), 0) > 27) return 'That costs more than 27 points.'
    const need = Math.min(ch.class.skills?.count || 0, (ch.class.skills?.from || []).filter((k) => !(ch.background?.skills || []).includes(k)).length)
    if (ch.skills.length < need) return `Choose ${need} skills from your class.`
    return null
  }

  window.bwCharacters = { onMessage, mineIds }
})()
