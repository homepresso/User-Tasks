/**
 * Fonts a workspace theme may use.
 *
 * - `google`: one of the curated Google Fonts below. The three families the
 *   app already ships through next/font (DM Sans, Space Mono, Fraunces) are
 *   served from the app bundle instead of fonts.googleapis.com.
 * - `system`: a platform font stack, no download.
 * - `upload`: a woff2 file in this workspace's `brand-fonts` storage folder
 *   (rendered with @font-face; the URL is checked by the schema/service).
 *
 * Every family name is limited to `[A-Za-z0-9 -]`, so it can be quoted in CSS
 * and put in a URL without escaping problems.
 */

export type FontSlot = 'sans' | 'display' | 'mono'
export type FontCategory = 'sans' | 'serif' | 'mono'

export interface CuratedFont {
  family: string
  category: FontCategory
  /** Weights Google serves for this family (a request for any other fails). */
  weights: number[]
  /** next/font CSS variable when the app bundles this family. */
  bundledVar?: '--font-sans' | '--font-mono' | '--font-display'
}

const range = (from: number, to: number) => {
  const out: number[] = []
  for (let w = from; w <= Math.min(to, 900); w += 100) out.push(w)
  return out
}

export const CURATED_FONTS: CuratedFont[] = [
  // Sans-serif
  { family: 'DM Sans', category: 'sans', weights: range(100, 900), bundledVar: '--font-sans' },
  { family: 'Inter', category: 'sans', weights: range(100, 900) },
  { family: 'Geist', category: 'sans', weights: range(100, 900) },
  { family: 'Roboto', category: 'sans', weights: [100, 300, 400, 500, 700, 900] },
  { family: 'Open Sans', category: 'sans', weights: range(300, 800) },
  { family: 'Lato', category: 'sans', weights: [100, 300, 400, 700, 900] },
  { family: 'Montserrat', category: 'sans', weights: range(100, 900) },
  { family: 'Poppins', category: 'sans', weights: range(100, 900) },
  { family: 'Source Sans 3', category: 'sans', weights: range(200, 900) },
  { family: 'Nunito', category: 'sans', weights: range(200, 900) },
  { family: 'Nunito Sans', category: 'sans', weights: range(200, 900) },
  { family: 'Raleway', category: 'sans', weights: range(100, 900) },
  { family: 'Work Sans', category: 'sans', weights: range(100, 900) },
  { family: 'IBM Plex Sans', category: 'sans', weights: range(100, 700) },
  { family: 'Manrope', category: 'sans', weights: range(200, 800) },
  { family: 'Plus Jakarta Sans', category: 'sans', weights: range(200, 800) },
  { family: 'Figtree', category: 'sans', weights: range(300, 900) },
  { family: 'Outfit', category: 'sans', weights: range(100, 900) },
  { family: 'Rubik', category: 'sans', weights: range(300, 900) },
  { family: 'Karla', category: 'sans', weights: range(200, 800) },
  { family: 'Mulish', category: 'sans', weights: range(200, 900) },
  { family: 'Barlow', category: 'sans', weights: range(100, 900) },
  { family: 'Public Sans', category: 'sans', weights: range(100, 900) },
  { family: 'Lexend', category: 'sans', weights: range(100, 900) },
  { family: 'Noto Sans', category: 'sans', weights: range(100, 900) },
  { family: 'Space Grotesk', category: 'sans', weights: range(300, 700) },
  { family: 'Sora', category: 'sans', weights: range(100, 800) },
  { family: 'Red Hat Display', category: 'sans', weights: range(300, 900) },
  { family: 'Archivo', category: 'sans', weights: range(100, 900) },
  { family: 'Atkinson Hyperlegible', category: 'sans', weights: [400, 700] },
  // Serif / display
  { family: 'Fraunces', category: 'serif', weights: range(100, 900), bundledVar: '--font-display' },
  { family: 'Playfair Display', category: 'serif', weights: range(400, 900) },
  { family: 'Merriweather', category: 'serif', weights: [300, 400, 700, 900] },
  { family: 'Lora', category: 'serif', weights: range(400, 700) },
  { family: 'Source Serif 4', category: 'serif', weights: range(200, 900) },
  { family: 'Libre Baskerville', category: 'serif', weights: [400, 700] },
  { family: 'EB Garamond', category: 'serif', weights: range(400, 800) },
  { family: 'Crimson Pro', category: 'serif', weights: range(200, 900) },
  { family: 'PT Serif', category: 'serif', weights: [400, 700] },
  { family: 'DM Serif Display', category: 'serif', weights: [400] },
  { family: 'Cormorant Garamond', category: 'serif', weights: range(300, 700) },
  { family: 'Bitter', category: 'serif', weights: range(100, 900) },
  // Monospace
  { family: 'Space Mono', category: 'mono', weights: [400, 700], bundledVar: '--font-mono' },
  { family: 'JetBrains Mono', category: 'mono', weights: range(100, 800) },
  { family: 'Fira Code', category: 'mono', weights: range(300, 700) },
  { family: 'IBM Plex Mono', category: 'mono', weights: range(100, 700) },
  { family: 'Roboto Mono', category: 'mono', weights: range(100, 700) },
  { family: 'Source Code Pro', category: 'mono', weights: range(200, 900) },
  { family: 'DM Mono', category: 'mono', weights: [300, 400, 500] },
]

const BY_FAMILY = new Map(CURATED_FONTS.map((f) => [f.family.toLowerCase(), f]))

export function findCuratedFont(family: string): CuratedFont | undefined {
  return BY_FAMILY.get(String(family).toLowerCase())
}

/** Platform stacks selectable as `system` fonts. */
export const SYSTEM_FONT_STACKS: Record<string, string> = {
  'System UI': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  'Serif': 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  'Monospace': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}

export const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/

/** Fallback stack appended after the chosen family, per slot. */
export const SLOT_FALLBACK: Record<FontSlot, string> = {
  sans: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif',
  display: 'var(--font-display), ui-serif, Georgia, serif',
  mono: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
}

/** Nearest weights the family actually has (Google rejects a request for a missing one). */
export function snapWeights(font: CuratedFont, wanted: number[]): number[] {
  const out = new Set<number>()
  for (const w of wanted) {
    let best = font.weights[0]
    for (const candidate of font.weights) if (Math.abs(candidate - w) < Math.abs(best - w)) best = candidate
    out.add(best)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * One css2 stylesheet URL for the non-bundled Google families, or null when
 * every family is bundled / system / uploaded.
 */
export function googleFontsHref(families: Array<{ family: string; weights: number[] }>): string | null {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const { family } of families) {
    const font = findCuratedFont(family)
    if (!font || font.bundledVar || seen.has(font.family)) continue
    seen.add(font.family)
    const merged = families.filter((f) => findCuratedFont(f.family) === font).flatMap((f) => f.weights)
    parts.push(`family=${font.family.replace(/ /g, '+')}:wght@${snapWeights(font, merged).join(';')}`)
  }
  return parts.length ? `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap` : null
}
