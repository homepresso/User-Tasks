/**
 * ut_validate — Validation & formatting: check digits and formats (IBAN, BIC,
 * cards, email, phone, postcodes, national ids) with normalised values, and
 * locale-aware number / currency / phone formatting and number parsing.
 * Pure computation; Intl comes from the host (ctx.intl).
 */

import { defineAction, type ActionContext } from '@usertasks/action'
import {
  aadhaarValid, auTfnValid, bicValid, caSinValid, cardIssuer, deTaxIdValid, digitsOf, esDniValid, frNirValid, ibanValid,
  itFiscalCodeValid, luhn, nlBsnValid, nzIrdValid, nzNhiValid, sgNricValid, ukNinoValid, usSsnValid,
} from '@/lib/documents/pii/validators'
import { bool, choice, isPlainObject, list, num, optNum, str, type Inputs } from '../../shared/inputs'
import { CALLING_CODES, IBAN_LENGTHS, NO_TRUNK_PREFIX, POSTCODES, countriesForCode, splitCallingCode } from './tables'

interface Result {
  valid: boolean
  normalized: string
  reason: string
  details: Record<string, unknown>
}

const ok = (normalized: string, details: Record<string, unknown> = {}): Result => ({ valid: true, normalized, reason: '', details })
const bad = (reason: string, normalized = '', details: Record<string, unknown> = {}): Result => ({ valid: false, normalized, reason, details })

const TYPES = ['iban', 'bic', 'card', 'email', 'phone', 'postcode', 'national_id'] as const
type ValidationType = (typeof TYPES)[number]

const ID_TYPES = ['us_ssn', 'uk_nino', 'ca_sin', 'au_tfn', 'nz_ird', 'nz_nhi', 'de_tax_id', 'fr_nir', 'es_dni', 'it_fiscal_code', 'nl_bsn', 'in_aadhaar', 'sg_nric'] as const
type IdType = (typeof ID_TYPES)[number]

// ── Validators ──────────────────────────────────────────────────────────────

function validateIban(raw: string): Result {
  const s = raw.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return bad('An IBAN starts with a 2-letter country code and 2 check digits, then letters and digits', s)
  const country = s.slice(0, 2)
  const expected = IBAN_LENGTHS[country]
  if (!expected) return bad(`${country} does not use IBANs (or is not a known IBAN country)`, s)
  if (s.length !== expected) return bad(`A ${country} IBAN has ${expected} characters, this has ${s.length}`, s)
  if (!ibanValid(s)) return bad('The check digits do not match (mod 97)', s)
  return ok(s, { country, check_digits: s.slice(2, 4), bban: s.slice(4), formatted: s.replace(/(.{4})(?=.)/g, '$1 ') })
}

function validateBic(raw: string): Result {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!bicValid(s)) return bad('A BIC is 8 or 11 characters: 4-letter bank code, 2-letter country, 2-character location, optional 3-character branch', s)
  return ok(s, { bank_code: s.slice(0, 4), country: s.slice(4, 6), location: s.slice(6, 8), branch: s.length === 11 ? s.slice(8) : 'XXX', primary_office: s.length === 8 || s.endsWith('XXX'), test_bic: s[7] === '0' })
}

function validateCard(raw: string): Result {
  if (/[^\d\s-]/.test(raw.trim())) return bad('A card number has only digits, spaces and dashes')
  const d = digitsOf(raw)
  if (d.length < 12 || d.length > 19) return bad(`A card number has 12–19 digits, this has ${d.length}`, d)
  if (/^(\d)\1+$/.test(d)) return bad('All digits are the same', d)
  if (!luhn(d)) return bad('The check digit is wrong (Luhn)', d)
  return ok(d, { issuer: cardIssuer(d) ?? 'unknown', length: d.length, last4: d.slice(-4), masked: `${'*'.repeat(d.length - 4)}${d.slice(-4)}` })
}

function validateEmail(raw: string): Result {
  const s = raw.trim()
  const at = s.lastIndexOf('@')
  if (at < 1 || at === s.length - 1) return bad('An email address needs a name, @ and a domain', s)
  const local = s.slice(0, at)
  const domain = s.slice(at + 1).toLowerCase()
  const normalized = `${local}@${domain}`
  if (s.length > 254) return bad('An email address has at most 254 characters', normalized)
  if (local.length > 64) return bad('The part before @ has at most 64 characters', normalized)
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return bad('The part before @ has a character that is not allowed, or a misplaced dot', normalized)
  const labels = domain.split('.')
  if (labels.length < 2) return bad('The domain needs a dot (example.com)', normalized)
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !/^xn--[a-z0-9-]+$/.test(label)) return bad(`The domain part "${label.slice(0, 30)}" is not valid`, normalized)
  }
  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return bad('The top-level domain must be letters (e.g. .com, .nz)', normalized)
  return ok(normalized, { local, domain, tld })
}

function callingCodeOf(country: string): string {
  const c = country.trim().replace(/^\+/, '').toUpperCase()
  if (!c) return ''
  if (/^\d{1,3}$/.test(c)) return c
  const code = CALLING_CODES[c]
  if (!code) throw new Error(`country "${country}" is not a known ISO country code (use e.g. NZ, or a calling code such as 64)`)
  return code
}

interface Phone { code: string; national: string; e164: string }

function parsePhone(raw: string, country: string): Phone | Result {
  const s = raw.trim()
  if (!s) return bad('No phone number')
  if (/[^\d\s()+.\-/]/.test(s.replace(/\s*(?:ext\.?|x)\s*\d+$/i, ''))) return bad('A phone number has only digits, spaces, + ( ) - . and /')
  const main = s.replace(/\s*(?:ext\.?|x)\s*\d+$/i, '')
  let digits = digitsOf(main)
  let code = ''
  let national = ''
  if (main.startsWith('+') || main.startsWith('00')) {
    if (main.startsWith('00')) digits = digits.slice(2)
    const split = splitCallingCode(digits)
    if (split) ({ code, national } = split)
    else {
      code = ''
      national = digits
    }
  } else {
    code = callingCodeOf(country)
    if (!code) return bad('Without + and a country code, set the default country (e.g. NZ or 64)', digits)
    national = digits
    if (!NO_TRUNK_PREFIX.has(code) && national.startsWith('0')) national = national.slice(1)
    if (code === '1' && national.length === 11 && national.startsWith('1')) national = national.slice(1)
  }
  const all = code + national
  if (all.length < 8 || all.length > 15) return bad(`An international number has 8–15 digits, this has ${all.length}`, `+${all}`)
  if (code === '1' && national.length !== 10) return bad('A North American number has 10 digits after +1', `+${all}`)
  return { code, national, e164: `+${all}` }
}

function validatePhone(raw: string, country: string): Result {
  const p = parsePhone(raw, country)
  if ('valid' in p) return p
  return ok(p.e164, { country_code: p.code, national_number: p.national, countries: countriesForCode(p.code), international: formatPhoneParts(p, 'international'), national: formatPhoneParts(p, 'national') })
}

function groupNational(n: string): string[] {
  if (n.length <= 4) return [n]
  if (n.length <= 7) return [n.slice(0, n.length - 4), n.slice(-4)]
  const head = n.length - 7
  return [n.slice(0, head), n.slice(head, head + 3), n.slice(-4)]
}

function formatPhoneParts(p: Phone, style: 'e164' | 'international' | 'national'): string {
  if (style === 'e164') return p.e164
  if (p.code === '1' && p.national.length === 10) {
    const [a, b, c] = [p.national.slice(0, 3), p.national.slice(3, 6), p.national.slice(6)]
    return style === 'national' ? `(${a}) ${b}-${c}` : `+1 ${a} ${b} ${c}`
  }
  const groups = groupNational(p.national)
  if (style === 'international') return [`+${p.code}`, ...groups].join(' ').trim()
  const trunk = p.code && !NO_TRUNK_PREFIX.has(p.code) ? '0' : ''
  return [trunk + groups[0], ...groups.slice(1)].join(' ')
}

function validatePostcode(raw: string, country: string): Result {
  const c = country.trim().toUpperCase()
  if (!c) return bad('Set the country for postcode validation (e.g. GB, US, NZ)')
  const rule = POSTCODES[c === 'UK' ? 'GB' : c]
  if (!rule) throw new Error(`Postcodes for "${country}" are not supported (supported: ${Object.keys(POSTCODES).join(', ')})`)
  const compact = raw.toUpperCase().replace(/[\s-]/g, '')
  if (!rule.re.test(compact)) return bad(`Not a valid ${c} postcode (for example ${rule.example})`, compact)
  return ok(rule.format ? rule.format(compact) : compact, { country: c === 'UK' ? 'GB' : c })
}

const ID_RULES: Record<IdType, { check: (s: string) => boolean; normalize: (s: string) => string; format?: (s: string) => string; name: string }> = {
  us_ssn: { check: usSsnValid, normalize: digitsOf, format: (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`, name: 'US Social Security number' },
  uk_nino: { check: ukNinoValid, normalize: (s) => s.replace(/\s/g, '').toUpperCase(), format: (s) => s.replace(/^(..)(..)(..)(..)(.)$/, '$1 $2 $3 $4 $5'), name: 'UK National Insurance number' },
  ca_sin: { check: caSinValid, normalize: digitsOf, format: (d) => `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, name: 'Canadian Social Insurance Number' },
  au_tfn: { check: auTfnValid, normalize: digitsOf, format: (d) => d.replace(/(\d{3})(?=\d)/g, '$1 '), name: 'Australian Tax File Number' },
  nz_ird: { check: nzIrdValid, normalize: (s) => digitsOf(s).padStart(9, '0'), format: (d) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, name: 'New Zealand IRD number' },
  nz_nhi: { check: nzNhiValid, normalize: (s) => s.replace(/\s/g, '').toUpperCase(), name: 'New Zealand NHI number' },
  de_tax_id: { check: deTaxIdValid, normalize: digitsOf, format: (d) => `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`, name: 'German tax ID (Steuer-ID)' },
  fr_nir: { check: frNirValid, normalize: (s) => s.replace(/[\s.-]/g, '').toUpperCase(), format: (s) => s.replace(/^(.)(..)(..)(..)(...)(...)(..)$/, '$1 $2 $3 $4 $5 $6 $7'), name: 'French social security number (NIR)' },
  es_dni: { check: esDniValid, normalize: (s) => s.replace(/[\s-]/g, '').toUpperCase(), name: 'Spanish DNI / NIE' },
  it_fiscal_code: { check: itFiscalCodeValid, normalize: (s) => s.replace(/\s/g, '').toUpperCase(), name: 'Italian fiscal code (codice fiscale)' },
  nl_bsn: { check: nlBsnValid, normalize: (s) => digitsOf(s).padStart(9, '0'), name: 'Dutch citizen service number (BSN)' },
  in_aadhaar: { check: aadhaarValid, normalize: digitsOf, format: (d) => `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`, name: 'Indian Aadhaar number' },
  sg_nric: { check: sgNricValid, normalize: (s) => s.replace(/\s/g, '').toUpperCase(), name: 'Singapore NRIC / FIN' },
}

function validateNationalId(raw: string, idType: string): Result {
  const type = idType.trim().toLowerCase() as IdType
  if (!type) return bad('Set id_type for national_id (e.g. us_ssn, uk_nino, nz_ird)')
  const rule = ID_RULES[type]
  if (!rule) throw new Error(`id_type must be one of ${ID_TYPES.join(', ')}`)
  const normalized = rule.normalize(raw)
  if (!rule.check(normalized)) return bad(`Not a valid ${rule.name} (format or check digit)`, normalized, { id_type: type })
  return ok(normalized, { id_type: type, name: rule.name, formatted: rule.format ? rule.format(normalized) : normalized })
}

function validateOne(type: ValidationType, value: string, opts: { country: string; id_type: string }): Result {
  if (!value.trim()) return bad('No value')
  if (value.length > 500) return bad('The value is longer than 500 characters')
  switch (type) {
    case 'iban': return validateIban(value)
    case 'bic': return validateBic(value)
    case 'card': return validateCard(value)
    case 'email': return validateEmail(value)
    case 'phone': return validatePhone(value, opts.country)
    case 'postcode': return validatePostcode(value, opts.country)
    case 'national_id': return validateNationalId(value, opts.id_type)
  }
}

// ── Numbers ─────────────────────────────────────────────────────────────────

function locale(inputs: Inputs): string {
  const l = str(inputs, 'locale', { default: 'en-US' })
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(l)) throw new Error(`locale "${l.slice(0, 20)}" is not a BCP 47 tag such as en-US or de-DE`)
  return l
}

function currencyCode(inputs: Inputs, required: boolean): string {
  const c = str(inputs, 'currency').toUpperCase()
  if (!c) {
    if (required) throw new Error('currency is required (an ISO 4217 code such as USD, EUR, NZD)')
    return ''
  }
  if (!/^[A-Z]{3}$/.test(c)) throw new Error(`currency "${c.slice(0, 10)}" must be a 3-letter ISO 4217 code such as USD`)
  return c
}

function fractionOptions(inputs: Inputs): Record<string, number> {
  const min = optNum(inputs, 'minimum_fraction_digits', { integer: true, min: 0, max: 20 })
  const max = optNum(inputs, 'maximum_fraction_digits', { integer: true, min: 0, max: 20 })
  if (min !== null && max !== null && min > max) throw new Error('minimum_fraction_digits cannot be more than maximum_fraction_digits')
  return { ...(min !== null ? { minimumFractionDigits: min } : {}), ...(max !== null ? { maximumFractionDigits: max } : {}) }
}

function numberSymbols(ctx: ActionContext, loc: string): { group: string; decimal: string; digits: string[]; minus: string } {
  const sample = ctx.intl.formatNumber(-12345.6, loc, { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const digits = ctx.intl.formatNumber(1234567890, loc, { useGrouping: false })
  // digits "1234567890" in the locale's numbering system → 0..9.
  const ds = Array.from(digits)
  const map = [ds[9], ds[0], ds[1], ds[2], ds[3], ds[4], ds[5], ds[6], ds[7], ds[8]]
  const chars = Array.from(sample)
  const isDigit = (c: string) => map.includes(c)
  const firstDigit = chars.findIndex(isDigit)
  const minus = chars.slice(0, firstDigit).join('').trim() || '-'
  const body = chars.slice(firstDigit)
  // body: 1 2 G 3 4 5 D 6 (group may be several chars).
  const lastDigitIdx = body.length - 1
  const decimal = body[lastDigitIdx - 1]
  const groupChars = body.slice(2, body.length - 5).join('')
  return { group: groupChars, decimal, digits: map, minus }
}

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    validate(inputs: Inputs) {
      const type = choice(inputs, 'type', TYPES, 'email')
      const value = str(inputs, 'value', { trim: false })
      return validateOne(type, value, { country: str(inputs, 'country'), id_type: str(inputs, 'id_type') })
    },

    validate_many(inputs: Inputs) {
      const items = list(inputs, 'items', { required: true })
      if (items.length > 10_000) throw new Error('items: at most 10,000')
      const defaultCountry = str(inputs, 'country')
      const results = items.map((item, i) => {
        if (!isPlainObject(item)) throw new Error(`items[${i}] must be an object like { "type": "email", "value": "a@b.co" }`)
        const type = String(item.type ?? '').trim().toLowerCase()
        if (!(TYPES as readonly string[]).includes(type)) throw new Error(`items[${i}].type must be one of ${TYPES.join(', ')}`)
        const value = item.value === null || item.value === undefined ? '' : String(item.value)
        const r = validateOne(type as ValidationType, value, { country: String(item.country ?? defaultCountry), id_type: String(item.id_type ?? '') })
        return { ...(item.name !== undefined ? { name: String(item.name) } : {}), type, value, valid: r.valid, normalized: r.normalized, reason: r.reason }
      })
      const validCount = results.filter((r) => r.valid).length
      return { results, all_valid: validCount === results.length, valid_count: validCount, invalid_count: results.length - validCount }
    },

    format_number(inputs: Inputs, ctx: ActionContext) {
      const value = num(inputs, 'value')
      const loc = locale(inputs)
      const style = choice(inputs, 'style', ['decimal', 'percent', 'currency'] as const, 'decimal')
      const currency = currencyCode(inputs, style === 'currency')
      const notation = choice(inputs, 'notation', ['standard', 'compact', 'scientific', 'engineering'] as const, 'standard')
      const options: Record<string, unknown> = {
        style, notation, useGrouping: bool(inputs, 'use_grouping', true), ...fractionOptions(inputs),
        ...(style === 'currency' ? { currency } : {}),
      }
      return { formatted: ctx.intl.formatNumber(value, loc, options) }
    },

    format_currency(inputs: Inputs, ctx: ActionContext) {
      const value = num(inputs, 'value')
      const currency = currencyCode(inputs, true)
      const loc = locale(inputs)
      const display = choice(inputs, 'display', ['symbol', 'narrowSymbol', 'code', 'name'] as const, 'symbol')
      const accounting = bool(inputs, 'accounting', false)
      const formatted = ctx.intl.formatNumber(value, loc, { style: 'currency', currency, currencyDisplay: display, ...(accounting ? { currencySign: 'accounting' } : {}), ...fractionOptions(inputs) })
      return { formatted, currency }
    },

    parse_number(inputs: Inputs, ctx: ActionContext) {
      const raw = str(inputs, 'text', { required: true, max: 200 })
      const loc = locale(inputs)
      const sym = numberSymbols(ctx, loc)
      let s = raw
      // Locale digits → ASCII.
      sym.digits.forEach((d, i) => { if (d !== String(i)) s = s.split(d).join(String(i)) })
      let negative = false
      if (/^\(.*\)$/.test(s.trim())) { negative = true; s = s.trim().slice(1, -1) }
      const percent = /[%\u066a]/.test(s)
      s = s.replace(/[%\u066a]/g, '')
      if (/^[\s\p{Sc}\p{L}.]*[-\u2212\u2012\u2013]/u.test(s) || /[-\u2212]\s*[\p{Sc}\p{L}]*\s*$/u.test(s) || (sym.minus !== '-' && s.includes(sym.minus))) negative = true
      s = s.replace(/^([\s\p{Sc}\p{L}.]*)[-\u2212\u2012\u2013+]/u, '$1').replace(/[-\u2212](\s*[\p{Sc}\p{L}]*\s*)$/u, '$1')
      if (sym.minus !== '-') s = s.split(sym.minus).join('')
      // Strip currency symbols, a currency code or unit before / after the number, and spaces (incl. no-break spaces).
      s = s.replace(/\p{Sc}/gu, '').trim().replace(/^[\p{L}.]+\s*/u, '').replace(/\s*\p{L}+\.?$/u, '').replace(/[\s\u00a0\u202f]/g, '')
      const group = sym.group.replace(/[\s\u00a0\u202f]/g, '')
      // A group separator after the decimal separator means another locale's format (1.234,56 read as en-US).
      const decimalAt = s.indexOf(sym.decimal)
      if (group && decimalAt >= 0 && s.indexOf(group, decimalAt + 1) > decimalAt) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group }
      if (group && s.includes(group)) {
        // Groups must be well formed: the last has 3 digits, the others 2 or 3 (Indian grouping 12,34,567).
        const intPart = decimalAt >= 0 ? s.slice(0, decimalAt) : s
        const parts = intPart.split(group)
        const wellFormed = /^\d{1,3}$/.test(parts[0]) && parts.slice(1, -1).every((p) => /^\d{2,3}$/.test(p)) && /^\d{3}$/.test(parts[parts.length - 1])
        if (!wellFormed) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group }
        s = s.split(group).join('')
      }
      s = s.replace(/['’]/g, '')
      if (sym.decimal !== '.') {
        if (s.includes('.') && group !== '.') return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group }
        s = s.split(sym.decimal).join('.')
      }
      const ok = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)
      if (!ok) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group }
      let value = Number(s)
      if (percent) value = Number((value / 100).toPrecision(15))
      if (negative) value = -value
      return { value: value === 0 ? 0 : value, valid: true, decimal_separator: sym.decimal, group_separator: sym.group }
    },

    format_phone(inputs: Inputs) {
      const value = str(inputs, 'value', { required: true, max: 100 })
      const country = str(inputs, 'country')
      const style = choice(inputs, 'format', ['e164', 'international', 'national'] as const, 'international')
      const p = parsePhone(value, country)
      if ('valid' in p) return { formatted: '', e164: '', valid: false, reason: p.reason }
      return { formatted: formatPhoneParts(p, style), e164: p.e164, valid: true, reason: '' }
    },
  },
})
