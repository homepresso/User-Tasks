import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '@/app/manifest'

const root = join(__dirname, '..')

describe('brand assets', () => {
  it('ships every brand file', () => {
    for (const file of ['mark.svg', 'mark-transparent.svg', 'mark-transparent-light.svg', 'mark-16.svg', 'wordmark.svg', 'wordmark-light.svg', 'mark-192.png', 'mark-512.png', 'mark-maskable-512.png']) {
      expect(existsSync(join(root, 'public/brand', file)), file).toBe(true)
    }
    expect(existsSync(join(root, 'app/apple-icon.png'))).toBe(true)
    expect(existsSync(join(root, 'public/favicon.ico'))).toBe(true)
  })

  it('uses the pixel-grid mark for the SVG favicon', () => {
    expect(readFileSync(join(root, 'app/icon.svg'), 'utf8')).toBe(readFileSync(join(root, 'public/brand/mark-16.svg'), 'utf8'))
  })

  it('draws the user → task mark: user dot, elbow connector, task block', () => {
    const mark = readFileSync(join(root, 'public/brand/mark.svg'), 'utf8')
    expect(mark).toContain('<circle cx="17" cy="17" r="7"')
    expect(mark).toContain('d="M17 31v6a8 8 0 0 0 8 8h6"')
    expect(mark).toContain('<rect x="36" y="36" width="18" height="18" rx="5"')
    // The retired "flow u" geometry must not linger anywhere.
    for (const file of ['public/brand/mark.svg', 'public/brand/mark-16.svg', 'components/brand/logo.tsx', 'lib/brand/og.tsx']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/M21 31v7|cx="43"|5 8v2a3 3/)
    }
  })

  it('keeps the React and Open Graph marks in step with the generated SVG', () => {
    for (const file of ['components/brand/logo.tsx', 'lib/brand/og.tsx']) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).toContain('cx="17" cy="17" r="7"')
      expect(source, file).toContain('d="M17 31v6a8 8 0 0 0 8 8h6"')
      expect(source, file).toContain('x="36" y="36" width="18" height="18" rx="5"')
    }
  })

  it('keeps the 16-unit favicon cut on whole pixels', () => {
    const svg = readFileSync(join(root, 'public/brand/mark-16.svg'), 'utf8')
    expect(svg).toContain('viewBox="0 0 16 16"')
    expect(svg).toContain('<rect x="8" y="8" width="6" height="6"')
    expect(svg).toContain('<circle cx="4" cy="4" r="2"')
  })

  it('keeps favicon.ico out of app/ so a workspace favicon can replace the icons', () => {
    // Next always lists app/favicon.ico first, even when a nested layout sets
    // its own icons (the dashboard does for a theme's custom favicon).
    expect(existsSync(join(root, 'app/favicon.ico'))).toBe(false)
  })

  it('points manifest icons at real files', () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(join(root, icon.src === '/icon.svg' ? 'app/icon.svg' : `public${icon.src}`)), icon.src).toBe(true)
    }
  })

  it('bundles the fonts the Open Graph cards load', () => {
    for (const font of ['DMSans-Medium.ttf', 'DMSans-Bold.ttf', 'Fraunces-Bold.ttf']) {
      expect(existsSync(join(root, 'lib/brand/fonts', font)), font).toBe(true)
    }
  })
})
