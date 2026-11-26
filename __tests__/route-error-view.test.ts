/**
 * Route error boundaries (app/**\/error.tsx, app/global-error.tsx → RouteErrorView).
 *
 * Next 16.4 renamed the error component's `unstable_retry` prop to `retry`
 * (it still passes `reset`) and types `error` as `unknown`: a value thrown in
 * a Client Component reaches the boundary as-is. "Try again" must call
 * `retry` (re-fetch + re-render) when Next passes it, and the view must not
 * crash on a thrown non-Error.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const clicks: Array<{ label: string; onClick?: () => void }> = []
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => {
    clicks.push({ label: typeof children === 'string' ? children : '', onClick })
    return createElement('button', null, children)
  },
}))

import { RouteErrorView, errorDigest } from '@/components/layout/route-states'

function render(props: Parameters<typeof RouteErrorView>[0]) {
  clicks.length = 0
  const html = renderToStaticMarkup(createElement(RouteErrorView, props))
  return { html, tryAgain: clicks.find((c) => c.label === 'Try again') }
}

describe('RouteErrorView', () => {
  it('Try again calls Next 16.4 retry (re-fetch), not reset', () => {
    const retry = vi.fn()
    const reset = vi.fn()
    const { tryAgain } = render({ error: Object.assign(new Error('boom'), { digest: 'abc123' }), retry, reset })
    expect(tryAgain).toBeDefined()
    tryAgain!.onClick!()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
  })

  it('still works with the 16.0–16.3 unstable_retry name, then reset', () => {
    const unstable_retry = vi.fn()
    const reset = vi.fn()
    render({ error: new Error('x'), unstable_retry, reset }).tryAgain!.onClick!()
    expect(unstable_retry).toHaveBeenCalledTimes(1)
    render({ error: new Error('x'), reset }).tryAgain!.onClick!()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('shows the digest of a Server Component error', () => {
    expect(render({ error: Object.assign(new Error('x'), { digest: 'd-42' }), retry: vi.fn() }).html).toContain('d-42')
  })

  it('does not crash on a thrown non-Error value', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const error of [null, undefined, 'a string', 42, { digest: 7 }]) {
      expect(() => render({ error, retry: vi.fn() })).not.toThrow()
    }
    expect(errorDigest(null)).toBeUndefined()
    expect(errorDigest({ digest: 7 })).toBeUndefined()
    expect(errorDigest({ digest: 'ok' })).toBe('ok')
  })
})
