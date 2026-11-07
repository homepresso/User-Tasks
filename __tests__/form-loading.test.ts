/**
 * Form page loading polish: the Spinner (accessible status), the form card
 * skeleton (FormLoading) used by StandaloneForm, /fill/<id>/loading.tsx and
 * the /p/<token> Suspense fallback, and the reduced-motion handling.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Spinner } from '@/components/ui/spinner'
import { FormLoading } from '@/components/forms/form-loading'
import FillFormLoading from '@/app/(dashboard)/fill/[id]/loading'

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Spinner', () => {
  it('is a status with screen-reader text', () => {
    const html = renderToStaticMarkup(createElement(Spinner, { label: 'Loading form' }))
    expect(html).toContain('role="status"')
    expect(html).toContain('<span class="sr-only">Loading form</span>')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
  })

  it('decorative: hidden from assistive tech, no second status', () => {
    const html = renderToStaticMarkup(createElement(Spinner, { decorative: true }))
    expect(html).not.toContain('role="status"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('sr-only')
  })

  it('sizes, and a slow turn under prefers-reduced-motion', () => {
    expect(renderToStaticMarkup(createElement(Spinner, { size: 'lg' }))).toContain('size-9')
    expect(renderToStaticMarkup(createElement(Spinner, { size: 'xs' }))).toContain('size-3')
    expect(renderToStaticMarkup(createElement(Spinner))).toContain('motion-reduce:animate-[spin_2.4s_linear_infinite]')
  })
})

describe('FormLoading', () => {
  it('a skeleton of the form card with one announced status', () => {
    const html = renderToStaticMarkup(createElement(FormLoading))
    expect(html).toContain('data-form-loading="card"')
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(html).toContain('Loading form…')
    expect(html).toContain('ds-skeleton')
    expect(html).toContain('max-w-3xl')
    expect(html).toContain('form-loading')
  })

  it('compact (embedded): spinner and text only, no card', () => {
    const html = renderToStaticMarkup(createElement(FormLoading, { compact: true }))
    expect(html).toContain('data-form-loading="compact"')
    expect(html).not.toContain('ds-skeleton')
    expect(html).not.toContain('bg-panel')
  })

  it('the in-app /fill/<id> route shows it while loading', () => {
    expect(renderToStaticMarkup(createElement(FillFormLoading))).toContain('data-form-loading="card"')
  })

  it('fades in late and the form fades in from it — never under reduced motion', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/\.form-loading \{ animation: ds-fade-in [^}]*120ms both; \}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.form-loading, \.form-reveal, \.fsi-enter \{ animation: none !important; \}/)
  })

  it('StandaloneForm uses it, and only fades the form in when the form has no load animation of its own', () => {
    const src = read('components/forms/standalone-form.tsx')
    expect(src).not.toContain('Loading the form…')
    expect(src).toContain('<FormLoading compact={embed} />')
    expect(src).toContain("loadedHere && motion.style === 'none' && 'form-reveal'")
  })

  it('/p/<token> checks the token before streaming (a real 404), then streams the form behind the skeleton', () => {
    const src = read('app/p/[token]/page.tsx')
    expect(src.indexOf('notFound()')).toBeLessThan(src.indexOf('<Suspense'))
    expect(src).toContain('<FormLoading compact />')
  })
})
