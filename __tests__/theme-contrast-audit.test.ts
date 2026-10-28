/**
 * Guardrails for theme legibility: every built-in preset meets every text /
 * UI contrast pair the app draws (lib/theme/contrast.ts) in both modes, and
 * the renderer's legibility pass makes arbitrary custom palettes pass too.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/theme/colors'
import { CONTRAST_PAIRS, paletteContrastIssues } from '@/lib/theme/contrast'
import { ensureContrast, legiblePalette, readableFill } from '@/lib/theme/legibility'
import { THEME_TEMPLATES, defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { parseStoredTheme } from '@/lib/theme/resolve'
import type { ThemePalette } from '@/lib/theme/schema'
import { themeStylesheet, themeVars } from '@/lib/theme/to-css'

const cases = THEME_TEMPLATES.flatMap((t) => [[t.id, 'light'], [t.id, 'dark']] as const)

describe('built-in presets pass the token audit', () => {
  it('covers every pair family the UI draws', () => {
    const pairs = CONTRAST_PAIRS.map((p) => p.pair)
    for (const p of ['cardText/cardBg', 'mutedText/surface', 'primaryText/primaryLight', 'onPrimary/primaryHover', 'status.done/status.doneBg',
      'danger/status.dangerBg', 'sidebarText/sidebarActive', 'sidebarAccent/sidebar', 'topbarText/topbar', 'focusRing/surface', 'chart6/cardBg']) {
      expect(pairs).toContain(p)
    }
  })

  it.each(cases)('%s (%s): AA for text, 3:1 for large text / sidebar highlights / graphics', (id, mode) => {
    const theme = presetToWorkspaceTheme(id)!
    expect(paletteContrastIssues(theme.colors[mode], mode, theme.chrome)).toEqual([])
  })

  it.each(cases)('%s (%s): already legible, so rendering changes nothing', (id, mode) => {
    const theme = presetToWorkspaceTheme(id)!
    expect(legiblePalette(theme.colors[mode], theme.chrome)).toEqual(theme.colors[mode])
  })

  it('light-only presets use one palette in both modes (no near-black washes in dark mode)', () => {
    const gallery = presetToWorkspaceTheme('basecamp')!
    expect(gallery.colors.dark.primaryLight).toBe(gallery.colors.light.primaryLight)
    expect(gallery.colors.dark.accentLight).toBe(gallery.colors.light.accentLight)
    // Dark-card presets get the dark status palette.
    const nebula = presetToWorkspaceTheme('nebula')!.colors.light
    expect(nebula.status.todo).not.toBe('#5B6770')
    expect(contrastRatio(nebula.status.todo, nebula.cardBg)!).toBeGreaterThanOrEqual(4.5)
  })

  it('sidebar wordmark and sidebar / top-bar secondary text read on every preset (studio: white sidebar)', () => {
    for (const t of THEME_TEMPLATES) {
      const theme = presetToWorkspaceTheme(t.id)!
      for (const mode of ['light', 'dark'] as const) {
        const v = themeVars(theme, mode)
        expect(contrastRatio(v['--sidebar-brand-color'], v['--theme-sidebar']) ?? 0, `${t.id}/${mode}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(v['--theme-sidebar-muted'], v['--theme-sidebar']) ?? 0, `${t.id}/${mode}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(v['--theme-topbar-muted'], v['--theme-topbar']) ?? 0, `${t.id}/${mode}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('legibility pass for stored / custom themes', () => {
  it('repairs a stored theme with the old dark-OS washes (dark tint under dark text)', () => {
    const stored = defaultWorkspaceTheme()
    stored.colors.dark.primaryLight = '#070605'
    stored.colors.dark.accentLight = '#352919'
    const theme = parseStoredTheme(JSON.parse(JSON.stringify(stored)))
    const v = themeVars(theme, 'dark')
    expect(v['--theme-primary-light']).toMatch(/^rgba\(23,21,15,0\.\d+\)$/)
    expect(contrastRatio(v['--theme-card-text'], v['--theme-accent-light'], v['--theme-card-bg'])!).toBeGreaterThanOrEqual(4.5)
    // The dark block of the stylesheet carries the repaired wash too.
    expect(themeStylesheet(theme)).not.toContain('#070605')
  })

  it('raises failing text colours to the nearest readable shade, keeping the hue', () => {
    const fixed = ensureContrast('#9CA3AF', [parseColor('#FFFFFF')], 4.5)
    expect(contrastRatio(fixed, '#FFFFFF')!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(fixed, '#FFFFFF')!).toBeLessThan(5.5)
    // Already passing → unchanged.
    expect(ensureContrast('#475569', [parseColor('#FFFFFF')], 4.5)).toBe('#475569')
  })

  it('fixes bright fills for white text (designer node headers)', () => {
    for (const c of ['#22C55E', '#F59E0B', '#0EA5E9', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6B7280']) {
      expect(contrastRatio('#FFFFFF', readableFill(c))!, c).toBeGreaterThanOrEqual(4.5)
    }
    expect(readableFill('var(--theme-primary)')).toBe('var(--theme-primary)')
  })

  // Seeded random palettes built on each preset: random text / tint / status colours.
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const hex = () => `#${Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')}`
  const wash = () => `rgba(${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)},${(0.04 + rnd() * 0.2).toFixed(2)})`

  it('makes 300 random custom palettes pass every pair', () => {
    const failures: string[] = []
    for (let n = 0; n < 300; n++) {
      const base = presetToWorkspaceTheme(THEME_TEMPLATES[n % THEME_TEMPLATES.length].id)!
      const mode = n % 2 ? 'dark' : 'light'
      const p: ThemePalette = structuredClone(base.colors[mode])
      p.mutedText = hex(); p.cardText = rnd() > 0.5 ? hex() : p.cardText
      p.primary = hex(); p.primaryHover = hex(); p.accent = hex()
      p.primaryLight = wash(); p.accentLight = wash(); p.rowHighlight = wash()
      p.success = hex(); p.warning = hex(); p.danger = hex(); p.info = hex()
      p.status = { ...p.status, todo: hex(), progress: hex(), blocked: hex(), done: hex(), info: hex(), doneBg: wash(), blockedBg: wash() }
      p.sidebarText = hex(); p.topbarText = hex(); p.chart = p.chart.map(() => hex())
      if (rnd() > 0.5) p.onPrimary = hex()
      const fixed = legiblePalette(p, base.chrome)
      const issues = paletteContrastIssues(fixed, mode, base.chrome)
      if (issues.length) failures.push(`${n}: ${issues.map((i) => `${i.pair}=${i.ratio}`).join(', ')}`)
      // Idempotent.
      expect(legiblePalette(fixed, base.chrome)).toEqual(fixed)
    }
    expect(failures).toEqual([])
  })

  it('emits the derived text tokens and status aliases', () => {
    const v = themeVars(defaultWorkspaceTheme(), 'light')
    for (const k of ['--theme-primary-text', '--theme-accent-text', '--theme-sidebar-muted', '--theme-topbar-muted', '--theme-on-accent', '--theme-on-danger', '--theme-on-success',
      '--theme-on-warning', '--theme-on-info', '--status-error', '--status-error-bg', '--status-warning', '--status-success']) {
      expect(v[k], k).toBeTruthy()
    }
    expect(contrastRatio(v['--theme-on-danger'], v['--theme-danger'])!).toBeGreaterThanOrEqual(4.5)
  })
})
