// BrainWaves table: what players see. The DM's BrainWaves sends the scene (only what players
// may see); this page draws it and sends back pings, temporary drawings, move requests and
// dice rolls. No build step: plain JavaScript, served by bw-table.
;(() => {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  // ---------- joining

  const pathCode = (location.pathname.match(/^\/join\/([A-Za-z0-9]+)/) || [])[1] || ''
  $('join-code').value = pathCode
  try { $('join-name').value = localStorage.getItem('bw-table-name') || '' } catch {}
  ;(pathCode ? $('join-name') : $('join-code')).focus()
  const go = () => {
    const code = $('join-code').value.trim()
    const name = $('join-name').value.trim()
    if (!/^[A-Za-z0-9]{6,32}$/.test(code)) return ($('join-error').textContent = 'That table code looks wrong.')
    if (!name) return ($('join-error').textContent = 'Tell the table your name.')
    try { localStorage.setItem('bw-table-name', name) } catch {}
    if (location.pathname !== `/join/${code}`) history.replaceState(null, '', `/join/${code}`)
    connect(code, name)
  }
  $('join-go').onclick = go
  for (const id of ['join-code', 'join-name']) $(id).addEventListener('keydown', (e) => e.key === 'Enter' && go())

  // ---------- state

  let ws = null
  let me = null
  let scene = {}
  let players = []
  let pending = null // { id, token, x, y }
  const pings = [] // { x, y, color, name, at }
  const drawings = new Map() // id -> { points, color, until }
  const images = new Map() // hash -> HTMLImageElement
  let view = { x: 0, y: 0, z: 1 } // world point at screen top-left, zoom
  let fitted = false
  let tool = 'pan'

  // This browser's player id: it's how the table knows your characters on your next visit.
  function playerId() {
    let pid = ''
    try { pid = localStorage.getItem('bw-table-pid') || '' } catch {}
    if (!/^[A-Za-z0-9]{16,64}$/.test(pid)) {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      pid = Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => abc[n % abc.length]).join('')
      try { localStorage.setItem('bw-table-pid', pid) } catch {}
    }
    return pid
  }

  function connect(code, name) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws/${code}?name=${encodeURIComponent(name)}&pid=${playerId()}`)
    ws.onopen = () => {
      $('join').hidden = true
      $('table').hidden = false
      resize()
    }
    ws.onmessage = (e) => onMessage(JSON.parse(e.data))
    ws.onclose = (e) => {
      if (!me) {
        $('join-error').textContent = 'No table with that code. Check it with your DM.'
        return
      }
      toast('Connection lost, reconnecting…')
      setTimeout(() => connect(code, name), 2000)
    }
  }
  const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m))
  window.bwTable = { send: (m) => send(m), toast: (m) => toast(m) }

  function onMessage(m) {
    window.bwCharacters?.onMessage(m)
    window.bwHub?.onMessage(m)
    if (m.t === 'party' || m.t === 'welcome') setTimeout(autoClaim)
    switch (m.t) {
      case 'welcome':
        me = m.you
        $('room-name').textContent = m.room.name || 'Table'
        document.title = `${m.room.name || 'Table'} · BrainWaves`
        setScene(m.scene)
        $('rolls').innerHTML = ''
        for (const r of m.rolls || []) addRoll(r, false)
        setDm(m.dmOnline)
        break
      case 'scene':
        setScene(m.scene)
        break
      case 'players':
        players = m.players
        renderPlayers()
        renderClaim()
        autoClaim()
        break
      case 'dm':
        setDm(m.online)
        break
      case 'ping':
        pings.push({ x: m.x, y: m.y, color: m.color, name: m.name, at: performance.now() })
        break
      case 'draw':
        drawings.set(m.id, { points: m.points, color: m.color, until: performance.now() + (m.until - Date.now()) })
        break
      case 'roll':
        addRoll(m, true)
        break
      case 'pending':
        pending = m
        $('pending').hidden = false
        $('pending').textContent = 'Waiting for the DM to accept your move…'
        break
      case 'decided':
        if (pending && pending.id === m.id) {
          pending = null
          $('pending').hidden = true
          if (!m.withdrawn) toast(m.accept ? 'The DM accepted your move.' : 'The DM declined your move.')
        }
        break
      case 'error':
        toast(m.message)
        break
    }
  }

  function setDm(on) {
    $('dm-status').className = `dm ${on ? 'on' : 'off'}`
    $('dm-status').textContent = on ? 'DM at the table' : 'DM away'
  }

  const roomCode = () => (location.pathname.match(/\/join\/([A-Za-z0-9]+)/) || [])[1]
  // Moving pictures only animate while they're in the page: they're kept in a hidden corner.
  const stash = document.createElement('div')
  stash.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none'
  document.body.appendChild(stash)
  /** A picture (or video) the DM sent, loaded once by its hash. */
  function load(hash, anim) {
    if (!hash || images.has(hash)) return
    const url = `/api/rooms/${roomCode()}/image/${hash}`
    if (anim === 'video') {
      const v = document.createElement('video')
      v.muted = true
      v.loop = true
      v.autoplay = true
      v.playsInline = true
      v.src = url
      stash.appendChild(v)
      v.play().catch(() => {})
      images.set(hash, v)
      return
    }
    const el = new Image()
    el.onload = () => (fitted ? null : fit())
    el.src = url
    if (anim) stash.appendChild(el)
    images.set(hash, el)
  }
  const ready = (el) => el && ((el.tagName === 'VIDEO' && el.readyState >= 2) || (el.complete && el.naturalWidth))

  function setScene(s) {
    scene = s || {}
    const img = scene.image
    if (scene.layers) for (const l of scene.layers) load(l.hash, l.anim)
    else if (img && img.hash) load(img.hash)
    if (!fitted && (img || scene.layers?.length || (scene.tokens || []).length)) fit()
    renderClaim()
    renderInitiative()
    autoClaim()
  }

  // ---------- panels

  function renderPlayers() {
    $('players').innerHTML = players.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.name)}${p.id === me?.id ? ' (you)' : ''}</span>`).join('')
  }
  const mine = () => players.find((p) => me && p.id === me.id)?.claim || null
  function renderClaim() {
    const tokens = (scene.tokens || []).filter((t) => t.player)
    if (!tokens.length) {
      $('claim').innerHTML = '<p class="muted">Your DM hasn\'t put your character on this map yet.</p>'
      return
    }
    const claimed = mine()
    $('claim').innerHTML = tokens
      .map((t) => {
        const by = players.find((p) => p.claim === t.id && p.id !== me?.id)
        const hp = t.maxHp ? `<span class="hp">${t.hp ?? '?'} / ${t.maxHp} HP</span>` : ''
        return `<button class="claim ${claimed === t.id ? 'mine' : ''}" data-token="${esc(t.id)}"><i style="background:${esc(t.color || '#888')}"></i>${esc(t.name || 'Hero')}${by ? `<span class="taken">${esc(by.name)}</span>` : hp}</button>`
      })
      .join('')
    for (const b of $('claim').querySelectorAll('button')) b.onclick = () => send({ t: 'claim', token: b.dataset.token === claimed ? null : b.dataset.token })
  }
  /** Take your own character's token on the map, when it's there and nobody holds it. */
  function autoClaim() {
    if (!me || mine()) return
    const ids = window.bwCharacters?.mineIds() || []
    const t = (scene.tokens || []).find((x) => x.player && x.page && ids.includes(x.page) && !players.some((p) => p.claim === x.id))
    if (t) send({ t: 'claim', token: t.id })
  }
  function renderInitiative() {
    const ini = scene.initiative
    $('init-panel').hidden = !(ini && ini.entries && ini.entries.length)
    if (!ini) return
    $('round').textContent = ini.round ? `round ${ini.round}` : ''
    $('initiative').innerHTML = (ini.entries || []).map((e, i) => `<li class="${i === ini.turn ? 'turn' : ''}">${esc(e.name)} <small class="muted">${e.init ?? ''}</small></li>`).join('')
  }

  function addRoll(r, fresh) {
    const li = document.createElement('li')
    if (fresh) li.className = 'new'
    li.innerHTML = `<b>${r.total}</b><span class="who" style="color:${esc(r.color || '#ccc')}">${esc(r.name)}</span> ${r.label ? `<em>${esc(r.label)}</em> ` : ''}rolled ${esc(r.expr)}${r.private ? ' (hidden)' : ''}<span class="detail">${esc(r.detail)}</span>`
    $('rolls').prepend(li)
    while ($('rolls').children.length > 60) $('rolls').lastChild.remove()
  }
  for (const b of document.querySelectorAll('[data-die]')) b.onclick = () => send({ t: 'roll', expr: b.dataset.die })
  const rollExpr = () => {
    const v = $('dice-expr').value.trim()
    if (v) send({ t: 'roll', expr: v })
  }
  $('dice-roll').onclick = rollExpr
  $('dice-expr').addEventListener('keydown', (e) => e.key === 'Enter' && rollExpr())

  let toastTimer
  function toast(msg) {
    $('toast').textContent = msg
    $('toast').hidden = false
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => ($('toast').hidden = true), 3200)
  }

  for (const b of document.querySelectorAll('[data-tool]'))
    b.onclick = () => {
      tool = b.dataset.tool
      for (const x of document.querySelectorAll('[data-tool]')) x.classList.toggle('active', x === b)
      canvas.className = `tool-${tool}`
      if (tool === 'move' && !mine()) toast('Choose your character first (on the right).')
    }

  // ---------- drawing the map

  const canvas = $('map')
  const ctx = canvas.getContext('2d')
  let dpr = 1
  function resize() {
    dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
  }
  window.addEventListener('resize', resize)

  function bounds() {
    if (scene.bounds) return scene.bounds
    const img = scene.image
    if (img) return { x: img.x, y: img.y, w: img.w, h: img.h }
    if (scene.width && scene.height) return { x: 0, y: 0, w: scene.width, h: scene.height }
    const ts = scene.tokens || []
    if (!ts.length) return { x: 0, y: 0, w: 1000, h: 700 }
    const xs = ts.flatMap((t) => [t.x, t.x + t.w]), ys = ts.flatMap((t) => [t.y, t.y + t.h])
    return { x: Math.min(...xs) - 200, y: Math.min(...ys) - 200, w: Math.max(...xs) - Math.min(...xs) + 400, h: Math.max(...ys) - Math.min(...ys) + 400 }
  }
  function fit() {
    const b = bounds()
    const sideW = window.innerWidth > 760 ? 330 : 0
    const W = canvas.clientWidth - sideW - 80, H = canvas.clientHeight - 100
    if (W <= 0 || H <= 0) return
    const z = Math.min(W / b.w, H / b.h, 3)
    view = { z, x: b.x - (W / z - b.w) / 2 - 70 / z, y: b.y - (H / z - b.h) / 2 - 60 / z }
    fitted = true
  }
  const toWorld = (sx, sy) => [sx / view.z + view.x, sy / view.z + view.y]

  function frame() {
    const now = performance.now()
    const W = canvas.width, H = canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#0b0907'
    ctx.fillRect(0, 0, W, H)
    ctx.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr)

    if (scene.layers) drawLayers()
    else {
      const img = scene.image
      const el = img && images.get(img.hash)
      if (ready(el)) ctx.drawImage(el, img.x, img.y, img.w, img.h)
      else if (img) {
        ctx.fillStyle = '#1d1812'
        ctx.fillRect(img.x, img.y, img.w, img.h)
      }
    }

    drawLight(now)
    drawGrid()
    if (scene.vision) drawSight()
    else drawFog()
    for (const t of scene.tokens || []) drawToken(t)
    if (pending) drawGhost(pending)

    // drawings fade over their last two seconds
    for (const [id, d] of drawings) {
      const left = d.until - now
      if (left <= 0) {
        drawings.delete(id)
        continue
      }
      ctx.globalAlpha = Math.min(1, left / 2000)
      ctx.strokeStyle = d.color
      ctx.lineWidth = 4 / view.z
      ctx.lineCap = ctx.lineJoin = 'round'
      ctx.beginPath()
      d.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (stroke) {
      ctx.strokeStyle = me?.color || '#fff'
      ctx.lineWidth = 4 / view.z
      ctx.beginPath()
      stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
    // pings: three expanding rings over two seconds
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i]
      const age = (now - p.at) / 2000
      if (age >= 1) {
        pings.splice(i, 1)
        continue
      }
      for (let k = 0; k < 3; k++) {
        const a = (age + k / 3) % 1
        ctx.strokeStyle = p.color
        ctx.globalAlpha = 1 - a
        ctx.lineWidth = 3 / view.z
        ctx.beginPath()
        ctx.arc(p.x, p.y, (8 + a * 50) / view.z, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = p.color
      ctx.font = `${13 / view.z}px Cinzel, Georgia, serif`
      ctx.fillText(p.name, p.x + 12 / view.z, p.y - 12 / view.z)
    }
    if (dragging && dragging.ghost) drawGhost(dragging.ghost, true)
    requestAnimationFrame(frame)
  }

  /** The map's layers, in order: the ground, pictures, the drawn floors and walls, props. */
  function drawLayers() {
    for (const l of scene.layers) {
      if (l.kind === 'rect') {
        ctx.fillStyle = l.color || '#222'
        ctx.fillRect(l.x, l.y, l.w, l.h)
        continue
      }
      const el = images.get(l.hash)
      if (!ready(el)) continue
      ctx.save()
      if (l.opacity != null) ctx.globalAlpha = l.opacity
      if (l.filter) ctx.filter = l.filter
      ctx.translate(l.x + l.w / 2, l.y + l.h / 2)
      if (l.rotate) ctx.rotate((l.rotate * Math.PI) / 180)
      if (l.flip) ctx.scale(-1, 1)
      ctx.drawImage(el, -l.w / 2, -l.h / 2, l.w, l.h)
      ctx.restore()
    }
  }

  const path = (c, multi) => {
    for (const poly of multi || [])
      for (const ring of poly) {
        ring.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
        c.closePath()
      }
  }
  const tint = (hex, a) => {
    const n = parseInt(String(hex || '#ffd28a').replace('#', ''), 16) || 0xffd28a
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const lightCanvas = document.createElement('canvas')
  /** Darkness, with the lights cut out of it, tinted by their colours (walls cast shadows). */
  function drawLight(t) {
    const lights = scene.lights || []
    const ambient = scene.ambient || 'day'
    if (!lights.length && ambient === 'day') return
    const b = bounds()
    lightCanvas.width = canvas.width
    lightCanvas.height = canvas.height
    const f = lightCanvas.getContext('2d')
    f.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr)
    const dark = ambient === 'dark' ? 0.92 : ambient === 'dusk' ? 0.5 : 0
    if (dark) {
      f.fillStyle = `rgba(6,8,14,${dark})`
      f.fillRect(b.x, b.y, b.w, b.h)
      f.globalCompositeOperation = 'destination-out'
      for (const l of lights) {
        const k = l.flicker ? 1 + Math.sin(t / 90 + l.x) * 0.03 + Math.sin(t / 37 + l.y) * 0.025 : 1
        const R = (l.bright + l.dim) * k
        const g = f.createRadialGradient(l.x, l.y, 0, l.x, l.y, R)
        g.addColorStop(0, 'rgba(0,0,0,1)')
        g.addColorStop(Math.min(0.98, (l.bright * k) / R), 'rgba(0,0,0,1)')
        g.addColorStop(Math.min(0.99, (l.bright * k) / R + 0.01), 'rgba(0,0,0,.55)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        f.save()
        f.beginPath()
        path(f, l.area)
        f.clip('evenodd')
        f.fillStyle = g
        f.fillRect(l.x - R, l.y - R, R * 2, R * 2)
        f.restore()
      }
      f.globalCompositeOperation = 'source-over'
    }
    f.globalCompositeOperation = 'lighter'
    for (const l of lights) {
      const k = l.flicker ? 0.85 + Math.sin(t / 70 + l.x * 0.3) * 0.1 + Math.sin(t / 23 + l.y) * 0.05 : 1
      const R = l.bright + l.dim
      const g = f.createRadialGradient(l.x, l.y, 0, l.x, l.y, R)
      g.addColorStop(0, tint(l.color, (ambient === 'day' ? 0.08 : 0.22) * k))
      g.addColorStop(1, tint(l.color, 0))
      f.save()
      f.beginPath()
      path(f, l.area)
      f.clip('evenodd')
      f.fillStyle = g
      f.fillRect(l.x - R, l.y - R, R * 2, R * 2)
      f.restore()
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(lightCanvas, 0, 0)
    ctx.restore()
  }

  /** What the party sees: clear; where it has been: dimmed; the rest: dark. Revealed areas are clear. */
  function drawSight() {
    const b = bounds()
    fogCanvas.width = canvas.width
    fogCanvas.height = canvas.height
    const f = fogCanvas.getContext('2d')
    f.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr)
    f.fillStyle = '#040406'
    f.fillRect(b.x - 5000, b.y - 5000, b.w + 10000, b.h + 10000)
    f.globalCompositeOperation = 'destination-out'
    if (scene.vision.explored?.length) {
      f.fillStyle = 'rgba(0,0,0,.45)'
      f.beginPath()
      path(f, scene.vision.explored)
      f.fill('evenodd')
    }
    f.fillStyle = '#000'
    f.beginPath()
    path(f, scene.vision.visible)
    f.fill('evenodd')
    for (const r of scene.reveals || []) {
      f.beginPath()
      if (r.points && r.points.length > 2) r.points.forEach(([x, y], i) => (i ? f.lineTo(x, y) : f.moveTo(x, y)))
      else f.rect(r.x, r.y, r.w, r.h)
      f.fill()
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(fogCanvas, 0, 0)
    ctx.restore()
  }

  function drawGrid() {
    const g = scene.grid
    if (!g || !g.show || !(g.size > 4) || g.type === 'none') return
    const b = bounds()
    ctx.strokeStyle = g.color || '#000'
    ctx.globalAlpha = g.opacity ?? 0.35
    ctx.lineWidth = 1 / view.z
    ctx.beginPath()
    if (g.type === 'hex') {
      const w = g.size, hh = (w * 2) / Math.sqrt(3), dy = hh * 0.75, ox = g.offsetX || 0, oy = g.offsetY || 0
      for (let r = Math.floor((b.y - oy) / dy) - 1; r <= Math.ceil((b.y + b.h - oy) / dy); r++) {
        const cy = oy + hh / 2 + r * dy
        const shift = ((r % 2) + 2) % 2 ? w / 2 : 0
        for (let c = Math.floor((b.x - ox - shift) / w) - 1; c <= Math.ceil((b.x + b.w - ox - shift) / w); c++) {
          const cx = ox + w / 2 + shift + c * w
          ctx.moveTo(cx, cy - hh / 2)
          ctx.lineTo(cx + w / 2, cy - hh / 4)
          ctx.lineTo(cx + w / 2, cy + hh / 4)
          ctx.lineTo(cx, cy + hh / 2)
          ctx.lineTo(cx - w / 2, cy + hh / 4)
        }
      }
      ctx.stroke()
      ctx.globalAlpha = 1
      return
    }
    const ox = (g.offsetX || 0) % g.size, oy = (g.offsetY || 0) % g.size
    for (let x = b.x + ox; x <= b.x + b.w; x += g.size) (ctx.moveTo(x, b.y), ctx.lineTo(x, b.y + b.h))
    for (let y = b.y + oy; y <= b.y + b.h; y += g.size) (ctx.moveTo(b.x, y), ctx.lineTo(b.x + b.w, y))
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  const fogCanvas = document.createElement('canvas')
  function drawFog() {
    if (!scene.fog) return
    const b = bounds()
    // Fog is drawn in screen space: darkness everywhere on the map, holes where it's revealed.
    fogCanvas.width = canvas.width
    fogCanvas.height = canvas.height
    const f = fogCanvas.getContext('2d')
    f.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr)
    f.fillStyle = 'rgba(8,6,4,0.96)'
    f.fillRect(b.x - 5000, b.y - 5000, b.w + 10000, b.h + 10000)
    f.globalCompositeOperation = 'destination-out'
    f.fillStyle = '#000'
    for (const r of scene.reveals || []) {
      f.beginPath()
      if (r.points && r.points.length > 2) r.points.forEach(([x, y], i) => (i ? f.lineTo(x, y) : f.moveTo(x, y)))
      else f.rect(r.x, r.y, r.w, r.h)
      f.fill()
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(fogCanvas, 0, 0)
    ctx.restore()
  }

  function drawToken(t, alpha = 1) {
    const r = Math.min(t.w, t.h) / 2
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(0,0,0,.45)'
    ctx.beginPath()
    ctx.arc(cx + r * 0.06, cy + r * 0.1, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = t.color || '#888'
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = r * 0.12
    ctx.strokeStyle = mine() === t.id ? '#e3c27a' : '#17130e'
    ctx.stroke()
    ctx.fillStyle = '#fff8e6'
    ctx.font = `700 ${r * 0.8}px Cinzel, Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((t.name || '?').slice(0, 2).toUpperCase(), cx, cy + r * 0.05)
    // name tag
    ctx.font = `600 ${Math.max(10, r * 0.42)}px EB Garamond, Georgia, serif`
    const label = t.name || ''
    const w = ctx.measureText(label).width + 10
    ctx.fillStyle = 'rgba(20,15,10,.85)'
    ctx.fillRect(cx - w / 2, cy + r + 3, w, r * 0.55)
    ctx.fillStyle = '#efe2c3'
    ctx.fillText(label, cx, cy + r + 3 + r * 0.28)
    if (t.maxHp) {
      const pct = Math.max(0, Math.min(1, (t.hp ?? 0) / t.maxHp))
      ctx.fillStyle = '#0e0b08'
      ctx.fillRect(cx - r, cy - r - r * 0.32, r * 2, r * 0.18)
      ctx.fillStyle = pct > 0.5 ? '#6fae55' : pct > 0.25 ? '#d6a43a' : '#c0573a'
      ctx.fillRect(cx - r, cy - r - r * 0.32, r * 2 * pct, r * 0.18)
    } else if (t.status) {
      ctx.fillStyle = '#c0573a'
      ctx.font = `italic ${Math.max(9, r * 0.36)}px EB Garamond, Georgia, serif`
      ctx.fillText(t.status, cx, cy - r - r * 0.2)
    }
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = 1
  }

  function drawGhost(p, live) {
    const t = (scene.tokens || []).find((x) => x.id === p.token)
    if (!t) return
    const gx = p.x - t.w / 2, gy = p.y - t.h / 2
    ctx.setLineDash([8 / view.z, 6 / view.z])
    ctx.strokeStyle = live ? '#ffffff' : '#e3c27a'
    ctx.lineWidth = 2.5 / view.z
    ctx.beginPath()
    ctx.moveTo(t.x + t.w / 2, t.y + t.h / 2)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.setLineDash([])
    drawToken({ ...t, x: gx, y: gy, maxHp: 0, status: '' }, 0.45)
  }

  /** The center of the grid square under a point (moves land on squares). */
  function snap(x, y, t) {
    const g = scene.grid
    if (!g || !(g.size > 4) || g.type === 'none') return [x, y]
    const s = g.size, ox = g.offsetX || 0, oy = g.offsetY || 0
    if (g.type === 'hex') {
      // The centre of the nearest pointy-top hex.
      const hh = (s * 2) / Math.sqrt(3), dy = hh * 0.75
      const r0 = Math.round((y - oy - hh / 2) / dy)
      let best = [x, y], bd = Infinity
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        const cy = oy + hh / 2 + r * dy
        const shift = ((r % 2) + 2) % 2 ? s / 2 : 0
        const cx = ox + s / 2 + shift + Math.round((x - ox - s / 2 - shift) / s) * s
        const d = Math.hypot(cx - x, cy - y)
        if (d < bd) (bd = d), (best = [cx, cy])
      }
      return best
    }
    const cells = Math.max(1, Math.round((t ? t.w : s) / s))
    const half = (cells * s) / 2
    return [Math.round((x - ox - half) / s) * s + ox + half, Math.round((y - oy - half) / s) * s + oy + half]
  }

  // ---------- input

  let dragging = null
  let stroke = null
  const pointers = new Map()
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, [e.offsetX, e.offsetY])
    if (pointers.size === 2) return (dragging = { pinch: pinchState() })
    const [wx, wy] = toWorld(e.offsetX, e.offsetY)
    if (tool === 'ping') return send({ t: 'ping', x: wx, y: wy })
    if (tool === 'draw') return (stroke = [[wx, wy]])
    if (tool === 'move') {
      const id = mine()
      const t = (scene.tokens || []).find((x) => x.id === id)
      if (!t) return toast('Choose your character first (on the right).')
      return (dragging = { move: t, ghost: null })
    }
    dragging = { pan: true, sx: e.offsetX, sy: e.offsetY, view: { ...view } }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.offsetX, e.offsetY])
    if (dragging && dragging.pinch && pointers.size === 2) {
      const p = pinchState(), s = dragging.pinch
      const z = Math.max(0.05, Math.min(8, s.view.z * (p.d / s.d)))
      const [wx, wy] = [s.cx / s.view.z + s.view.x, s.cy / s.view.z + s.view.y]
      view = { z, x: wx - p.cx / z, y: wy - p.cy / z }
      return
    }
    const [wx, wy] = toWorld(e.offsetX, e.offsetY)
    if (stroke) {
      const last = stroke[stroke.length - 1]
      if (Math.hypot(wx - last[0], wy - last[1]) * view.z > 3 && stroke.length < 1000) stroke.push([wx, wy])
      return
    }
    if (!dragging) return
    if (dragging.pan) view = { ...dragging.view, x: dragging.view.x - (e.offsetX - dragging.sx) / view.z, y: dragging.view.y - (e.offsetY - dragging.sy) / view.z }
    if (dragging.move) {
      const [sx, sy] = snap(wx, wy, dragging.move)
      dragging.ghost = { token: dragging.move.id, x: sx, y: sy }
    }
  })
  const end = (e) => {
    pointers.delete(e.pointerId)
    if (stroke) {
      if (stroke.length > 1) send({ t: 'draw', points: stroke.map(([x, y]) => [Math.round(x), Math.round(y)]) })
      stroke = null
    }
    if (dragging && dragging.move && dragging.ghost) send({ t: 'move', token: dragging.ghost.token, x: dragging.ghost.x, y: dragging.ghost.y })
    if (pointers.size < 2) dragging = null
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const f = Math.exp(-e.deltaY * 0.0015)
      const z = Math.max(0.05, Math.min(8, view.z * f))
      const [wx, wy] = toWorld(e.offsetX, e.offsetY)
      view = { z, x: wx - e.offsetX / z, y: wy - e.offsetY / z }
    },
    { passive: false },
  )
  function pinchState() {
    const [a, b] = [...pointers.values()]
    return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, view: { ...view } }
  }

  requestAnimationFrame(frame)
})()
