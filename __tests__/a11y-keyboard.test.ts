import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isActivation, isKeyboardClick, onActivateKey } from '@/lib/a11y/keyboard'
import { wrapTarget } from '@/lib/a11y/focus-trap'

function key(k: string, extra: Record<string, unknown> = {}) {
  const el = {}
  return { key: k, target: el, currentTarget: el, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra }
}

describe('keyboard activation (non-button controls)', () => {
  it('Enter and Space on the element itself activate; other keys, children, repeats and modifiers do not', () => {
    expect(isActivation(key('Enter'))).toBe(true)
    expect(isActivation(key(' '))).toBe(true)
    expect(isActivation(key('a'))).toBe(false)
    expect(isActivation(key('Enter', { target: {} }))).toBe(false)
    expect(isActivation(key('Enter', { repeat: true }))).toBe(false)
    expect(isActivation(key('Enter', { metaKey: true }))).toBe(false)
  })

  it('onActivateKey runs the action and swallows the key (no page scroll on Space)', () => {
    const action = vi.fn()
    const e = key(' ')
    onActivateKey(action)(e)
    expect(action).toHaveBeenCalledOnce()
    expect(e.preventDefault).toHaveBeenCalled()
    const other = key('Tab')
    onActivateKey(action)(other)
    expect(action).toHaveBeenCalledOnce()
    expect(other.preventDefault).not.toHaveBeenCalled()
  })

  it('a keyboard click reports detail 0, a mouse click 1+', () => {
    expect(isKeyboardClick({ detail: 0 })).toBe(true)
    expect(isKeyboardClick({ detail: 1 })).toBe(false)
  })
})

describe('panel focus trap: Tab wraps inside the top panel', () => {
  const [a, b, c] = ['a', 'b', 'c']
  const container = 'panel'
  it('Tab from the last control goes to the first; from the middle the browser moves on', () => {
    expect(wrapTarget([a, b, c], c, false, container)).toBe(a)
    expect(wrapTarget([a, b, c], b, false, container)).toBeNull()
  })
  it('Shift+Tab from the first control (or the panel itself) goes to the last', () => {
    expect(wrapTarget([a, b, c], a, true, container)).toBe(c)
    expect(wrapTarget([a, b, c], container, true, container)).toBe(c)
    expect(wrapTarget([a, b, c], b, true, container)).toBeNull()
  })
  it('Tab from the panel itself (just opened) goes to the first control; an empty panel keeps focus', () => {
    expect(wrapTarget([a, b, c], container, false, container)).toBe(a)
    expect(wrapTarget([], container, false, container)).toBe(container)
  })
})

// Source-level guards: the wiring is in client components this node-only suite can't mount.
describe('keyboard wiring stays in place', () => {
  const src = (p: string) => readFileSync(p, 'utf8')
  it('workflow palette items add a step on Enter / Space', () => {
    expect(src('components/automations/node-palette.tsx')).toMatch(/onKeyDown=\{onActivateKey\(/)
  })
  it('canvas steps select / finish a connection from the keyboard, and the connect handles answer a keyboard click', () => {
    expect(src('components/automations/canvas-node.tsx')).toMatch(/onKeyDown: onActivateKey\(/)
    const card = src('components/automations/workflow-node-card.tsx')
    expect(card.match(/isKeyboardClick\(e\)/g)?.length).toBeGreaterThanOrEqual(2)
  })
  it('the app panel stack traps Tab in the top panel', () => {
    expect(src('components/apps/panels.tsx')).toMatch(/trapTabKey\(ref\.current, e\)/)
  })
})

describe('date-time picker is operable and named for assistive tech', () => {
  it('day buttons announce the full date', async () => {
    const { dayLabel } = await import('@/components/ui/date-time-picker')
    expect(dayLabel(new Date(2026, 10, 23))).toBe('Monday, November 23, 2026')
  })
  it('arrow keys move a day / a week, Home / End to the week edges, clamped to the month', async () => {
    const { dayStep } = await import('@/components/ui/date-time-picker')
    expect(dayStep('ArrowRight', 10, 30, 2)).toBe(11)
    expect(dayStep('ArrowUp', 3, 30, 2)).toBe(1)
    expect(dayStep('ArrowDown', 28, 30, 2)).toBe(30)
    expect(dayStep('Home', 11, 30, 3)).toBe(8)
    expect(dayStep('End', 11, 30, 3)).toBe(14)
    expect(dayStep('a', 11, 30, 3)).toBeNull()
  })
  it('month buttons are labelled, the trigger exposes the popup, focus moves into the panel and back', () => {
    const src = readFileSync('components/ui/date-time-picker.tsx', 'utf8')
    for (const s of ['aria-label="Previous month"', 'aria-label="Next month"', 'aria-haspopup="dialog"', 'aria-expanded={open}', 'role="dialog"', 'aria-pressed={isSelected}', "aria-current={isToday ? 'date' : undefined}", 'triggerRef.current?.focus()']) {
      expect(src).toContain(s)
    }
  })
})

describe('dialogs open on their first field, not the header ×', () => {
  it('focusFirstField focuses the first field and cancels Radix default focus', async () => {
    const { focusFirstField, FIRST_FIELD } = await import('@/components/ui/dialog')
    const field = { focus: vi.fn() }
    const root = { querySelector: vi.fn(() => field) }
    const e = { target: root, preventDefault: vi.fn() } as unknown as Event
    focusFirstField(e)
    expect(root.querySelector).toHaveBeenCalledWith(FIRST_FIELD)
    expect(field.focus).toHaveBeenCalled()
    expect(e.preventDefault).toHaveBeenCalled()
  })
  it('without a field, Radix keeps its default (first tabbable)', async () => {
    const { focusFirstField } = await import('@/components/ui/dialog')
    const e = { target: { querySelector: () => null }, preventDefault: vi.fn() } as unknown as Event
    focusFirstField(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
  it('Dialog and Sheet both use it, before caller props (an explicit onOpenAutoFocus wins)', () => {
    for (const f of ['components/ui/dialog.tsx', 'components/ui/sheet.tsx']) {
      expect(readFileSync(f, 'utf8')).toMatch(/onOpenAutoFocus=\{focusFirstField\}\n\s+\{\.\.\.props\}/)
    }
  })
})
