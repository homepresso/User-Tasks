/**
 * UI foundations (docs/design/ui-polish-spec.md §2, §9): fonts, dark palettes
 * for Gallery / Atelier, mode-aware elevation, density, the design-system
 * tokens derived from every theme (and their contrast), and the stored-theme
 * migration staying in step with the presets.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, isDarkColor } from '@/lib/theme/colors'
import { CONTRAST_PAIRS, DS_BOUNDARY, paletteContrastIssues } from '@/lib/theme/contrast'
import { CURATED_FONTS, findCuratedFont } from '@/lib/theme/fonts'
import { dsTokenColors, dsTokenHex, derivedTokens, legiblePalette } from '@/lib/theme/legibility'
import { DEFAULT_TYPOGRAPHY, LEGACY_DEFAULT_TYPOGRAPHY, THEME_TEMPLATES, defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { canvasMode, parseStoredTheme } from '@/lib/theme/resolve'
import { WorkspaceThemeSchema, type ThemePalette, type WorkspaceTheme } from '@/lib/theme/schema'
import { DENSITY, DS_DERIVED_VARS, ELEVATION, elevationVars, themeStylesheet, themeVars } from '@/lib/theme/to-css'

const ROOT = process.cwd()
const globals = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
const migration = readFileSync(path.join(ROOT, 'supabase/migrations/20261221000000_theme_defaults_refresh.sql'), 'utf8')
const cases = THEME_TEMPLATES.flatMap((t) => [[t.id, 'light'], [t.id, 'dark']] as const)

describe('fonts', () => {
  it('bundles Inter, JetBrains Mono and Fraunces; DM Sans and Space Mono are plain Google fonts', () => {
    expect(findCuratedFont('Inter')?.bundledVar).toBe('--font-sans')
    expect(findCuratedFont('JetBrains Mono')?.bundledVar).toBe('--font-mono')
    expect(findCuratedFont('Fraunces')?.bundledVar).toBe('--font-display')
    expect(findCuratedFont('DM Sans')?.bundledVar).toBeUndefined()
    expect(findCuratedFont('Space Mono')?.bundledVar).toBeUndefined()
    expect(CURATED_FONTS.filter((f) => f.bundledVar).map((f) => f.family).sort()).toEqual(['Fraunces', 'Inter', 'JetBrains Mono'])
  })

  it('every built-in preset uses the new defaults with sans headings', () => {
    for (const t of THEME_TEMPLATES) {
      const ty = presetToWorkspaceTheme(t.id)!.typography
      expect(ty.sans, t.id).toEqual(DEFAULT_TYPOGRAPHY.sans)
      expect(ty.mono, t.id).toEqual(DEFAULT_TYPOGRAPHY.mono)
      expect(ty.headingFont, t.id).toBe('sans')
    }
  })

  it('the root layout loads them through next/font and the bootstrap defaults to sans headings', () => {
    const layout = readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/import \{ Inter, JetBrains_Mono, Fraunces \} from "next\/font\/google"/)
    expect(layout).not.toMatch(/DM_Sans|Space_Mono/)
    expect(layout).toContain("getItem('theme_headings')||'sans'")
  })

  it('a workspace theme font still wins over the defaults', () => {
    const t = defaultWorkspaceTheme()
    t.typography.sans = { source: 'google', family: 'IBM Plex Sans' }
    expect(themeVars(t, 'light')['--theme-font-sans']).toBe("'IBM Plex Sans', var(--font-sans), ui-sans-serif, system-ui, sans-serif")
  })
})

describe('Gallery and Atelier follow the device into dark', () => {
  it.each(['basecamp', 'trailside'])('%s has its own dark palette on a dark canvas', (id) => {
    const t = presetToWorkspaceTheme(id)!
    // Gallery (the platform default) starts in light mode; Follow device turns its dark palette on.
    expect(t.meta.mode).toBe(id === 'basecamp' ? 'light' : 'auto')
    t.meta.mode = 'auto'
    expect(t.colors.dark).not.toEqual(t.colors.light)
    expect(isDarkColor(t.colors.dark.surface)).toBe(true)
    expect(isDarkColor(t.colors.dark.cardBg)).toBe(true)
    expect(canvasMode(t, true)).toBe('dark')
    expect(canvasMode(t, false)).toBe('light')
    expect(paletteContrastIssues(t.colors.dark, 'dark', t.chrome)).toEqual([])
    // The OS-dark block of the stylesheet carries the dark palette.
    expect(themeStylesheet(t)).toContain(`@media (prefers-color-scheme: dark){:root{--theme-primary:${t.colors.dark.primary} !important`)
  })

  it('Gallery keeps the ink-black primary in light, white-on-black actions in dark, camel only as the accent', () => {
    const g = presetToWorkspaceTheme('basecamp')!
    expect(g.colors.light.primary).toBe('#17150F')
    expect(g.colors.light.accent).toBe('#B08A54')
    expect(g.colors.dark.primary).toBe('#EDE8DD')
    expect(g.colors.dark.onPrimary).toBe('#17150F')
    expect(g.colors.dark.accent).toBe('#C7A575')
  })
})

describe('elevation', () => {
  it('is mode-aware: platform values keyed by the canvas', () => {
    const g = presetToWorkspaceTheme('basecamp')!
    expect(themeVars(g, 'light')['--ds-elev-2']).toBe(ELEVATION.light[2])
    expect(themeVars(g, 'dark')['--ds-elev-2']).toBe(ELEVATION.dark[2])
    expect(themeVars(g, 'dark')['--ds-bg-elevated']).toBe(ELEVATION.dark.elevatedBg)
    expect(themeVars(presetToWorkspaceTheme('night-drive')!, 'light')['--ds-elev-3']).toBe(ELEVATION.dark[3])
  })

  it('custom shadows apply on light canvases only', () => {
    const shadows = { ...defaultWorkspaceTheme().shadows, lg: '0 2px 6px rgba(1,2,3,0.3)' }
    expect(elevationVars({ surface: '#FFFFFF' }, shadows)['--ds-elev-2']).toBe('0 0 0 1px var(--ds-border), 0 2px 6px rgba(1,2,3,0.3)')
    expect(elevationVars({ surface: '#101010' }, shadows)['--ds-elev-2']).toBe(ELEVATION.dark[2])
    expect(elevationVars({ surface: '#FFFFFF' }, defaultWorkspaceTheme().shadows)['--ds-elev-2']).toBe(ELEVATION.light[2])
  })

  it('globals.css carries the same light and dark defaults', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const level of [1, 2, 3] as const) expect(globals, `${mode} ${level}`).toContain(`--ds-elev-${level}: ${ELEVATION[mode][level]};`)
    }
  })
})

describe('density', () => {
  it('drives row, cell and control heights', () => {
    for (const density of ['compact', 'comfortable', 'spacious'] as const) {
      const t = defaultWorkspaceTheme()
      t.layout.density = density
      const v = themeVars(t, 'light')
      expect(v['--theme-density-row-height']).toBe(`${DENSITY[density].rowHeight}px`)
      expect(v['--ds-control-h']).toBe(`${DENSITY[density].controlH}px`)
      expect(v['--ds-nav-item-h']).toBe(`${DENSITY[density].navItemH}px`)
    }
    expect(DENSITY.comfortable).toMatchObject({ rowHeight: 40, controlH: 32, navItemH: 32 })
    expect(globals).toContain('--ds-control-h: 32px;')
  })
})

describe('design-system tokens', () => {
  it('globals.css declares DS_DERIVED_VARS on :root and on form-theme / preview scopes', () => {
    const start = globals.indexOf(':root, [data-form-theme], [data-ds-scope] {')
    expect(start).toBeGreaterThan(0)
    const block = globals.slice(start, globals.indexOf('}', start))
    for (const [k, v] of Object.entries(DS_DERIVED_VARS)) expect(block, k).toContain(`${k}: ${v};`)
  })

  it('scoped previews re-declare them so the edited theme flows into them', () => {
    const css = themeStylesheet(defaultWorkspaceTheme(), { scope: '#preview', important: false })
    expect(css).toContain('--ds-bg-muted:color-mix(in srgb, var(--theme-card-text) 7%, var(--theme-card-bg))')
    expect(themeStylesheet(defaultWorkspaceTheme())).not.toContain('--ds-bg-muted:')
  })

  it('the contrast audit covers the derived pairs', () => {
    const pairs = CONTRAST_PAIRS.map((p) => p.pair)
    for (const p of ['mutedText/ds.bgMuted', 'cardText/ds.bgSubtle', 'ds.fgSubtle/cardBg', 'ds.borderStrong/cardBg']) expect(pairs).toContain(p)
  })

  it.each(cases)('%s (%s): StatusPill text on its wash, neutral fills, subtle text and the strong hairline', (id, mode) => {
    const p = presetToWorkspaceTheme(id)!.colors[mode]
    const d = derivedTokens(p)
    const ds = dsTokenHex(p)
    const on = (fg: string, bg: string) => contrastRatio(fg, bg, p.cardBg) ?? 0
    // One semantic tone set: neutral / info / success / warning / danger / brand.
    expect(on(p.mutedText, ds.dsBgMuted), 'neutral').toBeGreaterThanOrEqual(4.5)
    expect(on(p.status.info, p.status.infoBg), 'info').toBeGreaterThanOrEqual(4.5)
    expect(on(p.success, p.status.successBg), 'success').toBeGreaterThanOrEqual(4.5)
    expect(on(p.warning, p.status.warningBg), 'warning').toBeGreaterThanOrEqual(4.5)
    expect(on(p.danger, p.status.dangerBg), 'danger').toBeGreaterThanOrEqual(4.5)
    expect(on(d.primaryText, p.primaryLight), 'brand').toBeGreaterThanOrEqual(4.5)
    // Table header / hover row text.
    expect(on(p.cardText, ds.dsBgSubtle)).toBeGreaterThanOrEqual(4.5)
    // Disabled text stays legible at 3:1; the strong hairline is a visible step.
    expect(on(ds.dsFgSubtle, p.cardBg)).toBeGreaterThanOrEqual(3)
    expect(on(ds.dsBorderStrong, p.cardBg)).toBeGreaterThanOrEqual(DS_BOUNDARY)
  })

  it('mirrors the CSS color-mix for the derived fills', () => {
    const t = dsTokenColors({ surface: '#FFFFFF', cardBg: '#FFFFFF', cardText: '#000000', mutedText: '#000000' })
    expect(Math.round(t.bgMuted.r)).toBe(Math.round(255 * 0.93))
    expect(Math.round(t.borderStrong.r)).toBe(Math.round(255 * 0.76))
  })

  it('custom palettes come out of the legibility pass with readable neutral pills', () => {
    const p: ThemePalette = { ...defaultWorkspaceTheme().colors.light, mutedText: '#8A8A8A', cardBg: '#F4F4F4' }
    const fixed = legiblePalette(p)
    expect(contrastRatio(fixed.mutedText, dsTokenHex(fixed).dsBgMuted)!).toBeGreaterThanOrEqual(4.5)
  })
})

describe('globals.css', () => {
  it('fences the legacy compat block and drops the radius flattening and blanket card shadow', () => {
    expect(globals).toContain('LEGACY COMPAT — remove when B–F land')
    expect(globals).not.toMatch(/border-radius: var\(--theme-border-radius\) !important/)
    expect(globals).not.toMatch(/\.rounded-xl\[class\*="border"\]/)
    expect(globals).toContain('--radius-lg: var(--ds-radius-md);')
    expect(globals).toContain('--radius-xl: var(--ds-radius-lg);')
  })

  it('has no dot texture by default and honours reduced motion', () => {
    expect(globals).toContain('--theme-canvas-image: none;')
    expect(globals).toContain('--theme-sidebar-image: none;')
    expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*--ds-dur-base: 0ms/)
  })
})

describe('stored-theme migration (20261221000000_theme_defaults_refresh)', () => {
  const constant = (name: string) => JSON.parse(new RegExp(`${name} constant jsonb := \\$json\\$(.+?)\\$json\\$`).exec(migration)![1])

  it('embeds the current Gallery / Atelier dark palettes', () => {
    expect(constant('gallery_dark')).toEqual(presetToWorkspaceTheme('basecamp')!.colors.dark)
    expect(constant('atelier_dark')).toEqual(presetToWorkspaceTheme('trailside')!.colors.dark)
  })

  it('matches only untouched defaults and keeps rollback data', () => {
    expect(migration).toContain(`'{"source":"google","family":"${LEGACY_DEFAULT_TYPOGRAPHY.sans.family}"}'::jsonb`)
    expect(migration).toContain(`= '${LEGACY_DEFAULT_TYPOGRAPHY.mono.family}'`)
    expect(migration).toContain("theme #> '{colors,dark}' = theme #> '{colors,light}'")
    expect(migration).toContain('workspace_theme_refresh_backup')
    expect(migration).toContain('on conflict (tenant_id, migration) do nothing')
    expect(migration).not.toMatch(/update\s+public\.(forms|form_versions|form_themes)\b/i)
  })

  it('a pre-foundations Gallery theme, rewritten as the migration does, is valid and renders dark', () => {
    // The stored copy of Gallery before this change: DM Sans / Space Mono, Fraunces headings, dark = light.
    const old: WorkspaceTheme = defaultWorkspaceTheme()
    old.meta.mode = 'auto'
    old.typography.sans = { source: 'google', family: 'DM Sans' }
    old.typography.mono = { source: 'google', family: 'Space Mono' }
    old.typography.headingFont = 'display'
    old.colors.dark = structuredClone(old.colors.light)
    expect(WorkspaceThemeSchema.safeParse(old).success).toBe(true)
    const migrated = structuredClone(old)
    migrated.typography.sans = { source: 'google', family: 'Inter' }
    migrated.typography.mono = { source: 'google', family: 'JetBrains Mono' }
    migrated.typography.headingFont = 'sans'
    migrated.typography.headingLetterSpacing = 'normal'
    migrated.colors.dark = constant('gallery_dark')
    const parsed = parseStoredTheme(JSON.parse(JSON.stringify(migrated)))
    expect(parsed.meta.name).toBe(old.meta.name)
    expect(parsed.colors.dark.surface).toBe('#171512')
    expect(canvasMode(parsed, true)).toBe('dark')
  })
})
