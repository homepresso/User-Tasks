/**
 * Tag colours: a fixed palette of named tokens (never raw hex in the
 * database), the deterministic auto colour of an uncoloured tag, and tag
 * name normalisation. Pure: shared by the browser (TagChip), the services
 * (lib/services/tags.ts), the API schemas and the tests.
 *
 * The CSS lives in app/globals.css (`--tag-<token>-solid` / `-fg`, light and
 * dark, and `.tag-chip`). A chip's background and border are the token's
 * solid colour mixed into the workspace theme's card colour
 * (`--theme-card-bg`), so every theme — light or dark — tints them in its
 * own surface; the text colour is a darker (light mode) or lighter (dark
 * mode) shade of the same hue that keeps WCAG AA contrast on that tint
 * (__tests__/tag-palette.test.ts checks every token on reference light and
 * dark surfaces, and that globals.css matches this table).
 */

export const TAG_COLOR_TOKENS = [
  'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal',
  'cyan', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
] as const

export type TagColorToken = (typeof TAG_COLOR_TOKENS)[number]

export interface TagPaletteEntry {
  token: TagColorToken
  label: string
  /** Swatch / tint source (the hue at full strength). */
  solid: string
  /** Text on the light tint. */
  lightFg: string
  /** Text on the dark tint. */
  darkFg: string
}

export const TAG_PALETTE: readonly TagPaletteEntry[] = [
  { token: 'gray', label: 'Gray', solid: '#6b7280', lightFg: '#374151', darkFg: '#d1d5db' },
  { token: 'red', label: 'Red', solid: '#ef4444', lightFg: '#991b1b', darkFg: '#fca5a5' },
  { token: 'orange', label: 'Orange', solid: '#f97316', lightFg: '#9a3412', darkFg: '#fdba74' },
  { token: 'amber', label: 'Amber', solid: '#f59e0b', lightFg: '#92400e', darkFg: '#fcd34d' },
  { token: 'yellow', label: 'Yellow', solid: '#eab308', lightFg: '#854d0e', darkFg: '#fde047' },
  { token: 'lime', label: 'Lime', solid: '#84cc16', lightFg: '#3f6212', darkFg: '#bef264' },
  { token: 'green', label: 'Green', solid: '#22c55e', lightFg: '#166534', darkFg: '#86efac' },
  { token: 'teal', label: 'Teal', solid: '#14b8a6', lightFg: '#115e59', darkFg: '#5eead4' },
  { token: 'cyan', label: 'Cyan', solid: '#06b6d4', lightFg: '#155e75', darkFg: '#67e8f9' },
  { token: 'blue', label: 'Blue', solid: '#3b82f6', lightFg: '#1e40af', darkFg: '#93c5fd' },
  { token: 'indigo', label: 'Indigo', solid: '#6366f1', lightFg: '#3730a3', darkFg: '#a5b4fc' },
  { token: 'violet', label: 'Violet', solid: '#8b5cf6', lightFg: '#5b21b6', darkFg: '#c4b5fd' },
  { token: 'purple', label: 'Purple', solid: '#a855f7', lightFg: '#6b21a8', darkFg: '#d8b4fe' },
  { token: 'pink', label: 'Pink', solid: '#ec4899', lightFg: '#9d174d', darkFg: '#f9a8d4' },
  { token: 'rose', label: 'Rose', solid: '#f43f5e', lightFg: '#9f1239', darkFg: '#fda4af' },
]

/** How much of the solid colour goes into the card colour (globals.css `--tag-mix-bg` / `--tag-mix-border`). */
export const TAG_MIX = {
  light: { bg: 14, border: 38 },
  dark: { bg: 24, border: 45 },
} as const

/** The neutral colour (auto colour switched off, or no name). */
export const NEUTRAL_TAG_COLOR: TagColorToken = 'gray'

/** Tokens the auto colour picks from: every hue but the neutral one. */
export const AUTO_TAG_COLORS: readonly TagColorToken[] = TAG_COLOR_TOKENS.filter((t) => t !== NEUTRAL_TAG_COLOR)

export const TAG_NAME_MAX = 60
export const TAG_DESCRIPTION_MAX = 280

export function isTagColorToken(value: unknown): value is TagColorToken {
  return typeof value === 'string' && (TAG_COLOR_TOKENS as readonly string[]).includes(value)
}

export function paletteEntry(token: TagColorToken): TagPaletteEntry {
  return TAG_PALETTE.find((p) => p.token === token) ?? TAG_PALETTE[0]
}

/** A tag as entered, tidied: trimmed, inner whitespace collapsed (case kept). */
export function cleanTagName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The registry key of a tag: case-insensitive and whitespace-tolerant, so
 * "Finance", "finance" and " finance " share one style. Mirrors the
 * `name_key` generated column of public.tag_styles.
 */
export function tagKey(name: unknown): string {
  return cleanTagName(name).toLowerCase()
}

/** FNV-1a (32-bit) of a string: stable across browsers, Node and releases. */
export function hashTagName(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The automatic colour of a tag with no style: the same name always gets the same hue. */
export function autoTagColor(name: string): TagColorToken {
  const key = tagKey(name)
  if (!key) return NEUTRAL_TAG_COLOR
  return AUTO_TAG_COLORS[hashTagName(key) % AUTO_TAG_COLORS.length]
}

/** The colour a chip shows: the tag's chosen colour, else the auto colour (or neutral when auto colour is off). */
export function resolveTagColor(name: string, chosen: TagColorToken | null | undefined, autoColor = true): TagColorToken {
  if (chosen && isTagColorToken(chosen)) return chosen
  return autoColor ? autoTagColor(name) : NEUTRAL_TAG_COLOR
}

/* ── Contrast (tests and the Settings preview) ───────────────────────── */

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/** CSS `color-mix(in srgb, a pct%, b)`. */
export function mixHex(a: string, pct: number, b: string): string {
  const [ar, ag, ab] = channels(a)
  const [br, bg, bb] = channels(b)
  const p = pct / 100
  return toHex([ar * p + br * (1 - p), ag * p + bg * (1 - p), ab * p + bb * (1 - p)])
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The concrete chip colours of a token on a given card colour (what the CSS computes). */
export function chipColors(token: TagColorToken, mode: 'light' | 'dark', cardBg: string): { bg: string; fg: string; border: string } {
  const p = paletteEntry(token)
  const mix = TAG_MIX[mode]
  return {
    bg: mixHex(p.solid, mix.bg, cardBg),
    fg: mode === 'light' ? p.lightFg : p.darkFg,
    border: mixHex(p.solid, mix.border, cardBg),
  }
}

/**
 * Nearest token to a legacy hex colour (tag_definitions stored hex before the
 * palette). Mirrors the migration's mapping of the old presets; anything else
 * goes to the closest solid by RGB distance.
 */
export function nearestTagColor(hex: string): TagColorToken {
  const value = String(hex ?? '').trim().toLowerCase()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) return NEUTRAL_TAG_COLOR
  const legacy = LEGACY_PRESETS[value]
  if (legacy) return legacy
  const [r, g, b] = channels(value)
  let best: TagColorToken = NEUTRAL_TAG_COLOR
  let bestDistance = Infinity
  for (const p of TAG_PALETTE) {
    const [pr, pg, pb] = channels(p.solid)
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < bestDistance) { bestDistance = d; best = p.token }
  }
  return best
}

/** The hex presets of the old tag colour picker (components/ui/tag-manager.tsx before tokens). */
export const LEGACY_PRESETS: Readonly<Record<string, TagColorToken>> = {
  '#6b7280': 'gray',
  '#ef4444': 'red',
  '#f97316': 'orange',
  '#f59e0b': 'amber',
  '#22c55e': 'green',
  '#17150f': 'teal',
  '#3b82f6': 'blue',
  '#6366f1': 'indigo',
  '#8b5cf6': 'violet',
  '#ec4899': 'pink',
}
