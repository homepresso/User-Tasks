import { describe, expect, it } from 'vitest'

/**
 * Information-type detection (lib/documents/pii): every type with a valid
 * and an invalid (checksum / range / context) fixture, date of birth vs a
 * plain date, overlap resolution, the ReDoS guard on every built-in
 * pattern and the time on a 5 MB text.
 *
 * Fixtures are published test or specimen values (Visa 4111 1111 1111 1111,
 * NHS 943 476 5919, IRD 49-091-850, NHI ZZZ0016, the ICAO 9303 specimen
 * MRZ, AWS's AKIAIOSFODNN7EXAMPLE …) or numbers made up to pass a check
 * digit; secrets are assembled at run time so no scanner mistakes them for
 * real ones.
 */

import { detectInfoTypes, DETECTOR_PATTERNS } from '@/lib/documents/pii/detect'
import { INFO_TYPES, PATTERN_INFO_TYPES, inRegions, infoTypeReferenceMarkdown, resolveInfoTypes } from '@/lib/documents/pii/catalog'
import * as v from '@/lib/documents/pii/validators'
import { findNestedQuantifier } from '@/lib/safe-regex'

const NOW = new Date('2026-10-29T00:00:00Z')
const ALL = resolveInfoTypes(['*'])

function find(text: string, types: string[] = ALL, minConfidence: 'low' | 'medium' | 'high' = 'low') {
  return detectInfoTypes(text, { types, minConfidence, now: NOW }).map((d) => ({ type: d.type, confidence: d.confidence, value: text.slice(d.start, d.end) }))
}

/** The one finding of `type` in `text` (all types enabled), or undefined. */
function only(text: string, type: string, minConfidence: 'low' | 'medium' | 'high' = 'low') {
  return find(text, ALL, minConfidence).find((f) => f.type === type)
}

const b64url = (s: string) => Buffer.from(s).toString('base64url')

// [type, text that must find it, the value found, expected confidence, text that must not]
const CASES: Array<[string, string, string, string, string]> = [
  ['us_ssn', 'SSN: 078-05-1120', '078-05-1120', 'high', 'SSN: 666-12-3456, 000-12-3456, 123-00-4567, 111-11-1111'],
  ['us_ssn', 'Social security number 078051120', '078051120', 'high', 'Order 078051120 shipped'],
  ['us_itin', 'ITIN 912-70-1234', '912-70-1234', 'high', 'ITIN 912-40-1234'],
  ['us_passport', 'US passport no. X12345678', 'X12345678', 'high', 'Ticket X12345678'],
  ['us_drivers_license', "Driver's license D123-4567-8901", 'D123-4567-8901', 'medium', 'Ref D123-4567-8901'],
  ['date_of_birth', 'DOB: 12/03/1985', '12/03/1985', 'high', 'Invoice date 12/03/1985'],
  ['date_of_birth', 'Born 12 March 1985 in Napier', '12 March 1985', 'high', 'DOB: 01/01/2090'],
  ['date_of_birth', 'Date of birth: Mar 12, 1985', 'Mar 12, 1985', 'high', 'Meeting on Mar 12, 1985'],
  ['date_of_birth', '1985-03-12 (date of birth)', '1985-03-12', 'high', 'DOB unknown, next appointment 01/02/2026'],
  ['uk_nino', 'NI number AB 12 34 56 C', 'AB 12 34 56 C', 'high', 'NI number QQ 12 34 56 C and BG123456A and AB123456E'],
  ['uk_passport', 'British passport 123456789', '123456789', 'high', 'Booking 123456789'],
  ['ca_sin', 'SIN 130 692 544', '130 692 544', 'high', 'SIN 130 692 545 and 046 454 286'],
  ['au_tfn', 'TFN: 123 456 782', '123 456 782', 'high', 'TFN: 123 456 781'],
  ['nz_ird', 'IRD number 49-091-850', '49-091-850', 'high', 'IRD number 136-410-133'],
  ['nz_ird', 'Our IRD no is 136410132', '136410132', 'high', 'IRD 9125568'],
  ['nz_drivers_licence', 'Driver licence AB123456', 'AB123456', 'high', 'Part AB123456'],
  ['de_tax_id', 'Steuer-ID: 86 095 742 719', '86 095 742 719', 'high', 'Steuer-ID: 86 095 742 718'],
  ['fr_nir', 'Numéro de sécurité sociale 2 84 12 75 123 456 87', '2 84 12 75 123 456 87', 'high', 'NIR 2 84 12 75 123 456 88'],
  ['es_dni', 'DNI 12345678Z', '12345678Z', 'high', 'DNI 12345678A'],
  ['es_dni', 'NIE X1234567L', 'X1234567L', 'high', 'NIE X1234567A'],
  ['it_fiscal_code', 'Codice fiscale RSSMRA85T10A562S', 'RSSMRA85T10A562S', 'high', 'Codice fiscale RSSMRA85T10A562T'],
  ['nl_bsn', 'BSN 111222333', '111222333', 'high', 'BSN 111222334'],
  ['in_aadhaar', 'Aadhaar 2345 6789 0124', '2345 6789 0124', 'high', 'Aadhaar 2345 6789 0125'],
  ['in_pan', 'PAN AAAPZ1234C', 'AAAPZ1234C', 'high', 'PAN AAAQZ1234C'],
  ['sg_nric', 'NRIC S1234567D', 'S1234567D', 'high', 'NRIC S1234567A'],
  ['passport_mrz', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10', 'high', 'L898902C36UTO7408122F1204159ZE184226B<<<<<11'],
  ['passport_mrz', 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'medium', 'PXUTOERIKSSONXANNAXMARIAXXXXXXXXXXXXXXXXXXX'],
  ['credit_card', 'Card 4111 1111 1111 1111', '4111 1111 1111 1111', 'high', 'Card 4111 1111 1111 1112'],
  ['credit_card', 'Amex 3782-822463-10005', '3782-822463-10005', 'high', 'Ref 1234-5678-9012-3456'],
  ['iban', 'IBAN GB82 WEST 1234 5698 7654 32 BIC', 'GB82 WEST 1234 5698 7654 32', 'high', 'IBAN GB82 WEST 1234 5698 7654 33'],
  ['swift_bic', 'SWIFT/BIC: DEUTDEFF500', 'DEUTDEFF500', 'medium', 'SWIFT: ABCDQQ12'],
  ['us_routing_number', 'Routing number 021000021', '021000021', 'high', 'Routing number 021000022'],
  ['us_bank_account', 'Checking account number 12345678901', '12345678901', 'medium', 'Order 12345678901'],
  ['uk_bank_account', 'Sort code 12-34-56, account 12345678', '12-34-56', 'high', 'Version 12-34-56'],
  ['au_bank_account', 'BSB 062-000 12345678', '062-000 12345678', 'high', 'Part 062-000'],
  ['nz_bank_account', 'Pay to 01-0902-0068389-00', '01-0902-0068389-00', 'high', 'Pay to 05-0902-0068389-00'],
  ['crypto_wallet', 'BTC 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'high', 'BTC 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'],
  ['crypto_wallet', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'high', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'],
  ['crypto_wallet', `ETH wallet 0x${'ab'.repeat(20)}`, `0x${'ab'.repeat(20)}`, 'high', `0x${'ab'.repeat(19)}`],
  ['email', 'Write to jane.doe@example.com today', 'jane.doe@example.com', 'high', 'jane.doe@localhost'],
  ['phone', 'Call +1 202 555 0100', '+1 202 555 0100', 'high', 'Call 1111111'],
  ['phone', 'Mobile (09) 555 0100', '(09) 555 0100', 'high', 'Dated 2026-10-29'],
  ['postal_address', 'Address: 12 Example Street, Springfield IL 62704', '12 Example Street, Springfield IL 62704', 'high', '12 items on the way'],
  ['uk_postcode', 'London SW1A 1AA', 'SW1A 1AA', 'medium', 'London SW1A'],
  ['us_zip', 'Springfield, IL 62704', '62704', 'medium', 'Order 62704'],
  ['ca_postal_code', 'Ottawa ON K1A 0B1', 'K1A 0B1', 'medium', 'Ottawa K1A 0D1'],
  ['au_postcode', 'Sydney NSW 2000', '2000', 'medium', 'In 2000 we'],
  ['nz_postcode', 'Wellington 6011', '6011', 'medium', 'Room 6011'],
  ['uk_nhs', 'NHS number 943 476 5919', '943 476 5919', 'high', 'NHS number 943 476 5918'],
  ['nz_nhi', 'NHI ZZZ0016', 'ZZZ0016', 'high', 'NHI ZZZ0017'],
  ['nz_nhi', 'NHI number ZZZ00AC', 'ZZZ00AC', 'high', 'NHI number ZZZ00AD'],
  ['au_medicare', 'Medicare 2123 45670 1', '2123 45670 1', 'high', 'Medicare 2123 45671 1'],
  ['us_mbi', 'Medicare MBI 1EG4-TE5-MK73', '1EG4-TE5-MK73', 'high', 'MBI 1EG4-TS5-MK73'],
  ['medical_record_number', 'MRN: 00123456', '00123456', 'high', 'Invoice 00123456'],
  ['ip_address', 'Server IP 192.0.2.10', '192.0.2.10', 'high', 'version 1.2.3.4 and 999.1.1.1'],
  ['ipv6_address', 'host 2001:db8::1 up', '2001:db8::1', 'high', 'at 12:30:45 today'],
  ['mac_address', 'MAC 00:1A:2B:3C:4D:5E', '00:1A:2B:3C:4D:5E', 'high', 'MAC 00:1A:2B:3C:4D'],
  ['url', 'See https://example.com/a?b=1.', 'https://example.com/a?b=1', 'medium', 'See example dot com'],
  ['api_key', 'key AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE', 'high', 'AKIA1234'],
  ['api_key', `token ${'ghp_'}${'aB3dE5'.repeat(6)}`, `${'ghp_'}${'aB3dE5'.repeat(6)}`, 'high', 'ghp_short'],
  ['api_key', `api_key = "${'q7Xz9LmP2vR4tY8w'}"`, 'q7Xz9LmP2vR4tY8w', 'medium', 'api_key = "aaaaaaaaaaaaaaaaaaaa"'],
  ['jwt', `Bearer ${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url('{"sub":"test-user"}')}.${'c2lnbmF0dXJlLXRlc3Q'}`, `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url('{"sub":"test-user"}')}.${'c2lnbmF0dXJlLXRlc3Q'}`, 'high', `eyJub3QiOiJqd3QifQ.${b64url('{"sub":"x"}')}.abcdefghijkl`],
  ['private_key', `${'-----BEGIN '}PRIVATE KEY-----\nMIIBtestonly\n-----END PRIVATE KEY-----`, `${'-----BEGIN '}PRIVATE KEY-----\nMIIBtestonly\n-----END PRIVATE KEY-----`, 'high', '-----BEGIN PUBLIC KEY-----'],
  ['password', 'password: Tr0ub4dor&3.', 'Tr0ub4dor&3', 'high', 'reset your password today'],
]

describe('info types: positive and negative fixtures', () => {
  it.each(CASES)('%s: %s', (type, text, value, confidence, negative) => {
    const hit = only(text, type)
    expect(hit, `${type} in "${text}" → ${JSON.stringify(find(text))}`).toBeDefined()
    expect(hit!.value).toBe(value)
    expect(hit!.confidence).toBe(confidence)
    expect(only(negative, type, 'medium'), `${type} must not match "${negative}" → ${JSON.stringify(find(negative))}`).toBeUndefined()
  })

  it('has a fixture for every pattern type', () => {
    const covered = new Set(CASES.map((c) => c[0]).concat('date'))
    expect(PATTERN_INFO_TYPES.map((t) => t.id).filter((id) => !covered.has(id))).toEqual([])
  })
})

describe('context, confidence and dates', () => {
  it('needs the context word for context-required types', () => {
    expect(find('Passport 123456789', ['uk_passport'])).toHaveLength(1)
    expect(find('Number 123456789', ['uk_passport'])).toEqual([])
    expect(only('Account number 12345678', 'us_bank_account')).toBeDefined()
    expect(only('12345678', 'us_bank_account')).toBeUndefined()
  })

  it('raises bare checksum numbers from low to high with context', () => {
    expect(only('9434765919', 'uk_nhs')?.confidence).toBe('low')
    expect(only('NHS 9434765919', 'uk_nhs')?.confidence).toBe('high')
    expect(find('9434765919', ['uk_nhs'], 'medium')).toEqual([])
    expect(only('49091850', 'nz_ird')?.confidence).toBe('low')
  })

  it('tells a date of birth from a plain date', () => {
    const text = 'Patient DOB: 12/03/1985. Seen on 01/02/2026. Born on 3 March 1990, follow-up Mar 12, 2027.'
    expect(find(text, ['date', 'date_of_birth'])).toEqual([
      { type: 'date_of_birth', confidence: 'high', value: '12/03/1985' },
      { type: 'date', confidence: 'medium', value: '01/02/2026' },
      { type: 'date_of_birth', confidence: 'high', value: '3 March 1990' },
      { type: 'date', confidence: 'medium', value: 'Mar 12, 2027' },
    ])
    // Only DOB enabled: plain dates are left alone.
    expect(find(text, ['date_of_birth']).map((f) => f.value)).toEqual(['12/03/1985', '3 March 1990'])
    // A DOB in the future is not plausible.
    expect(find('DOB 05/05/2031', ['date_of_birth'])).toEqual([])
    // Not a real calendar date.
    expect(find('DOB 31/02/1985', ['date', 'date_of_birth'])).toEqual([])
  })

  it('accepts every common date format', () => {
    for (const d of ['1985-03-12', '12/03/1985', '03/12/1985', '12.03.85', '12 March 1985', '12th March 1985', 'Mar 12, 1985', 'March 12 1985', '12-Mar-1985']) {
      expect(find(`Date of birth: ${d}`, ['date_of_birth']).map((f) => f.value), d).toEqual([d])
    }
  })

  it('resolves overlaps: the more specific, more confident type wins', () => {
    // An NHS number also looks like a phone number.
    expect(find('NHS 943 476 5919', ['uk_nhs', 'phone'])).toEqual([{ type: 'uk_nhs', confidence: 'high', value: '943 476 5919' }])
    // An SSN with context beats the phone pattern.
    expect(find('SSN 078-05-1120', ['us_ssn', 'phone'])[0].type).toBe('us_ssn')
    // Without SSN enabled the phone pattern may take it; nothing is found twice.
    const both = find('Card 4111 1111 1111 1111, SSN 078-05-1120', ALL, 'medium')
    expect(both.map((f) => f.type)).toEqual(['credit_card', 'us_ssn'])
  })

  it('applies the minimum confidence', () => {
    expect(find('SWIFT DEUTDEFF', ['swift_bic'], 'high')).toEqual([])
    expect(find('SWIFT DEUTDEFF', ['swift_bic'], 'medium')).toHaveLength(1)
  })

  it('finds AI-supplied values literally', () => {
    const r = detectInfoTypes('Signed by Jane Example and Jane Example.', { types: [], aiValues: [{ type: 'person_name', text: 'Jane Example' }] })
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ type: 'person_name', source: 'ai', confidence: 'medium' })
  })
})

describe('catalogue', () => {
  it('resolves *, @high, categories and regions', () => {
    expect(resolveInfoTypes(['@high'])).not.toContain('us_drivers_license')
    expect(resolveInfoTypes(['@high'])).toContain('us_ssn')
    expect(resolveInfoTypes(['category:financial'])).toContain('nz_bank_account')
    const nz = resolveInfoTypes(['*'], ['NZ'])
    expect(nz).toEqual(expect.arrayContaining(['nz_ird', 'nz_nhi', 'nz_bank_account', 'email', 'date_of_birth']))
    expect(nz).not.toContain('us_ssn')
    expect(resolveInfoTypes(['*'], ['EU'])).toEqual(expect.arrayContaining(['de_tax_id', 'fr_nir', 'iban']))
    expect(resolveInfoTypes(['*'])).not.toContain('person_name')
    expect(INFO_TYPES.every((t) => inRegions(t, []))).toBe(true)
  })

  it('renders the reference table with every type', () => {
    const md = infoTypeReferenceMarkdown()
    for (const t of INFO_TYPES) expect(md).toContain(`\`${t.id}\``)
  })

  it('validators: checksum spot checks', () => {
    expect(v.verhoeff('2363')).toBe(true)
    expect(v.nzBankAccount('08-6523-1954512-001')).toEqual({ format: true, checksum: true })
    expect(v.nzBankAccount('26-2600-0320871-032')).toEqual({ format: true, checksum: true })
    expect(v.nzBankAccount('01-0902-0068388-00')).toEqual({ format: true, checksum: false })
    expect(v.cardIssuer('5555 5555 5555 4444')).toBe('mastercard')
    expect(v.cardIssuer('6011 1111 1111 1117')).toBe('discover')
  })
})

describe('safety and speed', () => {
  it('every built-in pattern passes the ReDoS guard', () => {
    for (const p of DETECTOR_PATTERNS) expect(findNestedQuantifier(p.source), `${p.type}: ${p.source}`).toBeNull()
  })

  it('scans 5 MB of records in bounded time', () => {
    const para = 'Customer 2024-05-01: Jane Example (DOB 12/03/1985) SSN 078-05-1120, phone +1 202 555 0100, card 4111 1111 1111 1111, 12 Example Street, Springfield IL 62704. Notes 42, ref ABCD1234XYZ.\n'
    const text = para.repeat(Math.ceil(5_000_000 / para.length))
    const t0 = performance.now()
    const hits = detectInfoTypes(text, { types: ALL, minConfidence: 'low', now: NOW })
    const ms = performance.now() - t0
    expect(hits.length).toBeGreaterThan(100_000)
    expect(ms).toBeLessThan(15_000)
  }, 30_000)

  it('stays linear on adversarial input', () => {
    const blobs = ['a'.repeat(1_000_000), '1 '.repeat(500_000), '1-'.repeat(500_000), 'a.'.repeat(500_000) + '@', '<'.repeat(500_000), 'A1'.repeat(500_000), ':'.repeat(500_000), '-----BEGIN RSA PRIVATE KEY-----' + 'x'.repeat(500_000)]
    for (const blob of blobs) {
      const t0 = performance.now()
      detectInfoTypes(blob, { types: ALL, minConfidence: 'low', now: NOW })
      expect(performance.now() - t0, blob.slice(0, 12)).toBeLessThan(5_000)
    }
  }, 60_000)
})
