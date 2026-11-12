/**
 * Fonts a workspace theme may use.
 *
 * - `google`: any family in the bundled Google Fonts catalogue
 *   (lib/fonts/google.ts), served from this origin by /fonts/g/… — visitors'
 *   browsers never contact Google. CURATED_FONTS are the featured ones the
 *   pickers show first. The three families the app already ships through
 *   next/font (Inter, JetBrains Mono, Fraunces) are drawn from the bundle.
 * - `system`: a platform font stack, no download.
 * - `upload`: a woff2 file in this workspace's `brand-fonts` storage folder
 *   (rendered with @font-face; the URL is checked by the schema/service).
 *
 * Every family name is limited to `[A-Za-z0-9 -]`, so it can be quoted in CSS
 * and put in a URL without escaping problems.
 */

import { findGoogleFont, googleFontHrefs, snapGoogleWeights, type GoogleFont, type GoogleFontCategory } from '@/lib/fonts/google'

export type FontSlot = 'sans' | 'display' | 'mono'
export type FontCategory = GoogleFontCategory

export type CuratedFont = GoogleFont

/** Featured families (pickers list these first; every catalogue family is accepted). */
export const CURATED_FAMILIES = [
  // Sans-serif
  'Inter', 'DM Sans', 'Geist', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Nunito', 'Nunito Sans',
  'Raleway', 'Work Sans', 'IBM Plex Sans', 'Manrope', 'Plus Jakarta Sans', 'Figtree', 'Outfit', 'Rubik', 'Karla', 'Mulish', 'Barlow',
  'Public Sans', 'Lexend', 'Noto Sans', 'Space Grotesk', 'Sora', 'Red Hat Display', 'Archivo', 'Atkinson Hyperlegible',
  // Serif / display
  'Fraunces', 'Playfair Display', 'Merriweather', 'Lora', 'Source Serif 4', 'Libre Baskerville', 'EB Garamond', 'Crimson Pro',
  'PT Serif', 'DM Serif Display', 'Cormorant Garamond', 'Bitter',
  // Monospace
  'Space Mono', 'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Roboto Mono', 'Source Code Pro', 'DM Mono',
] as const

export const CURATED_FONTS: CuratedFont[] = CURATED_FAMILIES.map((f) => findGoogleFont(f)).filter((f): f is GoogleFont => Boolean(f))

const CURATED = new Set(CURATED_FONTS.map((f) => f.family))

/** A featured family (see CURATED_FAMILIES), or undefined. */
export function findCuratedFont(family: string): CuratedFont | undefined {
  const font = findGoogleFont(family)
  return font && CURATED.has(font.family) ? font : undefined
}

/** Any Google Fonts family a theme may name (the bundled catalogue), or undefined. */
export function findThemeFont(family: string): GoogleFont | undefined {
  return findGoogleFont(family)
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

/** Nearest weights the family actually has. */
export function snapWeights(font: Pick<GoogleFont, 'weights'>, wanted: number[]): number[] {
  return snapGoogleWeights(font, wanted)
}

/**
 * Our stylesheets (/fonts/g/…, one per family) for the non-bundled Google
 * families among these, in order; empty when every family is bundled /
 * system / uploaded.
 */
export function googleFontsHrefs(families: Array<{ family: string }>): string[] {
  return googleFontHrefs(families.map((f) => f.family))
}
