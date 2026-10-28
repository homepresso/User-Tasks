import { describe, expect, it } from 'vitest'
import { THEMES, getContrastRatio, sidebarAccentColor, themeToCSS } from '@/lib/themes'

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c)

describe('sidebar accent (wordmark "tasks", active nav item)', () => {
  it('basecamp: the ink-black primary is replaced by the camel accent on the ink sidebar', () => {
    const basecamp = THEMES.find((t) => t.id === 'basecamp')!
    expect(getContrastRatio(basecamp.colors.primary, basecamp.colors.sidebar)).toBeLessThan(1.5)
    expect(themeToCSS(basecamp)['--theme-sidebar-accent']).toBe(basecamp.colors.accent)
  })

  it('keeps the primary when it already reads on the sidebar', () => {
    expect(sidebarAccentColor({ primary: '#14B8A6', accent: '#000000', sidebar: '#0F172A', sidebarText: '#FFFFFF' })).toBe('#14B8A6')
  })

  it('falls back to the sidebar text colour when neither primary nor accent reads', () => {
    expect(sidebarAccentColor({ primary: '#111111', accent: '#151515', sidebar: '#121212', sidebarText: '#EEEEEE' })).toBe('#EEEEEE')
  })

  it.each(THEMES.flatMap((t) => [[t.id, false], [t.id, true]] as const))('%s (dark=%s) has a readable sidebar accent', (id, dark) => {
    const theme = THEMES.find((t) => t.id === id)!
    const css = themeToCSS(theme, dark)
    const accent = css['--theme-sidebar-accent']
    const sidebar = css['--theme-sidebar']
    if (!isHex(accent) || !isHex(sidebar)) return
    // The sidebar text colour is the theme's own choice for that background.
    if (accent === css['--theme-sidebar-text']) return
    expect(getContrastRatio(accent, sidebar)).toBeGreaterThanOrEqual(3)
  })
})
