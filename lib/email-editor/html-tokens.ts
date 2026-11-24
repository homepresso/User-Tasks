/**
 * A small, forgiving HTML tokenizer for the email editor's tools (lint,
 * formatter, CSS inliner, html → text). Not a full HTML5 parser: it splits
 * markup into text, tags, comments, doctype and raw-text elements (style,
 * script, textarea, title) with source offsets — enough for email markup.
 * Pure.
 */

export type HtmlToken =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'comment'; text: string; start: number; end: number }
  | { kind: 'doctype'; text: string; start: number; end: number }
  | { kind: 'open'; name: string; attrs: HtmlAttr[]; selfClosing: boolean; text: string; start: number; end: number }
  | { kind: 'close'; name: string; text: string; start: number; end: number }
  /** The content of a raw-text element (style / script / textarea / title). */
  | { kind: 'raw'; name: string; text: string; start: number; end: number }

export interface HtmlAttr { name: string; value: string | null }

export const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const RAW_TEXT = new Set(['style', 'script', 'textarea', 'title'])

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

export function parseAttrs(source: string): HtmlAttr[] {
  const attrs: HtmlAttr[] = []
  for (const m of source.matchAll(ATTR_RE)) {
    const value = m[2] ?? m[3] ?? m[4]
    attrs.push({ name: m[1].toLowerCase(), value: value === undefined ? null : value })
  }
  return attrs
}

export function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = []
  let i = 0
  const n = html.length
  const pushText = (start: number, end: number) => {
    if (end > start) tokens.push({ kind: 'text', text: html.slice(start, end), start, end })
  }
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { pushText(i, n); break }
    pushText(i, lt)
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4)
      const end = close === -1 ? n : close + 3
      tokens.push({ kind: 'comment', text: html.slice(lt, end), start: lt, end })
      i = end
      continue
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const close = html.indexOf('>', lt)
      const end = close === -1 ? n : close + 1
      tokens.push({ kind: 'doctype', text: html.slice(lt, end), start: lt, end })
      i = end
      continue
    }
    const closeMatch = /^<\/\s*([A-Za-z][\w:-]*)\s*>/.exec(html.slice(lt, lt + 200))
    if (closeMatch) {
      const end = lt + closeMatch[0].length
      tokens.push({ kind: 'close', name: closeMatch[1].toLowerCase(), text: closeMatch[0], start: lt, end })
      i = end
      continue
    }
    const openName = /^<([A-Za-z][\w:-]*)/.exec(html.slice(lt, lt + 100))
    if (!openName) { pushText(lt, lt + 1); i = lt + 1; continue }
    // Find the end of the tag, honouring quoted attribute values.
    let j = lt + openName[0].length
    let quote: string | null = null
    while (j < n) {
      const c = html[j]
      if (quote) { if (c === quote) quote = null }
      else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    const end = Math.min(n, j + 1)
    const text = html.slice(lt, end)
    const name = openName[1].toLowerCase()
    const inner = text.slice(openName[0].length, text.endsWith('>') ? -1 : undefined)
    const selfClosing = /\/\s*$/.test(inner)
    tokens.push({ kind: 'open', name, attrs: parseAttrs(inner.replace(/\/\s*$/, '')), selfClosing, text, start: lt, end })
    i = end
    if (RAW_TEXT.has(name) && !selfClosing) {
      const re = new RegExp(`</\\s*${name}\\s*>`, 'i')
      const rest = html.slice(i)
      const m = re.exec(rest)
      const rawEnd = m ? i + m.index : n
      if (rawEnd > i) tokens.push({ kind: 'raw', name, text: html.slice(i, rawEnd), start: i, end: rawEnd })
      i = rawEnd
    }
  }
  return tokens
}

export function attrValue(attrs: HtmlAttr[], name: string): string | null {
  return attrs.find((a) => a.name === name)?.value ?? null
}

/** Rebuild an open tag from a name and attributes. */
export function serializeOpenTag(name: string, attrs: HtmlAttr[], selfClosing = false): string {
  const parts = attrs.map((a) => (a.value === null ? a.name : `${a.name}="${a.value.replace(/"/g, '&quot;')}"`))
  return `<${name}${parts.length ? ' ' + parts.join(' ') : ''}${selfClosing ? ' /' : ''}>`
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', euro: '€', pound: '£', zwnj: '', zwj: '' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    const named = ENTITIES[body.toLowerCase()]
    return named === undefined ? whole : named
  })
}

export function escapeHtml(text: string): string {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
