/**
 * The portalled dropdown panel copies the theme variables scoped on its
 * anchor's ancestors. A variable whose inline value refers to another one
 * (`--theme-card-bg: var(--mkt-white)`, as the marketing InfoPath preview
 * sets) must be copied as resolved at the anchor, or the panel turns
 * transparent outside that scope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inheritedThemeStyle } from '@/components/ui/floating-layer'

type FakeEl = { style: any; parentElement: FakeEl | null }

function el(vars: Record<string, string>, parent: FakeEl | null): FakeEl {
  const names = Object.keys(vars)
  const style: any = { length: names.length, getPropertyValue: (n: string) => vars[n] ?? '' }
  names.forEach((n, i) => { style[i] = n })
  return { style, parentElement: parent }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('inheritedThemeStyle', () => {
  it('resolves var() references at the anchor and keeps plain values as written; nearest ancestor wins', () => {
    const body = el({}, null)
    const outer = el({ '--theme-card-bg': '#000000', '--theme-radius': '8px' }, body)
    const wrapper = el({ '--theme-card-bg': 'var(--mkt-white)', '--theme-card-text': 'var(--mkt-ink)', '--theme-primary': '#17150F' }, outer)
    const anchor = el({}, wrapper)
    const computed: Record<string, string> = { '--theme-card-bg': ' #FFFFFF', '--theme-card-text': '#17150F' }
    vi.stubGlobal('document', { body })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => computed[n] ?? '', colorScheme: 'light', fontFamily: 'Inter' }))
    const out = inheritedThemeStyle(anchor as unknown as HTMLElement) as Record<string, string>
    expect(out['--theme-card-bg']).toBe('#FFFFFF')
    expect(out['--theme-card-text']).toBe('#17150F')
    expect(out['--theme-primary']).toBe('#17150F')
    expect(out['--theme-radius']).toBe('8px')
    expect(out.colorScheme).toBe('light')
  })

  it('falls back to the raw value when the browser cannot resolve it', () => {
    const body = el({}, null)
    const anchor = el({ '--x': 'var(--missing, red)' }, body)
    vi.stubGlobal('document', { body })
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', colorScheme: 'normal', fontFamily: '' }))
    expect((inheritedThemeStyle(anchor as unknown as HTMLElement) as Record<string, string>)['--x']).toBe('var(--missing, red)')
  })
})
