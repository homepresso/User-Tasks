/* Injected into each audited page by scripts/theme-audit/run.ts (window.__themeAudit). Plain browser JS. */
(() => {
// Runs in the page: candidate text runs with their rects + metadata.
function collectText() {
  // SVG labels (connector labels, chart ticks) usually sit in pointer-events:none layers, which
  // elementFromPoint looks through; let it hit them while collecting so they're measured too.
  const hit = document.createElement('style')
  hit.textContent = 'svg text, svg tspan{pointer-events:all!important}'
  document.head.appendChild(hit)
  try { return collectTextRuns() } finally { hit.remove() }
}
function collectTextRuns() {
  const out = []
  const vw = innerWidth, vh = innerHeight
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Map()
  while (walker.nextNode()) {
    const t = walker.currentNode
    if (!t.textContent.trim()) continue
    const el = t.parentElement
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE'].includes(el.tagName)) continue
    const r = document.createRange(); r.selectNodeContents(t)
    const raw = r.getBoundingClientRect()
    // Clip to ancestors that clip their overflow (scroll panes, truncated cells, canvases under side panels).
    let L = raw.left, T = raw.top, R = raw.right, B = raw.bottom
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const st = getComputedStyle(e)
      if (/(hidden|clip|auto|scroll)/.test(st.overflowX + st.overflowY)) {
        const b = e.getBoundingClientRect()
        L = Math.max(L, b.left); T = Math.max(T, b.top); R = Math.min(R, b.right); B = Math.min(B, b.bottom)
      }
    }
    const rect = { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T }
    if (rect.width < 2 || rect.height < 4 || rect.width * rect.height < 0.4 * raw.width * raw.height) continue
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) continue
    const prev = seen.get(el)
    if (prev) { prev.text += ' ' + t.textContent.trim(); continue }
    const item = { el, rect, text: t.textContent.trim() }
    seen.set(el, item); out.push(item)
  }
  const sigOf = (e) => {
    const cls = (e.getAttribute('class') || '').split(/\s+/).filter((c) => /^(dark:|hover:|group-hover:)?(text|bg|from|via|to|opacity)-/.test(c) || /themed|prose|badge/.test(c)).join(' ')
    const st = (e.getAttribute('style') || '').split(';').filter((s) => /(^|\s)(color|background(-color)?|opacity|fill)\s*:/.test(s)).map((s) => s.trim()).join('; ')
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls.replace(/\s+/g, '.') : ''}${st ? `{${st}}` : ''}`
  }
  const res = []
  for (const it of out) {
    const el = it.el
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const isSvg = el instanceof SVGElement
    let op = isSvg ? (parseFloat(cs.fillOpacity) || 1) : 1
    for (let e = el; e; e = e.parentElement) { const o = parseFloat(getComputedStyle(e).opacity); op *= isNaN(o) ? 1 : o }
    if (op < 0.05) continue
    const cx = Math.min(vw - 1, Math.max(0, it.rect.left + it.rect.width / 2)), cy = Math.min(vh - 1, Math.max(0, it.rect.top + it.rect.height / 2))
    const top = document.elementFromPoint(cx, cy)
    if (!top || !(top === el || el.contains(top) || top.contains(el))) continue
    const disabled = !!el.closest(':disabled, [aria-disabled="true"], [data-disabled]')
    const anc = []
    for (let e = el.parentElement, i = 0; e && i < 3; e = e.parentElement, i++) anc.push(sigOf(e))
    const comp = el.closest('[role="dialog"]') ? 'dialog' : el.closest('aside, nav, .themed-sidebar, .premium-sidebar') ? 'sidebar' : el.closest('header, .themed-topbar') ? 'topbar' : el.closest('[role="menu"], [role="listbox"]') ? 'menu' : 'main'
    res.push({
      text: it.text.slice(0, 60), x: it.rect.left, y: it.rect.top, w: it.rect.width, h: it.rect.height,
      color: isSvg ? cs.fill : cs.color, fill: isSvg ? cs.fill : cs.webkitTextFillColor, opacity: op, fontSize: parseFloat(cs.fontSize), fontWeight: parseInt(cs.fontWeight, 10) || 400,
      disabled, sig: sigOf(el), anc, comp,
    })
  }
  return res
}

// Runs in the page: sample the text-less screenshot under each run and compute contrast.
async function sampleContrast({ png, items }) {
  const img = new Image()
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = 'data:image/png;base64,' + png })
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0)
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) { const m2 = s.match(/color\(srgb ([^)]+)\)/); if (!m2) return null; const p = m2[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] ?? 1 } } const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const out = []
  for (const it of items) {
    let fg = parse(it.fill && it.fill !== it.color && !/rgba?\(0, 0, 0, 0\)/.test(it.fill) ? it.fill : it.color)
    if (!fg) continue
    const a = (fg.a ?? 1) * it.opacity
    const x0 = Math.max(0, Math.floor(it.x + 1)), y0 = Math.max(0, Math.floor(it.y + 1)), x1 = Math.min(c.width - 1, Math.ceil(it.x + it.w - 1)), y1 = Math.min(c.height - 1, Math.ceil(it.y + it.h - 1))
    if (x1 <= x0 || y1 <= y0) continue
    const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data
    const W = x1 - x0 + 1, H = y1 - y0 + 1
    const samples = []
    const nx = Math.min(9, W), ny = Math.min(3, H)
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const px = Math.floor((i + 0.5) * W / nx), py = Math.floor((j + 0.5) * H / ny)
      const k = (py * W + px) * 4
      samples.push({ r: data[k], g: data[k + 1], b: data[k + 2] })
    }
    const rs = samples.map((bg) => {
      const f = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }
      return { r: ratio(f, bg), bg, f }
    }).sort((p, q) => p.r - q.r)
    const med = rs[Math.floor(rs.length / 2)]
    out.push({ ...it, ratio: Math.round(med.r * 100) / 100, bg: hex(med.bg), fg: hex(med.f) })
  }
  return out
}


window.__themeAudit = { collectText, sampleContrast }
})()
