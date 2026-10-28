/**
 * WCAG contrast checks for a workspace theme, per mode.
 *
 * One list of every text / background pair the app actually draws (cards,
 * muted text, washes, status badges, semantic text, buttons, sidebar, top
 * bar, inputs, focus ring, chart series). Body text needs AA (4.5:1); large
 * text, sidebar highlights and graphics need 3:1.
 *
 * - block: the core reading pairs (body / muted text, text on primary fills,
 *   sidebar and top-bar text) below 3:1 — practically invisible, so saving
 *   is refused.
 * - warn: anything else below its target — reported. The renderer's
 *   legibility pass (lib/theme/legibility.ts) raises such colours when the
 *   theme is drawn, so members still get readable text.
 *
 * Built-in presets must pass every pair in both modes (__tests__/theme-contrast-audit.test.ts).
 */

import { contrastRatio } from './colors'
import { AA_LARGE, AA_TEXT, derivedTokens, flatten } from './legibility'
import type { ThemeMode, ThemePalette, WorkspaceTheme } from './schema'

export interface ContrastIssue {
  mode: ThemeMode
  pair: string
  foreground: string
  background: string
  ratio: number
  required: number
  level: 'warn' | 'block'
}

type Chrome = WorkspaceTheme['chrome']
type Derived = ReturnType<typeof derivedTokens>
type Get = (p: ThemePalette, chrome: Chrome | undefined, d: Derived) => string | undefined

interface PairSpec {
  pair: string
  fg: Get
  bg: Get
  /** What a translucent background sits on (default: the card, itself on the surface). */
  on?: 'card' | 'surface' | 'sidebar' | 'topbar' | 'none'
  required: number
  /** Block saving below 3:1. */
  core?: boolean
}

const opaqueHex = (value: string, under?: string): string => {
  const u = under ? flatten(under) ?? undefined : undefined
  const c = flatten(value, u)
  if (!c) return value
  return `#${[c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
}
const card = (p: ThemePalette) => opaqueHex(p.cardBg, p.surface)

const T = AA_TEXT
const L = AA_LARGE

/** Every pair the UI draws, on the raw palette (derived tokens filled in as the renderer would). */
export const CONTRAST_PAIRS: PairSpec[] = [
  { pair: 'cardText/cardBg', fg: (p) => p.cardText, bg: (p) => p.cardBg, on: 'surface', required: T, core: true },
  { pair: 'cardText/surface', fg: (p) => p.cardText, bg: (p) => p.surface, on: 'none', required: T, core: true },
  { pair: 'cardText/inputBg', fg: (p) => p.cardText, bg: (p) => p.inputBg ?? p.cardBg, required: T, core: true },
  { pair: 'cardText/primaryLight', fg: (p) => p.cardText, bg: (p) => p.primaryLight, required: T, core: true },
  { pair: 'cardText/accentLight', fg: (p) => p.cardText, bg: (p) => p.accentLight, required: T, core: true },
  { pair: 'cardText/rowHighlightStrong', fg: (p) => p.cardText, bg: (p) => p.rowHighlightStrong, required: T, core: true },
  { pair: 'mutedText/cardBg', fg: (p) => p.mutedText, bg: (p) => p.cardBg, on: 'surface', required: T, core: true },
  { pair: 'mutedText/surface', fg: (p) => p.mutedText, bg: (p) => p.surface, on: 'none', required: T, core: true },
  { pair: 'mutedText/rowHighlight', fg: (p) => p.mutedText, bg: (p) => p.rowHighlight, required: T },
  { pair: 'mutedText/rowHighlightStrong', fg: (p) => p.mutedText, bg: (p) => p.rowHighlightStrong, required: T },
  { pair: 'primaryText/cardBg', fg: (_p, _c, d) => d.primaryText, bg: (p) => p.cardBg, on: 'surface', required: T },
  { pair: 'primaryText/surface', fg: (_p, _c, d) => d.primaryText, bg: (p) => p.surface, on: 'none', required: T },
  { pair: 'primaryText/primaryLight', fg: (_p, _c, d) => d.primaryText, bg: (p) => p.primaryLight, required: T, core: true },
  { pair: 'accentText/cardBg', fg: (_p, _c, d) => d.accentText, bg: (p) => p.cardBg, on: 'surface', required: T },
  { pair: 'accentText/accentLight', fg: (_p, _c, d) => d.accentText, bg: (p) => p.accentLight, required: T },
  { pair: 'onPrimary/primary', fg: (_p, _c, d) => d.onPrimary, bg: (p) => p.primary, required: T, core: true },
  { pair: 'onPrimary/primaryHover', fg: (_p, _c, d) => d.onPrimary, bg: (p) => p.primaryHover, required: T, core: true },
  ...(['todo', 'progress', 'blocked', 'done', 'info'] as const).flatMap((k): PairSpec[] => [
    { pair: `status.${k}/cardBg`, fg: (p) => p.status[k], bg: (p) => p.cardBg, on: 'surface', required: T },
    { pair: `status.${k}/status.${k}Bg`, fg: (p) => p.status[k], bg: (p) => p.status[`${k}Bg`], required: T, core: true },
  ]),
  ...([['success', 'successBg'], ['warning', 'warningBg'], ['danger', 'dangerBg'], ['info', 'infoBg']] as const).flatMap(([k, bg]): PairSpec[] => [
    { pair: `${k}/cardBg`, fg: (p) => p[k], bg: (p) => p.cardBg, on: 'surface', required: T },
    { pair: `${k}/surface`, fg: (p) => p[k], bg: (p) => p.surface, on: 'none', required: T },
    { pair: `${k}/status.${bg}`, fg: (p) => p[k], bg: (p) => p.status[bg], required: T, core: true },
  ]),
  { pair: 'sidebarText/sidebar', fg: (p) => p.sidebarText, bg: (p) => p.sidebar, on: 'none', required: T, core: true },
  { pair: 'sidebarText/sidebarActive', fg: (p) => p.sidebarText, bg: (p) => p.sidebarActive, on: 'sidebar', required: T, core: true },
  { pair: 'sidebarText/sidebarHover', fg: (p) => p.sidebarText, bg: (_p, c) => c?.sidebar.hoverBg, on: 'sidebar', required: T },
  { pair: 'sidebarAccent/sidebar', fg: (_p, _c, d) => d.sidebarAccent, bg: (p) => p.sidebar, on: 'none', required: T },
  { pair: 'sidebarAccent/sidebarActive', fg: (_p, _c, d) => d.sidebarAccent, bg: (p) => p.sidebarActive, on: 'sidebar', required: T },
  { pair: 'topbarText/topbar', fg: (p) => p.topbarText, bg: (p) => p.topbar, on: 'none', required: T, core: true },
  { pair: 'focusRing/surface', fg: (_p, _c, d) => d.focusRing, bg: (p) => p.surface, on: 'none', required: L },
  { pair: 'focusRing/cardBg', fg: (_p, _c, d) => d.focusRing, bg: (p) => p.cardBg, on: 'surface', required: L },
  ...Array.from({ length: 10 }, (_, i): PairSpec => ({
    pair: `chart${i + 1}/cardBg`, fg: (p) => p.chart[i], bg: (p) => p.cardBg, on: 'surface', required: L,
  })),
  ...Array.from({ length: 10 }, (_, i): PairSpec => ({
    pair: `chart${i + 1}Text/cardBg`, fg: (p, _c, d) => (p.chart[i] ? d.chartText[i] : undefined), bg: (p) => p.cardBg, on: 'surface', required: T,
  })),
]

/** Gradient stops are shared by both modes: each is checked against each mode's text colour. */
const CHROME: Array<{ surface: 'sidebar' | 'topbar'; text: (p: ThemePalette, c: Chrome, d: Derived) => string; required: number; label: string; core?: boolean }> = [
  { surface: 'sidebar', text: (p) => p.sidebarText, required: T, label: 'sidebarText/sidebar gradient', core: true },
  { surface: 'sidebar', text: (_p, _c, d) => d.sidebarAccent, required: T, label: 'sidebarAccent/sidebar gradient' },
  { surface: 'topbar', text: (p) => p.topbarText, required: T, label: 'topbarText/topbar gradient', core: true },
]

function baseFor(spec: PairSpec, p: ThemePalette): string | undefined {
  switch (spec.on ?? 'card') {
    case 'card': return card(p)
    case 'surface': return p.surface
    case 'sidebar': return p.sidebar
    case 'topbar': return p.topbar
    case 'none': return undefined
  }
}

const levelOf = (core: boolean | undefined, ratio: number): 'warn' | 'block' => (core && ratio < AA_LARGE ? 'block' : 'warn')
const round = (n: number) => Math.round(n * 100) / 100

/** Every failing pair for one palette (with its chrome). */
export function paletteContrastIssues(p: ThemePalette, mode: ThemeMode, chrome?: Chrome): ContrastIssue[] {
  const issues: ContrastIssue[] = []
  const d = derivedTokens(p, chrome)
  for (const spec of CONTRAST_PAIRS) {
    const fg = spec.fg(p, chrome, d)
    const bg = spec.bg(p, chrome, d)
    if (!fg || !bg) continue
    const ratio = contrastRatio(fg, bg, baseFor(spec, p))
    if (ratio === null || ratio >= spec.required) continue
    issues.push({ mode, pair: spec.pair, foreground: fg, background: bg, ratio: round(ratio), required: spec.required, level: levelOf(spec.core, ratio) })
  }
  if (chrome) {
    for (const c of CHROME) {
      const ch = chrome[c.surface]
      if (ch.style === 'solid' || !ch.gradient) continue
      const fg = c.text(p, chrome, d)
      for (const stop of ch.gradient.stops) {
        const ratio = contrastRatio(fg, stop.color, c.surface === 'sidebar' ? p.sidebar : p.topbar)
        if (ratio === null || ratio >= c.required) continue
        issues.push({ mode, pair: c.label, foreground: fg, background: stop.color, ratio: round(ratio), required: c.required, level: levelOf(c.core, ratio) })
      }
    }
  }
  return issues
}

export function checkThemeContrast(theme: WorkspaceTheme): ContrastIssue[] {
  const modes: ThemeMode[] = theme.meta.mode === 'auto' ? ['light', 'dark'] : [theme.meta.mode]
  return modes.flatMap((mode) => paletteContrastIssues(theme.colors[mode], mode, theme.chrome))
}

export function blockingContrastIssues(theme: WorkspaceTheme): ContrastIssue[] {
  return checkThemeContrast(theme).filter((i) => i.level === 'block')
}

export interface ContrastCheck {
  pair: string
  ratio: number | null
  required: number
  level: 'warn' | 'block'
  /** Meets the requirement. */
  ok: boolean
}

/** Every pair check for one palette, passing or not (the designer's inline badges). */
export function paletteContrastChecks(p: ThemePalette, chrome?: Chrome): ContrastCheck[] {
  const d = derivedTokens(p, chrome)
  return CONTRAST_PAIRS.flatMap((spec) => {
    const fg = spec.fg(p, chrome, d)
    const bg = spec.bg(p, chrome, d)
    if (!fg || !bg) return []
    const ratio = contrastRatio(fg, bg, baseFor(spec, p))
    const rounded = ratio === null ? null : round(ratio)
    return [{ pair: spec.pair, ratio: rounded, required: spec.required, level: levelOf(spec.core, ratio ?? Infinity), ok: ratio === null || ratio >= spec.required }]
  })
}
