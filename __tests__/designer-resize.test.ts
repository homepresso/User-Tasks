import { describe, expect, it } from 'vitest'
import {
  DESIGNER_MIN, DESIGNER_SIZE_STORAGE_KEY, clampDesignerSize, initialDesignerSize, readDesignerPrefs, resizeBy, writeDesignerPrefs,
} from '@/components/forms/designer/use-resizable-dialog'

const vp = { width: 1600, height: 1000 }

describe('designer resize math', () => {
  it('clamps between the minimum and the viewport (less margin)', () => {
    expect(clampDesignerSize({ width: 100, height: 100 }, vp)).toEqual(DESIGNER_MIN)
    expect(clampDesignerSize({ width: 5000, height: 5000 }, vp)).toEqual({ width: 1584, height: 984 })
    expect(clampDesignerSize({ width: NaN, height: 700 }, vp).height).toBe(700)
  })

  it('keeps the minimum on a tiny viewport', () => {
    expect(clampDesignerSize({ width: 2000, height: 2000 }, { width: 500, height: 300 })).toEqual(DESIGNER_MIN)
  })

  it('opens at the remembered size, else the old default', () => {
    expect(initialDesignerSize({ width: 900, height: 600 }, vp)).toEqual({ width: 900, height: 600 })
    expect(initialDesignerSize({}, vp)).toEqual({ width: 1320, height: 900 })
    expect(initialDesignerSize({}, { width: 1000, height: 700 })).toEqual({ width: 970, height: 644 })
  })

  it('resizes symmetrically from each edge (the dialog stays centred)', () => {
    const start = { width: 1000, height: 700 }
    expect(resizeBy(start, 'e', 50, 0, vp)).toEqual({ width: 1100, height: 700 })
    expect(resizeBy(start, 'w', 50, 0, vp)).toEqual({ width: 900, height: 700 })
    expect(resizeBy(start, 's', 0, 20, vp)).toEqual({ width: 1000, height: 740 })
    expect(resizeBy(start, 'nw', -10, -10, vp)).toEqual({ width: 1020, height: 720 })
    expect(resizeBy(start, 'se', -1000, -1000, vp)).toEqual(DESIGNER_MIN)
  })
})

describe('designer prefs storage', () => {
  const memory = () => {
    const map = new Map<string, string>()
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, map }
  }

  it('round-trips and drops junk', () => {
    const s = memory()
    expect(writeDesignerPrefs({ width: 900, height: 600, maximized: true, paletteCollapsed: true }, s)).toBe(true)
    expect(readDesignerPrefs(s)).toEqual({ width: 900, height: 600, maximized: true, paletteCollapsed: true })
    s.map.set(DESIGNER_SIZE_STORAGE_KEY, JSON.stringify({ width: 'x', maximized: 'yes', propertiesCollapsed: true }))
    expect(readDesignerPrefs(s)).toEqual({ propertiesCollapsed: true })
    s.map.set(DESIGNER_SIZE_STORAGE_KEY, '{not json')
    expect(readDesignerPrefs(s)).toEqual({})
  })

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
    expect(readDesignerPrefs(blocked)).toEqual({})
    expect(writeDesignerPrefs({ width: 900 }, blocked)).toBe(false)
    expect(readDesignerPrefs(null)).toEqual({})
    expect(writeDesignerPrefs({}, null)).toBe(false)
  })
})
