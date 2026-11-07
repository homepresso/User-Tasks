/**
 * Information-type detection: finds the types in ./catalog in a piece of
 * text (a paragraph, a cell, a line or a whole text file) with a pattern,
 * a validator (check digits, ranges, structure), context words nearby and
 * a confidence. Every built-in pattern is bounded (no unbounded repetition
 * inside a repeated group, and bounded character runs) so the scan stays
 * linear; __tests__/pii-detect.test.ts runs each through the ReDoS guard.
 *
 * Overlaps are resolved once per text: the most confident match wins, then
 * the most specific type (a checksum-backed ID before a phone number), then
 * the longer match.
 */

import { isIPv6 } from 'node:net'
import { CONFIDENCE_RANK, INFO_TYPE_BY_ID, type Confidence } from './catalog'
import * as v from './validators'

export interface DetectOptions {
  /** Info type ids to look for (already resolved: no `*` / `@high`). */
  types: readonly string[]
  /** Drop matches below this confidence (default medium). */
  minConfidence?: Confidence
  /** Values found by an AI model, matched literally in the text. */
  aiValues?: ReadonlyArray<{ type: string; text: string }>
  /** For tests: "today" for the date-of-birth plausibility check. */
  now?: Date
}

export interface Detection {
  type: string
  start: number
  end: number
  confidence: Confidence
  /** A context word was found near the match. */
  context: boolean
  source: 'pattern' | 'ai'
}

type Level = Confidence | null
interface Ctx { text: string; start: number; end: number; before: string; after: string; now: Date; enabled: ReadonlySet<string> }

interface Detector {
  type: string
  re: RegExp
  /** The value is this capture group (always the trailing part of the match). */
  group?: number
  validate?: (value: string, c: Ctx) => boolean
  /** Confidence without context (null: the context is required). */
  base: Level | ((value: string, c: Ctx) => Level)
  /** Context words (tested on the text just before and after). */
  context?: RegExp
  /** Custom context test (replaces `context`). */
  contextFn?: (c: Ctx) => boolean
  /** Confidence with context (default high). */
  boosted?: Level | ((value: string, c: Ctx) => Level)
  /** Re-classify a match (dates: date of birth or date). */
  classify?: (value: string, c: Ctx) => { type: string; confidence: Confidence; context: boolean } | null
  /** Shrink a match that fails validation (IBAN followed by other capitals). */
  refine?: (value: string) => string | null
  rank: number
}

/* ── Building blocks ── */

const L = String.raw`(?<![\w-])`
const R = String.raw`(?![\w]|-\w)`
const re = (src: string, flags = 'g') => new RegExp(src, flags)
const words = (src: string) => new RegExp(src, 'i')
const BEFORE = 48
const AFTER = 24
const grouped = (s: string) => /[\s.-]/.test(s.trim())

export const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR'
const NZ_TOWNS = 'Auckland|Wellington|Christchurch|Hamilton|Tauranga|Dunedin|Palmerston North|Napier|Nelson|Rotorua|New Plymouth|Whang[aā]rei|Invercargill|Queenstown|Lower Hutt|Upper Hutt|Porirua|Hastings|Gisborne|Timaru|Whanganui|Blenheim|Masterton|Taupō|Taupo|Wānaka|Wanaka|Ashburton|Levin|Kapiti|Paraparaumu'
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\\.?'
const DATE_SRC = String.raw`(?<![\w.-])(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})|\d{1,2}(?:st|nd|rd|th)?[\s-]{1,3}${MONTH},?[\s-]{1,3}\d{4}|${MONTH}\s{1,3}\d{1,2}(?:st|nd|rd|th)?,?\s{1,3}\d{4})(?![\w]|[-/.]\d)`
const DOB_WORDS = /(?:\bd\.?o\.?b\b\.?|\bdate\s+of\s+birth\b|\bbirth\s*date\b|\bborn(?:\s+on)?\b|\bbirthday\b|\bgeboren(?:\s+am)?\b|\bgeburtsdatum\b|\bn[ée]e?\s+le\b|\bdate\s+de\s+naissance\b|\bfecha\s+de\s+nacimiento\b|\bdata\s+di\s+nascita\b|\bgeboortedatum\b)/gi

/**
 * The date-of-birth context: a DOB word shortly before the date on the
 * same line (at most 16 characters before it, no other number in between,
 * so the next date after a DOB is not taken for it).
 */
function dobContext(c: Ctx): boolean {
  const before = c.before.split(/[\n\r\t;|]/).pop() ?? ''
  let last: RegExpExecArray | null = null
  DOB_WORDS.lastIndex = 0
  for (let m = DOB_WORDS.exec(before); m; m = DOB_WORDS.exec(before)) last = m
  if (last) { const gap = before.slice(last.index + last[0].length); return gap.length <= 16 && !/\d/.test(gap) }
  // "12/03/1985 (date of birth)"
  return /^\s{0,3}[([]?\s{0,2}(?:d\.?o\.?b\b|date\s+of\s+birth|born)/i.test(c.after)
}

const endsWith = (pattern: string, flags = '') => { const r = new RegExp(`(?:${pattern})\\s{0,3}$`, flags); return (c: Ctx) => r.test(c.before) }

/* ── Detectors ── */

const DETECTORS: Detector[] = [
  /* Identity */
  { type: 'us_ssn', re: re(String.raw`${L}\d{3}([- ])\d{2}\1\d{4}${R}`), validate: v.usSsnValid, base: 'medium', context: words(String.raw`\bssn\b|social\s+security|\bss\s?(?:#|no\b|number)`), rank: 70 },
  { type: 'us_ssn', re: re(String.raw`${L}\d{9}${R}`), validate: v.usSsnValid, base: null, context: words(String.raw`\bssn\b|social\s+security|\bss\s?(?:#|no\b|number)`), rank: 60 },
  { type: 'us_itin', re: re(String.raw`${L}9\d{2}([- ])\d{2}\1\d{4}${R}`), validate: v.usItinValid, base: 'medium', context: words(String.raw`\bitin\b|taxpayer\s+identification`), rank: 72 },
  { type: 'us_itin', re: re(String.raw`${L}9\d{8}${R}`), validate: v.usItinValid, base: null, context: words(String.raw`\bitin\b|taxpayer\s+identification`), rank: 62 },
  { type: 'us_passport', re: re(String.raw`${L}(?:[A-Z]\d{8}|\d{9})${R}`), base: null, context: words('passport'), boosted: (_s, c) => (/\b(?:us|u\.s\.|united\s+states|american)\b/i.test(c.before) ? 'high' : 'medium'), rank: 45 },
  { type: 'uk_passport', re: re(String.raw`${L}(?:[A-Z]{2}\d{7}|\d{9})${R}`), base: null, context: words('passport'), boosted: (_s, c) => (/\b(?:uk|british|hm|united\s+kingdom)\b/i.test(c.before) ? 'high' : 'medium'), rank: 44 },
  { type: 'us_drivers_license', re: re(String.raw`${L}(?:[A-Z]{1,2}\d{5,14}|\d{5,14}|[A-Z]\d{3}(?:[- ]\d{3,4}){2,3})${R}`), base: null, context: words(String.raw`driver'?s?\s+licen[cs]e|\bdln?\b|licen[cs]e\s+(?:no|number|#)`), boosted: 'medium', rank: 30 },
  { type: 'nz_drivers_licence', re: re(String.raw`${L}[A-Z]{2}\d{6}${R}`), base: null, context: words(String.raw`driver'?s?\s+licen[cs]e|licen[cs]e\s+(?:no|number|#)|\bdl\b`), rank: 46 },
  {
    type: 'date', re: re(DATE_SRC, 'gi'), base: 'medium', rank: 12,
    validate: (s) => v.parseDateCandidates(s).length > 0,
    classify: (s, c) => {
      if (c.enabled.has('date_of_birth') && dobContext(c) && v.birthDatePlausible(s, c.now)) return { type: 'date_of_birth', confidence: 'high', context: true }
      return c.enabled.has('date') ? { type: 'date', confidence: 'medium', context: false } : null
    },
  },
  { type: 'uk_nino', re: re(String.raw`${L}[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]${R}`), validate: v.ukNinoValid, base: 'medium', context: words(String.raw`national\s+insurance|\bni\s*(?:no\b|number|#)|\bnino\b`), rank: 75 },
  { type: 'ca_sin', re: re(String.raw`${L}\d{3}([- ])\d{3}\1\d{3}${R}`), validate: v.caSinValid, base: 'medium', context: words(String.raw`\bsin\b|social\s+insurance`), rank: 64 },
  { type: 'ca_sin', re: re(String.raw`${L}\d{9}${R}`), validate: v.caSinValid, base: 'low', context: words(String.raw`\bsin\b|social\s+insurance`), rank: 54 },
  { type: 'au_tfn', re: re(String.raw`${L}\d{3} \d{3} \d{2,3}${R}`), validate: v.auTfnValid, base: 'medium', context: words(String.raw`\btfn\b|tax\s+file`), rank: 65 },
  { type: 'au_tfn', re: re(String.raw`${L}\d{8,9}${R}`), validate: v.auTfnValid, base: 'low', context: words(String.raw`\btfn\b|tax\s+file`), rank: 55 },
  { type: 'nz_ird', re: re(String.raw`${L}\d{2,3}([- ])\d{3}\1\d{3}${R}`), validate: v.nzIrdValid, base: 'medium', context: words(String.raw`\bird\b|inland\s+revenue|tax\s+(?:number|no\b)|\bgst\b`), rank: 66 },
  { type: 'nz_ird', re: re(String.raw`${L}\d{8,9}${R}`), validate: v.nzIrdValid, base: 'low', context: words(String.raw`\bird\b|inland\s+revenue|tax\s+(?:number|no\b)|\bgst\b`), rank: 56 },
  { type: 'de_tax_id', re: re(String.raw`${L}\d{2} ?\d{3} ?\d{3} ?\d{3}${R}`), validate: v.deTaxIdValid, base: 'low', context: words(String.raw`steuer-?id|steueridentifikationsnummer|\bidnr\b|identifikationsnummer|tax\s+id`), rank: 63 },
  { type: 'fr_nir', re: re(String.raw`${L}[12] ?\d{2} ?\d{2} ?(?:\d{2}|2[AB]) ?\d{3} ?\d{3} ?\d{2}${R}`), validate: v.frNirValid, base: 'medium', context: words(String.raw`s[ée]curit[ée]\s+sociale|\bnir\b|\binsee\b|num[ée]ro\s+de\s+s[ée]cu`), rank: 78 },
  { type: 'es_dni', re: re(String.raw`${L}(?:\d{8}|[XYZ]-?\d{7})-?[A-Z]${R}`), validate: v.esDniValid, base: 'medium', context: words(String.raw`\bdni\b|\bnie\b|documento\s+nacional`), rank: 74 },
  { type: 'it_fiscal_code', re: re(String.raw`${L}[A-Z]{6}[\dLMNP-V]{2}[A-EHLMPR-T][\dLMNP-V]{2}[A-Z][\dLMNP-V]{3}[A-Z]${R}`), validate: v.itFiscalCodeValid, base: 'high', context: words(String.raw`codice\s+fiscale|\bcf\b`), rank: 85 },
  { type: 'nl_bsn', re: re(String.raw`${L}\d{4}\.?\d{2}\.?\d{3}${R}`), validate: v.nlBsnValid, base: 'low', context: words(String.raw`\bbsn\b|burgerservicenummer|sofi-?nummer`), rank: 53 },
  { type: 'in_aadhaar', re: re(String.raw`${L}[2-9]\d{3}([ -])\d{4}\1\d{4}${R}`), validate: v.aadhaarValid, base: 'medium', context: words(String.raw`aadhaa?r|\buidai\b|\buid\b`), rank: 68 },
  { type: 'in_aadhaar', re: re(String.raw`${L}[2-9]\d{11}${R}`), validate: v.aadhaarValid, base: 'low', context: words(String.raw`aadhaa?r|\buidai\b|\buid\b`), rank: 58 },
  { type: 'in_pan', re: re(String.raw`${L}[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]${R}`), base: 'medium', context: words(String.raw`\bpan\b|permanent\s+account|income\s+tax`), rank: 73 },
  { type: 'sg_nric', re: re(String.raw`${L}[STFGM]\d{7}[A-Z]${R}`), validate: v.sgNricValid, base: 'medium', context: words(String.raw`\bnric\b|\bfin\b|\bic\s+(?:no\b|number)`), rank: 76 },
  { type: 'passport_mrz', re: re(String.raw`(?<![A-Z0-9<])[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}\d[MFX<]\d{6}\d[A-Z0-9<]{14}[0-9<]\d(?![A-Z0-9<])`), validate: v.mrzTd3Line2Valid, base: 'high', rank: 95 },
  { type: 'passport_mrz', re: re(String.raw`(?<![A-Z0-9<])P[A-Z<][A-Z]{3}[A-Z<]{39}(?![A-Z0-9<])`), validate: (s) => s.includes('<<'), base: 'medium', rank: 94 },
  { type: 'passport_mrz', re: re(String.raw`(?<![A-Z0-9<])[AIC][A-Z<][A-Z<]{3}[A-Z0-9<]{9}[0-9<][A-Z0-9<]{15}(?![A-Z0-9<])`), validate: v.mrzTd1Line1Valid, base: 'high', rank: 93 },
  { type: 'passport_mrz', re: re(String.raw`(?<![A-Z0-9<])\d{6}\d[MFX<]\d{6}\d[A-Z<]{3}[A-Z0-9<]{11}\d(?![A-Z0-9<])`), validate: v.mrzTd1Line2Valid, base: 'high', rank: 93 },

  /* Financial */
  {
    type: 'credit_card', re: re(String.raw`(?<![\d-])(?:\d[ -]?){11,18}\d(?!\d)`), rank: 80,
    validate: (s) => v.luhn(v.digitsOf(s)) && v.digitsOf(s).length >= 12,
    base: (s) => (v.cardIssuer(s) ? 'high' : 'low'),
    context: words(String.raw`\bcard\b|credit|debit|\bvisa\b|master\s?card|\bamex\b|\bpan\b`),
    boosted: (s) => (v.cardIssuer(s) ? 'high' : 'medium'),
  },
  {
    type: 'iban', re: re(String.raw`\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b`), validate: v.ibanValid, base: 'high', rank: 90,
    refine: (s) => { let t = s; while (t.includes(' ')) { t = t.slice(0, t.lastIndexOf(' ')); if (v.ibanValid(t)) return t } return null },
  },
  { type: 'swift_bic', re: re(String.raw`\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b`), validate: v.bicValid, base: 'low', context: words(String.raw`\bswift\b|\bbic\b`), boosted: 'medium', rank: 40 },
  { type: 'us_routing_number', re: re(String.raw`${L}\d{9}${R}`), validate: v.abaValid, base: 'low', context: words(String.raw`routing|\baba\b|\brtn\b|transit`), rank: 59 },
  { type: 'us_bank_account', re: re(String.raw`${L}\d{8,17}${R}`), base: null, context: words(String.raw`account\s*(?:number|no\b|#)|\bacct\b|checking|savings`), boosted: 'medium', rank: 25 },
  { type: 'uk_bank_account', re: re(String.raw`${L}\d{2}-\d{2}-\d{2}[ ,;/]{1,3}\d{8}${R}`), base: 'medium', context: words(String.raw`sort\s*code|account`), rank: 50 },
  { type: 'uk_bank_account', re: re(String.raw`${L}\d{2}-\d{2}-\d{2}${R}`), base: null, context: words(String.raw`sort\s*code`), rank: 48 },
  { type: 'au_bank_account', re: re(String.raw`${L}\d{3}-\d{3}[ ,;/]{1,3}\d{6,10}${R}`), base: 'medium', context: words(String.raw`\bbsb\b|account`), rank: 50 },
  { type: 'au_bank_account', re: re(String.raw`${L}\d{3}-\d{3}${R}`), base: null, context: words(String.raw`\bbsb\b`), rank: 48 },
  {
    type: 'nz_bank_account', re: re(String.raw`${L}\d{2}([- ])\d{4}\1\d{7,8}\1\d{2,4}${R}`), rank: 82,
    validate: (s) => v.nzBankAccount(s).format,
    base: (s) => (v.nzBankAccount(s).checksum ? 'high' : 'medium'),
    context: words(String.raw`account|\bbank\b`),
  },
  { type: 'crypto_wallet', re: re(String.raw`(?<![\w])[13][1-9A-HJ-NP-Za-km-z]{25,34}(?![\w])`), validate: v.base58CheckValid, base: 'high', rank: 88 },
  { type: 'crypto_wallet', re: re(String.raw`(?<![\w])(?:bc1|BC1)[02-9ac-hj-np-zAC-HJ-NP-Z]{11,71}(?![\w])`), validate: v.bech32Valid, base: 'high', rank: 88 },
  { type: 'crypto_wallet', re: re(String.raw`(?<![\w])0x[0-9a-fA-F]{40}(?![\w])`), base: 'medium', context: words(String.raw`wallet|ethereum|\beth\b|address`), rank: 70 },

  /* Contact */
  { type: 'email', re: re(String.raw`(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![A-Za-z0-9-])`), base: 'high', rank: 92 },
  {
    type: 'phone', re: re(String.raw`(?<![\w+])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])`), rank: 10,
    validate: (s) => {
      const d = v.digitsOf(s)
      const t = s.trim()
      return d.length >= 7 && d.length <= 15 && !/^(\d)\1+$/.test(d) && !v.parseDateCandidates(t).length && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(t) && (/[\s().+-]/.test(t) || d.length >= 9)
    },
    base: (s) => (s.trim().startsWith('+') ? 'high' : grouped(s) || /\(/.test(s) ? 'medium' : 'low'),
    context: words(String.raw`phone|\btel\b|\bmobile\b|\bcell\b|\bfax\b|\bcall\b|\bph\b|\bmob\b`),
  },
  {
    type: 'postal_address', rank: 20, base: 'medium', context: words(String.raw`address|lives\s+at|resid|deliver\s+to|ship\s+to|located\s+at`),
    re: re(String.raw`(?<![\w-])\d{1,5}[A-Za-z]?(?:[-/]\d{1,5})?\s{1,3}(?:[A-Z][A-Za-z'.-]{1,24}\s{1,3}){0,4}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Terrace|Tce|Crescent|Cres|Way|Highway|Hwy|Parade|Pde|Close|Square|Sq|Grove|Gr|Quay|Esplanade|Rise)\b\.?(?:,?\s{1,3}[A-Z][A-Za-z'-]{1,24}(?:\s{1,3}[A-Z][A-Za-z'-]{1,24}){0,3})?(?:,?\s{1,3}(?:[A-Z]{2,3}\s{1,3})?(?:\d{4,5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]\d[A-Z]\s?\d[A-Z]\d))?`),
  },
  { type: 'uk_postcode', re: re(String.raw`\b[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2}\b`), base: 'medium', context: words(String.raw`post\s?code|address`), rank: 22 },
  { type: 'us_zip', re: re(String.raw`${L}\d{5}(?:-\d{4})?${R}`), base: null, contextFn: (c) => endsWith(`\\b(?:${US_STATES})\\.?,?`)(c) || endsWith('\\bzip(?:\\s*code)?\\s*[:#]?', 'i')(c), boosted: 'medium', rank: 18 },
  { type: 'ca_postal_code', re: re(String.raw`\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b`), base: 'medium', context: words(String.raw`postal\s+code|address`), rank: 22 },
  { type: 'au_postcode', re: re(String.raw`${L}\d{4}${R}`), base: null, contextFn: (c) => endsWith('\\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT),?')(c) || endsWith('\\bpost\\s?code\\s*:?', 'i')(c), boosted: 'medium', rank: 17 },
  { type: 'nz_postcode', re: re(String.raw`${L}\d{4}${R}`), base: null, contextFn: (c) => endsWith(`\\b(?:${NZ_TOWNS}),?`)(c) || endsWith('\\bpost\\s?code\\s*:?', 'i')(c), boosted: 'medium', rank: 16 },

  /* Health */
  { type: 'uk_nhs', re: re(String.raw`${L}\d{3}([ -])\d{3}\1\d{4}${R}`), validate: v.nhsValid, base: 'medium', context: words(String.raw`\bnhs\b|health\s+service`), rank: 67 },
  { type: 'uk_nhs', re: re(String.raw`${L}\d{10}${R}`), validate: v.nhsValid, base: 'low', context: words(String.raw`\bnhs\b|health\s+service`), rank: 57 },
  { type: 'nz_nhi', re: re(String.raw`${L}[A-HJ-NP-Z]{3}(?:\d{4}|\d{2}[A-HJ-NP-Z]{2})${R}`), validate: v.nzNhiValid, base: 'low', context: words(String.raw`\bnhi\b|national\s+health\s+index|patient`), rank: 69 },
  { type: 'au_medicare', re: re(String.raw`${L}[2-6]\d{3} \d{5} \d(?:[ -]?\d)?${R}`), validate: v.auMedicareValid, base: 'medium', context: words('medicare'), rank: 67 },
  { type: 'au_medicare', re: re(String.raw`${L}[2-6]\d{9,10}${R}`), validate: v.auMedicareValid, base: 'low', context: words('medicare'), rank: 57 },
  { type: 'us_mbi', re: re(String.raw`${L}[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y\d]\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y\d]\d-?[AC-HJKMNP-RT-Y]{2}\d{2}${R}`), base: 'medium', context: words(String.raw`medicare|\bmbi\b|beneficiary`), rank: 77 },
  { type: 'medical_record_number', re: re(String.raw`${L}(?:[A-Z]{1,3}-?)?\d{5,12}${R}`), base: null, context: words(String.raw`\bmrn\b|medical\s+record|patient\s+(?:id|number|no\b)|hospital\s+(?:number|no\b)|chart\s+(?:number|no\b)|\burn\b`), rank: 35 },

  /* Technical */
  {
    type: 'ip_address', re: re(String.raw`(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w]|\.\d)`), rank: 42,
    validate: (_s, c) => !/\b(?:v|version|ver|release|build)\.?\s{0,2}$/i.test(c.before),
    base: 'medium', context: words(String.raw`\bip\b|host|server|address|client|gateway|dns`),
  },
  { type: 'ipv6_address', re: re(String.raw`(?<![\w:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])`), validate: (s) => /[0-9A-Fa-f]/.test(s) && isIPv6(s), base: 'high', rank: 43 },
  { type: 'mac_address', re: re(String.raw`(?<![\w:-])[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4}(?![\w:-])`), base: 'medium', context: words(String.raw`\bmac\b|hardware|ethernet|wi-?fi|device`), rank: 44 },
  { type: 'mac_address', re: re(String.raw`(?<![\w.])[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}(?![\w.])`), base: 'medium', context: words(String.raw`\bmac\b|hardware|ethernet|wi-?fi|device`), rank: 44 },
  { type: 'url', re: re(String.raw`\bhttps?:\/\/[^\s<>"'()[\]{}]{1,2048}[^\s<>"'()[\]{}.,;:!?]`, 'gi'), base: 'medium', rank: 15 },

  /* Credentials */
  { type: 'api_key', re: re(String.raw`(?<![\w-])(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,200}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,200}|A[KS]IA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255}|xox[abposr]-[A-Za-z0-9-]{10,200}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,64}|npm_[A-Za-z0-9]{36}|SG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{16,64})(?![\w-])`), base: 'high', rank: 91 },
  {
    type: 'api_key', group: 1, rank: 89, base: 'medium',
    re: re(String.raw`(?:api[_ -]?key|apikey|secret|token|access[_ -]?key|client[_ -]?secret|auth[_ -]?key)["']?\s{0,3}[:=]\s{0,3}["']?([A-Za-z0-9_\-+/=.]{16,256})`, 'gi'),
    validate: (s) => v.shannonEntropy(s) >= 3.5 && /\d/.test(s) && /[A-Za-z]/.test(s),
  },
  { type: 'jwt', re: re(String.raw`(?<![\w-])eyJ[A-Za-z0-9_-]{5,2000}\.eyJ[A-Za-z0-9_-]{5,8000}\.[A-Za-z0-9_-]{10,2000}(?![\w-])`), validate: v.jwtValid, base: 'high', rank: 96 },
  { type: 'private_key', re: re(String.raw`-----BEGIN (?:[A-Z]{2,10} ){0,2}PRIVATE KEY-----[\s\S]{0,12000}?-----END (?:[A-Z]{2,10} ){0,2}PRIVATE KEY-----`), base: 'high', rank: 99 },
  { type: 'private_key', re: re(String.raw`-----BEGIN (?:[A-Z]{2,10} ){0,2}PRIVATE KEY-----`), base: 'high', rank: 98 },
  { type: 'password', group: 1, re: re(String.raw`(?<![\w])(?:password|passwd|pwd|passcode|pass\s?phrase|pin)\s{0,3}(?:[:=]|\bis\s)\s{0,3}["']?([^\s"']{3,63}[^\s"'.,;:!?)])`, 'gi'), base: 'high', rank: 97 },
]

/** The built-in patterns (for the ReDoS guard test). */
export const DETECTOR_PATTERNS: ReadonlyArray<{ type: string; source: string }> = DETECTORS.map((d) => ({ type: d.type, source: d.re.source }))

const level = (l: Level | ((s: string, c: Ctx) => Level) | undefined, s: string, c: Ctx, dflt: Level): Level => (l === undefined ? dflt : typeof l === 'function' ? l(s, c) : l)
const up = (a: Level, b: Level): Level => (!a ? b : !b ? a : CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b)

interface Candidate extends Detection { rank: number }

/** Find the enabled info types in one text. Sorted by position, no overlaps. */
export function detectInfoTypes(text: string, options: DetectOptions): Detection[] {
  if (!text) return []
  const enabled = new Set(options.types)
  if (!enabled.size && !options.aiValues?.length) return []
  const min = CONFIDENCE_RANK[options.minConfidence ?? 'medium']
  const now = options.now ?? new Date()
  const out: Candidate[] = []
  for (const d of DETECTORS) {
    const wanted = d.type === 'date' ? enabled.has('date') || enabled.has('date_of_birth') : enabled.has(d.type)
    if (!wanted) continue
    d.re.lastIndex = 0
    for (let m = d.re.exec(text); m; m = d.re.exec(text)) {
      if (m[0] === '') { d.re.lastIndex++; continue }
      let value = d.group ? m[d.group] ?? '' : m[0]
      let start = d.group ? m.index + m[0].length - value.length : m.index
      const lead = value.length - value.trimStart().length
      start += lead
      value = value.trim()
      if (!value) continue
      const c: Ctx = { text, start, end: start + value.length, before: text.slice(Math.max(0, start - BEFORE), start), after: text.slice(start + value.length, start + value.length + AFTER), now, enabled }
      if (d.validate && !d.validate(value, c)) {
        const shorter = d.refine?.(value)
        if (!shorter) continue
        value = shorter
        c.end = start + value.length
      }
      if (d.classify) {
        const k = d.classify(value, c)
        if (k && CONFIDENCE_RANK[k.confidence] >= min) out.push({ type: k.type, start, end: c.end, confidence: k.confidence, context: k.context, source: 'pattern', rank: k.type === 'date_of_birth' ? 79 : d.rank })
        continue
      }
      const hasContext = d.contextFn ? d.contextFn(c) : d.context ? d.context.test(c.before) || d.context.test(c.after) : false
      const base = level(d.base, value, c, null)
      const conf = hasContext ? up(base, level(d.boosted, value, c, 'high')) : base
      if (!conf || CONFIDENCE_RANK[conf] < min) continue
      out.push({ type: d.type, start, end: c.end, confidence: conf, context: hasContext, source: 'pattern', rank: d.rank })
    }
  }
  // AI-found values (names, addresses): literal matches, medium confidence.
  for (const a of options.aiValues ?? []) {
    const needle = a.text.trim()
    if (needle.length < 2 || CONFIDENCE_RANK.medium < min) continue
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      out.push({ type: a.type, start: at, end: at + needle.length, confidence: 'medium', context: false, source: 'ai', rank: 5 })
    }
  }
  return resolveOverlaps(out, text.length)
}

function resolveOverlaps(cands: Candidate[], length: number): Detection[] {
  cands.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.rank - a.rank || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  // Characters already taken by a better match.
  const taken = new Uint8Array(length)
  const kept: Candidate[] = []
  for (const c of cands) {
    let free = true
    for (let i = c.start; i < c.end; i++) if (taken[i]) { free = false; break }
    if (!free) continue
    taken.fill(1, c.start, c.end)
    kept.push(c)
  }
  kept.sort((a, b) => a.start - b.start)
  return kept.map(({ rank: _rank, ...d }) => d)
}

/** The `[TOKEN]` for a type (catalogue token, else the id in capitals). */
export function tokenFor(type: string): string {
  return INFO_TYPE_BY_ID[type]?.token ?? type.toUpperCase()
}
