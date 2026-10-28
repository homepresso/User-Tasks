import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Source guards for three UI regressions found while capturing screenshots:
 *  - emphasised task rows (workflow / critical) sit on a light theme tint
 *    (--theme-row-highlight-strong) but used dark-row text (white, gray-300),
 *    so titles rendered faded;
 *  - the sidebar wordmark and active item used --theme-primary, which is
 *    ink-black on the ink-black default sidebar;
 *  - the report chart's x-axis title sat under the axis where the legend
 *    overlapped it.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('UI contrast guards', () => {
  it.each([
    'components/tasks/task-list-row-summary.tsx',
    'app/(dashboard)/tasks/page.tsx',
    'app/(dashboard)/tasks/queue/page.tsx',
  ])('%s: emphasised rows keep the normal text hierarchy', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/isDarkRow \?\s*["']text-/)
    expect(src).not.toMatch(/isDarkRow \?\s*["']rgba\(255,\s*255,\s*255/)
    expect(src).not.toContain('var(--theme-accent, #1B2A4A)')
  })

  it('sidebar wordmark and active item use the sidebar accent, not the raw primary', () => {
    for (const file of ['components/layout/sidebar.tsx', 'components/layout/mobile-nav.tsx']) {
      expect(read(file)).not.toContain('<span className="themed-text-primary">tasks</span>')
    }
    const css = read('app/globals.css')
    expect(css).toMatch(/\.themed-sidebar-active \{[^}]*color: var\(--theme-sidebar-accent/)
  })

  it('report chart gives the x-axis title its own band above the legend', () => {
    const src = read('components/reports/report-chart.tsx')
    expect(src).not.toContain('position="insideBottom" offset={-5}')
    expect(src).toMatch(/height=\{xAxisHeight\}/)
  })
})
