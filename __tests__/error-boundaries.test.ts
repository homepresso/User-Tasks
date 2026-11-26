/**
 * Route error boundaries (ops QA 2026-11): besides the dashboard, the sign-in
 * pages, public form links, friendly form links and embedded pages each have
 * their own error.tsx, so an error keeps the section's layout (and, for
 * /embed, stays inside the frame) instead of replacing the whole document
 * with app/global-error.tsx. Each shows the error ID (digest) and Try again.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({ default: ({ children }: { children: unknown }) => children }))

const ROOT = path.resolve(__dirname, '..')
const SEGMENTS = ['app/(dashboard)', 'app/(auth)', 'app/p', 'app/f', 'app/form', 'app/embed']

describe('error boundaries', () => {
  it.each(SEGMENTS)('%s has an error.tsx that renders the error state with the digest', async (segment) => {
    const file = path.join(ROOT, segment, 'error.tsx')
    expect(existsSync(file)).toBe(true)
    const mod = await import(/* @vite-ignore */ file)
    const html = renderToStaticMarkup(h(mod.default, { error: Object.assign(new Error('boom'), { digest: 'dg-4242' }), unstable_retry: () => undefined }))
    expect(html).toContain('data-route-error')
    expect(html).toContain('dg-4242')
    expect(html).not.toContain('boom')
  })
})
