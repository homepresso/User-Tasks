/**
 * WorkspaceTheme → CSS.
 *
 * themeVars() is the full custom-property set for one mode (a superset of the
 * legacy themeToCSS(): same names and values for a converted preset, plus
 * typography, status, row, focus, input, overlay, chart, radii, shadows,
 * density, layout and chrome variables). themeStylesheet() wraps them for a
 * <style> tag — `:root` light vars, a prefers-color-scheme block for the dark
 * palette when the theme follows the OS — plus the few rules that can't be
 * plain variables (uploaded @font-face, display headings, uppercase labels,
 * sidebar decorations, density). app/globals.css consumes the variables.
 *
 * Design-system tokens (docs/design/foundations.md): each palette also gets
 * its elevation (--ds-elev-1/2/3, --ds-bg-elevated — platform values keyed
 * by whether the canvas is dark; a custom theme's own shadows apply to light
 * canvases only, they were invisible on dark ones), and the theme's density
 * sets the control / row / nav heights.
 *
 * Every value comes from a schema-validated theme; nothing here concatenates
 * unvalidated input.
 */

import { isDarkColor } from './colors'
import { derivedTokens, legibleBrandColor, legiblePalette, onColor, onSemantic, sidebarAccentFor } from './legibility'
import { SLOT_FALLBACK, SYSTEM_FONT_STACKS, findThemeFont, googleFontsHrefs, type FontSlot } from './fonts'
import type { FontRef, ThemeMode, ThemePalette, WorkspaceTheme } from './schema'
import { resolveStorageUrl } from '@/lib/storage/refs'

type Vars = Record<string, string>
type Gradient = NonNullable<WorkspaceTheme['chrome']['sidebar']['gradient']>
type Texture = NonNullable<WorkspaceTheme['chrome']['sidebar']['texture']>

export const CHART_SLOTS = 10

/**
 * Density presets: table / list row height, cell padding, and the heights of
 * app-chrome controls (md / sm / lg buttons and inputs) and nav items.
 * `comfortable` is the default. The form runtime keeps 40px controls
 * regardless (it serves end users on touch devices).
 */
export const DENSITY: Record<WorkspaceTheme['layout']['density'], { rowHeight: number; cellY: number; cellX: number; gap: number; controlH: number; controlHSm: number; controlHLg: number; navItemH: number }> = {
  compact: { rowHeight: 32, cellY: 4, cellX: 8, gap: 8, controlH: 28, controlHSm: 24, controlHLg: 32, navItemH: 28 },
  comfortable: { rowHeight: 40, cellY: 8, cellX: 12, gap: 12, controlH: 32, controlHSm: 28, controlHLg: 36, navItemH: 32 },
  spacious: { rowHeight: 48, cellY: 12, cellX: 16, gap: 16, controlH: 36, controlHSm: 32, controlHLg: 40, navItemH: 36 },
}

/** Platform elevation (docs/design/ui-polish-spec.md §2.6): level 0 is flat (cards), 1 hover / thumbs, 2 popovers / menus, 3 dialogs. */
export const ELEVATION: Record<ThemeMode, { 1: string; 2: string; 3: string; elevatedBg: string }> = {
  light: {
    1: '0 1px 2px rgb(16 16 20 / .06)',
    2: '0 0 0 1px var(--ds-border), 0 4px 12px -2px rgb(16 16 20 / .08), 0 2px 4px -2px rgb(16 16 20 / .04)',
    3: '0 0 0 1px var(--ds-border), 0 16px 40px -8px rgb(16 16 20 / .18), 0 6px 16px -6px rgb(16 16 20 / .08)',
    elevatedBg: 'var(--theme-card-bg)',
  },
  dark: {
    1: '0 1px 2px rgb(0 0 0 / .4), inset 0 1px 0 rgb(255 255 255 / .04)',
    2: '0 0 0 1px var(--ds-border), 0 8px 24px -4px rgb(0 0 0 / .55), inset 0 1px 0 rgb(255 255 255 / .05)',
    3: '0 0 0 1px var(--ds-border), 0 24px 56px -12px rgb(0 0 0 / .7), inset 0 1px 0 rgb(255 255 255 / .06)',
    elevatedBg: 'color-mix(in srgb, var(--theme-card-bg) 92%, white)',
  },
}

/** Shadows the built-in presets ship with (a theme that keeps them uses the platform elevation). */
const PLATFORM_SHADOWS = {
  sm: '0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.02)',
  lg: '0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
  xl: '0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
}

/**
 * Elevation for one palette: platform values by canvas darkness; on a light
 * canvas a theme's own (non-default) shadows replace levels 1–3.
 */
export function elevationVars(p: Pick<ThemePalette, 'surface'>, shadows?: WorkspaceTheme['shadows']): Vars {
  const mode: ThemeMode = isDarkColor(p.surface) ? 'dark' : 'light'
  const e = ELEVATION[mode]
  const own = (key: 'sm' | 'lg' | 'xl') => mode === 'light' && shadows && shadows[key] !== PLATFORM_SHADOWS[key] ? shadows[key] : null
  const ring = (shadow: string) => (shadow === 'none' ? 'none' : `0 0 0 1px var(--ds-border), ${shadow}`)
  const s1 = own('sm'), s2 = own('lg'), s3 = own('xl')
  return {
    '--ds-elev-1': s1 ?? e[1],
    '--ds-elev-2': s2 ? ring(s2) : e[2],
    '--ds-elev-3': s3 ? ring(s3) : e[3],
    '--ds-bg-elevated': e.elevatedBg,
  }
}

/**
 * Tokens derived from the --theme-* variables (app/globals.css declares the
 * same list on :root and on form-theme scopes). A var() resolves where the
 * property is declared, so a scoped stylesheet (theme designer preview) has
 * to declare them again for its own colours to flow into them.
 */
export const DS_DERIVED_VARS: Vars = {
  '--ds-radius-xs': 'var(--theme-badge-radius)',
  '--ds-radius-sm': 'var(--theme-button-radius)',
  '--ds-radius-input': 'var(--theme-input-radius)',
  '--ds-radius-md': 'var(--theme-border-radius)',
  '--ds-radius-lg': 'var(--theme-dialog-radius)',
  '--ds-border-subtle': 'color-mix(in srgb, var(--theme-surface-border) 55%, var(--theme-card-bg))',
  '--ds-border': 'var(--theme-surface-border)',
  '--ds-border-strong': 'color-mix(in srgb, var(--theme-card-text) 24%, var(--theme-card-bg))',
  '--ds-border-focus': 'var(--theme-focus-ring)',
  '--ds-bg-subtle': 'color-mix(in srgb, var(--theme-card-text) 4%, var(--theme-card-bg))',
  '--ds-bg-muted': 'color-mix(in srgb, var(--theme-card-text) 7%, var(--theme-card-bg))',
  '--ds-fg-subtle': 'color-mix(in srgb, var(--theme-muted-text) 80%, var(--theme-card-bg))',
}

/** Font family value for one slot (quoted family + the slot's fallback stack). */
export function fontFamilyValue(font: FontRef, slot: FontSlot): string {
  if (font.source === 'system') return SYSTEM_FONT_STACKS[font.family]
  const google = font.source === 'google' ? findThemeFont(font.family) : undefined
  if (google?.bundledVar) {
    // Served by next/font; its variable already names the family.
    const own = `var(${google.bundledVar})`
    return SLOT_FALLBACK[slot].startsWith(own) ? SLOT_FALLBACK[slot] : `${own}, ${SLOT_FALLBACK[slot]}`
  }
  return `'${google?.family ?? font.family}', ${SLOT_FALLBACK[slot]}`
}

function gradientCss(g: Gradient): string {
  return `linear-gradient(${g.angle}deg, ${g.stops.map((s) => `${s.color} ${s.at}%`).join(', ')})`
}

/** background-image / background-size pair for a solid | gradient | texture surface. */
export function backgroundLayers(style: 'solid' | 'gradient' | 'texture', gradient?: Gradient, texture?: Texture): { image: string; size: string } {
  if (style === 'gradient' && gradient) return { image: gradientCss(gradient), size: 'auto' }
  if (style === 'texture' && texture) {
    const dots = `radial-gradient(circle at 1px 1px, ${texture.color} 1px, transparent 0)`
    const tile = `${texture.size}px ${texture.size}px`
    return gradient
      ? { image: `${dots}, ${gradientCss(gradient)}`, size: `${tile}, auto` }
      : { image: dots, size: tile }
  }
  return { image: 'none', size: 'auto' }
}

type Chrome = Pick<WorkspaceTheme['chrome'], 'sidebar' | 'topbar'>

/** Text colour on primary fills: the stored one, else the better of white / ink on the fill (the hover is adjusted to match). */
export function derivedOnPrimary(p: Pick<ThemePalette, 'primary' | 'primaryHover' | 'onPrimary'>): string {
  return p.onPrimary ?? onColor(p.primary)
}

export function derivedSidebarAccent(p: Pick<ThemePalette, 'primary' | 'accent' | 'sidebar' | 'sidebarText' | 'sidebarActive' | 'sidebarAccent'>, chrome?: Chrome): string {
  return sidebarAccentFor(p, chrome)
}

/**
 * Colour variables for one palette. The palette first goes through the
 * legibility pass (lib/theme/legibility.ts), so a stored theme with a colour
 * below its contrast target still renders readable text; `chrome` adds the
 * sidebar / top-bar gradient stops and hover wash to what text must read on.
 */
export function paletteVars(input: ThemePalette, chrome?: Chrome, shadows?: WorkspaceTheme['shadows']): Vars {
  const p = legiblePalette(input, chrome)
  const on = onSemantic(p)
  const d = derivedTokens(p, chrome)
  const vars: Vars = {
    '--theme-primary': p.primary,
    '--theme-primary-hover': p.primaryHover,
    '--theme-on-primary': d.onPrimary,
    // Brand colours as text (links, pills on their own wash): AA on cards, the surface and the wash.
    '--theme-primary-text': d.primaryText,
    '--theme-accent-text': d.accentText,
    '--theme-primary-light': p.primaryLight,
    '--theme-accent': p.accent,
    '--theme-accent-light': p.accentLight,
    '--theme-sidebar': p.sidebar,
    '--theme-sidebar-text': p.sidebarText,
    '--theme-sidebar-active': p.sidebarActive,
    '--theme-sidebar-border': p.sidebarBorder,
    '--theme-sidebar-accent': d.sidebarAccent,
    '--theme-sidebar-muted': d.sidebarMuted,
    '--theme-topbar': p.topbar,
    '--theme-topbar-text': p.topbarText,
    '--theme-topbar-muted': d.topbarMuted,
    '--theme-surface': p.surface,
    '--theme-surface-border': p.surfaceBorder,
    '--theme-card-bg': p.cardBg,
    '--theme-card-text': p.cardText,
    '--theme-muted-text': p.mutedText,
    '--theme-success': p.success,
    '--theme-warning': p.warning,
    '--theme-danger': p.danger,
    '--theme-info': p.info,
    '--status-todo': p.status.todo,
    '--status-todo-bg': p.status.todoBg,
    '--status-progress': p.status.progress,
    '--status-progress-bg': p.status.progressBg,
    '--status-blocked': p.status.blocked,
    '--status-blocked-bg': p.status.blockedBg,
    '--status-done': p.status.done,
    '--status-done-bg': p.status.doneBg,
    '--status-info': p.status.info,
    '--status-info-bg': p.status.infoBg,
    '--status-warning-bg': p.status.warningBg,
    '--status-danger-bg': p.status.dangerBg,
    '--status-success-bg': p.status.successBg,
    '--theme-row-highlight': p.rowHighlight,
    '--theme-row-highlight-strong': p.rowHighlightStrong,
    '--theme-focus-ring': d.focusRing,
    '--theme-input-bg': p.inputBg ?? p.cardBg,
    '--theme-input-border': p.inputBorder ?? p.surfaceBorder,
    '--theme-overlay': p.overlay,
    // Text on solid semantic fills (destructive buttons, solid chips, count badges).
    '--theme-on-accent': on.onAccent,
    '--theme-on-danger': on.onDanger,
    '--theme-on-success': on.onSuccess,
    '--theme-on-warning': on.onWarning,
    '--theme-on-info': on.onInfo,
    // Aliases components use for error / warning / success text.
    '--status-error': p.danger,
    '--status-error-bg': p.status.dangerBg,
    '--status-warning': p.warning,
    '--status-success': p.success,
    // Mode-aware elevation (the dark palette's block flips it with the colours).
    ...elevationVars(p, shadows),
  }
  if (chrome) vars['--sidebar-brand-color'] = legibleBrandColor(chrome.sidebar.brandColor, p, chrome)
  for (let i = 0; i < CHART_SLOTS; i++) {
    vars[`--theme-chart-${i + 1}`] = p.chart[i % p.chart.length]
    vars[`--theme-chart-${i + 1}-text`] = d.chartText[i % p.chart.length]
  }
  return vars
}

/** Mode-independent variables: typography, shape, shadows, layout, chrome. */
export function sharedVars(theme: WorkspaceTheme): Vars {
  const { typography: t, shape, shadows, layout, chrome } = theme
  const density = DENSITY[layout.density]
  const sidebar = backgroundLayers(chrome.sidebar.style, chrome.sidebar.gradient, chrome.sidebar.texture)
  const topbar = backgroundLayers(chrome.topbar.style, chrome.topbar.gradient, chrome.topbar.texture)
  const canvas = backgroundLayers(chrome.canvas.texture ? 'texture' : 'solid', undefined, chrome.canvas.texture)
  const px = (n: number) => `${n}px`
  const vars: Vars = {
    // Typography
    '--theme-font-sans': fontFamilyValue(t.sans, 'sans'),
    '--theme-font-display': fontFamilyValue(t.display, 'display'),
    '--theme-font-mono': fontFamilyValue(t.mono, 'mono'),
    '--font-weight-normal': String(t.weights.normal),
    '--font-weight-medium': String(t.weights.medium),
    '--font-weight-semibold': String(t.weights.semibold),
    '--font-weight-bold': String(t.weights.bold),
    '--theme-font-weight-normal': String(t.weights.normal),
    '--theme-font-weight-medium': String(t.weights.medium),
    '--theme-font-weight-semibold': String(t.weights.semibold),
    '--theme-font-weight-bold': String(t.weights.bold),
    '--theme-font-weight-heading': String(t.weights.heading ?? t.weights.semibold),
    '--theme-font-base-size': px(t.baseSize),
    '--theme-font-size-scale': `${Number(((t.baseSize / 16) * 100).toFixed(4))}%`,
    '--theme-heading-letter-spacing': t.headingLetterSpacing,
    // Shape (legacy names kept for the existing remap rules)
    '--theme-border-radius': px(shape.cardRadius),
    '--theme-button-radius': px(shape.buttonRadius),
    '--theme-input-radius': px(shape.inputRadius),
    '--theme-badge-radius': px(shape.badgeRadius),
    '--theme-dialog-radius': px(shape.dialogRadius),
    // Elevation
    '--theme-card-shadow': shadows.card,
    '--shadow-sm': shadows.sm,
    '--shadow-md': shadows.md,
    '--shadow-lg': shadows.lg,
    '--shadow-xl': shadows.xl,
    // Layout / density
    '--theme-sidebar-width': px(chromeSize(layout.sidebarWidth, LEGACY_SIDEBAR_WIDTH, SIDEBAR_WIDTH)),
    '--theme-topbar-height': px(chromeSize(layout.topbarHeight, LEGACY_TOPBAR_HEIGHT, TOPBAR_HEIGHT)),
    '--theme-density-row-height': px(density.rowHeight),
    '--theme-density-cell-y': px(density.cellY),
    '--theme-density-cell-x': px(density.cellX),
    '--theme-density-gap': px(density.gap),
    '--ds-control-h': px(density.controlH),
    '--ds-control-h-sm': px(density.controlHSm),
    '--ds-control-h-lg': px(density.controlHLg),
    '--ds-nav-item-h': px(density.navItemH),
    // Chrome
    '--sidebar-glow-1': chrome.sidebar.glow1,
    '--sidebar-glow-2': chrome.sidebar.glow2,
    '--sidebar-hover-bg': chrome.sidebar.hoverBg,
    '--sidebar-brand-color': chrome.sidebar.brandColor,
    '--theme-sidebar-image': sidebar.image,
    '--theme-sidebar-image-size': sidebar.size,
    '--theme-sidebar-decoration-color': chrome.sidebar.decorationColor ?? '#FFFFFF',
    '--theme-topbar-image': topbar.image,
    '--theme-topbar-image-size': topbar.size,
    '--theme-canvas-image': canvas.image,
    '--theme-canvas-image-size': canvas.size,
  }
  return vars
}

/** Every variable for one mode. */
/**
 * App-shell sizes (docs/design/ui-polish-spec.md §4.1–4.2): sidebar 240px,
 * top bar 48px. Stored themes carry the old platform defaults (256 / 56)
 * without having chosen them, so those render at the new defaults; any
 * other value is a deliberate choice and wins.
 */
export const SIDEBAR_WIDTH = 240
export const TOPBAR_HEIGHT = 48
const LEGACY_SIDEBAR_WIDTH = 256
const LEGACY_TOPBAR_HEIGHT = 56
function chromeSize(value: number, legacyDefault: number, platformDefault: number): number {
  return value === legacyDefault ? platformDefault : value
}

export function themeVars(theme: WorkspaceTheme, mode: ThemeMode): Vars {
  return { ...sharedVars(theme), ...paletteVars(theme.colors[mode], theme.chrome, theme.shadows) }
}

/**
 * Subset cached in sessionStorage for the pre-paint bootstrap on pages
 * outside the dashboard (colours + chrome only — public pages keep their own
 * fonts and sizes).
 */
export function cacheableVars(theme: WorkspaceTheme, mode: ThemeMode): Vars {
  const shared = sharedVars(theme)
  const chrome = Object.fromEntries(Object.entries(shared).filter(([k]) => k.startsWith('--sidebar-') || k.startsWith('--theme-sidebar-image') || k.startsWith('--theme-canvas-image')))
  return { ...chrome, ...paletteVars(theme.colors[mode], theme.chrome, theme.shadows) }
}

const block = (selector: string, vars: Vars, important: boolean) =>
  `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}${important ? ' !important' : ''}`).join(';')}}`

function scoped(scope: string, selectors: string[]): string {
  return selectors.map((s) => `${scope} ${s}`).join(',')
}

/** Rules that aren't plain variables. */
function themeRules(theme: WorkspaceTheme, scope: string): string[] {
  const rules: string[] = []
  const t = theme.typography

  for (const font of [t.sans, t.display, t.mono]) {
    if (font.source === 'upload') {
      rules.push(`@font-face{font-family:'${font.family}';src:url("${resolveStorageUrl(font.url)}") format("woff2");font-display:swap}`)
    }
  }

  // Display family + letter spacing come from globals.css via the
  // data-theme-headings attribute (restored pre-paint by the bootstrap script).
  if (t.headingFont === 'sans' && t.headingLetterSpacing !== 'normal') {
    rules.push(`${scoped(scope, ['h1', 'h2'])}{letter-spacing:var(--theme-heading-letter-spacing)}`)
  }
  if (t.weights.heading) rules.push(`${scoped(scope, ['h1', 'h2'])}{font-weight:var(--theme-font-weight-heading)}`)

  if (t.uppercaseLabels) rules.push(`${scoped(scope, ['label'])}{text-transform:uppercase;letter-spacing:0.04em}`)

  const deco = theme.chrome.sidebar.decorations
  if (deco !== 'off') rules.push(`${scoped(scope, ['.premium-sidebar .sidebar-decorations'])}{display:block}`)
  if (deco === 'light') {
    // Light sidebars: the white line illustrations are recoloured and boosted.
    rules.push(`${scoped(scope, ['.sidebar-decorations svg rect', '.sidebar-decorations svg circle'])}{fill:var(--theme-sidebar-decoration-color)}`)
    rules.push(`${scoped(scope, ['.sidebar-decorations svg path', '.sidebar-decorations svg circle[stroke]'])}{stroke:var(--theme-sidebar-decoration-color)}`)
    rules.push(`${scoped(scope, ['.deco-workflow'])}{opacity:0.22 !important}`)
    rules.push(`${scoped(scope, ['.deco-orbit'])}{opacity:0.18 !important}`)
  }

  if (theme.layout.density !== 'comfortable') {
    rules.push(`${scoped(scope, ['td', 'th'])}{padding-top:var(--theme-density-cell-y);padding-bottom:var(--theme-density-cell-y)}`)
  }
  return rules
}

export interface StylesheetOptions {
  /** Selector the variables are declared on (`:root` for the app, a container for previews). */
  scope?: string
  /** Mark declarations !important so they win over the cached inline vars of the bootstrap script. */
  important?: boolean
}

/** Complete stylesheet text for a <style> element. */
export function themeStylesheet(theme: WorkspaceTheme, opts: StylesheetOptions = {}): string {
  const scope = opts.scope ?? ':root'
  const important = opts.important ?? scope === ':root'
  const parts: string[] = []
  const mode = theme.meta.mode
  // Scoped previews re-declare the derived design-system tokens (see DS_DERIVED_VARS).
  const derived = scope === ':root' ? {} : DS_DERIVED_VARS
  if (mode === 'dark') {
    parts.push(block(scope, { ...themeVars(theme, 'dark'), ...derived }, important))
  } else {
    parts.push(block(scope, { ...themeVars(theme, 'light'), ...derived }, important))
    if (mode === 'auto') {
      parts.push(`@media (prefers-color-scheme: dark){${block(scope, paletteVars(theme.colors.dark, theme.chrome, theme.shadows), important)}}`)
    }
  }
  parts.push(...themeRules(theme, scope))
  // Values are schema-validated; this only guarantees the text can't close the <style> element.
  return parts.join('\n').replace(/</g, '\\3c ')
}

/**
 * Stylesheets for the theme's non-bundled Google families (our own
 * /fonts/g/… route, one per family: every weight is in it and the browser
 * downloads only the faces it uses), or none.
 */
export function themeFontHrefs(theme: WorkspaceTheme): string[] {
  const t = theme.typography
  return googleFontsHrefs([t.sans, t.display, t.mono].filter((f) => f.source === 'google'))
}
