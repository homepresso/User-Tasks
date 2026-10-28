/**
 * Form theme legibility audit: every token pair a themed form draws — card
 * text, muted text (labels, help, placeholders), input text on inputs,
 * links / selected text, errors, text on primary and danger buttons, chips
 * and the active suggestion (text on the accent wash), input borders and
 * the focus ring (3:1), text on the page background and on the header banner
 * — for every built-in preset in light and dark, with no mini theme, with a
 * full mini theme derived from each preset, and with random palettes and
 * random mini themes (page, input, border and button colours included).
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/lib/theme/colors'
import { flatten } from '@/lib/theme/legibility'
import { THEME_TEMPLATES, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { formHeaderColors, formThemeVars, overridesFromPreset, paletteScopeVars, type FormThemeOverrides } from '@/lib/forms/form-theme'
import type { ThemeMode, ThemePalette } from '@/lib/theme/schema'

type Vars = Record<string, string>

function hex(rgba: { r: number; g: number; b: number }): string {
  return `#${[rgba.r, rgba.g, rgba.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}

/** Every pair, with the ratio it needs. */
function audit(vars: Vars, base: Vars): string[] {
  const v = (name: string) => vars[name] ?? base[name]
  const card = flatten(v('--theme-card-bg'))!
  const on = (color: string) => hex(flatten(color, card)!)
  const cardHex = hex(card)
  const input = on(v('--theme-input-bg') ?? v('--theme-card-bg'))
  const wash = on(v('--theme-primary-light'))
  const pairs: Array<[string, string, string, number]> = [
    ['card text / card', v('--theme-card-text'), cardHex, 4.5],
    ['muted / card', v('--theme-muted-text'), cardHex, 4.5],
    ['placeholder / input', v('--form-placeholder') ?? v('--theme-muted-text'), input, 4.5],
    ['input text / input', v('--theme-topbar-text') ?? v('--theme-card-text'), input, 4.5],
    ['link / card', v('--theme-primary-text'), cardHex, 4.5],
    ['text / accent wash (chips, active suggestion)', v('--theme-card-text'), wash, 4.5],
    ['error / card', v('--status-blocked'), cardHex, 4.5],
    ['on primary / primary', v('--theme-on-primary'), on(v('--theme-primary')), 4.5],
    ['on primary / primary hover', v('--theme-on-primary'), on(v('--theme-primary-hover')), 4.5],
    ['focus ring / card', v('--theme-focus-ring'), cardHex, 3],
  ]
  if (v('--theme-danger') && v('--theme-on-danger')) pairs.push(['on danger / danger', v('--theme-on-danger'), on(v('--theme-danger')), 4.5])
  if (vars['--form-page-bg']) pairs.push(['page text / page', vars['--form-page-text'], vars['--form-page-bg'], 4.5])
  if (base['--theme-input-border'] || vars['--theme-input-border']) pairs.push(['input border / input', v('--theme-input-border'), input, 3])
  const out: string[] = []
  for (const [name, fg, bg, need] of pairs) {
    if (!fg || !bg) { out.push(`${name}: missing`); continue }
    const ratio = contrastRatio(fg, bg, cardHex) ?? 0
    if (ratio + 1e-6 < need) out.push(`${name}: ${ratio.toFixed(2)} < ${need} (${fg} on ${bg})`)
  }
  return out
}

const cases = THEME_TEMPLATES.flatMap((t) => (['light', 'dark'] as const).map((mode) => [t.id, mode] as const))
const palette = (id: string, mode: ThemeMode): ThemePalette => presetToWorkspaceTheme(id)!.colors[mode]

/** Deterministic pseudo-random colours. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}
const randomHex = (r: () => number) => `#${Array.from({ length: 3 }, () => Math.floor(r() * 256).toString(16).padStart(2, '0')).join('')}`

function randomOverrides(r: () => number): FormThemeOverrides {
  const colors = () => ({
    accent: randomHex(r), background: randomHex(r), text: randomHex(r),
    ...(r() > 0.3 ? { page: randomHex(r) } : {}), ...(r() > 0.6 ? { page_to: randomHex(r) } : {}),
    ...(r() > 0.4 ? { input: randomHex(r) } : {}), ...(r() > 0.4 ? { border: randomHex(r) } : {}), ...(r() > 0.4 ? { button: randomHex(r) } : {}),
  })
  return { colors: { light: colors(), ...(r() > 0.3 ? { dark: colors() } : {}) }, header: { enabled: true, banner_color: randomHex(r) } }
}

describe('form theme contrast audit', () => {
  it.each(cases)('%s (%s): the workspace theme as a form', (id, mode) => {
    const base = paletteScopeVars(palette(id, mode))
    expect(audit({}, base)).toEqual([])
  })

  it.each(cases)('%s (%s): a mini theme from the preset, with page / input / border / button colours', (id, mode) => {
    const preset = overridesFromPreset(id)!
    const light = preset.colors!.light!
    const overrides: FormThemeOverrides = {
      ...preset,
      colors: {
        light: { ...light, page: light.text, page_to: light.accent, input: light.background, border: light.accent, button: light.accent },
        dark: preset.colors!.dark,
      },
    }
    const base = paletteScopeVars(palette(id, mode))
    expect(audit(formThemeVars(overrides, palette(id, mode), mode), base)).toEqual([])
  })

  it('random palettes × random mini themes stay legible (light and dark)', () => {
    const r = rng(20261116)
    const failures: string[] = []
    for (let i = 0; i < 160; i++) {
      const id = THEME_TEMPLATES[Math.floor(r() * THEME_TEMPLATES.length)].id
      const overrides = randomOverrides(r)
      for (const mode of ['light', 'dark'] as const) {
        const base = paletteScopeVars(palette(id, mode))
        for (const issue of audit(formThemeVars(overrides, palette(id, mode), mode), base)) failures.push(`#${i} ${id}/${mode} ${issue}`)
      }
      const banner = formHeaderColors(overrides)
      if (banner && (contrastRatio(banner.text, banner.background) ?? 0) < 4.5) failures.push(`#${i} banner ${banner.text} on ${banner.background}`)
    }
    expect(failures).toEqual([])
  })
})
