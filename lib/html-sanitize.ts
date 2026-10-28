/**
 * Allowlist HTML sanitiser for rich task descriptions.
 *
 * Isomorphic (no DOM): a small tokenizer rebuilds the markup from scratch, so
 * only allowlisted elements and attributes ever reach the output — every
 * other byte is re-escaped as text. Used on every task-description write and
 * again at render time (defence in depth), on the server and in the browser.
 *
 *   - allowed elements: see ALLOWED_TAGS (formatting, lists, headings,
 *     quotes, code, tables, links, https images); no style/class/id/on*.
 *   - script-like elements (script, style, iframe, object, embed, svg, math,
 *     form, template, …) are removed together with their content.
 *   - other real HTML elements (font, center, input, …) are unwrapped: the
 *     tag goes, its text stays.
 *   - anything that only looks like a tag (`<customer name>`) is kept as
 *     literal text, so plain-text descriptions don't lose words.
 *   - links: http(s)/mailto or relative, always rel="noopener noreferrer"
 *     target="_blank"; images: absolute https only (dropped otherwise). URLs are checked after
 *     entity decoding and whitespace/control-character removal.
 */

/* Element → allowed attributes. */
const ALLOWED_TAGS: Record<string, readonly string[]> = {
  p: [], br: [], div: [], span: [], hr: [],
  strong: [], b: [], em: [], i: [], u: [], s: [], sub: [], sup: [],
  a: ['href', 'title'],
  ul: [], ol: ['start'], li: [],
  h1: [], h2: [], h3: [], h4: [],
  blockquote: [], code: [], pre: [],
  table: [], thead: [], tbody: [], tr: [], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
  img: ['src', 'alt', 'width', 'height'],
}

/** Allowed elements, for docs and tests. */
export const ALLOWED_HTML_TAGS = Object.keys(ALLOWED_TAGS)

const VOID_TAGS = new Set(['br', 'hr', 'img'])

/** Removed with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template',
  'noscript', 'noembed', 'noframes', 'textarea', 'title', 'xmp', 'plaintext', 'svg', 'math',
  'form', 'select', 'head', 'canvas', 'audio', 'video', 'button',
])

/** Real HTML elements outside the allowlist: unwrapped (tag dropped, text kept). */
const KNOWN_HTML_TAGS = new Set([
  'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'base', 'basefont', 'bdi', 'bdo', 'big',
  'blink', 'body', 'caption', 'center', 'cite', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
  'details', 'dfn', 'dialog', 'dir', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'font', 'footer',
  'h5', 'h6', 'header', 'hgroup', 'html', 'image', 'input', 'ins', 'isindex', 'kbd', 'keygen', 'label',
  'legend', 'link', 'listing', 'main', 'map', 'mark', 'marquee', 'menu', 'menuitem', 'meta', 'meter',
  'nav', 'nobr', 'optgroup', 'option', 'output', 'param', 'picture', 'portal', 'progress', 'q', 'rb',
  'rp', 'rt', 'rtc', 'ruby', 'samp', 'search', 'section', 'slot', 'small', 'source', 'spacer', 'strike',
  'summary', 'tfoot', 'time', 'track', 'tt', 'var', 'wbr',
])

const NBSP = String.fromCharCode(0xa0)

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: NBSP, colon: ':', tab: '\t', newline: '\n',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
  copy: '©', reg: '®', trade: '™', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£',
}

const ENTITY_IN_TEXT = /^&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Decode character references (numeric ones without `;` too, as browsers do in attributes). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+);?|&([a-z][a-z0-9]*);/gi, (match, numeric: string | undefined, name: string | undefined) => {
    if (numeric) {
      const code = numeric[1] === 'x' || numeric[1] === 'X' ? parseInt(numeric.slice(2), 16) : parseInt(numeric.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return String.fromCharCode(0xfffd)
      return String.fromCodePoint(code)
    }
    const decoded = NAMED_ENTITIES[name!.toLowerCase()]
    return decoded ?? match
  })
}

/** Text: keep valid character references, escape everything markup-significant. */
function escapeText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else if (ch === '&') {
      const entity = ENTITY_IN_TEXT.exec(text.slice(i, i + 40))
      if (entity) { out += entity[0]; i += entity[0].length - 1 } else out += '&amp;'
    } else out += ch
  }
  return out
}

/** Control characters, whitespace and invisible separators (browsers ignore them inside URL schemes). */
const URL_NOISE = new RegExp(`[${[[0x00, 0x20], [0x7f, 0xa0], [0x1680], [0x2000, 0x200f], [0x2028, 0x2029], [0x202f], [0x205f], [0x3000], [0xfeff]]
  .map((range) => range.map((code) => '\\u' + code.toString(16).padStart(4, '0')).join('-')).join('')}]`, 'g')

function cleanUrl(raw: string): string {
  return decodeEntities(raw).replace(URL_NOISE, (ch) => (ch === ' ' ? '%20' : '')).replace(/^(%20)+|(%20)+$/g, '')
}

function safeHref(raw: string): string | null {
  const url = cleanUrl(raw)
  if (!url) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (!scheme) return url.startsWith('\\') ? null : url // relative (/path, #anchor, ?q, page)
  return ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase()) ? url : null
}

function safeImgSrc(raw: string): string | null {
  const url = cleanUrl(raw)
  return /^https:\/\/[^/\\]/i.test(url) ? url : null
}

interface Tag { name: string; closing: boolean; attrs: Array<[string, string]>; end: number }

/** Parse a tag starting at `<` (index `start`); null when it isn't a complete tag. */
function parseTag(html: string, start: number): Tag | null {
  let i = start + 1
  const closing = html[i] === '/'
  if (closing) i++
  const nameMatch = /^[a-z][a-z0-9-]*/i.exec(html.slice(i, i + 64))
  if (!nameMatch) return null
  const name = nameMatch[0].toLowerCase()
  i += nameMatch[0].length
  if (i < html.length && !/[\s/>]/.test(html[i])) return null
  const attrs: Array<[string, string]> = []
  while (i < html.length) {
    while (i < html.length && /[\s/]/.test(html[i])) i++
    if (i >= html.length) return null
    if (html[i] === '>') return { name, closing, attrs, end: i + 1 }
    const attrStart = i
    while (i < html.length && !/[\s/>=]/.test(html[i])) i++
    const attrName = html.slice(attrStart, i).toLowerCase()
    if (!attrName) { i++; continue } // stray "=" — skip it
    while (i < html.length && /\s/.test(html[i])) i++
    let value = ''
    if (html[i] === '=') {
      i++
      while (i < html.length && /\s/.test(html[i])) i++
      const quote = html[i]
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1)
        if (close === -1) return null
        value = html.slice(i + 1, close)
        i = close + 1
      } else {
        const valueStart = i
        while (i < html.length && !/[\s>]/.test(html[i])) i++
        value = html.slice(valueStart, i)
      }
    }
    attrs.push([attrName, value])
  }
  return null
}

function renderAttrs(tag: Tag): string {
  const allowed = ALLOWED_TAGS[tag.name]
  const out: string[] = []
  const seen = new Set<string>()
  for (const [name, raw] of tag.attrs) {
    if (!allowed.includes(name) || seen.has(name)) continue
    let value: string | null
    if (name === 'href') value = safeHref(raw)
    else if (name === 'src') value = safeImgSrc(raw)
    else if (['width', 'height', 'colspan', 'rowspan', 'start'].includes(name)) value = /^\d{1,4}$/.test(raw.trim()) ? raw.trim() : null
    else value = decodeEntities(raw).slice(0, 500)
    if (value === null) continue
    seen.add(name)
    out.push(` ${name}="${escapeHtml(value)}"`)
  }
  if (tag.name === 'a') out.push(' rel="noopener noreferrer" target="_blank"')
  return out.join('')
}

/** Sanitise untrusted HTML down to the allowlist. Idempotent. */
export function sanitizeHtml(input: unknown): string {
  const html = String(input ?? '')
  let out = ''
  const open: string[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += escapeText(html.slice(i)); break }
    out += escapeText(html.slice(i, lt))
    i = lt

    // Comments, doctype, CDATA, processing instructions: dropped.
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      i = close === -1 ? html.length : close + 3
      continue
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const close = html.indexOf('>', i + 2)
      i = close === -1 ? html.length : close + 1
      continue
    }

    const tag = parseTag(html, i)
    if (!tag) { out += '&lt;'; i++; continue }

    if (DROP_WITH_CONTENT.has(tag.name)) {
      i = tag.end
      if (!tag.closing && !/\/>$/.test(html.slice(i - 2, i))) {
        // Skip to the matching close tag (raw-text semantics); nothing after
        // an unclosed one is kept.
        const closeRe = new RegExp(`</${tag.name}[\\s/>]`, 'ig')
        closeRe.lastIndex = i
        const close = closeRe.exec(html)
        if (!close) { i = html.length; continue }
        const end = html.indexOf('>', close.index)
        i = end === -1 ? html.length : end + 1
      }
      continue
    }

    i = tag.end
    if (!(tag.name in ALLOWED_TAGS)) {
      // Real-but-disallowed element: unwrap. Not an HTML element: keep as text.
      if (!KNOWN_HTML_TAGS.has(tag.name)) out += escapeText(html.slice(lt, tag.end))
      continue
    }
    if (tag.closing) {
      const at = open.lastIndexOf(tag.name)
      if (at === -1) continue
      while (open.length > at) out += `</${open.pop()}>`
      continue
    }
    const attrs = renderAttrs(tag)
    if (tag.name === 'img' && !attrs.includes(' src=')) continue // nothing safe to show
    out += `<${tag.name}${attrs}>`
    if (!VOID_TAGS.has(tag.name)) open.push(tag.name)
  }
  while (open.length) out += `</${open.pop()}>`
  return out
}

/** Markup or a character reference — i.e. a stored value is HTML, not plain text. */
export function looksLikeHtml(value: unknown): boolean {
  return /<\/?[a-z][a-z0-9-]*[\s/>]|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(String(value ?? ''))
}

const BLOCK_MARKUP = /<(?:p|br|div|li|h[1-4]|pre|table|blockquote|hr)[\s/>]/i

/**
 * Render-ready HTML for a stored description: HTML is sanitised; plain text
 * (and HTML without any block markup) keeps its line breaks.
 */
export function descriptionToHtml(value: unknown): string {
  const text = String(value ?? '')
  if (!text.trim()) return ''
  if (!looksLikeHtml(text)) return escapeHtml(text).replace(/\r?\n/g, '<br>')
  const clean = sanitizeHtml(text)
  return BLOCK_MARKUP.test(clean) ? clean : clean.replace(/\r?\n/g, '<br>')
}

/**
 * Plain text for API `description_text`, list previews, notifications and the
 * CLI. Plain-text input is returned unchanged (trimmed); HTML is sanitised
 * first, so script/style content never leaks into the text.
 */
export function htmlToPlainText(value: unknown): string {
  const text = String(value ?? '')
  if (!looksLikeHtml(text)) return text.trim()
  return decodeEntities(
    sanitizeHtml(text)
      .replace(/<br>/g, '\n')
      .replace(/<li>/g, '- ')
      .replace(/<\/(?:p|div|h[1-4]|li|tr|blockquote|pre|ul|ol|table)>/g, '\n')
      .replace(/<hr>/g, '\n')
      .replace(/<\/t[dh]>/g, '\t')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(new RegExp(NBSP, 'g'), ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Normalise a task description for storage: HTML (anything with a tag-like
 * `<`) is sanitised; plain text is stored as is. null/undefined pass through.
 */
export function sanitizeTaskDescription<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string') return value
  return (/<[a-z!/?]/i.test(value) ? sanitizeHtml(value) : value) as T
}
