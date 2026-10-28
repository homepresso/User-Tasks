/**
 * Colour parsing and WCAG maths for workspace themes.
 *
 * Theme colours end up inside CSS custom properties, so only a closed set of
 * notations is accepted — `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`,
 * `hsl()`, `hsla()` with plain numbers. Anything else (`url()`, `var()`,
 * `expression()`, `;`, braces, keywords) is rejected, which is what keeps a
 * stored theme from injecting CSS.
 */

export interface Rgba { r: number; g: number; b: number; a: number }

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const NUM = String.raw`(\d{1,3}(?:\.\d+)?)`
const ALPHA = String.raw`(0|1|0?\.\d+|1\.0+|\d{1,3}%)`
const RGB_RE = new RegExp(String.raw`^rgba?\(\s*${NUM}\s*,\s*${NUM}\s*,\s*${NUM}\s*(?:,\s*${ALPHA}\s*)?\)$`, 'i')
const HSL_RE = new RegExp(String.raw`^hsla?\(\s*${NUM}(?:deg)?\s*,\s*${NUM}%\s*,\s*${NUM}%\s*(?:,\s*${ALPHA}\s*)?\)$`, 'i')

function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1
  return raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = light - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Parsed colour, or null when the value is not one of the accepted notations (or out of range). */
export function parseColor(value: string): Rgba | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (HEX_RE.test(v)) {
    let hex = v.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  let m = RGB_RE.exec(v)
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const a = parseAlpha(m[4])
    if ([r, g, b].some((n) => n > 255) || a > 1) return null
    return { r, g, b, a }
  }
  m = HSL_RE.exec(v)
  if (m) {
    const [h, s, l] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const a = parseAlpha(m[4])
    if (h > 360 || s > 100 || l > 100 || a > 1) return null
    const [r, g, b] = hslToRgb(h, s, l)
    return { r, g, b, a }
  }
  return null
}

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && parseColor(value) !== null
}

/** `fg` alpha-composited over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

export function relativeLuminance(c: Rgba): number {
  const lin = (n: number) => {
    const s = n / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * WCAG contrast ratio of `fg` on `bg`. Translucent backgrounds are first laid
 * over `base` (default white), translucent text over the resulting background.
 * Returns null for unparseable input.
 */
export function contrastRatio(fg: string, bg: string, base: string = '#FFFFFF'): number | null {
  const f = parseColor(fg)
  const b = parseColor(bg)
  const under = parseColor(base) ?? WHITE
  if (!f || !b) return null
  const opaqueBase = under.a < 1 ? composite(under, WHITE) : under
  const back = b.a < 1 ? composite(b, opaqueBase) : b
  const front = f.a < 1 ? composite(f, back) : f
  const l1 = relativeLuminance(front)
  const l2 = relativeLuminance(back)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** Same "dark canvas" rule as the legacy getThemeMode (perceived brightness < 110). */
export function isDarkColor(value: string): boolean {
  const c = parseColor(value)
  if (!c) return false
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b < 110
}

/** `#rrggbb` (or `#rgb`) plus an opacity → `rgba()`; other notations are returned as-is. */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseColor(hex)
  if (!c || !hex.startsWith('#')) return hex
  return `rgba(${c.r},${c.g},${c.b},${Number(alpha.toFixed(3))})`
}
