/**
 * The Google fonts a form draws with: text styles on fields, List columns
 * and repeating-section controls (`text_style.*.font`), List row styles and
 * set_style rule actions (`style.font`) — every `font: "google:<Family>"`
 * anywhere in the fields and the layout. Renderers link our stylesheet for
 * each (lib/fonts/google.ts googleFontHrefs), so a page only loads the
 * families it uses. The mini theme's own fonts are linked by FormThemeScope.
 * Pure and isomorphic.
 */

import { googleFontHrefs } from '@/lib/fonts/google'
import { textFontGoogleFamily } from './text-style'

const MAX_DEPTH = 16
const MAX_FAMILIES = 24

/** Google families used by a form's fields and layout (catalogue spelling, first-use order). */
export function formGoogleFontFamilies(fields: unknown, layout?: unknown): string[] {
  const out: string[] = []
  const seen = new WeakSet<object>()
  const walk = (value: unknown, depth: number) => {
    if (out.length >= MAX_FAMILIES || depth > MAX_DEPTH || !value || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1); return }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'font' && typeof v === 'string') {
        const family = textFontGoogleFamily(v)
        if (family && !out.includes(family)) out.push(family)
      } else if (v && typeof v === 'object') walk(v, depth + 1)
    }
  }
  walk(fields, 0)
  walk(layout, 0)
  return out
}

/** Our stylesheets for the Google fonts a form uses. */
export function formFontHrefs(fields: unknown, layout?: unknown): string[] {
  return googleFontHrefs(formGoogleFontFamilies(fields, layout))
}
