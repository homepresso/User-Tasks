/**
 * QR codes for form page links, drawn as SVG on the server (the `qrcode`
 * package's encoder; nothing extra ships to the browser — the dialog shows
 * the SVG and rasterises it for the PNG download).
 *
 * Always dark modules on a white quiet zone (4 modules), whatever the app
 * theme: scanners need the contrast, and a printed code has no dark mode.
 * The optional caption (the form's name and the URL) sits under the code on
 * the same white card. Error correction M (15%), byte mode for the URL.
 *
 * Server-only (imports `qrcode`); the browser asks for the SVG through the
 * `forms.qr` read.
 */

import QRCode from 'qrcode'

export const QR_DARK = '#000000'
export const QR_LIGHT = '#ffffff'
export const QR_QUIET_ZONE = 4

export interface QrMatrix {
  /** Modules per side. */
  size: number
  /** QR version (1-40). */
  version: number
  /** Row-major: true = dark module. */
  dark: (row: number, col: number) => boolean
}

/** The module matrix of `text` (throws when it does not fit a QR code). */
export function qrMatrix(text: string): QrMatrix {
  const code = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = code.modules
  return { size, version: code.version, dark: (row, col) => data[row * size + col] === 1 }
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export interface QrSvgOptions {
  /** Pixels per module (default 8). */
  scale?: number
  /** Text under the code: the form's name and the link. */
  caption?: { title?: string | null; url?: string | null } | null
}

/** The dark modules as one path (one `h` run per horizontal stretch), in module units offset by the quiet zone. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = []
  for (let row = 0; row < matrix.size; row++) {
    let col = 0
    while (col < matrix.size) {
      if (!matrix.dark(row, col)) { col++; continue }
      const start = col
      while (col < matrix.size && matrix.dark(row, col)) col++
      parts.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${col - start}v1h-${col - start}z`)
    }
  }
  return parts.join('')
}

/** A caption line's font size so it fits the card width (characters ≈ 0.6em wide). */
function fitFont(text: string, width: number, max: number, min = 7): number {
  const fit = (width * 0.9) / Math.max(1, text.length * 0.6)
  return Math.round(Math.max(min, Math.min(max, fit)) * 10) / 10
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The QR code of `text` as a standalone SVG document (white card, black modules, optional caption). */
export function qrSvg(text: string, options: QrSvgOptions = {}): string {
  const matrix = qrMatrix(text)
  const scale = Math.max(1, Math.min(32, Math.round(options.scale ?? 8)))
  const side = (matrix.size + QR_QUIET_ZONE * 2) * scale
  const title = options.caption?.title ? truncate(String(options.caption.title).trim(), 80) : ''
  const url = options.caption?.url ? truncate(String(options.caption.url).trim(), 200) : ''
  const titleSize = title ? fitFont(title, side, Math.max(12, scale * 2.4)) : 0
  const urlSize = url ? fitFont(url, side, Math.max(10, scale * 1.6)) : 0
  const captionHeight = title || url ? Math.round((title ? titleSize * 1.5 : 0) + (url ? urlSize * 1.6 : 0) + scale * 2) : 0
  const height = side + captionHeight
  const lines: string[] = []
  // Captions start one module into the bottom quiet zone (three stay clear).
  let y = side - scale
  if (title) {
    y += titleSize * 1.2
    lines.push(`<text x="${side / 2}" y="${round(y)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="${QR_DARK}">${escapeXml(title)}</text>`)
  }
  if (url) {
    y += urlSize * 1.5
    lines.push(`<text x="${side / 2}" y="${round(y)}" text-anchor="middle" font-family="Menlo, Consolas, monospace" font-size="${urlSize}" fill="${QR_DARK}">${escapeXml(url)}</text>`)
  }
  const label = escapeXml(title ? `QR code: ${title}` : 'QR code')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${height}" viewBox="0 0 ${side} ${height}" role="img" aria-label="${label}">`,
    `<rect width="${side}" height="${height}" fill="${QR_LIGHT}"/>`,
    `<path transform="scale(${scale})" shape-rendering="crispEdges" fill="${QR_DARK}" d="${qrPath(matrix)}"/>`,
    ...lines,
    '</svg>',
  ].join('')
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
