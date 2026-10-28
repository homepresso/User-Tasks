import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  COALESCE_MS, HISTORY_LIMIT, designerReducer, exportThemeJson, getIn, initDesigner, isDirty, parseThemeImport, setIn,
  type DesignerState,
} from '@/lib/theme/designer-state'
import { defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { paletteContrastChecks } from '@/lib/theme/contrast'
import { themeStylesheet } from '@/lib/theme/to-css'
import { ThemePreview } from '@/components/settings/theme-designer/theme-preview'

const base = () => defaultWorkspaceTheme()
const set = (state: DesignerState, path: Array<string | number>, value: unknown, at: number) =>
  designerReducer(state, { type: 'set', path, value, at })

describe('setIn / getIn', () => {
  it('copies along the path and leaves the original untouched', () => {
    const theme = base()
    const next = setIn(theme, ['colors', 'light', 'primary'], '#112233')
    expect(next.colors.light.primary).toBe('#112233')
    expect(theme.colors.light.primary).not.toBe('#112233')
    expect(next.colors.dark).toBe(theme.colors.dark)
    expect(getIn(next, ['colors', 'light', 'primary'])).toBe('#112233')
  })

  it('removes an optional key when set to undefined, and sets array items', () => {
    const theme = setIn(base(), ['colors', 'light', 'onPrimary'], '#FFFFFF')
    expect('onPrimary' in setIn(theme, ['colors', 'light', 'onPrimary'], undefined).colors.light).toBe(false)
    expect(setIn(theme, ['colors', 'light', 'chart', 0], '#000000').colors.light.chart[0]).toBe('#000000')
  })
})

describe('designer reducer', () => {
  it('records edits, undoes and redoes them', () => {
    let s = initDesigner(base(), 3)
    s = set(s, ['colors', 'light', 'primary'], '#112233', 1_000)
    s = set(s, ['layout', 'density'], 'compact', 5_000)
    expect(s.past).toHaveLength(2)
    expect(isDirty(s)).toBe(true)

    s = designerReducer(s, { type: 'undo' })
    expect(s.present.layout.density).toBe(base().layout.density)
    expect(s.present.colors.light.primary).toBe('#112233')
    s = designerReducer(s, { type: 'undo' })
    expect(isDirty(s)).toBe(false)
    expect(designerReducer(s, { type: 'undo' })).toBe(s) // nothing left

    s = designerReducer(s, { type: 'redo' })
    s = designerReducer(s, { type: 'redo' })
    expect(s.present.layout.density).toBe('compact')
    expect(designerReducer(s, { type: 'redo' })).toBe(s)
  })

  it('coalesces a gesture on one field into one undo step', () => {
    let s = initDesigner(base(), 1)
    s = set(s, ['typography', 'baseSize'], 15, 1_000)
    s = set(s, ['typography', 'baseSize'], 16.5, 1_000 + COALESCE_MS - 1)
    s = set(s, ['typography', 'baseSize'], 17, 1_000 + 2 * COALESCE_MS - 2)
    expect(s.past).toHaveLength(1)
    expect(s.present.typography.baseSize).toBe(17)
    // A pause starts a new step; another field always does.
    s = set(s, ['typography', 'baseSize'], 18, 10_000)
    s = set(s, ['layout', 'sidebarWidth'], 300, 10_001)
    expect(s.past).toHaveLength(3)
    expect(designerReducer(s, { type: 'undo' }).present.typography.baseSize).toBe(18)
  })

  it('ignores no-op edits and a new edit clears the redo stack', () => {
    let s = initDesigner(base(), 1)
    expect(set(s, ['layout', 'density'], base().layout.density, 1)).toBe(s)
    s = set(s, ['layout', 'density'], 'compact', 1)
    s = designerReducer(s, { type: 'undo' })
    expect(s.future).toHaveLength(1)
    s = set(s, ['layout', 'density'], 'spacious', 5_000)
    expect(s.future).toHaveLength(0)
  })

  it('replaces (templates, import), reverts to the saved theme and tracks saves', () => {
    let s = initDesigner(base(), 4)
    s = designerReducer(s, { type: 'replace', theme: presetToWorkspaceTheme('night-drive')! })
    expect(s.present.meta.basePreset).toBe('night-drive')
    s = designerReducer(s, { type: 'revert' })
    expect(isDirty(s)).toBe(false)
    expect(s.past).toHaveLength(2) // revert is undoable
    s = designerReducer(s, { type: 'undo' })
    expect(s.present.meta.basePreset).toBe('night-drive')

    s = designerReducer(s, { type: 'saved', theme: s.present, version: 5 })
    expect(s.version).toBe(5)
    expect(isDirty(s)).toBe(false)
  })

  it('caps the history', () => {
    let s = initDesigner(base(), 1)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = set(s, ['layout', 'sidebarWidth'], 200 + (i % 2) * 4, i * 10_000)
    expect(s.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('theme import / export', () => {
  it('round-trips the exported JSON', () => {
    const theme = presetToWorkspaceTheme('lagoon')!
    expect(parseThemeImport(exportThemeJson(theme))).toEqual({ theme })
  })

  it('accepts the GET /workspace-theme response and its envelope', () => {
    const theme = base()
    expect(parseThemeImport(JSON.stringify({ workspace_theme: theme, version: 3 }))).toEqual({ theme })
    expect(parseThemeImport(JSON.stringify({ success: true, data: { workspace_theme: theme } }))).toEqual({ theme })
    expect(parseThemeImport(JSON.stringify({ ...theme, expected_version: 2 }))).toEqual({ theme })
  })

  it('rejects invalid JSON and unsafe values', () => {
    expect(parseThemeImport('{nope')).toEqual({ error: 'The file is not valid JSON' })
    const bad = setIn(base(), ['colors', 'light', 'primary'], 'red;background:url(x)')
    const result = parseThemeImport(JSON.stringify(bad))
    expect('error' in result && result.error).toMatch(/colors\.light\.primary/)
  })
})

describe('preview CSS scoping', () => {
  it('scopes every variable and rule to the preview container', () => {
    const theme = setIn(presetToWorkspaceTheme('aurora')!, ['typography', 'uppercaseLabels'], true)
    const css = themeStylesheet({ ...theme, meta: { ...theme.meta, mode: 'dark' } }, { scope: '#theme-preview-x', important: false })
    expect(css).not.toContain(':root')
    expect(css).not.toContain('!important{')
    expect(css).not.toMatch(/prefers-color-scheme/)
    expect(css).toContain('#theme-preview-x{--theme-font-sans')
    expect(css).toContain(`--theme-primary:${theme.colors.dark.primary}`)
    expect(css).toContain('#theme-preview-x label{text-transform:uppercase')
    expect(css).toContain('#theme-preview-x .premium-sidebar .sidebar-decorations{display:block}')
    // Every rule outside @font-face starts with the scope.
    for (const rule of css.split('\n').filter((r) => !r.startsWith('@font-face'))) expect(rule.startsWith('#theme-preview-x')).toBe(true)
  })

  it('renders the preview with the scoped stylesheet, the theme attributes and the forced mode', () => {
    const theme = setIn(presetToWorkspaceTheme('basecamp')!, ['layout', 'density'], 'compact')
    const html = renderToStaticMarkup(createElement(ThemePreview, { theme, mode: 'dark', appBaseSize: 16 }))
    const id = /id="(theme-preview-[^"]+)"/.exec(html)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`#${id}{`)
    expect(html).toContain(`--theme-surface:${theme.colors.dark.surface}`)
    expect(html).toContain('data-density="compact"')
    expect(html).toContain('data-theme-headings="display"')
    expect(html).toMatch(/inert=""/)
    // Light mode uses the light palette.
    expect(renderToStaticMarkup(createElement(ThemePreview, { theme, mode: 'light', appBaseSize: 16 }))).toContain(`--theme-surface:${theme.colors.light.surface}`)
  })
})

describe('palette contrast checks (designer badges)', () => {
  it('reports every key pair with pass / fail', () => {
    const p = { ...base().colors.light, primary: '#FFFF00', onPrimary: '#FFFFFF' }
    const checks = paletteContrastChecks(p)
    expect(checks.map((c) => c.pair)).toContain('onPrimary/primary')
    expect(checks.find((c) => c.pair === 'onPrimary/primary')).toMatchObject({ ok: false, level: 'block' })
    expect(checks.find((c) => c.pair === 'cardText/cardBg')?.ok).toBe(true)
  })
})
