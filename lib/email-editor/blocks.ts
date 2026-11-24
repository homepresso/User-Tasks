/**
 * The email Design tab's block model and its HTML.
 *
 * A design is a list of blocks (header / logo, heading, rich text, button,
 * image, divider, spacer, two columns, footer) plus a few settings (accent,
 * colours, width). `designToHtml` turns it into email-safe HTML: table
 * layout, inline styles, a bulletproof button, two columns that stack on
 * narrow screens without media queries (with an Outlook ghost table), and a
 * small `prefers-color-scheme: dark` block. The design itself travels in a
 * comment at the end of the HTML (`<!--ut-design:v1:…-->`), so the HTML stays the
 * source of truth: `readDesign` gives the blocks back only while the HTML is
 * still exactly what they generate (whitespace and the preheader aside) —
 * once the HTML is hand-edited beyond that, the Design tab is read-only.
 * Pure.
 */

import { escapeHtml, tokenizeHtml, attrValue } from './html-tokens'

export interface DesignSettings {
  accent: string
  /** Text on the accent (button label). */
  accentText: string
  background: string
  content: string
  text: string
  muted: string
  /** Content width in px (480–720). */
  width: number
  font: string
}

export type DesignBlock =
  | { id: string; type: 'header'; logoUrl?: string; wordmark?: string; align?: 'left' | 'center' }
  | { id: string; type: 'heading'; text: string; level?: 1 | 2 | 3 }
  | { id: string; type: 'text'; html: string }
  | { id: string; type: 'button'; label: string; url: string; align?: 'left' | 'center' }
  | { id: string; type: 'image'; src: string; alt?: string; width?: number; href?: string; align?: 'left' | 'center' }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height?: number }
  | { id: string; type: 'columns'; left: string; right: string }
  | { id: string; type: 'footer'; html: string }

export type DesignBlockType = DesignBlock['type']

export interface EmailDesign {
  version: 1
  settings: DesignSettings
  blocks: DesignBlock[]
}

export const DEFAULT_DESIGN_SETTINGS: DesignSettings = {
  accent: '#2563EB',
  accentText: '#FFFFFF',
  background: '#F4F4F5',
  content: '#FFFFFF',
  text: '#18181B',
  muted: '#71717A',
  width: 600,
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

let idCounter = 0
export function newBlockId(): string {
  idCounter = (idCounter + 1) % 1_000_000
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function newBlock(type: DesignBlockType): DesignBlock {
  const id = newBlockId()
  switch (type) {
    case 'header': return { id, type, wordmark: 'Your workspace', align: 'left' }
    case 'heading': return { id, type, text: 'A clear headline', level: 1 }
    case 'text': return { id, type, html: '<p>Write your message here. Use <strong>variables</strong> like {{user_task_title}}.</p>' }
    case 'button': return { id, type, label: 'Open task', url: '{{task_url}}', align: 'left' }
    case 'image': return { id, type, src: 'https://placehold.co/600x240/png', alt: 'Image description', width: 536, align: 'center' }
    case 'divider': return { id, type }
    case 'spacer': return { id, type, height: 24 }
    case 'columns': return { id, type, left: '<p><strong>Left column</strong><br>Details go here.</p>', right: '<p><strong>Right column</strong><br>More details.</p>' }
    case 'footer': return { id, type, html: '<p>Sent by a UserTasks workflow.</p>' }
  }
}

// ── rich text sanitising (text / columns / footer blocks) ────────────────────

const RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'span'])

export function safeHref(href: string | null | undefined): string | null {
  const value = String(href ?? '').trim()
  if (!value) return null
  if (/^(https?:|mailto:|tel:)/i.test(value) || /^\{\{[\w.\-[\]]+\}\}/.test(value)) return value
  return null
}

/** Keep only simple formatting (bold, italic, underline, links, lists, paragraphs). */
export function sanitizeRichText(html: string): string {
  const out: string[] = []
  const open: string[] = []
  for (const token of tokenizeHtml(String(html ?? ''))) {
    if (token.kind === 'text') out.push(token.text.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    else if (token.kind === 'open') {
      let name = token.name
      if (name === 'div') name = 'p'
      if (name === 'b') name = 'strong'
      if (name === 'i') name = 'em'
      if (!RICH_TAGS.has(name)) continue
      if (name === 'br') { out.push('<br>'); continue }
      if (name === 'a') {
        const href = safeHref(attrValue(token.attrs, 'href'))
        if (!href) continue
        out.push(`<a href="${escapeHtml(href)}">`)
      } else out.push(`<${name}>`)
      if (name !== 'span') open.push(name)
      else open.push('span')
    } else if (token.kind === 'close') {
      let name = token.name
      if (name === 'div') name = 'p'
      if (name === 'b') name = 'strong'
      if (name === 'i') name = 'em'
      const at = open.lastIndexOf(name)
      if (at === -1) continue
      for (let k = open.length - 1; k >= at; k--) out.push(`</${open[k]}>`)
      open.length = at
    }
  }
  for (let k = open.length - 1; k >= 0; k--) out.push(`</${open[k]}>`)
  return out.join('').replace(/<span>([\s\S]*?)<\/span>/g, '$1').replace(/<p>\s*<\/p>/g, '').trim()
}

/** Inline-styled rich text for the email. */
function styledRichText(html: string, s: DesignSettings, color: string, size: number): string {
  const clean = sanitizeRichText(html)
  return clean
    .replace(/<p>/g, `<p style="margin:0 0 12px;font-size:${size}px;line-height:1.6;color:${color};">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 12px;padding-left:22px;color:${color};">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 12px;padding-left:22px;color:${color};">`)
    .replace(/<li>/g, `<li style="margin:0 0 4px;font-size:${size}px;line-height:1.6;">`)
    .replace(/<a href="/g, `<a style="color:${s.accent};text-decoration:underline;" href="`)
}

// ── HTML generation ──────────────────────────────────────────────────────────

function settingsOf(design: EmailDesign): DesignSettings {
  const s = { ...DEFAULT_DESIGN_SETTINGS, ...(design.settings ?? {}) }
  for (const key of ['accent', 'accentText', 'background', 'content', 'text', 'muted'] as const) if (!HEX.test(s[key])) s[key] = DEFAULT_DESIGN_SETTINGS[key]
  s.width = Math.min(720, Math.max(480, Math.round(Number(s.width) || 600)))
  if (/[<>"{};]/.test(s.font)) s.font = DEFAULT_DESIGN_SETTINGS.font
  return s
}

const pad = (s: DesignSettings) => `padding:8px 32px;font-family:${s.font};`

function blockHtml(block: DesignBlock, s: DesignSettings): string {
  const inner = s.width - 64
  switch (block.type) {
    case 'header': {
      const align = block.align === 'center' ? 'center' : 'left'
      const logo = safeHref(block.logoUrl)
      const mark = logo
        ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(block.wordmark || 'Logo')}" height="36" style="display:inline-block;height:36px;width:auto;border:0;">`
        : `<span class="ut-text" style="font-size:20px;font-weight:700;color:${s.text};">${escapeHtml(block.wordmark || '')}</span>`
      return `<tr><td align="${align}" style="padding:24px 32px 12px;font-family:${s.font};text-align:${align};">${mark}</td></tr>`
    }
    case 'heading': {
      const level = block.level === 2 || block.level === 3 ? block.level : 1
      const size = level === 1 ? 26 : level === 2 ? 20 : 17
      return `<tr><td style="${pad(s)}"><h${level} class="ut-text" style="margin:0;font-size:${size}px;line-height:1.3;font-weight:700;color:${s.text};">${escapeHtml(block.text)}</h${level}></td></tr>`
    }
    case 'text':
      return `<tr><td class="ut-text" style="${pad(s)}color:${s.text};">${styledRichText(block.html, s, s.text, 15)}</td></tr>`
    case 'button': {
      const align = block.align === 'center' ? 'center' : 'left'
      const url = safeHref(block.url) ?? '#'
      return `<tr><td align="${align}" style="padding:12px 32px;font-family:${s.font};">`
        + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${align === 'center' ? ' align="center"' : ''}><tr>`
        + `<td class="ut-btn" bgcolor="${s.accent}" style="background-color:${s.accent};border-radius:8px;">`
        + `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 24px;font-family:${s.font};font-size:15px;font-weight:600;line-height:1.2;color:${s.accentText};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>`
        + `</td></tr></table></td></tr>`
    }
    case 'image': {
      const src = safeHref(block.src)
      if (!src) return ''
      const width = Math.min(inner, Math.max(16, Math.round(Number(block.width) || inner)))
      const align = block.align === 'left' ? 'left' : 'center'
      const img = `<img src="${escapeHtml(src)}" width="${width}" alt="${escapeHtml(block.alt ?? '')}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;${align === 'center' ? 'margin:0 auto;' : ''}">`
      const href = safeHref(block.href)
      return `<tr><td align="${align}" style="padding:8px 32px;">${href ? `<a href="${escapeHtml(href)}">${img}</a>` : img}</td></tr>`
    }
    case 'divider':
      return `<tr><td style="padding:16px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ut-rule" style="border-top:1px solid #E4E4E7;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>`
    case 'spacer': {
      const h = Math.min(120, Math.max(4, Math.round(Number(block.height) || 24)))
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`
    }
    case 'columns': {
      const col = Math.floor((inner - 16) / 2)
      const cell = (html: string) => `<div style="display:inline-block;width:100%;max-width:${col}px;vertical-align:top;font-family:${s.font};">`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="ut-text" style="padding:0 0 8px;font-family:${s.font};color:${s.text};text-align:left;">${styledRichText(html, s, s.text, 14)}</td></tr></table></div>`
      return `<tr><td style="padding:8px 32px;font-size:0;text-align:left;">`
        + `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${col}" valign="top"><![endif]-->`
        + cell(block.left)
        + `<!--[if mso]></td><td width="16"></td><td width="${col}" valign="top"><![endif]-->`
        + `<div style="display:inline-block;width:16px;font-size:0;line-height:0;">&nbsp;</div>`
        + cell(block.right)
        + `<!--[if mso]></td></tr></table><![endif]-->`
        + `</td></tr>`
    }
    case 'footer':
      return `<tr><td class="ut-muted" style="padding:16px 32px 28px;font-family:${s.font};text-align:center;color:${s.muted};">${styledRichText(block.html, s, s.muted, 12)}</td></tr>`
  }
}

// base64 of UTF-8 (browser and Node 16+ both have btoa / atob / TextEncoder).
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function fromBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const MARKER_RE = /<!--ut-design:v1:([A-Za-z0-9+/=]+)-->/

/** The design's blocks only (no marker), for comparison. */
function designBody(design: EmailDesign): string {
  const s = settingsOf(design)
  const rows = design.blocks.map((b) => blockHtml(b, s)).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
@media (prefers-color-scheme: dark) {
  .ut-bg { background-color: #18181B !important; }
  .ut-card { background-color: #27272A !important; }
  .ut-text, .ut-text p, .ut-text li { color: #F4F4F5 !important; }
  .ut-muted, .ut-muted p { color: #A1A1AA !important; }
  .ut-rule { border-color: #3F3F46 !important; }
  .ut-btn { border: 1px solid #71717A !important; }
  .ut-text a, .ut-muted a { color: #93C5FD !important; }
}
</style>
</head>
<body class="ut-bg" style="margin:0;padding:0;background-color:${s.background};">
<table role="presentation" class="ut-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${s.background}" style="background-color:${s.background};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="ut-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${s.content}" style="max-width:${s.width}px;background-color:${s.content};border-radius:12px;">
${rows}
</table>
</td></tr>
</table>
</body>
</html>
`
}

export function designToHtml(design: EmailDesign): string {
  const body = designBody(design)
  const marker = `<!--ut-design:v1:${toBase64(JSON.stringify({ version: 1, settings: design.settings, blocks: design.blocks }))}-->`
  // At the very end, out of the way of whoever reads the HTML.
  return `${body}${marker}\n`
}

/** Whitespace-, marker- and preheader-insensitive form for comparison. */
export function normalizeForCompare(html: string): string {
  return String(html ?? '')
    .replace(MARKER_RE, '')
    .replace(/<div data-preheader[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ReadDesignResult {
  design: EmailDesign | null
  /** The HTML is still what the design generates (the Design tab can edit it). */
  editable: boolean
}

export function readDesign(html: string): ReadDesignResult {
  const m = MARKER_RE.exec(String(html ?? ''))
  if (!m) return { design: null, editable: false }
  let design: EmailDesign
  try {
    const parsed = JSON.parse(fromBase64(m[1]))
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.blocks)) return { design: null, editable: false }
    design = { version: 1, settings: { ...DEFAULT_DESIGN_SETTINGS, ...(parsed.settings ?? {}) }, blocks: (parsed.blocks as Array<Partial<DesignBlock> | null>).filter((b): b is DesignBlock => !!b && typeof b.type === 'string' && typeof b.id === 'string') }
  } catch {
    return { design: null, editable: false }
  }
  return { design, editable: normalizeForCompare(designBody(design)) === normalizeForCompare(html) }
}

export function emptyDesign(settings: Partial<DesignSettings> = {}): EmailDesign {
  return { version: 1, settings: { ...DEFAULT_DESIGN_SETTINGS, ...settings }, blocks: [] }
}
