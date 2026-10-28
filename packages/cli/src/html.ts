/**
 * Task descriptions may be HTML. The CLI shows plain text by default: task
 * reads send `strip_html=true`, and HTML-looking description fields in any
 * task output are also converted here (e.g. the PATCH response, older
 * servers). `--html` shows the stored HTML instead.
 */

/** Resource → fields that may hold HTML. */
export const HTML_FIELDS: Record<string, readonly string[]> = {
  tasks: ['description'],
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', copy: '©', reg: '®', trade: '™',
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][a-z0-9-]*[\s/>]|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(value)
}

function decode(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[ref.toLowerCase()] ?? match
  })
}

/** HTML → readable plain text (plain text is returned unchanged). */
export function htmlToText(value: string): string {
  if (!looksLikeHtml(value)) return value
  return decode(
    value
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|template|svg|math|iframe|object|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|ul|ol|table)\s*>/gi, '\n')
      .replace(/<hr\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]\s*>/gi, '\t')
      .replace(/<\/?[a-z][^>]*>/gi, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Replace HTML in the named fields, anywhere in a response. */
export function stripHtmlFields(value: unknown, fields: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => stripHtmlFields(item, fields))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, field]) => [
    key,
    fields.includes(key) && typeof field === 'string' ? htmlToText(field) : stripHtmlFields(field, fields),
  ]))
}
