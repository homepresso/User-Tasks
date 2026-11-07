/**
 * Builds the base64url RFC 2822 message Gmail's messages.send / drafts.create
 * take as `raw`, from separate fields — safely:
 *  - header values may not contain CR/LF (no header injection via {{to}} or
 *    {{subject}}); addresses must be plain addr-specs or "Name <addr>";
 *  - non-ASCII subjects and display names are RFC 2047 encoded;
 *  - bodies are base64 (any charset, no line-length or dot issues).
 *
 * Pure: the reference executor applies it for templates whose
 * request_config._transform is 'gmail_mime' (see the connector audit notes).
 */
import { randomUUID } from 'node:crypto'

export interface GmailMessageFields {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  from?: string
  reply_to?: string
  subject?: string
  text?: string
  html?: string
  in_reply_to?: string
  references?: string
}

export class GmailMimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailMimeError'
  }
}

const ADDR_SPEC = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/
const NAME_ADDR = /^\s*(?:"((?:[^"\\]|\\.)*)"|([^<>"]*?))\s*<([^<>\s]+)>\s*$/

function noBreaks(field: string, value: string): string {
  if (/[\r\n\0]/.test(value)) throw new GmailMimeError(`${field} must not contain line breaks`)
  return value
}

/** RFC 2047 encoded-word (UTF-8, base64) when the text is not plain printable ASCII. */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  // Split on characters (not bytes) so no multi-byte character straddles two words.
  const words: string[] = []
  let chunk = ''
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) { words.push(chunk); chunk = '' }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ')
}

function formatAddress(field: string, raw: string): string {
  const value = noBreaks(field, raw.trim())
  if (ADDR_SPEC.test(value)) return value
  const m = NAME_ADDR.exec(value)
  if (!m || !ADDR_SPEC.test(m[3])) throw new GmailMimeError(`${field} has an invalid address: ${value}`)
  const name = (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]).trim()
  if (!name) return m[3]
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : encodeHeaderText(name)
  return `${display} <${m[3]}>`
}

function addressList(field: string, value: string | string[] | undefined): string | null {
  if (value === undefined || value === null) return null
  const items = (Array.isArray(value) ? value : splitAddresses(String(value))).map((v) => String(v).trim()).filter(Boolean)
  if (!items.length) return null
  return items.map((item) => formatAddress(field, item)).join(', ')
}

/** Split "a@x, "Doe, Jane" <b@y>" on commas outside quotes and angle brackets. */
function splitAddresses(value: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let angle = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '\\' && quoted) { cur += ch + (value[++i] ?? ''); continue }
    if (ch === '"') quoted = !quoted
    else if (ch === '<' && !quoted) angle = true
    else if (ch === '>' && !quoted) angle = false
    if ((ch === ',' || ch === ';') && !quoted && !angle) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n')
}

/** The RFC 2822 message text (CRLF line endings). */
export function buildMimeMessage(fields: GmailMessageFields, opts: { boundary?: string; date?: Date } = {}): string {
  const to = addressList('to', fields.to)
  if (!to) throw new GmailMimeError('to is required')
  const headers: string[] = []
  const from = fields.from ? addressList('from', fields.from) : null
  if (from) headers.push(`From: ${from}`)
  headers.push(`To: ${to}`)
  const cc = addressList('cc', fields.cc)
  if (cc) headers.push(`Cc: ${cc}`)
  const bcc = addressList('bcc', fields.bcc)
  if (bcc) headers.push(`Bcc: ${bcc}`)
  const replyTo = addressList('reply_to', fields.reply_to)
  if (replyTo) headers.push(`Reply-To: ${replyTo}`)
  headers.push(`Subject: ${encodeHeaderText(noBreaks('subject', fields.subject ?? ''))}`)
  for (const [name, value] of [['In-Reply-To', fields.in_reply_to], ['References', fields.references]] as const) {
    if (!value) continue
    const v = noBreaks(name, String(value).trim())
    if (!/^(<[^<>\s]+>\s*)+$/.test(v)) throw new GmailMimeError(`${name} must be one or more <message-id> values`)
    headers.push(`${name}: ${v}`)
  }
  headers.push(`Date: ${(opts.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`)
  headers.push('MIME-Version: 1.0')

  const text = fields.text ?? ''
  const html = fields.html ?? ''
  const part = (type: string, body: string) => `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(body)}`
  if (html && text) {
    const boundary = opts.boundary ?? `ut-${randomUUID()}`
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    return `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\n${part('text/plain', text)}\r\n--${boundary}\r\n${part('text/html', html)}\r\n--${boundary}--\r\n`
  }
  return `${headers.join('\r\n')}\r\n${part(html ? 'text/html' : 'text/plain', html || text)}\r\n`
}

/** base64url of the message — the `raw` field Gmail expects. */
export function buildGmailRawMessage(fields: GmailMessageFields, opts: { boundary?: string; date?: Date } = {}): string {
  return Buffer.from(buildMimeMessage(fields, opts), 'utf8').toString('base64url')
}
