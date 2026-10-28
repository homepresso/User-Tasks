import { describe, it, expect } from 'vitest'
import { escapeLikePattern, ilikeOrFilter } from '../lib/utils'

// Free-text search terms are interpolated into PostgREST .or() filter strings;
// commas and parens are filter-syntax structural characters (they 400 the
// whole request) and %/_ are LIKE wildcards. These helpers make any term safe.
describe('escapeLikePattern', () => {
  it('strips .or() structural characters', () => {
    expect(escapeLikePattern('Smith, John (acct)')).not.toMatch(/[,()]/)
  })

  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
  })
})

describe('ilikeOrFilter', () => {
  it('builds an OR filter across the given columns', () => {
    expect(ilikeOrFilter(['title', 'number'], 'widget'))
      .toBe('title.ilike.%widget%,number.ilike.%widget%')
  })

  it('a term containing commas/parens yields a parseable filter', () => {
    const filter = ilikeOrFilter(['title', 'number'], 'Smith, J (acct 50%)')
    // Exactly one comma per column boundary — none contributed by the term.
    expect(filter.split(',')).toHaveLength(2)
    expect(filter).not.toMatch(/[()]/)
  })

  it('trims the term', () => {
    expect(ilikeOrFilter(['title'], '  abc  ')).toBe('title.ilike.%abc%')
  })
})
