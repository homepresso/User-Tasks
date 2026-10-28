/**
 * Built-in themes as WorkspaceThemes.
 *
 * The 37 legacy THEMES (lib/themes.ts) plus the 6 marketplace THEME_PRESETS
 * are the designer's starting templates. A large part of their look used to
 * live in app/globals.css keyed by `html[data-theme="<id>"]` (sidebar
 * gradients and dot textures, glows, row highlights, the Noir status palette,
 * Fraunces headings, the paper dot grid). PRESET_EXTRAS carries those values
 * so the converted theme renders the same through the generic CSS; only the
 * Dawn / Nebula canvas effects stay as named CSS (`meta.decorationPreset`).
 *
 * Colours start from the legacy themeToCSS() output and then go through the
 * legibility pass (lib/theme/legibility.ts), so every template meets the
 * contrast pairs in lib/theme/contrast.ts in both modes. Themes without a dark
 * variant use their one palette in both modes — the legacy dark-OS rule
 * darkened only primaryLight / accentLight, which put near-black washes under
 * dark text on light cards. Dark cards get the dark status palette.
 */

import { CARD_SHADOWS, DEFAULT_COMPONENTS, THEMES, THEME_PRESETS, PLATFORM_DEFAULT_THEME_ID, themeToCSS, type Theme, type ThemeComponents } from '@/lib/themes'
import { CHART_PALETTES } from '@/lib/report-sources'
import { isDarkColor, withAlpha } from './colors'
import { legiblePalette } from './legibility'
import {
  WORKSPACE_THEME_SCHEMA_VERSION, WorkspaceThemeSchema,
  type ThemePalette, type WorkspaceTheme,
} from './schema'

type SidebarChrome = WorkspaceTheme['chrome']['sidebar']
type Gradient = NonNullable<SidebarChrome['gradient']>
type Status = ThemePalette['status']

export const DEFAULT_THEME_PRESET_ID = PLATFORM_DEFAULT_THEME_ID

export const DEFAULT_STATUS: Status = {
  todo: '#5B6770', todoBg: 'rgba(91,103,112,0.12)',
  progress: '#A6721C', progressBg: 'rgba(166,114,28,0.14)',
  blocked: '#B23A2E', blockedBg: 'rgba(178,58,46,0.12)',
  done: '#4F7A5B', doneBg: 'rgba(79,122,91,0.14)',
  info: '#8A6D45', infoBg: 'rgba(138,109,69,0.14)',
  warningBg: 'rgba(178,138,30,0.14)', dangerBg: 'rgba(176,64,42,0.14)', successBg: 'rgba(91,119,87,0.16)',
}

// Noir (and every dark card): lightened so dots/badges clear 4.5:1 on dark cards.
const NOIR_STATUS: Status = {
  todo: '#A29A89', todoBg: 'rgba(162,154,137,0.16)',
  progress: '#D9A441', progressBg: 'rgba(217,164,65,0.16)',
  blocked: '#D07A6A', blockedBg: 'rgba(208,122,106,0.16)',
  done: '#7FA98A', doneBg: 'rgba(127,169,138,0.18)',
  info: '#C7A575', infoBg: 'rgba(199,165,117,0.16)',
  warningBg: 'rgba(217,164,65,0.16)', dangerBg: 'rgba(208,122,106,0.16)', successBg: 'rgba(127,169,138,0.18)',
}

export const DEFAULT_SHADOWS: WorkspaceTheme['shadows'] = {
  sm: '0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.02)',
  md: '0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
  lg: '0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
  xl: '0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
  card: CARD_SHADOWS.sm,
}

export const DEFAULT_CHART_COLORS: string[] = [...CHART_PALETTES[0].colors]
export const DEFAULT_OVERLAY = 'rgba(0,0,0,0.5)'

interface PresetExtras {
  sidebar?: { gradient: Gradient; dots?: { color: string; size: number } }
  glows?: [glow1: string, glow2: string, hoverBg: string, brandColor: string]
  decorations?: SidebarChrome['decorations']
  decorationColor?: string
  rows?: [string, string]
  status?: Status
  canvasDots?: { color: string; size: number }
  displayHeadings?: boolean
  decorationPreset?: WorkspaceTheme['meta']['decorationPreset']
}

const g3 = (angle: number, a: string, b: string, c: string, mid = 50): Gradient => ({
  angle, stops: [{ color: a, at: 0 }, { color: b, at: mid }, { color: c, at: 100 }],
})
/** Legacy ::before dot overlay (hex colour at an opacity, 32px grid). */
const dots = (hex: string, opacity: number) => ({ color: withAlpha(hex, opacity), size: 32 })

const NAVY = g3(135, '#0F172A', '#1B2A4A', '#0F172A')
const TEAL_LIGHT = g3(135, '#FFFFFF', '#F0FDFA', '#FFFFFF')
const W08 = 'rgba(255,255,255,0.08)'
const NONE = 'rgba(0,0,0,0)'
const MINIMAL_GLOWS: PresetExtras['glows'] = [NONE, NONE, 'rgba(255,255,255,0.06)', '#FFFFFF']
const TEAL_ROWS: [string, string] = ['rgba(20,184,166,0.08)', 'rgba(20,184,166,0.14)']
const TEAL_ROWS_STRONG: [string, string] = ['rgba(20,184,166,0.10)', 'rgba(20,184,166,0.18)']
const rows = (rgb: string): [string, string] => [`rgba(${rgb},0.08)`, `rgba(${rgb},0.14)`]
const BRAND_CANVAS = { color: 'rgba(27,25,22,0.045)', size: 28 }

export const PRESET_EXTRAS: Record<string, PresetExtras> = {
  basecamp: {
    sidebar: { gradient: g3(180, '#1B1815', '#161411', '#121110', 55), dots: { color: 'rgba(233,228,216,0.055)', size: 26 } },
    canvasDots: BRAND_CANVAS, displayHeadings: true,
  },
  trailside: {
    sidebar: { gradient: g3(180, '#322C24', '#2B261F', '#241F19', 55), dots: { color: 'rgba(233,224,206,0.06)', size: 26 } },
    canvasDots: BRAND_CANVAS, displayHeadings: true,
  },
  'night-drive': {
    sidebar: { gradient: g3(180, '#171512', '#121110', '#0E0D0C', 60), dots: { color: 'rgba(217,210,194,0.05)', size: 26 } },
    canvasDots: { color: 'rgba(242,239,231,0.035)', size: 28 }, displayHeadings: true,
    rows: ['rgba(242,239,231,0.05)', 'rgba(242,239,231,0.10)'], status: NOIR_STATUS,
  },
  default: { sidebar: { gradient: NAVY, dots: dots('#FFFFFF', 0.04) }, decorations: 'on', rows: TEAL_ROWS },
  dawn: {
    sidebar: { gradient: NAVY, dots: dots('#FFFFFF', 0.04) }, decorations: 'on', rows: TEAL_ROWS,
    glows: ['rgba(20,184,166,0.15)', 'rgba(99,102,241,0.08)', W08, '#FFFFFF'], decorationPreset: 'dawn',
  },
  nebula: {
    sidebar: { gradient: NAVY, dots: dots('#FFFFFF', 0.04) }, decorations: 'on', rows: TEAL_ROWS_STRONG,
    glows: ['rgba(20,184,166,0.15)', 'rgba(99,102,241,0.08)', W08, '#FFFFFF'], decorationPreset: 'nebula',
  },
  aurora: {
    sidebar: { gradient: TEAL_LIGHT, dots: dots('#0F172A', 0.05) }, decorations: 'light', decorationColor: '#0D9488', rows: TEAL_ROWS,
    glows: ['rgba(20,184,166,0.20)', 'rgba(13,148,136,0.10)', 'rgba(15,23,42,0.06)', '#0F172A'],
  },
  eclipse: {
    sidebar: { gradient: TEAL_LIGHT, dots: dots('#0F172A', 0.05) }, decorations: 'light', decorationColor: '#0D9488', rows: TEAL_ROWS_STRONG,
    glows: ['rgba(20,184,166,0.20)', 'rgba(13,148,136,0.10)', 'rgba(15,23,42,0.06)', '#0F172A'],
  },
  ultraviolet: {
    sidebar: { gradient: g3(135, '#13102B', '#241B4A', '#13102B'), dots: dots('#C4B5FD', 0.06) },
    glows: ['rgba(167,139,250,0.22)', 'rgba(232,121,249,0.12)', W08, '#FFFFFF'],
  },
  abyss: {
    sidebar: { gradient: g3(160, '#020D1C', '#07305C', '#020D1C', 55), dots: dots('#67E8F9', 0.05) },
    glows: ['rgba(34,211,238,0.20)', 'rgba(56,189,248,0.10)', W08, '#FFFFFF'],
  },
  aurum: {
    sidebar: { gradient: g3(135, '#141210', '#2A2118', '#141210'), dots: dots('#FACC15', 0.05) },
    glows: ['rgba(202,138,4,0.20)', 'rgba(250,204,21,0.08)', W08, '#FFFFFF'],
  },
  sakura: {
    sidebar: { gradient: g3(150, '#2B0A1C', '#4A1230', '#2B0A1C'), dots: dots('#F9A8D4', 0.06) },
    glows: ['rgba(236,72,153,0.20)', 'rgba(190,24,93,0.10)', W08, '#FFFFFF'],
  },
  ember: {
    sidebar: { gradient: g3(135, '#1C1917', '#2D1F1A', '#1C1917'), dots: dots('#FED7AA', 0.05) }, decorations: 'on',
    glows: ['rgba(249,115,22,0.18)', 'rgba(234,88,12,0.10)', W08, '#FFFFFF'], rows: rows('249,115,22'),
  },
  'ember-minimal': { glows: MINIMAL_GLOWS, rows: rows('249,115,22') },
  'ember-dawn': {
    sidebar: { gradient: g3(135, '#FFFFFF', '#FFF7ED', '#FFFFFF'), dots: dots('#7C2D12', 0.05) }, decorations: 'light', decorationColor: '#EA580C',
    glows: ['rgba(249,115,22,0.22)', 'rgba(234,88,12,0.12)', 'rgba(28,25,23,0.05)', '#1C1917'], rows: rows('249,115,22'),
  },
  sage: {
    sidebar: { gradient: g3(135, '#0F1B17', '#152A21', '#0F1B17'), dots: dots('#A7F3D0', 0.05) }, decorations: 'on',
    glows: ['rgba(5,150,105,0.20)', 'rgba(4,120,87,0.10)', W08, '#FFFFFF'], rows: rows('5,150,105'),
  },
  'sage-minimal': { glows: MINIMAL_GLOWS, rows: rows('5,150,105') },
  'sage-dawn': {
    sidebar: { gradient: g3(135, '#FFFFFF', '#ECFDF5', '#FFFFFF'), dots: dots('#065F46', 0.05) }, decorations: 'light', decorationColor: '#047857',
    glows: ['rgba(5,150,105,0.22)', 'rgba(4,120,87,0.12)', 'rgba(15,27,23,0.05)', '#0F1B17'], rows: rows('5,150,105'),
  },
  lagoon: {
    sidebar: { gradient: g3(135, '#0B1724', '#0F2333', '#0B1724'), dots: dots('#5EEAD4', 0.05) }, decorations: 'on',
    glows: ['rgba(13,148,136,0.22)', 'rgba(15,118,110,0.10)', W08, '#FFFFFF'], rows: rows('13,148,136'),
  },
  'lagoon-minimal': { glows: MINIMAL_GLOWS, rows: rows('13,148,136') },
  'lagoon-dawn': {
    sidebar: { gradient: TEAL_LIGHT, dots: dots('#115E59', 0.05) }, decorations: 'light', decorationColor: '#0F766E',
    glows: ['rgba(13,148,136,0.22)', 'rgba(15,118,110,0.12)', 'rgba(11,23,36,0.05)', '#0B1724'], rows: rows('13,148,136'),
  },
  silver: {
    sidebar: { gradient: g3(135, '#1E293B', '#2A3A52', '#1E293B'), dots: dots('#CBD5E1', 0.05) }, decorations: 'on',
    glows: ['rgba(148,163,184,0.18)', 'rgba(100,116,139,0.10)', W08, '#FFFFFF'], rows: rows('71,85,105'),
  },
  'silver-minimal': { glows: MINIMAL_GLOWS, rows: rows('71,85,105') },
  'silver-dawn': {
    sidebar: { gradient: g3(135, '#FFFFFF', '#F1F5F9', '#FFFFFF'), dots: dots('#475569', 0.05) }, decorations: 'light', decorationColor: '#475569',
    glows: ['rgba(148,163,184,0.22)', 'rgba(71,85,105,0.12)', 'rgba(15,23,42,0.05)', '#0F172A'], rows: rows('71,85,105'),
  },
  onyx: {
    sidebar: { gradient: g3(135, '#0A0A0A', '#18181B', '#0A0A0A'), dots: dots('#D4D4D8', 0.04) }, decorations: 'on',
    glows: ['rgba(212,212,216,0.14)', 'rgba(161,161,170,0.08)', W08, '#FFFFFF'], rows: rows('55,65,81'),
  },
  'onyx-minimal': { glows: MINIMAL_GLOWS, rows: rows('55,65,81') },
  'onyx-dawn': {
    sidebar: { gradient: g3(135, '#FAFAFA', '#F4F4F5', '#FAFAFA'), dots: dots('#0A0A0A', 0.05) }, decorations: 'light', decorationColor: '#18181B',
    glows: ['rgba(161,161,170,0.18)', 'rgba(113,113,122,0.10)', 'rgba(10,10,10,0.05)', '#0A0A0A'], rows: rows('55,65,81'),
  },
}

const ROOT_GLOWS: NonNullable<PresetExtras['glows']> = ['rgba(176,138,84,0.12)', 'rgba(243,239,231,0.05)', W08, '#FFFFFF']
const ROOT_ROWS: [string, string] = ['rgba(176,138,84,0.10)', 'rgba(176,138,84,0.18)']

const FONT_SCALE_PX: Record<string, number> = { sm: 15, base: 16, lg: 17 }

function paletteFromLegacy(theme: Theme, dark: boolean, extras: PresetExtras): ThemePalette {
  const css = themeToCSS(theme, dark && Boolean(theme.dark))
  const status = extras.status ?? (isDarkColor(css['--theme-card-bg']) ? NOIR_STATUS : DEFAULT_STATUS)
  const [rowHighlight, rowHighlightStrong] = extras.rows ?? ROOT_ROWS
  return {
    primary: css['--theme-primary'],
    primaryHover: css['--theme-primary-hover'],
    primaryLight: css['--theme-primary-light'],
    accent: css['--theme-accent'],
    accentLight: css['--theme-accent-light'],
    sidebar: css['--theme-sidebar'],
    sidebarText: css['--theme-sidebar-text'],
    sidebarActive: css['--theme-sidebar-active'],
    sidebarBorder: css['--theme-sidebar-border'],
    topbar: css['--theme-topbar'],
    topbarText: css['--theme-topbar-text'],
    surface: css['--theme-surface'],
    surfaceBorder: css['--theme-surface-border'],
    cardBg: css['--theme-card-bg'],
    cardText: css['--theme-card-text'],
    mutedText: css['--theme-muted-text'],
    success: css['--theme-success'],
    warning: css['--theme-warning'],
    danger: css['--theme-danger'],
    info: status.info,
    status: { ...status },
    rowHighlight,
    rowHighlightStrong,
    overlay: DEFAULT_OVERLAY,
    chart: [...DEFAULT_CHART_COLORS],
  }
}

function legacyToWorkspaceTheme(theme: Theme, extras: PresetExtras, basePreset?: string): WorkspaceTheme {
  const comp: ThemeComponents = { ...DEFAULT_COMPONENTS, ...(theme.components ?? {}) }
  const px = (v: string) => Math.min(9999, Math.max(0, parseInt(v, 10) || 0))
  const [glow1, glow2, hoverBg, brandColor] = extras.glows ?? ROOT_GLOWS
  const sidebarDots = extras.sidebar?.dots
  const chrome: WorkspaceTheme['chrome'] = {
    sidebar: {
      style: extras.sidebar ? (sidebarDots ? 'texture' : 'gradient') : 'solid',
      ...(extras.sidebar ? { gradient: extras.sidebar.gradient } : {}),
      ...(sidebarDots ? { texture: { pattern: 'dots' as const, color: sidebarDots.color, size: sidebarDots.size } } : {}),
      glow1, glow2, hoverBg, brandColor,
      decorations: extras.decorations ?? 'off',
      ...(extras.decorationColor ? { decorationColor: extras.decorationColor } : {}),
    },
    topbar: { style: 'solid' },
    canvas: extras.canvasDots ? { texture: { pattern: 'dots', ...extras.canvasDots } } : {},
  }
  return {
    meta: {
      name: theme.name,
      ...(basePreset ? { basePreset } : {}),
      mode: theme.mode ?? 'auto',
      schemaVersion: WORKSPACE_THEME_SCHEMA_VERSION,
      ...(extras.decorationPreset ? { decorationPreset: extras.decorationPreset } : {}),
    },
    colors: {
      light: legiblePalette(paletteFromLegacy(theme, false, extras), chrome),
      dark: legiblePalette(paletteFromLegacy(theme, true, extras), chrome),
    },
    typography: {
      sans: { source: 'google', family: 'DM Sans' },
      display: { source: 'google', family: 'Fraunces' },
      mono: { source: 'google', family: 'Space Mono' },
      weights: { normal: 400, medium: 500, semibold: 600, bold: 700 },
      baseSize: FONT_SCALE_PX[comp.fontSize] ?? 16,
      headingFont: extras.displayHeadings ? 'display' : 'sans',
      headingLetterSpacing: extras.displayHeadings ? '-0.015em' : 'normal',
      uppercaseLabels: false,
    },
    shape: {
      cardRadius: px(comp.borderRadius),
      buttonRadius: px(comp.buttonRadius),
      inputRadius: px(comp.inputRadius),
      badgeRadius: 4,
      dialogRadius: 16,
    },
    shadows: { ...DEFAULT_SHADOWS, card: CARD_SHADOWS[comp.cardShadow] ?? CARD_SHADOWS.sm },
    layout: { density: 'comfortable', sidebarWidth: px(comp.sidebarWidth) || 256, topbarHeight: 56 },
    chrome,
    branding: {},
  }
}

/** Template id for a marketplace preset ("Corporate Blue" → "corporate-blue"). */
const marketplaceId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export interface ThemeTemplate {
  id: string
  name: string
  description: string
  category: string
}

/** Every built-in starting point: the 37 legacy themes, then the marketplace presets. */
export const THEME_TEMPLATES: ThemeTemplate[] = [
  ...THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description, category: 'Built-in' })),
  ...THEME_PRESETS.map((p) => ({ id: marketplaceId(p.name), name: p.name, description: p.description, category: p.category })),
]

const cache = new Map<string, WorkspaceTheme>()

/**
 * WorkspaceTheme for a built-in template id, or null for an unknown id.
 * Returns a fresh copy (callers may edit it).
 */
export function presetToWorkspaceTheme(id: string): WorkspaceTheme | null {
  let theme = cache.get(id)
  if (!theme) {
    const legacy = THEMES.find((t) => t.id === id)
    if (legacy) {
      theme = legacyToWorkspaceTheme(legacy, PRESET_EXTRAS[id] ?? {}, id)
    } else {
      const market = THEME_PRESETS.find((p) => marketplaceId(p.name) === id)
      if (!market) return null
      theme = legacyToWorkspaceTheme(
        { id, name: market.name, description: market.description, colors: market.colors, components: market.components },
        {},
        id,
      )
    }
    // Templates must satisfy the same schema as stored themes.
    theme = WorkspaceThemeSchema.parse(theme)
    cache.set(id, theme)
  }
  return structuredClone(theme)
}

/** The platform default theme (Gallery). */
export function defaultWorkspaceTheme(): WorkspaceTheme {
  return presetToWorkspaceTheme(DEFAULT_THEME_PRESET_ID)!
}
