import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES, themeToCSS } from '@/lib/themes'
import { contrastRatio, isValidColor, parseColor } from '@/lib/theme/colors'
import { checkThemeContrast, blockingContrastIssues } from '@/lib/theme/contrast'
import { CURATED_FONTS, googleFontsHref } from '@/lib/theme/fonts'
import { THEME_TEMPLATES, defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { canvasMode, parseStoredTheme, resolvePaletteMode, themeAttributes } from '@/lib/theme/resolve'
import { WorkspaceThemeSchema, isOwnStorageUrl, isValidShadow, type WorkspaceTheme } from '@/lib/theme/schema'
import { themeFontsHref, themeStylesheet, themeVars } from '@/lib/theme/to-css'

const SUPABASE = 'https://proj.supabase.co'

function withPatch(patch: (t: WorkspaceTheme) => void): unknown {
  const theme = defaultWorkspaceTheme()
  patch(theme)
  return theme
}

const valid = (value: unknown) => WorkspaceThemeSchema.safeParse(value).success

describe('colour grammar', () => {
  it.each(['#fff', '#FFFFFF', '#17150F80', 'rgb(1, 2, 3)', 'rgba(23,21,15,0.08)', 'rgba(0,0,0,0)', 'hsl(210, 40%, 50%)', 'hsla(210deg,40%,50%,.5)'])('accepts %s', (c) => {
    expect(isValidColor(c)).toBe(true)
  })

  it.each([
    'red', 'transparent', '#ffff', '#gggggg', 'rgb(256,0,0)', 'rgba(0,0,0,2)', 'hsl(400,0%,0%)',
    'url(https://evil.example/x.png)', 'var(--theme-primary)', 'expression(alert(1))',
    '#fff;} body{display:none', '#fff</style><script>alert(1)</script>', 'rgb(1,2,3);color:red', '#fff !important',
  ])('rejects %s', (c) => {
    expect(isValidColor(c)).toBe(false)
  })

  it('parses and composites for contrast', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
    // A translucent black on white is laid over white first.
    expect(contrastRatio('#000000', 'rgba(0,0,0,0)')).toBeCloseTo(21, 0)
    expect(contrastRatio('rgba(0,0,0,0.5)', '#FFFFFF')!).toBeLessThan(6)
  })
})

describe('WorkspaceTheme schema', () => {
  it('accepts the default theme and every template', () => {
    expect(valid(defaultWorkspaceTheme())).toBe(true)
    for (const t of THEME_TEMPLATES) expect(valid(presetToWorkspaceTheme(t.id)), t.id).toBe(true)
  })

  it('rejects CSS injection through colours, gradients and textures', () => {
    expect(valid(withPatch((t) => { t.colors.light.primary = 'red;}*{display:none' }))).toBe(false)
    expect(valid(withPatch((t) => { t.colors.dark.chart[0] = 'url(javascript:alert(1))' }))).toBe(false)
    expect(valid(withPatch((t) => { t.chrome.sidebar.gradient!.stops[0].color = 'var(--x)' }))).toBe(false)
    expect(valid(withPatch((t) => { t.chrome.canvas.texture = { pattern: 'dots', color: '#000);background:url(x)', size: 20 } }))).toBe(false)
  })

  it('rejects bad shadows, lengths and letter spacing', () => {
    for (const bad of ['0 1px url(x)', '0 1px 2px var(--x)', '0 1px 2px red', '0 1px 2px #000; color: red', 'none none', '0 0 0 0 0 0 #000']) {
      expect(isValidShadow(bad), bad).toBe(false)
    }
    expect(isValidShadow('0 1px 2px rgba(0,0,0,0.05), inset 0 0 0 1px #E6E1D5')).toBe(true)
    expect(valid(withPatch((t) => { t.typography.headingLetterSpacing = '1px;color:red' }))).toBe(false)
    expect(valid(withPatch((t) => { t.shape.cardRadius = -1 }))).toBe(false)
    expect(valid(withPatch((t) => { t.typography.baseSize = 40 }))).toBe(false)
  })

  it('limits fonts to safe names, the curated Google list and our storage', () => {
    expect(valid(withPatch((t) => { t.typography.sans = { source: 'google', family: 'Inter' } }))).toBe(true)
    expect(valid(withPatch((t) => { t.typography.sans = { source: 'google', family: 'Comic Neue' } }))).toBe(false)
    expect(valid(withPatch((t) => { t.typography.sans = { source: 'google', family: "Inter'; } body { x" } }))).toBe(false)
    expect(valid(withPatch((t) => { t.typography.sans = { source: 'upload', family: 'Brand</style>', url: `${SUPABASE}/storage/v1/object/public/brand-fonts/t/a.woff2` } }))).toBe(false)
    expect(valid(withPatch((t) => { t.typography.sans = { source: 'system', family: 'Wingdings' } }))).toBe(false)
  })

  it('only accepts storage URLs in our own buckets', () => {
    const font = (url: string) => withPatch((t) => { t.typography.display = { source: 'upload', family: 'Brand Serif', url } })
    const good = `${SUPABASE}/storage/v1/object/public/brand-fonts/tenant-a/brand.woff2`
    expect(isOwnStorageUrl(good, ['brand-fonts'], SUPABASE)).toBe(true)
    for (const bad of [
      'https://evil.example/storage/v1/object/public/brand-fonts/tenant-a/brand.woff2',
      `${SUPABASE}/storage/v1/object/public/logos/tenant-a/brand.woff2`,
      `${SUPABASE}/storage/v1/object/public/brand-fonts/../task-files/x.woff2`,
      `${SUPABASE}/storage/v1/object/public/brand-fonts/tenant-a/a.woff2") ; x`,
      `javascript:alert(1)`,
    ]) {
      expect(isOwnStorageUrl(bad, ['brand-fonts'], SUPABASE), bad).toBe(false)
    }
    const prev = process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE
    try {
      expect(valid(font(good))).toBe(true)
      expect(valid(font(good.replace('.woff2', '.ttf')))).toBe(false)
      expect(valid(withPatch((t) => { t.branding.logoLight = `${SUPABASE}/storage/v1/object/public/logos/tenant-a/logo.png` }))).toBe(true)
      expect(valid(withPatch((t) => { t.branding.favicon = 'https://evil.example/favicon.ico' }))).toBe(false)
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = prev
    }
  })

  it('rejects unknown keys and markup in names', () => {
    expect(valid({ ...defaultWorkspaceTheme(), extra: true })).toBe(false)
    expect(valid(withPatch((t) => { Object.assign(t.colors.light, { customCss: 'x' }) }))).toBe(false)
    expect(valid(withPatch((t) => { t.meta.name = '<img src=x>' }))).toBe(false)
  })
})

describe('built-in presets', () => {
  it('cover all 37 legacy themes plus the marketplace presets', () => {
    expect(THEMES).toHaveLength(37)
    expect(THEME_TEMPLATES).toHaveLength(37 + 6)
    expect(new Set(THEME_TEMPLATES.map((t) => t.id)).size).toBe(THEME_TEMPLATES.length)
  })

  // Colour distance (max channel delta) between two opaque hex colours.
  const delta = (a: string, b: string) => {
    const x = parseColor(a), y = parseColor(b)
    if (!x || !y) return Infinity
    return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))
  }

  it.each(THEMES.flatMap((t) => [[t.id, false], [t.id, true]] as const))('%s (dark=%s) keeps the legacy themeToCSS look, give or take legibility nudges', (id, dark) => {
    const legacyTheme = THEMES.find((t) => t.id === id)!
    // Themes without a dark variant now use their one palette in both modes (the legacy dark-OS rule only darkened the tints).
    const legacy = themeToCSS(legacyTheme, dark && Boolean(legacyTheme.dark))
    const next = themeVars(presetToWorkspaceTheme(id)!, dark ? 'dark' : 'light')
    // Everything but the retired body font scale carries over.
    expect(Object.keys(legacy).filter((k) => !(k in next))).toEqual(['--theme-font-scale'])
    for (const key of Object.keys(legacy).filter((k) => k in next)) {
      if (next[key] === legacy[key]) continue
      // Only colours may move, and only by a contrast nudge (same colour family) — or a translucent wash rebuilt.
      expect(isValidColor(legacy[key]), key).toBe(true)
      if (next[key].startsWith('rgba(') || legacy[key].startsWith('rgba(')) continue
      // Sidebar highlight may fall back to the primary nudged or the sidebar text.
      if (key === '--theme-sidebar-accent') continue
      expect(delta(next[key], legacy[key]), `${key}: ${legacy[key]} → ${next[key]}`).toBeLessThanOrEqual(110)
    }
  })

  it('keeps the id-keyed looks: brand trio texture + display headings, decorated sidebars, Noir status', () => {
    const gallery = presetToWorkspaceTheme('basecamp')!
    expect(gallery.chrome.sidebar).toMatchObject({ style: 'texture', decorations: 'off' })
    expect(gallery.typography.headingFont).toBe('display')
    expect(themeVars(gallery, 'light')['--theme-sidebar-image']).toBe('radial-gradient(circle at 1px 1px, rgba(233,228,216,0.055) 1px, transparent 0), linear-gradient(180deg, #1B1815 0%, #161411 55%, #121110 100%)')
    expect(themeVars(gallery, 'light')['--theme-canvas-image']).toContain('rgba(27,25,22,0.045)')
    expect(presetToWorkspaceTheme('night-drive')!.colors.light.status.todo).toBe('#A29A89')
    expect(presetToWorkspaceTheme('aurora')!.chrome.sidebar).toMatchObject({ decorations: 'light', decorationColor: '#0D9488' })
    expect(presetToWorkspaceTheme('dawn')!.meta.decorationPreset).toBe('dawn')
    expect(themeVars(presetToWorkspaceTheme('ultraviolet')!, 'light')['--theme-sidebar-image']).toContain('rgba(196,181,253,0.06)')
    expect(presetToWorkspaceTheme('studio')!.chrome.sidebar.style).toBe('solid')
    expect(themeVars(presetToWorkspaceTheme('studio')!, 'light')['--theme-sidebar-image']).toBe('none')
  })

  it('returns independent copies and null for unknown ids', () => {
    const a = presetToWorkspaceTheme('basecamp')!
    a.meta.name = 'changed'
    expect(presetToWorkspaceTheme('basecamp')!.meta.name).toBe('Gallery')
    expect(presetToWorkspaceTheme('nope')).toBeNull()
    expect(presetToWorkspaceTheme('corporate-blue')!.shape.buttonRadius).toBe(6)
  })
})

describe('CSS generation', () => {
  it('emits every variable globals.css declares on :root (and vice versa for theme vars)', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    const declared = [...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1])
    expect(declared.length).toBeGreaterThan(80)
    const vars = themeVars(defaultWorkspaceTheme(), 'light')
    expect(declared.filter((v) => !(v in vars))).toEqual([])
    // The globals defaults are the default theme's values.
    for (const v of declared) {
      if (v === '--theme-card-shadow') continue
      expect(vars[v], v).toBe(root.match(new RegExp(`${v}: ([^;]+);`))![1])
    }
    expect(vars['--theme-card-shadow']).toBe('0 1px 2px rgba(0,0,0,0.05)')
    // Tailwind weight tokens are driven too.
    expect(vars['--font-weight-semibold']).toBe('600')
  })

  it('auto mode: light on :root, dark palette under prefers-color-scheme', () => {
    const css = themeStylesheet(presetToWorkspaceTheme('midnight')!)
    expect(css).toMatch(/^:root\{--theme-font-sans:[^}]*--theme-primary:#2563EB !important/)
    expect(css).toContain('@media (prefers-color-scheme: dark){:root{')
    expect(css).toContain('--theme-primary:#60A5FA !important')
  })

  it('forced modes render one palette; scoped previews skip !important', () => {
    const dark = withPatch((t) => { t.meta.mode = 'dark' }) as WorkspaceTheme
    const css = themeStylesheet(dark)
    expect(css).not.toContain('@media')
    expect(css).toContain(`--theme-surface:${dark.colors.dark.surface} !important`)
    const scoped = themeStylesheet(dark, { scope: '.theme-preview' })
    expect(scoped.startsWith('.theme-preview{')).toBe(true)
    expect(scoped).not.toContain('!important')
  })

  it('adds rules for uploads, decorations, uppercase labels, density and heading weight', () => {
    const t = presetToWorkspaceTheme('aurora')!
    t.typography.display = { source: 'upload', family: 'Brand Serif', url: `${SUPABASE}/storage/v1/object/public/brand-fonts/t/b.woff2` }
    t.typography.uppercaseLabels = true
    t.typography.weights.heading = 800
    t.layout.density = 'compact'
    const css = themeStylesheet(t)
    expect(css).toContain(`@font-face{font-family:'Brand Serif';src:url("${SUPABASE}/storage/v1/object/public/brand-fonts/t/b.woff2") format("woff2")`)
    expect(css).toContain(':root .premium-sidebar .sidebar-decorations{display:block}')
    expect(css).toContain('fill:var(--theme-sidebar-decoration-color)')
    expect(css).toContain(':root label{text-transform:uppercase')
    expect(css).toContain(':root td,:root th{padding-top:var(--theme-density-cell-y)')
    expect(css).toContain(':root h1,:root h2{font-weight:var(--theme-font-weight-heading)}')
    expect(themeVars(t, 'light')['--theme-font-display']).toBe("'Brand Serif', var(--font-display), ui-serif, Georgia, serif")
    expect(themeStylesheet(defaultWorkspaceTheme())).not.toContain('sidebar-decorations')
  })

  it('never lets "<" through to the style element', () => {
    expect(themeStylesheet(defaultWorkspaceTheme())).not.toContain('<')
  })

  it('maps base size and density to variables', () => {
    const t = withPatch((x) => { x.typography.baseSize = 15; x.layout.sidebarWidth = 280; x.layout.density = 'spacious' }) as WorkspaceTheme
    const vars = themeVars(t, 'light')
    expect(vars['--theme-font-size-scale']).toBe('93.75%')
    expect(vars['--theme-sidebar-width']).toBe('280px')
    expect(vars['--theme-density-row-height']).toBe('48px')
  })

  it('loads non-bundled Google fonts only', () => {
    expect(themeFontsHref(defaultWorkspaceTheme())).toBeNull()
    const t = withPatch((x) => { x.typography.sans = { source: 'google', family: 'Inter' }; x.typography.mono = { source: 'google', family: 'Space Mono' } }) as WorkspaceTheme
    expect(themeFontsHref(t)).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')
    expect(themeVars(t, 'light')['--theme-font-sans']).toBe("'Inter', var(--font-sans), ui-sans-serif, system-ui, sans-serif")
    // Weights snap to what the family has (Google rejects a request for a missing weight).
    expect(googleFontsHref([{ family: 'Atkinson Hyperlegible', weights: [400, 500, 600, 700] }])).toBe('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap')
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(40)
  })
})

describe('contrast checks', () => {
  it('no built-in template is blocked', () => {
    for (const t of THEME_TEMPLATES) expect(blockingContrastIssues(presetToWorkspaceTheme(t.id)!), t.id).toEqual([])
  })

  it('blocks near-invisible core text (below 3:1), warns below the AA target', () => {
    const t = defaultWorkspaceTheme()
    t.colors.light.onPrimary = '#1A1A1A'
    t.colors.dark.sidebarText = t.colors.dark.sidebar
    t.colors.light.mutedText = '#BBBBBB'
    t.colors.light.status.todo = '#767F87'
    const issues = checkThemeContrast(t)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'light', pair: 'onPrimary/primary', level: 'block' }),
      expect.objectContaining({ mode: 'dark', pair: 'sidebarText/sidebar', level: 'block' }),
      expect.objectContaining({ mode: 'light', pair: 'mutedText/cardBg', level: 'block', required: 4.5 }),
      // ~4:1 status text: below AA, not invisible.
      expect.objectContaining({ mode: 'light', pair: 'status.todo/cardBg', level: 'warn', required: 4.5 }),
    ]))
    // The dark sidebar text also fails against every sidebar gradient stop and the active wash.
    expect(new Set(blockingContrastIssues(t).map((i) => `${i.mode}:${i.pair}`))).toEqual(new Set([
      'light:onPrimary/primary', 'light:onPrimary/primaryHover', 'light:mutedText/cardBg', 'light:mutedText/surface',
      'dark:sidebarText/sidebar', 'dark:sidebarText/sidebarActive', 'dark:sidebarText/sidebar gradient',
    ]))
  })

  it('checks text against every gradient stop of the sidebar and topbar, in each mode', () => {
    const t = defaultWorkspaceTheme()
    t.chrome.topbar = { style: 'gradient', gradient: { angle: 90, stops: [{ color: '#FFFFFF', at: 0 }, { color: '#EDE9FE', at: 100 }] } }
    t.colors.dark.topbarText = '#F3F4F6'
    t.chrome.sidebar.gradient = { angle: 180, stops: [{ color: '#161411', at: 0 }, { color: '#F0F0F0', at: 100 }] }
    const issues = checkThemeContrast(t)
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'dark', pair: 'topbarText/topbar gradient', level: 'block' }),
      expect.objectContaining({ mode: 'light', pair: 'sidebarText/sidebar gradient', background: '#F0F0F0', level: 'block' }),
    ]))
    expect(issues.filter((i) => i.pair === 'topbarText/topbar gradient' && i.mode === 'light')).toEqual([])
  })

  it('only checks the forced palette when the theme forces a mode', () => {
    const t = defaultWorkspaceTheme()
    t.meta.mode = 'light'
    t.colors.dark.sidebarText = t.colors.dark.sidebar
    expect(blockingContrastIssues(t)).toEqual([])
  })
})

describe('provider resolution', () => {
  it('expands stored stubs and falls back to the default', () => {
    expect(parseStoredTheme({ base_preset: 'night-drive' }).meta.name).toBe('Noir')
    expect(parseStoredTheme({ base_preset: 'retired-theme' }).meta.basePreset).toBe('basecamp')
    expect(parseStoredTheme(null).meta.basePreset).toBe('basecamp')
    expect(parseStoredTheme({ meta: { name: 'broken' } }).meta.basePreset).toBe('basecamp')
    const custom = withPatch((t) => { t.meta.name = 'Acme'; delete t.meta.basePreset })
    expect(parseStoredTheme(custom).meta.name).toBe('Acme')
  })

  it('follows the OS unless the theme forces a mode; data-theme-mode follows the canvas', () => {
    const gallery = presetToWorkspaceTheme('basecamp')!
    expect(resolvePaletteMode(gallery, true)).toBe('dark')
    // Light presets without a dark variant keep a light canvas in dark OS mode (as before).
    expect(canvasMode(gallery, true)).toBe('light')
    expect(canvasMode(presetToWorkspaceTheme('midnight')!, true)).toBe('dark')
    expect(canvasMode(presetToWorkspaceTheme('night-drive')!, false)).toBe('dark')
    const forced = presetToWorkspaceTheme('midnight')!
    forced.meta.mode = 'light'
    expect(resolvePaletteMode(forced, true)).toBe('light')
    expect(canvasMode(forced, true)).toBe('light')
  })

  it('sets the html attributes the CSS keys off', () => {
    expect(themeAttributes(presetToWorkspaceTheme('nebula')!, false)).toEqual({
      'data-theme': 'nebula',
      'data-theme-mode': 'dark',
      'data-theme-decoration': 'nebula',
      'data-sidebar-style': 'texture',
      'data-density': 'comfortable',
      'data-theme-headings': 'sans',
    })
    const custom = withPatch((t) => { delete t.meta.basePreset }) as WorkspaceTheme
    expect(themeAttributes(custom, false)['data-theme']).toBe('custom')
  })
})
