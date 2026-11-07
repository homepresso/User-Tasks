/**
 * Official action ut_validate (gallery/actions/validation-formatting):
 * contract checks and every operation run in the QuickJS sandbox from the
 * built module (check digits via lib/documents/pii/validators, Intl via ctx).
 */
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const action = contractSuite('validation-formatting', {
  key: 'ut_validate',
  operations: ['validate', 'validate_many', 'format_number', 'format_currency', 'parse_number', 'format_phone'],
  capabilities: [],
})

const v = (type: string, value: string, extra: Record<string, unknown> = {}) => ok(action, 'validate', { type, value, ...extra })

describe('ut_validate validate: banking and cards', () => {
  it('IBAN: country length and mod 97', async () => {
    expect(await v('iban', 'GB82 WEST 1234 5698 7654 32')).toEqual({
      valid: true, normalized: 'GB82WEST12345698765432', reason: '',
      details: { country: 'GB', check_digits: '82', bban: 'WEST12345698765432', formatted: 'GB82 WEST 1234 5698 7654 32' },
    })
    expect((await v('iban', 'de89-3704-0044-0532-0130-00')).normalized).toBe('DE89370400440532013000')
    expect(await v('iban', 'GB83 WEST 1234 5698 7654 32')).toMatchObject({ valid: false, reason: expect.stringMatching(/check digits/) })
    expect((await v('iban', 'GB82 WEST 1234 5698 7654 3')).reason).toMatch(/A GB IBAN has 22 characters, this has 21/)
    expect((await v('iban', 'US12 3456 7890 1234')).reason).toMatch(/US does not use IBANs/)
    expect((await v('iban', 'hello')).valid).toBe(false)
  })

  it('BIC', async () => {
    expect(await v('bic', 'cobadeffxxx')).toMatchObject({ valid: true, normalized: 'COBADEFFXXX', details: { bank_code: 'COBA', country: 'DE', location: 'FF', branch: 'XXX', primary_office: true } })
    expect(await v('bic', 'DEUTDEFF500')).toMatchObject({ valid: true, details: { branch: '500', primary_office: false } })
    expect((await v('bic', 'DEUTQQFF')).valid).toBe(false)
    expect((await v('bic', 'DEUT')).valid).toBe(false)
  })

  it('cards: Luhn and issuer', async () => {
    expect(await v('card', '4111 1111 1111 1111')).toEqual({ valid: true, normalized: '4111111111111111', reason: '', details: { issuer: 'visa', length: 16, last4: '1111', masked: '************1111' } })
    expect((await v('card', '5555-5555-5555-4444')).details.issuer).toBe('mastercard')
    expect((await v('card', '378282246310005')).details.issuer).toBe('amex')
    expect((await v('card', '6011111111111117')).details.issuer).toBe('discover')
    expect((await v('card', '4111 1111 1111 1112')).reason).toMatch(/Luhn/)
    expect((await v('card', '4111')).reason).toMatch(/12–19 digits/)
    expect((await v('card', '0000 0000 0000 0000')).reason).toMatch(/same/)
    expect((await v('card', '4111-abcd')).reason).toMatch(/only digits/)
  })
})

describe('ut_validate validate: contact details', () => {
  it('email syntax', async () => {
    expect(await v('email', ' Aroha.Smith+ap@Example.CO.NZ ')).toEqual({ valid: true, normalized: 'Aroha.Smith+ap@example.co.nz', reason: '', details: { local: 'Aroha.Smith+ap', domain: 'example.co.nz', tld: 'nz' } })
    for (const bad of ['no-at-sign', '@example.com', 'a@', 'a..b@example.com', 'a@example', 'a@-example.com', 'a@example.c0m', 'a b@example.com', `${'x'.repeat(65)}@example.com`]) {
      expect((await v('email', bad)).valid, bad).toBe(false)
    }
  })

  it('phone numbers to E.164 with a default country', async () => {
    expect(await v('phone', '021 123 4567', { country: 'NZ' })).toEqual({
      valid: true, normalized: '+64211234567', reason: '',
      details: { country_code: '64', national_number: '211234567', countries: ['NZ'], international: '+64 21 123 4567', national: '021 123 4567' },
    })
    expect((await v('phone', '+1 (415) 555-0132')).details).toMatchObject({ country_code: '1', countries: ['US', 'CA'], national: '(415) 555-0132' })
    expect((await v('phone', '0044 20 7946 0958')).normalized).toBe('+442079460958')
    expect((await v('phone', '020 7946 0958', { country: '44' })).normalized).toBe('+442079460958')
    expect((await v('phone', '06 1234 5678', { country: 'IT' })).normalized).toBe('+390612345678')
    expect((await v('phone', '1-415-555-0132', { country: 'US' })).normalized).toBe('+14155550132')
    expect((await v('phone', '+64 21 123 4567 ext. 89')).normalized).toBe('+64211234567')
    expect((await v('phone', '021 123 4567')).reason).toMatch(/default country/)
    expect((await v('phone', '+64 12')).reason).toMatch(/8–15 digits/)
    expect((await v('phone', '+1 415 555')).valid).toBe(false)
    expect((await v('phone', 'call me')).valid).toBe(false)
    await fails(action, 'validate', { type: 'phone', value: '021 123 4567', country: 'Atlantis' }, /not a known ISO country/)
  })

  it('postcodes by country', async () => {
    const pc = async (country: string, value: string) => v('postcode', value, { country })
    expect(await pc('GB', 'sw1a1aa')).toEqual({ valid: true, normalized: 'SW1A 1AA', reason: '', details: { country: 'GB' } })
    expect((await pc('UK', 'EC1A 1BB')).normalized).toBe('EC1A 1BB')
    expect((await pc('US', '94105-1234')).normalized).toBe('94105-1234')
    expect((await pc('US', '941051234')).normalized).toBe('94105-1234')
    expect((await pc('CA', 'k1a0b1')).normalized).toBe('K1A 0B1')
    expect((await pc('NL', '1012ab')).normalized).toBe('1012 AB')
    expect((await pc('NZ', '6011')).valid).toBe(true)
    expect((await pc('AU', '0800')).valid).toBe(true)
    expect((await pc('DE', '10115')).valid).toBe(true)
    expect((await pc('FR', '75008')).valid).toBe(true)
    expect((await pc('IE', 'd02x285')).normalized).toBe('D02 X285')
    expect((await pc('JP', '1000001')).normalized).toBe('100-0001')
    expect((await pc('PL', '00950')).normalized).toBe('00-950')
    expect((await pc('SE', '11455')).normalized).toBe('114 55')
    expect(await pc('US', '9410')).toMatchObject({ valid: false, reason: 'Not a valid US postcode (for example 94105 or 94105-1234)' })
    expect((await pc('CA', 'D1A 0B1')).valid).toBe(false)
    expect((await pc('DE', '00115')).valid).toBe(false)
    expect((await v('postcode', '6011')).reason).toMatch(/Set the country/)
    await fails(action, 'validate', { type: 'postcode', value: '1234', country: 'XX' }, /not supported/)
  })
})

describe('ut_validate validate: national IDs', () => {
  const valid: Array<[string, string, string, string]> = [
    ['us_ssn', '536-90-4399', '536904399', '536-90-4399'],
    ['uk_nino', 'ab 12 34 56 c', 'AB123456C', 'AB 12 34 56 C'],
    ['ca_sin', '130 692 544', '130692544', '130 692 544'],
    ['au_tfn', '123 456 782', '123456782', '123 456 782'],
    ['nz_ird', '49-091-850', '049091850', '049-091-850'],
    ['nz_nhi', 'zzz0016', 'ZZZ0016', 'ZZZ0016'],
    ['de_tax_id', '86095742719', '86095742719', '86 095 742 719'],
    ['fr_nir', '2 55 08 14 168 025 38', '255081416802538', '2 55 08 14 168 025 38'],
    ['es_dni', '12345678-Z', '12345678Z', '12345678Z'],
    ['it_fiscal_code', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S', 'RSSMRA85T10A562S'],
    ['nl_bsn', '111222333', '111222333', '111222333'],
    ['in_aadhaar', '2341 2341 2346', '234123412346', '2341 2341 2346'],
    ['sg_nric', 's1234567d', 'S1234567D', 'S1234567D'],
  ]
  it.each(valid)('%s %s is valid', async (idType, value, normalized, formatted) => {
    expect(await v('national_id', value, { id_type: idType })).toEqual({ valid: true, normalized, reason: '', details: expect.objectContaining({ id_type: idType, formatted }) })
  })

  const invalid: Array<[string, string]> = [
    ['us_ssn', '000-12-3456'], ['us_ssn', '123-45-6789'], ['uk_nino', 'QQ123456C'], ['ca_sin', '130 692 545'], ['au_tfn', '123 456 789'],
    ['nz_ird', '49-091-851'], ['nz_nhi', 'ZZZ0017'], ['de_tax_id', '86095742718'], ['fr_nir', '2 55 08 14 168 025 39'], ['es_dni', '12345678A'],
    ['it_fiscal_code', 'RSSMRA85T10A562T'], ['nl_bsn', '111222334'], ['in_aadhaar', '2341 2341 2345'], ['sg_nric', 'S1234567A'],
  ]
  it.each(invalid)('%s %s is invalid', async (idType, value) => {
    const r = await v('national_id', value, { id_type: idType })
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/format or check digit/)
  })

  it('needs an id type', async () => {
    expect((await v('national_id', '123')).reason).toMatch(/Set id_type/)
    await fails(action, 'validate', { type: 'national_id', value: '1', id_type: 'xx_id' }, /must be one of/)
  })
})

describe('ut_validate validate_many', () => {
  it('checks a list and reports all_valid', async () => {
    const out = await ok(action, 'validate_many', {
      country: 'NZ',
      items: [
        { name: 'Email', type: 'email', value: 'ap@example.co.nz' },
        { name: 'Bank', type: 'iban', value: 'DE89 3704 0044 0532 0130 00' },
        { name: 'Phone', type: 'phone', value: '021 123 4567' },
        { type: 'postcode', value: '99999', country: 'GB' },
        { type: 'card', value: null },
      ],
    })
    expect(out.results).toEqual([
      { name: 'Email', type: 'email', value: 'ap@example.co.nz', valid: true, normalized: 'ap@example.co.nz', reason: '' },
      { name: 'Bank', type: 'iban', value: 'DE89 3704 0044 0532 0130 00', valid: true, normalized: 'DE89370400440532013000', reason: '' },
      { name: 'Phone', type: 'phone', value: '021 123 4567', valid: true, normalized: '+64211234567', reason: '' },
      { type: 'postcode', value: '99999', valid: false, normalized: '99999', reason: 'Not a valid GB postcode (for example SW1A 1AA)' },
      { type: 'card', value: '', valid: false, normalized: '', reason: 'No value' },
    ])
    expect(out).toMatchObject({ all_valid: false, valid_count: 3, invalid_count: 2 })
    expect((await ok(action, 'validate_many', { items: [{ type: 'email', value: 'a@b.co' }] })).all_valid).toBe(true)
  })

  it('rejects bad entries', async () => {
    await fails(action, 'validate_many', { items: [{ type: 'colour', value: 'red' }] }, /items\[0\]\.type must be one of/)
    await fails(action, 'validate_many', { items: ['a@b.co'] }, /must be an object/)
  })
})

describe('ut_validate number formatting', () => {
  it('formats numbers by locale, style and notation', async () => {
    const fmt = async (inputs: Record<string, unknown>) => (await ok(action, 'format_number', inputs)).formatted
    expect(await fmt({ value: 1234567.891, locale: 'de-DE', maximum_fraction_digits: 2 })).toBe('1.234.567,89')
    expect(await fmt({ value: 1234567.891 })).toBe('1,234,567.891')
    expect(await fmt({ value: 1234567.891, locale: 'en-IN', maximum_fraction_digits: 0 })).toBe('12,34,568')
    expect(await fmt({ value: 0.256, style: 'percent', maximum_fraction_digits: 1 })).toBe('25.6%')
    expect(await fmt({ value: 1234567, notation: 'compact' })).toBe('1.2M')
    expect(await fmt({ value: 5, minimum_fraction_digits: 2 })).toBe('5.00')
    expect(await fmt({ value: 1234.5, use_grouping: false })).toBe('1234.5')
    expect(await fmt({ value: 9.99, style: 'currency', currency: 'eur', locale: 'fr-FR' })).toBe('9,99 €')
    await fails(action, 'format_number', { value: 1, style: 'currency' }, /currency is required/)
    await fails(action, 'format_number', { value: 1, locale: 'not a locale!' }, /BCP 47/)
    await fails(action, 'format_number', { value: 1, minimum_fraction_digits: 3, maximum_fraction_digits: 1 }, /cannot be more than/)
  })

  it('formats currencies', async () => {
    const cur = async (inputs: Record<string, unknown>) => (await ok(action, 'format_currency', inputs)).formatted
    expect(await ok(action, 'format_currency', { value: 1234.5, currency: 'NZD', locale: 'en-NZ' })).toEqual({ formatted: '$1,234.50', currency: 'NZD' })
    expect(await cur({ value: 1234567.8, currency: 'JPY', locale: 'ja-JP' })).toBe('￥1,234,568')
    expect(await cur({ value: -1234.5, currency: 'USD', accounting: true })).toBe('($1,234.50)')
    expect(await cur({ value: 1234.5, currency: 'NZD', display: 'code' })).toBe('NZD 1,234.50')
    expect(await cur({ value: 2, currency: 'GBP', display: 'name', locale: 'en-GB' })).toBe('2.00 British pounds')
    await fails(action, 'format_currency', { value: 1, currency: 'DOLLARS' }, /3-letter ISO 4217/)
    await fails(action, 'format_currency', { value: 1 }, /Currency is required|currency is required/)
  })
})

describe('ut_validate parse_number', () => {
  const parse = async (text: string, locale?: string) => ok(action, 'parse_number', { text, ...(locale ? { locale } : {}) })
  it('reads locale-formatted numbers', async () => {
    expect(await parse('1.234,56 €', 'de-DE')).toEqual({ value: 1234.56, valid: true, decimal_separator: ',', group_separator: '.' })
    expect((await parse('1 234,56', 'fr-FR')).value).toBe(1234.56)
    expect((await parse('1 234,56', 'fr-FR')).value).toBe(1234.56)
    expect((await parse("CHF 1'234.50", 'de-CH')).value).toBe(1234.5)
    expect((await parse('1,234.56')).value).toBe(1234.56)
    expect((await parse('$1,234')).value).toBe(1234)
    expect((await parse('USD 99.95')).value).toBe(99.95)
    expect((await parse('12,34,567.5', 'en-IN')).value).toBe(1234567.5)
    expect((await parse('١٢٣٫٥', 'ar-EG')).value).toBe(123.5)
  })

  it('handles negatives and percentages', async () => {
    expect((await parse('(1,234.50)')).value).toBe(-1234.5)
    expect((await parse('-42')).value).toBe(-42)
    expect((await parse('−42')).value).toBe(-42)
    expect((await parse('42-')).value).toBe(-42)
    expect((await parse('-€5,50', 'de-DE')).value).toBe(-5.5)
    expect((await parse('12.5%')).value).toBe(0.125)
  })

  it('reports text that is not a number', async () => {
    for (const bad of ['12abc34', 'abc', '1.2.3', '1.234,56']) expect((await parse(bad)).valid, bad).toBe(false)
    expect((await parse('1.234.56', 'de-DE')).valid).toBe(false)
    expect((await parse('', 'de-DE').catch((e) => e.message))).toMatch(/Text is required/)
  })
})

describe('ut_validate format_phone', () => {
  it('formats E.164, international and national', async () => {
    expect(await ok(action, 'format_phone', { value: '021 123 4567', country: 'NZ' })).toEqual({ formatted: '+64 21 123 4567', e164: '+64211234567', valid: true, reason: '' })
    expect((await ok(action, 'format_phone', { value: '021 123 4567', country: 'NZ', format: 'national' })).formatted).toBe('021 123 4567')
    expect((await ok(action, 'format_phone', { value: '021 123 4567', country: 'NZ', format: 'e164' })).formatted).toBe('+64211234567')
    expect((await ok(action, 'format_phone', { value: '4155550132', country: 'US', format: 'national' })).formatted).toBe('(415) 555-0132')
    expect((await ok(action, 'format_phone', { value: '+1 415 555 0132' })).formatted).toBe('+1 415 555 0132')
    expect((await ok(action, 'format_phone', { value: '+39 06 1234 5678', format: 'national' })).formatted).toBe('061 234 5678')
  })

  it('reports invalid numbers without failing the step', async () => {
    expect(await ok(action, 'format_phone', { value: '12', country: 'NZ' })).toEqual({ formatted: '', e164: '', valid: false, reason: expect.stringMatching(/8–15 digits/) })
  })
})
