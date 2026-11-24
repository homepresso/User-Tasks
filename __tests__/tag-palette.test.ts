/**
 * Tag colours (lib/tags/palette.ts): the palette tokens and their contrast
 * on light and dark theme surfaces, globals.css kept in step with the
 * table, the deterministic auto colour, name normalisation (the
 * case-insensitive registry key, mirrored by the migration's name_key) and
 * the legacy hex → token mapping.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTO_TAG_COLORS, autoTagColor, chipColors, cleanTagName, contrastRatio, hashTagName, isTagColorToken, LEGACY_PRESETS,
  mixHex, nearestTagColor, NEUTRAL_TAG_COLOR, resolveTagColor, tagKey, TAG_COLOR_TOKENS, TAG_MIX, TAG_PALETTE,
} from '@/lib/tags/palette'

const LIGHT_CARDS = ['#ffffff', '#fbfaf7', '#f8fafc', '#f5f5f4']
const DARK_CARDS = ['#18181b', '#0f172a', '#1c1917', '#111111', '#1e1e24']

describe('tag palette', () => {
  it('has 15 named tokens, one palette entry each, no raw hex names', () => {
    expect(TAG_COLOR_TOKENS).toHaveLength(15)
    expect(TAG_PALETTE.map((p) => p.token)).toEqual([...TAG_COLOR_TOKENS])
    for (const p of TAG_PALETTE) {
      expect(p.token).toMatch(/^[a-z]+$/)
      for (const hex of [p.solid, p.lightFg, p.darkFg]) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(isTagColorToken('teal')).toBe(true)
    expect(isTagColorToken('#ff0000')).toBe(false)
    expect(isTagColorToken('auto')).toBe(false)
  })

  it('every token keeps AA text contrast (4.5:1) on its tint, light and dark, on several theme surfaces', () => {
    for (const p of TAG_PALETTE) {
      for (const card of LIGHT_CARDS) {
        const c = chipColors(p.token, 'light', card)
        expect(contrastRatio(c.fg, c.bg), `${p.token} light on ${card}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const card of DARK_CARDS) {
        const c = chipColors(p.token, 'dark', card)
        expect(contrastRatio(c.fg, c.bg), `${p.token} dark on ${card}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the tint is visibly coloured (not the card) and the border stronger than the fill', () => {
    for (const p of TAG_PALETTE) {
      const light = chipColors(p.token, 'light', '#ffffff')
      expect(light.bg).not.toBe('#ffffff')
      expect(contrastRatio(light.border, '#ffffff')).toBeGreaterThan(contrastRatio(light.bg, '#ffffff'))
      const dark = chipColors(p.token, 'dark', '#18181b')
      expect(contrastRatio(dark.border, '#18181b')).toBeGreaterThan(contrastRatio(dark.bg, '#18181b'))
    }
  })

  it('mixHex and contrastRatio match CSS color-mix and WCAG', () => {
    expect(mixHex('#000000', 50, '#ffffff')).toBe('#808080')
    expect(mixHex('#ff0000', 100, '#00ff00')).toBe('#ff0000')
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
  })

  it('app/globals.css declares the same tokens, colours and mixes as the table', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8')
    const block = css.slice(css.indexOf('/* ─── Tag colours'))
    const dark = block.slice(block.indexOf('[data-theme-mode="dark"]'), block.indexOf('.tag-chip {'))
    for (const p of TAG_PALETTE) {
      expect(block, p.token).toContain(`--tag-${p.token}-solid: ${p.solid}; --tag-${p.token}-fg: ${p.lightFg};`)
      expect(dark, p.token).toContain(`--tag-${p.token}-fg: ${p.darkFg};`)
      expect(block).toContain(`.tag-chip[data-tag-color="${p.token}"]`)
    }
    expect(block).toContain(`--tag-mix-bg: ${TAG_MIX.light.bg}%;`)
    expect(block).toContain(`--tag-mix-border: ${TAG_MIX.light.border}%;`)
    expect(dark).toContain(`--tag-mix-bg: ${TAG_MIX.dark.bg}%;`)
    expect(dark).toContain(`--tag-mix-border: ${TAG_MIX.dark.border}%;`)
    // Tints come from the theme's card colour, so every workspace theme harmonises.
    expect(block).toMatch(/color-mix\(in srgb, var\(--tag-solid\) var\(--tag-mix-bg\), var\(--theme-card-bg\)\)/)
  })

  it('the migration allows exactly the palette tokens', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20270121150000_tag_styles.sql'), 'utf8')
    const check = sql.slice(sql.indexOf('color text CHECK'), sql.indexOf('description text CHECK'))
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...TAG_COLOR_TOKENS])
  })
})

describe('tag names', () => {
  it('cleanTagName trims and collapses whitespace, keeping case', () => {
    expect(cleanTagName('  Finance   Team ')).toBe('Finance Team')
    expect(cleanTagName('a\tb\nc')).toBe('a b c')
    expect(cleanTagName(null)).toBe('')
  })

  it('tagKey is case-insensitive and whitespace-tolerant (= the name_key column)', () => {
    expect(tagKey('Finance')).toBe('finance')
    expect(tagKey(' finance ')).toBe('finance')
    expect(tagKey('FINANCE  team')).toBe('finance team')
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20270121150000_tag_styles.sql'), 'utf8')
    expect(sql).toContain("name_key text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\\s+', ' ', 'g')))) STORED")
    expect(sql).toContain('CONSTRAINT tag_styles_tenant_name_key UNIQUE (tenant_id, name_key)')
  })
})

describe('auto colour', () => {
  it('is deterministic: the same name always gets the same token, whatever its case or spacing', () => {
    for (const name of ['finance', 'urgent', 'onboarding', 'hr', 'Q3 review']) {
      const color = autoTagColor(name)
      expect(autoTagColor(name)).toBe(color)
      expect(autoTagColor(name.toUpperCase())).toBe(color)
      expect(autoTagColor(`  ${name}  `)).toBe(color)
      expect(AUTO_TAG_COLORS).toContain(color)
    }
  })

  it('is stable across releases (FNV-1a over the key)', () => {
    expect(hashTagName('finance')).toBe(hashTagName('finance'))
    expect(hashTagName('')).toBe(0x811c9dc5)
    expect(hashTagName('a')).toBe(0xe40c292c)
    expect(autoTagColor('a')).toBe(AUTO_TAG_COLORS[0xe40c292c % AUTO_TAG_COLORS.length])
  })

  it('never picks the neutral grey and spreads names over the palette', () => {
    expect(AUTO_TAG_COLORS).not.toContain(NEUTRAL_TAG_COLOR)
    const names = ['finance', 'hr', 'legal', 'it', 'sales', 'marketing', 'ops', 'urgent', 'vip', 'q1', 'q2', 'q3', 'q4', 'onboarding', 'offboarding', 'travel', 'expenses', 'procurement', 'security', 'compliance']
    const used = new Set(names.map(autoTagColor))
    expect(used.size).toBeGreaterThanOrEqual(8)
    expect(autoTagColor('')).toBe(NEUTRAL_TAG_COLOR)
  })

  it('resolveTagColor: a chosen colour wins; else auto, or grey when auto colour is off', () => {
    expect(resolveTagColor('finance', 'rose')).toBe('rose')
    expect(resolveTagColor('finance', null)).toBe(autoTagColor('finance'))
    expect(resolveTagColor('finance', null, false)).toBe('gray')
    expect(resolveTagColor('finance', 'rose', false)).toBe('rose')
    expect(resolveTagColor('finance', '#ff0000' as never)).toBe(autoTagColor('finance'))
  })
})

describe('legacy hex colours', () => {
  it('maps the old picker presets to their tokens and other hex to the nearest solid', () => {
    for (const [hex, token] of Object.entries(LEGACY_PRESETS)) expect(nearestTagColor(hex.toUpperCase())).toBe(token)
    expect(nearestTagColor('#ee4444')).toBe('red')
    expect(nearestTagColor('#3a80f0')).toBe('blue')
    expect(nearestTagColor('not a colour')).toBe('gray')
  })

  it('the migration maps the same presets', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20270121150000_tag_styles.sql'), 'utf8')
    for (const [hex, token] of Object.entries(LEGACY_PRESETS)) expect(sql).toContain(`('${hex}', '${token}')`)
  })
})
