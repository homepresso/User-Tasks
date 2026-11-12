/**
 * Rich text fields (`type: 'rich_text'`): formatted text the person writes in
 * a small toolbar editor (components/forms/rich-text-field.tsx) — InfoPath's
 * rich text box.
 *
 * Stored value: a sanitised HTML string (or null). The browser's HTML is
 * never trusted: every submission is rebuilt by the allowlist sanitiser
 * (lib/html-sanitize.ts) with the narrow policy below —
 *   p, br, strong / b, em / i, u, s, ul, ol, li, h3, h4, blockquote, code,
 *   a[href] (https / mailto only; rel="noopener noreferrer", new tab).
 * `div` becomes `p`, h1 / h2 → h3, h5 / h6 → h4, strike / del → s; every
 * other element is unwrapped (its text kept) and script-like elements are
 * removed with their content. Plain text sent by an API / workflow becomes
 * paragraphs (one per line).
 *
 * Beside the value the server stores `<key>_text`: the same content as plain
 * text (CSV, summaries, workflow conditions, e-mails).
 *
 * Config `rich_text`: { max_length?: characters of TEXT (default 20000,
 * at most 100000), toolbar?: 'basic' (bold, italic, underline, lists, link,
 * clear — default) | 'full' (adds strikethrough, headings, quote, code) }.
 *
 * Pure and isomorphic.
 */

import { escapeHtml, htmlToPlainText, looksLikeHtml, sanitizeHtml, type SanitizeOptions } from '@/lib/html-sanitize'
import { isPlainObject } from '@/lib/utils/guards'

export type RichTextToolbar = 'basic' | 'full'
export const RICH_TEXT_TOOLBARS: RichTextToolbar[] = ['basic', 'full']

export interface RichTextConfig {
  /** Longest text in characters (the words, not the markup). Default 20000, at most 100000. */
  max_length?: number
  /** basic (default) or full. */
  toolbar?: RichTextToolbar
}

export const RICH_TEXT_DEFAULT_MAX = 20_000
export const RICH_TEXT_MAX = 100_000
/** Markup allowed per character of text, on top of a fixed allowance (a hard cap on what is stored). */
const HTML_OVERHEAD = 8

/** The rich text allowlist: element → attributes. */
export const RICH_TEXT_TAGS: Readonly<Record<string, readonly string[]>> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [],
  ul: [], ol: [], li: [], h3: [], h4: [], blockquote: [], code: [],
  a: ['href'],
}

const POLICY: SanitizeOptions = {
  tags: RICH_TEXT_TAGS,
  hrefSchemes: ['https', 'mailto'],
  relativeLinks: false,
  rename: { div: 'p', h1: 'h3', h2: 'h3', h5: 'h4', h6: 'h4', strike: 's', del: 's', ins: 'u', pre: 'p' },
  closeParagraphBefore: new Set(['p', 'ul', 'ol', 'h3', 'h4', 'blockquote']),
}

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote'])

/**
 * Sanitised HTML → every top-level run of text / inline markup in its own
 * paragraph ("intro<ul>…</ul>" → "<p>intro</p><ul>…</ul>"); blank runs
 * dropped. The input is the sanitiser's output: well-formed, allowlisted.
 */
function wrapTopLevelRuns(html: string): string {
  let out = ''
  let run = ''
  let depth = 0
  let inRun = false
  const flush = () => {
    if (run.replace(/<br>/g, '').replace(/&nbsp;/g, ' ').trim()) out += `<p>${run.trim()}</p>`
    run = ''
  }
  const re = /<(\/?)([a-z0-9]+)[^>]*>|[^<]+/g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const token = m[0]
    const name = m[2]
    const closing = m[1] === '/'
    if (depth === 0) {
      if (name && BLOCK_TAGS.has(name) && !closing) { flush(); inRun = false; out += token; depth = 1; continue }
      run += token
      inRun = true
      if (name && !closing && name !== 'br') depth = 1
      continue
    }
    if (inRun) run += token
    else out += token
    if (name && name !== 'br') depth += closing ? -1 : 1
  }
  flush()
  return out
}

const BLOCK = /<(?:p|ul|ol|li|h3|h4|blockquote)[\s>]/

/** The key the plain-text copy is stored under. */
export function richTextTextKey(key: string): string {
  return `${key}_text`
}

export function normalizeRichTextConfig(raw: unknown): RichTextConfig {
  const out: RichTextConfig = {}
  if (!isPlainObject(raw)) return out
  const max = Number(raw.max_length)
  if (raw.max_length !== undefined && raw.max_length !== null && raw.max_length !== '' && Number.isFinite(max) && max > 0) {
    out.max_length = Math.min(Math.floor(max), RICH_TEXT_MAX)
  }
  if (raw.toolbar === 'full' || raw.toolbar === 'basic') out.toolbar = raw.toolbar
  return out
}

export function richTextMaxLength(config: RichTextConfig | undefined): number {
  return config?.max_length ?? RICH_TEXT_DEFAULT_MAX
}

/**
 * Untrusted input → the stored HTML ('' when there is no text). Plain text
 * (no markup) becomes one paragraph per line. Idempotent.
 */
export function sanitizeRichText(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
  if (!raw.trim()) return ''
  let clean = looksLikeHtml(raw) ? sanitizeHtml(raw, POLICY).trim() : raw.split(/\r?\n/).map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`).join('')
  // Text with inline markup only ("Hi <b>there</b>", "a <b> c"): one paragraph per line, balanced again.
  if (!BLOCK.test(clean)) clean = sanitizeHtml(clean.split(/\r?\n/).map((line) => `<p>${line || '<br>'}</p>`).join(''), POLICY)
  // Loose text beside blocks (what contentEditable makes of a first line): its own paragraph.
  else clean = wrapTopLevelRuns(clean)
  clean = clean.replace(/<p><\/p>/g, '')
  return richTextPlainText(clean) ? clean : ''
}

/** The plain text of a rich text value (any input: sanitised first). */
export function richTextPlainText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return htmlToPlainText(looksLikeHtml(value) ? sanitizeHtml(value, POLICY) : value)
}

/** Nothing written: no value, or markup without text ("<p><br></p>"). */
export function isBlankRichText(value: unknown): boolean {
  return !richTextPlainText(value)
}

/** A problem with a submitted value (the shape and the length of its text); null when fine. */
export function richTextValueError(field: { label: string; rich_text?: RichTextConfig }, value: unknown): string | null {
  if (typeof value !== 'string') return `${field.label} must be text`
  const max = richTextMaxLength(field.rich_text)
  if (value.length > max * HTML_OVERHEAD + 10_000) return `${field.label} is too long`
  const length = richTextPlainText(value).length
  if (length > max) return `${field.label} must be at most ${max} characters (now ${length})`
  return null
}
