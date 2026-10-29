import { randomBytes } from 'node:crypto'
import { htmlToText, parseAddress, type EmailMessage } from './types'

/**
 * RFC 5322 / MIME rendering of a message (multipart/alternative: text +
 * HTML, base64 bodies, RFC 2047 encoded headers; with attachments a
 * multipart/mixed around it, file names per RFC 2231). Used by the Gmail
 * API provider (raw message), SES with attachments (raw message) and the
 * console provider (.eml files).
 */

const CRLF = '\r\n'

/** RFC 2047 encoded-word when the value isn't plain printable ASCII. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

function formatAddress(value: string): string {
  const { name, address } = parseAddress(value)
  if (/[\r\n<>]/.test(address)) throw new Error('Invalid email address')
  if (!name) return address
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : encodeHeader(name)
  return `${display} <${address}>`
}

function base64Lines(text: string | Uint8Array): string {
  const buf = typeof text === 'string' ? Buffer.from(text, 'utf8') : Buffer.from(text)
  return (buf.toString('base64').match(/.{1,76}/g) ?? []).join(CRLF)
}

/** `filename="…"` (ASCII) plus RFC 2231 `filename*=` for anything else. */
function fileNameParams(name: string): string {
  const clean = name.replace(/[\r\n"\\]/g, '_')
  if (/^[\x20-\x7e]*$/.test(clean)) return `filename="${clean}"`
  return `filename="${clean.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}

function safeContentType(type: string): string {
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type) ? type : 'application/octet-stream'
}

export function buildMimeMessage(message: EmailMessage, options: { date?: Date; messageIdDomain?: string } = {}): string {
  const boundary = `=_ut_${randomBytes(12).toString('hex')}`
  const domain = options.messageIdDomain ?? (parseAddress(message.from).address.split('@')[1] || 'usertasks.local')
  const headers = [
    `From: ${formatAddress(message.from)}`,
    `To: ${message.to.map(formatAddress).join(', ')}`,
    ...(message.replyTo ? [`Reply-To: ${formatAddress(message.replyTo)}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${(options.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
  ]
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', base64Lines(body)].join(CRLF)
  const alternative = [
    part('text/plain', message.text ?? htmlToText(message.html)),
    part('text/html', message.html),
    `--${boundary}--`,
  ]
  const attachments = message.attachments ?? []
  if (!attachments.length) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...alternative, ''].join(CRLF)
  }
  const mixed = `=_ut_mixed_${randomBytes(12).toString('hex')}`
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    ...alternative,
    ...attachments.flatMap((file) => [
      `--${mixed}`,
      `Content-Type: ${safeContentType(file.contentType)}; name="${file.filename.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; ${fileNameParams(file.filename)}`,
      '',
      base64Lines(file.content),
    ]),
    `--${mixed}--`,
    '',
  ].join(CRLF)
}
