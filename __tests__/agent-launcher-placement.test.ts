/**
 * The Agent launcher never covers a button or form control: the collision
 * planner (lift above a sticky bar, other corner, icon), the dialog dock
 * (split beside the form, or over a narrow dialog), the header-slot entry
 * point in pop-ups (left of ×, never near the footer), the reserved-space
 * variables, and the in-dialog panel's composer layout.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/tasks', useSearchParams: () => new URLSearchParams() }))

import {
  barDock, compactRect, dialogDockMode, HOME_PLAN, intersects, liftToClear, mirrorRect, overlapArea, planLauncher, planRect, type Rect,
} from '@/lib/assistants/launcher-geometry'
import { planTransform } from '@/components/assistants/use-launcher-avoidance'
import { dialogSlot, hostDialog, launcherReserveVars, needsScrollRoom } from '@/components/assistants/assistant-host'
import { Dialog, DialogAgentSlot, DialogFooter, DialogHeader } from '@/components/ui/dialog'

const ROOT = path.resolve(__dirname, '..')
const VIEW = { width: 1280, height: 800 }
// The launcher at md:right-6 md:bottom-6: 96×40.
const HOME: Rect = { left: 1160, right: 1256, top: 736, bottom: 776 }

describe('rect helpers', () => {
  it('intersects with clearance, overlap area, mirror and compact', () => {
    const a: Rect = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(intersects(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false)
    expect(intersects(a, { left: 10, top: 0, right: 20, bottom: 10 }, 1)).toBe(true)
    expect(intersects(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true)
    expect(overlapArea(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(25)
    expect(overlapArea(a, { left: 20, top: 20, right: 30, bottom: 30 })).toBe(0)
    expect(mirrorRect(HOME, 1280)).toEqual({ left: 24, right: 120, top: 736, bottom: 776 })
    expect(compactRect(HOME)).toEqual({ left: 1216, right: 1256, top: 736, bottom: 776 })
  })

  it('liftToClear steps over stacked obstacles and gives up past maxLift', () => {
    const bar: Rect = { left: 300, right: 1256, top: 720, bottom: 776 }
    const toast: Rect = { left: 1000, right: 1256, top: 640, bottom: 712 }
    expect(liftToClear(HOME, [bar], 8, 400)).toBe(776 - (720 - 8))
    // Lifted above the bar it meets the toast, so it rises above that too.
    expect(liftToClear(HOME, [bar, toast], 8, 400)).toBe(776 - (640 - 8))
    expect(liftToClear(HOME, [bar, toast], 8, 100)).toBeNull()
  })
})

describe('planLauncher', () => {
  it('stays home when nothing is under it', () => {
    expect(planLauncher({ home: HOME, obstacles: [], viewport: VIEW })).toEqual(HOME_PLAN)
  })

  it('lifts above a sticky save bar so neither Discard nor Save is covered', () => {
    const saveBar: Rect = { left: 280, right: 1256, top: 724, bottom: 776 }
    const plan = planLauncher({ home: HOME, obstacles: [saveBar], viewport: VIEW })
    expect(plan).toEqual({ side: 'right', lift: 776 - 716, compact: false })
    expect(intersects(planRect(HOME, plan, VIEW.width), saveBar)).toBe(false)
  })

  it('moves to the other corner when lifting would take it too high (phones), else down to an icon', () => {
    const tall: Rect = { left: 600, right: 1280, top: 100, bottom: 800 }
    const left = planLauncher({ home: HOME, obstacles: [tall], viewport: VIEW, allowLeft: true })
    expect(left).toEqual({ side: 'left', lift: 0, compact: false })
    // A column of controls that only the full-width pill touches: the icon fits beside it.
    const column: Rect = { left: 1100, right: 1200, top: 0, bottom: 800 }
    const icon = planLauncher({ home: HOME, obstacles: [column], viewport: VIEW, allowLeft: false })
    expect(icon).toEqual({ side: 'right', lift: 0, compact: true })
    expect(intersects(planRect(HOME, icon, VIEW.width), column)).toBe(false)
  })

  it('nowhere clear: the smallest footprint over the fewest pixels', () => {
    const wall: Rect = { left: 0, right: 1280, top: 0, bottom: 800 }
    const plan = planLauncher({ home: HOME, obstacles: [wall], viewport: VIEW, allowLeft: false })
    expect(plan.compact).toBe(true)
  })

  it('planTransform moves a right/bottom-anchored button by transform only', () => {
    expect(planTransform(HOME_PLAN, 24, 96, 1280)).toBeUndefined()
    expect(planTransform({ side: 'right', lift: 60, compact: false }, 24, 96, 1280)).toBe('translate(0px, -60px)')
    expect(planTransform({ side: 'left', lift: 0, compact: false }, 24, 96, 1280)).toBe('translate(-1136px, 0px)')
  })
})

describe('docking into a shared action bar', () => {
  it('centres the launcher in a bar that reaches its column and reserves a gutter for it', () => {
    // Phone: the settings save bar (16..374, 686..748) above the tab bar; launcher 330..374, 740..776.
    const home: Rect = { left: 330, right: 374, top: 740, bottom: 776 }
    const dock = barDock(home, { left: 16, right: 374, top: 686, bottom: 748 })
    expect(dock).toEqual({ lift: 41, gutter: 52 })
    const rect = planRect(home, { side: 'right', lift: dock!.lift, compact: false }, 390)
    expect(rect.top).toBeGreaterThanOrEqual(686)
    expect(rect.bottom).toBeLessThanOrEqual(748)
  })

  it('a bar that stops short of the launcher, or is too thin to hold it, is lifted over instead', () => {
    expect(barDock(HOME, { left: 280, right: 1000, top: 724, bottom: 776 })).toBeNull()
    expect(barDock(HOME, { left: 280, right: 1256, top: 760, bottom: 780 })).toBeNull()
  })

  it('the gutter is applied by CSS to registered bars only', () => {
    const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/\[data-agent-bar\]\[data-agent-reserve\] \{\s*padding-inline-end: var\(--agent-reserve\) !important;/)
  })
})

describe('the Agent docked in a modal dialog', () => {
  it('widens and splits a lg dialog so the form shrinks beside the panel', () => {
    expect(dialogDockMode({ dialogWidth: 720, viewportWidth: 1440 })).toEqual({ mode: 'split', width: 1120, panel: 400 })
    // Only as wide as the viewport allows.
    expect(dialogDockMode({ dialogWidth: 720, viewportWidth: 1024 })).toEqual({ mode: 'split', width: 992, panel: 400 })
    // A full-screen dialog cannot widen: the form gives up the panel's width.
    expect(dialogDockMode({ dialogWidth: 1248, viewportWidth: 1280 })).toEqual({ mode: 'split', width: 1248, panel: 400 })
  })

  it('covers a dialog too narrow to split (the panel is never squeezed below a usable width)', () => {
    expect(dialogDockMode({ dialogWidth: 560, viewportWidth: 700 })).toEqual({ mode: 'overlay' })
  })

  it('hosts in the topmost big dialog; on phones (full-width sheets) by height', () => {
    const el = (w: number, h: number) => ({ closest: () => null, hasAttribute: () => false, getAttribute: (a: string) => (a === 'role' ? 'dialog' : null), getBoundingClientRect: () => ({ width: w, height: h }) })
    const doc = (list: unknown[]) => ({ querySelectorAll: () => list }) as unknown as Document
    expect(hostDialog(doc([el(390, 700)]))).toBeNull()
    expect(hostDialog(doc([el(390, 700)]), true)).not.toBeNull()
    expect(hostDialog(doc([el(390, 200)]), true)).toBeNull()
  })
})

describe('the Agent entry point in pop-ups', () => {
  it('is a header slot left of the close button, never in the footer', () => {
    const html = renderToStaticMarkup(h(Dialog, { open: true }, h(DialogHeader, { title: 'New request' }), h(DialogFooter, null, h('button', null, 'Cancel'), h('button', null, 'Submit'))))
    const slot = html.indexOf('data-agent-header-slot')
    const close = html.indexOf('aria-label="Close"')
    const footer = html.indexOf('data-agent-bar')
    expect(slot).toBeGreaterThan(-1)
    expect(slot).toBeLessThan(close)
    expect(close).toBeLessThan(footer)
    // Empty (the Agent not hosted here), it takes no room.
    expect(html).toMatch(/data-agent-header-slot="" class="[^"]*empty:hidden/)
  })

  it('dialogs without a visible header get a slim bar of their own', () => {
    const html = renderToStaticMarkup(h(DialogAgentSlot, { bar: true }))
    expect(html).toContain('justify-end')
    expect(html).toContain('empty:hidden')
    const content = readFileSync(path.join(ROOT, 'components/ui/dialog.tsx'), 'utf8')
    expect(content).toMatch(/\{\(title == null \|\| hideHeader\) && <DialogAgentSlot bar \/>\}/)
  })

  it('custom modal panels (aria-modal, no Radix data-state) host it too; the phone sheet sits above them', () => {
    const host = readFileSync(path.join(ROOT, 'components/assistants/assistant-host.tsx'), 'utf8')
    expect(host).toContain(`'[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]'`)
    expect(host).toMatch(/attributeFilter: \['data-state', 'aria-modal'\]/)
    const panel = readFileSync(path.join(ROOT, 'components/assistants/assistant-panel.tsx'), 'utf8')
    expect(panel).toMatch(/RadixDialog\.Overlay className="fixed inset-0 z-\[1100\]/)
  })

  it('prefers a header row slot over the slim bar', () => {
    const slot = (v: string) => ({ getAttribute: () => v, closest: () => null })
    const bar = slot('bar'), header = slot('')
    expect(dialogSlot({ querySelectorAll: () => [bar, header] } as any)).toBe(header)
    expect(dialogSlot({ querySelectorAll: () => [bar] } as any)).toBe(bar)
    expect(dialogSlot({ querySelectorAll: () => [] } as any)).toBeNull()
  })

  it('no floating pill inside pop-ups: the host renders an icon button into the slot', () => {
    const host = readFileSync(path.join(ROOT, 'components/assistants/assistant-host.tsx'), 'utf8')
    expect(host).not.toMatch(/absolute bottom-3 right-3/)
    expect(host).toMatch(/createPortal\(\s*<IconButton[\s\S]*data-testid="assistant-launcher-dialog"/)
  })

  it('custom pop-ups that can host the Agent render the slot in their header', () => {
    for (const f of ['components/apps/panels.tsx', 'components/settings/log-export/destination-dialog.tsx', 'components/forms/form-submissions-panel.tsx', 'components/governance/bulk-assign-users-dialog.tsx', 'components/forms/node-form-section.tsx']) {
      expect(readFileSync(path.join(ROOT, f), 'utf8'), f).toContain('<DialogAgentSlot')
    }
  })
})

describe('shared bars and reserved space', () => {
  it('the shared footers and action bars register as obstacles', () => {
    const files: Record<string, RegExp> = {
      'components/ui/dialog.tsx': /data-agent-bar=""/,
      'components/settings/settings-section.tsx': /data-agent-bar=""/,
      'components/forms/form-shell.tsx': /data-agent-bar=\{sticky/,
      'components/forms/wizard/form-wizard.tsx': /data-agent-bar=""/,
      'components/grid/edit-all-bar.tsx': /data-agent-bar=""/,
      'app/(dashboard)/tasks/[id]/page.tsx': /data-agent-bar=""/,
    }
    for (const [f, re] of Object.entries(files)) expect(readFileSync(path.join(ROOT, f), 'utf8'), f).toMatch(re)
  })

  it('scroll room only for pages that already scroll (full-height builders never grow a scrollbar)', () => {
    expect(needsScrollRoom({ scrollHeight: 1400, clientHeight: 752, extra: 0 })).toBe(true)
    expect(needsScrollRoom({ scrollHeight: 752, clientHeight: 752, extra: 0 })).toBe(false)
    // Measured with the room applied: still scrolls without it → keep; only scrolled because of it → drop.
    expect(needsScrollRoom({ scrollHeight: 758 + 56, clientHeight: 752, extra: 56 })).toBe(true)
    expect(needsScrollRoom({ scrollHeight: 752 + 56, clientHeight: 752, extra: 56 })).toBe(false)
    const css = readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/html\[data-agent-launcher\] main\[data-agent-scroll-room\] \{\s*padding-bottom: calc\(var\(--agent-launcher-reserve, 0px\) \+ 0\.5rem\) !important;/)
  })

  it('publishes the launcher footprint as CSS variables for layouts to keep clear', () => {
    expect(launcherReserveVars(null)).toEqual({})
    expect(launcherReserveVars({ width: 96, height: 40, right: 24, bottom: 24 })).toEqual({ '--agent-launcher-w': '128px', '--agent-launcher-reserve': '72px' })
  })
})

describe('the in-dialog panel composer', () => {
  it('the message box takes the free width (flex-1, min-w-0) and the buttons keep theirs', () => {
    const panel = readFileSync(path.join(ROOT, 'components/assistants/assistant-panel.tsx'), 'utf8')
    const textarea = panel.match(/<textarea[\s\S]*?data-testid="assistant-input"/)![0]
    expect(textarea).toMatch(/className="[^"]*\bmin-w-0\b[^"]*\bflex-1\b/)
    expect(panel).toMatch(/className="flex min-w-0 items-end gap-2 \[&>button\]:shrink-0" data-agent-composer/)
    // The dialog variant fills its dock (no percentage cap that squeezed it to a strip).
    expect(panel).toMatch(/variant === 'dialog' && 'h-full w-full min-w-0/)
  })
})
