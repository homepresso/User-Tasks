/**
 * Customer feedback (DanCo, Nov 2026), on /settings/mcp: "Settings scroll
 * locked until bottom of page is reached. Add in hover proximity for
 * scrolling."
 *
 * Root cause: the Settings sub-nav (~40 entries, taller than the window) was
 * `sticky top-0` with no height cap. A sticky box taller than the viewport
 * keeps its lower part off-screen until its container ends, so the
 * Developers / Infrastructure entries could only be reached by scrolling the
 * page to the very bottom, and wheeling over the nav did nothing for it.
 *
 * Fix: the nav is capped to the visible column and scrolls on its own under
 * the pointer (no overscroll-contain: at its ends the wheel goes back to the
 * page, so nothing traps it); the chosen entry is scrolled into the nav's
 * view after navigation. Only #main scrolls the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('Settings sub-nav scrolling', () => {
  const frame = read('components/settings/settings-frame.tsx')
  const navTag = frame.slice(frame.indexOf('<nav ref={navRef}'), frame.indexOf('>', frame.indexOf('className=', frame.indexOf('<nav ref={navRef}'))) + 1)

  it('is sticky but never taller than the visible column, and scrolls on its own', () => {
    expect(navTag).toMatch(/md:sticky/)
    expect(navTag).toMatch(/md:max-h-\[calc\(100dvh-var\(--theme-topbar-height\)-3rem\)\]/)
    expect(navTag).toMatch(/md:overflow-y-auto/)
  })

  it('does not trap the wheel (no overscroll containment, no scroll snapping)', () => {
    expect(navTag).not.toMatch(/overscroll-(contain|none)/)
    expect(frame).not.toMatch(/snap-(y|mandatory|proximity)/)
  })

  it('keeps the chosen entry in the nav’s own view (without moving the page)', () => {
    expect(frame).toMatch(/querySelector<HTMLElement>\('\[aria-current="page"\]'\)/)
    expect(frame).toMatch(/nav\.scrollTop = /)
    expect(frame).not.toMatch(/\.scrollIntoView\(/)
  })

  it('the content column is not a second scroll container (only #main scrolls the page)', () => {
    const content = frame.slice(frame.indexOf('<div className={cn("min-w-0 flex-1"'))
    expect(content.split('\n')[0]).not.toMatch(/overflow-(y-)?(auto|scroll|hidden)/)
    const shell = read('components/layout/dashboard-shell.tsx')
    expect(shell).toMatch(/id="main"[\s\S]{0,160}overflow-y-auto/)
  })

  it('nothing in the dashboard locks the page scroll by default (body / #main overflow)', () => {
    // The app panel stack's lock (lockPageScroll) lives on another branch; when it lands it must
    // restore what it changed. Here: no settings or shell code sets overflow on body / #main.
    for (const file of ['components/settings/settings-frame.tsx', 'components/layout/dashboard-shell.tsx', 'app/(dashboard)/settings/layout.tsx']) {
      expect(read(file), file).not.toMatch(/body\.style\.overflow|data-app-panels-open/)
    }
  })
})
