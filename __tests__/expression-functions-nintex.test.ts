/** Native expression functions added for Nintex parity (text, date, money, lists). */
import { describe, expect, it } from 'vitest'
import { evaluateFunction, FUNCTION_CATALOG } from '@/lib/expression-functions'

const f = (e: string) => evaluateFunction(e)

describe('text', () => {
  it('SUBSTRING / INSERT / REMOVE are 0-based', () => {
    expect(f('SUBSTRING("Example", 2, 3)')).toBe('amp')
    expect(f('SUBSTRING("Example", 3)')).toBe('mple')
    expect(f('INSERT("ABCD", 2, "-")')).toBe('AB-CD')
    expect(f('REMOVE("ABCDEF", 1, 2)')).toBe('ADEF')
    expect(f('REMOVE("ABCDEF", 3)')).toBe('ABC')
  })
  it('XML_ENCODE / XML_DECODE / HTML_TO_TEXT', () => {
    expect(f('XML_ENCODE("a<b & \'c\'")')).toBe('a&lt;b &amp; &apos;c&apos;')
    expect(f('XML_DECODE("a&amp;b&#65;")')).toBe('a&bA')
    expect(f('HTML_TO_TEXT("<p>Hi&nbsp;there</p><p>Two<br>lines</p>")')).toBe('Hi there\nTwo\nlines')
  })
})

describe('dates and numbers', () => {
  it('DATE_DIFF in units, ADD_MONTHS / ADD_YEARS clamp', () => {
    expect(f('DATE_DIFF("2024-01-01", "2024-03-15", "months")')).toBe(2)
    expect(f('DATE_DIFF("2024-01-01", "2024-01-08")')).toBe(7)
    expect(f('DATE_DIFF("2024-01-01T00:00:00Z", "2024-01-01T05:30:00Z", "hours")')).toBe(5)
    expect(f('DATE_DIFF("2020-06-01", "2024-05-31", "years")')).toBe(3)
    expect(f('ADD_MONTHS("2024-01-31", 1)')).toBe('2024-02-29')
    expect(f('ADD_YEARS("2024-02-29", 1)')).toBe('2025-02-28')
  })
  it('FORMAT_DATE month and weekday names', () => {
    expect(f('FORMAT_DATE("2024-03-15", "dddd, MMMM DD YYYY")')).toBe('Friday, March 15 2024')
    expect(f('FORMAT_DATE("2024-03-15", "DD MMM YYYY")')).toBe('15 Mar 2024')
  })
  it('FORMAT_CURRENCY, CEILING, FLOOR', () => {
    expect(f('FORMAT_CURRENCY(1234.5)')).toBe('$1,234.50')
    expect(f('FORMAT_CURRENCY(10, "EUR", "en-US")')).toBe('€10.00')
    expect(f('CEILING(2.341, 2)')).toBe(2.35)
    expect(f('FLOOR(2.349, 2)')).toBe(2.34)
  })
})

describe('lists', () => {
  const scope = { l: ['a', 'b', 'a'], n: [3, 1, 2], o: ['b', 'c'] }
  const g = (e: string) => evaluateFunction(e, scope)
  it('add / insert / remove / contains / index of', () => {
    expect(g('LIST_ADD(l, "c")')).toEqual(['a', 'b', 'a', 'c'])
    expect(g('LIST_INSERT(l, 2, "x")')).toEqual(['a', 'x', 'b', 'a'])
    expect(g('LIST_REMOVE_AT(l, 1)')).toEqual(['b', 'a'])
    expect(g('LIST_REMOVE(l, "a")')).toEqual(['b'])
    expect(g('LIST_CONTAINS(l, "b")')).toBe(true)
    expect(g('LIST_INDEX_OF(l, "b")')).toBe(2)
    expect(g('LIST_INDEX_OF(l, "z")')).toBe(0)
  })
  it('join / sort / union / intersect / except, and ;-separated text as a list', () => {
    expect(g('LIST_JOIN(l, "; ")')).toBe('a; b; a')
    expect(g('LIST_SORT(n, "desc")')).toEqual([3, 2, 1])
    expect(g('UNION(l, o)')).toEqual(['a', 'b', 'c'])
    expect(g('INTERSECT(l, o)')).toEqual(['b'])
    expect(g('EXCEPT(l, o)')).toEqual(['a', 'a'])
    expect(f('LIST_ADD("x;y", "z")')).toEqual(['x', 'y', 'z'])
  })
  it('every new function is in the catalogue (docs and the expression picker)', () => {
    const names = new Set(FUNCTION_CATALOG.map((d) => d.name))
    for (const n of ['SUBSTRING', 'INSERT', 'REMOVE', 'XML_ENCODE', 'XML_DECODE', 'HTML_TO_TEXT', 'DATE_DIFF', 'ADD_MONTHS', 'ADD_YEARS', 'FORMAT_CURRENCY', 'CEILING', 'FLOOR', 'LIST_ADD', 'LIST_INSERT', 'LIST_REMOVE_AT', 'LIST_REMOVE', 'LIST_CONTAINS', 'LIST_INDEX_OF', 'LIST_JOIN', 'LIST_SORT', 'UNION', 'INTERSECT', 'EXCEPT']) expect(names.has(n)).toBe(true)
  })
})
