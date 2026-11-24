/**
 * The coloured app header: its tile and menu washes must not use `bg-white…`
 * classes. app/globals.css's legacy-compat rule repaints any element whose
 * class contains "bg-white" with the card background — solid white in light
 * mode — so the icon (drawn in the header's on-colour, usually white)
 * vanished. Washes over the header colour use currentColor instead.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppIconTile } from '@/components/apps/app-icon'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [] })
}

describe('coloured app header', () => {
  it('the legacy rule still repaints bg-white (why app chrome must not use it)', () => {
    expect(readFileSync('app/globals.css', 'utf8')).toMatch(/\[class\*="bg-white"\]/)
  })

  it('no app chrome uses bg-white washes', () => {
    const offenders = files('components/apps').filter((f) => /\bbg-white\b/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
    expect(readFileSync('components/apps/app-page-view.tsx', 'utf8')).toContain('className={colored ? "bg-current/20 text-current" : undefined}')
  })

  it('the icon tile on a coloured header is a translucent wash of the header text colour', () => {
    const html = renderToStaticMarkup(createElement(AppIconTile, { icon: 'Landmark', color: null, size: 'lg', className: 'bg-current/20 text-current' }))
    expect(html).toContain('bg-current/20')
    expect(html).not.toContain('bg-primary')
    expect(html).not.toContain('bg-white')
    expect(html).toContain('<svg')
  })
})
