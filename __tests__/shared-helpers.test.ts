import { describe, expect, it } from 'vitest'
import { isObjectLike, isPlainObject } from '@/lib/utils/guards'
import { toKeySlug, toUrlSlug } from '@/lib/utils/slug'
import { formatDuration } from '@/lib/format'
import { average } from '@/lib/report-flow-stats'
import { messageOf } from '@/lib/mcp/tools/_util'

/** Helpers consolidated from per-file copies (same behaviour as the copies). */

describe('guards', () => {
  it('isObjectLike accepts arrays, isPlainObject does not', () => {
    for (const v of [{}, { a: 1 }]) { expect(isObjectLike(v)).toBe(true); expect(isPlainObject(v)).toBe(true) }
    expect(isObjectLike([])).toBe(true)
    expect(isPlainObject([])).toBe(false)
    for (const v of [null, undefined, 0, '', 'x', true]) { expect(isObjectLike(v)).toBe(false); expect(isPlainObject(v)).toBe(false) }
  })
})

describe('slugs', () => {
  it('toKeySlug collapses runs to _ and trims them', () => {
    expect(toKeySlug('  Needs Review!! ')).toBe('needs_review')
    expect(toKeySlug('__Approved__')).toBe('approved')
    expect(toKeySlug('Ünïcode 2')).toBe('n_code_2')
  })
  it('toUrlSlug collapses runs to - and cuts to maxLength', () => {
    expect(toUrlSlug(' Acme Corp, Inc. ')).toBe('acme-corp-inc')
    expect(toUrlSlug('a'.repeat(60), 40)).toHaveLength(40)
    expect(toUrlSlug('!!!', 50) || 'team').toBe('team')
  })
})

describe('formatDuration / average / messageOf', () => {
  it('formats durations', () => {
    expect([0, -5, 850, 12_400, 192_000, 5_400_000].map(formatDuration)).toEqual(['—', '—', '850ms', '12.4s', '3.2m', '1.5h'])
  })
  it('averages, 0 for empty', () => {
    expect(average([])).toBe(0)
    expect(average([1, 2, 3])).toBe(2)
  })
  it('messageOf falls back for non-errors and empty messages', () => {
    expect(messageOf(new Error('boom'), 'x')).toBe('boom')
    expect(messageOf(new Error(''), 'x')).toBe('x')
    expect(messageOf('str', 'x')).toBe('x')
  })
})
