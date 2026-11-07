/**
 * Official action ut_text (gallery/actions/text-toolkit): contract checks and
 * every operation run in the QuickJS sandbox from the built module.
 */
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const action = contractSuite('text-toolkit', {
  key: 'ut_text',
  operations: ['slugify', 'change_case', 'template', 'truncate', 'extract_between', 'similarity', 'word_count', 'mask'],
  capabilities: [],
})

describe('ut_text slugify', () => {
  it('folds accents, spells out & and collapses separators', async () => {
    expect((await ok(action, 'slugify', { text: 'Crème brûlée & Café Menu 2026!' })).slug).toBe('creme-brulee-and-cafe-menu-2026')
    expect((await ok(action, 'slugify', { text: '  Straße / Øresund — Łódź  ' })).slug).toBe('strasse-oresund-lodz')
    expect((await ok(action, 'slugify', { text: "Don't Stop", separator: '_' })).slug).toBe('dont_stop')
    expect((await ok(action, 'slugify', { text: 'Keep CASE', lowercase: false })).slug).toBe('Keep-CASE')
    expect((await ok(action, 'slugify', { text: 'Привет мир' })).slug).toBe('')
  })

  it('cuts long slugs at a word boundary', async () => {
    expect((await ok(action, 'slugify', { text: 'The quick brown fox jumps over', max_length: 18 })).slug).toBe('the-quick-brown')
    expect((await ok(action, 'slugify', { text: 'abcdefghijklmnop', max_length: 5 })).slug).toBe('abcde')
  })

  it('rejects bad separators and missing text', async () => {
    await fails(action, 'slugify', { text: 'x', separator: 'ab' }, /separator/)
    await fails(action, 'slugify', {}, /Text is required/)
  })
})

describe('ut_text change_case', () => {
  const cases: Array<[string, string, string]> = [
    ['customer order ID', 'camel', 'customerOrderId'],
    ['customer order ID', 'pascal', 'CustomerOrderId'],
    ['parseHTTPResponse v2', 'snake', 'parse_http_response_v2'],
    ['parseHTTPResponse v2', 'kebab', 'parse-http-response-v2'],
    ['max-retry_count', 'constant', 'MAX_RETRY_COUNT'],
    ['the lord of the rings: return of the king', 'title', 'The Lord of the Rings: Return of the King'],
    ['annual HR review in the office', 'title', 'Annual HR Review in the Office'],
    ['HELLO WORLD. this is i. 3 apples', 'sentence', 'Hello world. This is I. 3 apples'],
    ['MiXeD', 'upper', 'MIXED'],
    ['MiXeD', 'lower', 'mixed'],
    ['café crème', 'pascal', 'CaféCrème'],
  ]
  it.each(cases)('%s → %s', async (text, kind, expected) => {
    expect((await ok(action, 'change_case', { text, case: kind })).result).toBe(expected)
  })

  it('rejects an unknown case', async () => {
    await fails(action, 'change_case', { text: 'x', case: 'sponge' }, /must be one of/)
  })
})

describe('ut_text template', () => {
  it('fills nested paths, list indexes and fallbacks', async () => {
    const out = await ok(action, 'template', {
      template: 'Hi {{ customer.first_name }}, order {{order.id}} ({{order.items[0].sku}}, {{order.items[-1].sku}}) ships {{order.ship_date | soon}}. Tags: {{tags}}. Paid: {{paid}}',
      data: { customer: { first_name: 'Aroha' }, order: { id: 'SO-1042', items: [{ sku: 'A1' }, { sku: 'B2' }] }, tags: ['x', 'y'], paid: false },
    })
    expect(out).toEqual({ result: 'Hi Aroha, order SO-1042 (A1, B2) ships soon. Tags: ["x","y"]. Paid: false', missing: [], replaced: 7 })
  })

  it('keeps, blanks or fails on missing values', async () => {
    const template = 'Dear {{name}}, ref {{ref}}'
    expect(await ok(action, 'template', { template, data: { name: 'Sam' } })).toEqual({ result: 'Dear Sam, ref {{ref}}', missing: ['ref'], replaced: 1 })
    expect((await ok(action, 'template', { template, data: { name: 'Sam' }, missing: 'blank' })).result).toBe('Dear Sam, ref ')
    await fails(action, 'template', { template, data: {}, missing: 'error' }, /No value for \{\{name\}\}, \{\{ref\}\}/)
    expect((await ok(action, 'template', { template: '{{a}}', data: { a: null } })).result).toBe('')
  })

  it('accepts data as JSON text', async () => {
    expect((await ok(action, 'template', { template: '{{a.b}}', data: '{"a":{"b":42}}' })).result).toBe('42')
    await fails(action, 'template', { template: '{{a}}', data: 'not json' }, /Data must be an object/)
  })
})

describe('ut_text truncate', () => {
  const long = 'The quarterly review covers revenue, churn and the hiring plan for the next two quarters.'
  it('truncates by characters without cutting words', async () => {
    const out = await ok(action, 'truncate', { text: long, length: 40 })
    expect(out).toEqual({ result: 'The quarterly review covers revenue…', truncated: true })
    expect(Array.from(out.result).length).toBeLessThanOrEqual(40)
    expect((await ok(action, 'truncate', { text: long, length: 20, preserve_words: false, ellipsis: '...' })).result).toBe('The quarterly rev...')
    expect(await ok(action, 'truncate', { text: 'short', length: 10 })).toEqual({ result: 'short', truncated: false })
  })

  it('truncates by words and counts emoji as one character', async () => {
    expect((await ok(action, 'truncate', { text: long, length: 5, by: 'words' })).result).toBe('The quarterly review covers revenue…')
    expect((await ok(action, 'truncate', { text: '😀😀😀😀😀', length: 3, ellipsis: 'none' })).result).toBe('😀😀😀')
  })

  it('needs a length', async () => {
    await fails(action, 'truncate', { text: 'x' }, /Length is required/)
    await fails(action, 'truncate', { text: 'x', length: 0 }, /at least 1/)
  })
})

describe('ut_text extract_between', () => {
  const text = 'Ref: [INV-1001] paid; Ref: [ INV-1002 ] due'
  it('finds the first or every match', async () => {
    expect(await ok(action, 'extract_between', { text, start: '[', end: ']' })).toEqual({ value: 'INV-1001', matches: ['INV-1001'], count: 1, found: true })
    expect((await ok(action, 'extract_between', { text, start: '[', end: ']', all: true })).matches).toEqual(['INV-1001', 'INV-1002'])
    expect((await ok(action, 'extract_between', { text, start: '[', end: ']', all: true, include_markers: true, trim: false })).matches).toEqual(['[INV-1001]', '[ INV-1002 ]'])
  })

  it('ignores case on request and handles open ends', async () => {
    expect((await ok(action, 'extract_between', { text: 'Name: Ana\nRole: Lead', start: 'name:', end: '\n', case_sensitive: false })).value).toBe('Ana')
    expect((await ok(action, 'extract_between', { text: 'Name: Ana\nRole: Lead', start: 'Role:' })).value).toBe('Lead')
    expect((await ok(action, 'extract_between', { text: 'Subject: Hello -- signature', end: '--' })).value).toBe('Subject: Hello')
    expect(await ok(action, 'extract_between', { text: 'nothing here', start: '[', end: ']' })).toEqual({ value: '', matches: [], count: 0, found: false })
  })

  it('needs a marker', async () => {
    await fails(action, 'extract_between', { text: 'x' }, /start marker, an end marker/)
  })
})

describe('ut_text similarity', () => {
  it('computes Levenshtein and Jaro-Winkler on known pairs', async () => {
    const kitten = await ok(action, 'similarity', { value: 'kitten', compare_to: 'sitting' })
    expect(kitten.distance).toBe(3)
    expect(kitten.similarity).toBe(0.5714)
    expect((await ok(action, 'similarity', { value: 'MARTHA', compare_to: 'MARHTA', case_sensitive: true })).jaro_winkler).toBe(0.9611)
    expect((await ok(action, 'similarity', { value: 'DWAYNE', compare_to: 'DUANE' })).jaro_winkler).toBe(0.84)
    expect((await ok(action, 'similarity', { value: 'DIXON', compare_to: 'DICKSONX' })).jaro_winkler).toBe(0.8133)
    const same = await ok(action, 'similarity', { value: ' Hello  World ', compare_to: 'hello world' })
    expect(same).toMatchObject({ distance: 0, similarity: 1, jaro_winkler: 1, matched: true, best_match: null, best_score: null, best_index: -1 })
    expect((await ok(action, 'similarity', { value: 'Hello', compare_to: 'hello', case_sensitive: true })).distance).toBe(1)
  })

  it('finds the best fuzzy match with a threshold', async () => {
    const out = await ok(action, 'similarity', { value: 'Jon Smyth', candidates: ['Jonas Schmidt', 'John Smith', 'Joan Smythe'], threshold: 0.85 })
    expect(out.best_match).toBe('Joan Smythe')
    expect(out.best_index).toBe(2)
    expect(out.best_score).toBeGreaterThan(0.9)
    expect(out.matched).toBe(true)
    expect(out.distance).toBeNull()
    const lev = await ok(action, 'similarity', { value: 'INV-1001', candidates: ['INV-1007', 'INV-2001', 'PO-1001'], method: 'levenshtein', threshold: 0.9 })
    expect(lev.best_match).toBe('INV-1007')
    expect(lev.best_score).toBe(0.875)
    expect(lev.matched).toBe(false)
    expect((await ok(action, 'similarity', { value: 'zzz', candidates: ['abc'] })).best_index).toBe(-1)
  })

  it('needs something to compare with', async () => {
    await fails(action, 'similarity', { value: 'x' }, /compare_to, candidates/)
    await fails(action, 'similarity', { value: 'x', compare_to: 'y', threshold: 2 }, /at most 1/)
  })
})

describe('ut_text word_count', () => {
  it('counts words, characters, sentences and paragraphs', async () => {
    const out = await ok(action, 'word_count', { text: "First sentence here. It's the second one!\n\nA new paragraph… with e-mail and 3.5 numbers" })
    expect(out).toEqual({ words: 15, characters: 87, characters_no_spaces: 72, sentences: 4, paragraphs: 2, reading_minutes: 1 })
    expect(await ok(action, 'word_count', { text: '' })).toEqual({ words: 0, characters: 0, characters_no_spaces: 0, sentences: 0, paragraphs: 0, reading_minutes: 0 })
    expect((await ok(action, 'word_count', { text: 'word '.repeat(450), words_per_minute: 200 })).reading_minutes).toBe(3)
  })
})

describe('ut_text mask', () => {
  it('keeps the last or first characters and separators', async () => {
    expect((await ok(action, 'mask', { value: '4111 1111 1111 1111' })).masked).toBe('**** **** **** 1111')
    expect((await ok(action, 'mask', { value: '4111111111111111', keep: 4, mode: 'keep_first' })).masked).toBe('4111************')
    expect((await ok(action, 'mask', { value: '12-3456-7890123-00', keep: 3, mask_char: '•' })).masked).toBe('••-••••-••••••3-00')
    expect((await ok(action, 'mask', { value: 'AB-12', preserve_separators: false, keep: 2 })).masked).toBe('***12')
    expect((await ok(action, 'mask', { value: 'secret', mode: 'all' })).masked).toBe('******')
  })

  it('never reveals a short value completely', async () => {
    expect((await ok(action, 'mask', { value: '1234', keep: 4 })).masked).toBe('**34')
  })

  it('masks email addresses', async () => {
    expect((await ok(action, 'mask', { value: 'aroha.smith@example.co.nz', mode: 'email' })).masked).toBe('a**********@example.co.nz')
    expect((await ok(action, 'mask', { value: 'jo@x.io', mode: 'email' })).masked).toBe('j***@x.io')
    expect((await ok(action, 'mask', { value: 'a@x.io', mode: 'email' })).masked).toBe('*@x.io')
    await fails(action, 'mask', { value: 'not-an-email', mode: 'email' }, /not an email/)
  })
})
