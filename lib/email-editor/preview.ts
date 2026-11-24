/**
 * The document the email preview iframe shows (srcdoc). The iframe itself is
 * sandboxed with no permissions (no scripts, forms, popups or same-origin);
 * on top of that this document:
 *   - is sanitised with the template sanitiser (lib/email-templates), and
 *     any remaining <script>, <base> and <meta http-equiv="refresh"> removed;
 *   - carries a Content-Security-Policy: no scripts, no frames, no fetches,
 *     inline styles only, images from https/data only when remote images are
 *     allowed (otherwise data: only, like a client that blocks images);
 *   - opens links in a new tab instead of navigating the frame;
 *   - in dark mode simulates email clients: rules inside
 *     `@media (prefers-color-scheme: dark)` apply (Apple Mail, Outlook.com);
 *     a template without them is colour-inverted the way Gmail / Outlook
 *     apps do (images kept as they are).
 * Pure.
 */

import { sanitizeEmailHtml } from '@/lib/email-templates'
import { escapeHtml } from './html-tokens'

export interface PreviewOptions {
  dark?: boolean
  /** Load https images (default true). */
  remoteImages?: boolean
  /** Inbox-style header with subject / preheader above the body. */
  envelope?: { subject: string; preheader?: string; from?: string } | null
}

export function previewCsp(remoteImages: boolean): string {
  return [
    "default-src 'none'",
    "script-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "style-src 'unsafe-inline'",
    `img-src data: cid:${remoteImages ? ' https: http:' : ''}`,
    `font-src data:${remoteImages ? ' https:' : ''}`,
  ].join('; ')
}

/** Extra hardening beyond the template sanitiser (preview only). */
export function stripActiveContent(html: string): string {
  return sanitizeEmailHtml(html)
    .replace(/<\s*script\b[^>]*>[\s\S]*?(<\s*\/\s*script\s*>|$)/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|base)\b[^>]*\/?>/gi, '')
    .replace(/<\s*meta\b[^>]*http-equiv[^>]*>/gi, '')
    .replace(/<\s*link\b[^>]*>/gi, '')
}

/** Activate `prefers-color-scheme: dark` rules; deactivate light-only ones. */
export function forceDarkMediaRules(html: string): { html: string; hadDarkRules: boolean } {
  let hadDarkRules = false
  const out = html.replace(/@media([^{]*)\{/gi, (whole, query: string) => {
    if (/prefers-color-scheme\s*:\s*dark/i.test(query)) {
      hadDarkRules = true
      const rest = query.replace(/(and\s*)?\(\s*prefers-color-scheme\s*:\s*dark\s*\)(\s*and)?/i, '').trim()
      return `@media ${rest || 'all'} {`
    }
    if (/prefers-color-scheme\s*:\s*light/i.test(query)) return '@media not all {'
    return whole
  })
  // Outlook.com / Office dark-mode attribute selectors.
  return { html: out.replace(/\[data-ogsc\]\s*/g, '').replace(/\[data-ogsb\]\s*/g, ''), hadDarkRules }
}

const INVERT_CSS = `html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}`

const FRAME_CSS = `html,body{margin:0}body{overflow-wrap:break-word}`

function envelopeHtml(envelope: NonNullable<PreviewOptions['envelope']>, dark: boolean): string {
  const fg = dark ? '#e8e6e3' : '#1f1f1f'
  const muted = dark ? '#a8a49d' : '#5f6368'
  const bg = dark ? '#1f1f1f' : '#ffffff'
  const border = dark ? '#3c3c3c' : '#e5e5e5'
  return `<div data-preview-envelope style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:${bg};color:${fg};padding:14px 18px;border-bottom:1px solid ${border}">`
    + `<div style="font-size:17px;font-weight:600;line-height:1.35">${escapeHtml(envelope.subject || '(no subject)')}</div>`
    + `<div style="font-size:12px;color:${muted};margin-top:4px">${escapeHtml(envelope.from || 'UserTasks')} · to me</div>`
    + (envelope.preheader ? `<div style="font-size:12px;color:${muted};margin-top:6px"><span style="font-weight:600">Inbox preview:</span> ${escapeHtml(envelope.preheader)}</div>` : '')
    + `</div>`
}

export function buildPreviewDocument(html: string, options: PreviewOptions = {}): string {
  const dark = !!options.dark
  const remoteImages = options.remoteImages !== false
  let body = stripActiveContent(String(html ?? ''))
  let invert = false
  if (dark) {
    const forced = forceDarkMediaRules(body)
    body = forced.html
    invert = !forced.hadDarkRules
  }
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp(remoteImages)}"><base target="_blank"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}"><style>${FRAME_CSS}${invert ? INVERT_CSS : ''}</style>`
  const envelope = options.envelope ? envelopeHtml(options.envelope, dark) : ''
  // A full document: put our head first and the envelope at the top of <body>.
  if (/<html[\s>]/i.test(body)) {
    let doc = /<head[\s>]/i.test(body) ? body.replace(/<head([^>]*)>/i, `<head$1>${head}`) : body.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`)
    if (envelope) doc = /<body[\s>]/i.test(doc) ? doc.replace(/<body([^>]*)>/i, `<body$1>${envelope}`) : doc.replace(/<\/head>/i, `</head>${envelope}`)
    return /^\s*<!doctype/i.test(doc) ? doc : `<!doctype html>${doc}`
  }
  return `<!doctype html><html><head>${head}</head><body>${envelope}${body}</body></html>`
}

/** The preheader (hidden inbox preview text) a template carries, if any. */
export function extractPreheader(html: string): string {
  const m = /<(div|span)[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(html)
  if (!m) return ''
  return m[2].replace(/<[^>]+>/g, '').replace(/&(zwnj|nbsp|#8204|#847|#160);/gi, '').replace(/[‌͏ ]/g, '').replace(/\s+/g, ' ').trim()
}

/** Set (or remove) the hidden preheader right after <body> (or at the top). */
export function setPreheader(html: string, preheader: string): string {
  const marker = /<div data-preheader[^>]*>[\s\S]*?<\/div>\s*/i
  const without = html.replace(marker, '')
  if (!preheader.trim()) return without
  const block = `<div data-preheader style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader.trim())}${'&#8204;&nbsp;'.repeat(20)}</div>\n`
  if (/<body[^>]*>/i.test(without)) return without.replace(/<body([^>]*)>/i, (m) => `${m}${block}`)
  return block + without
}
