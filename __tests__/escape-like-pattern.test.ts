import { describe, it, expect } from 'vitest'
import { escapeLikePattern } from '@/lib/utils'

describe('escapeLikePattern', () => {
  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLikePattern('50%')).toBe('50\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash')
  })

  it('strips PostgREST .or() structural characters', () => {
    expect(escapeLikePattern('a,b')).toBe('a b')
    expect(escapeLikePattern('call(now)')).toBe('call now ')
  })

  it('passes plain text through', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world')
  })
})
