/** Reference tables: IBAN lengths, postcode formats and country calling codes. */

/** IBAN length by country (SWIFT IBAN registry). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25,
  QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26,
  UA: 29, VA: 22, VG: 24, XK: 20,
}

export interface PostcodeRule {
  re: RegExp
  /** Normalise the matched (upper-cased, compacted) value. */
  format?: (compact: string) => string
  example: string
}

const spaceBefore = (n: number) => (s: string) => `${s.slice(0, s.length - n)} ${s.slice(s.length - n)}`
const dashAt = (i: number) => (s: string) => `${s.slice(0, i)}-${s.slice(i)}`

/** Postcode rules by ISO country; the regex runs on the value upper-cased with spaces and dashes removed. */
export const POSTCODES: Record<string, PostcodeRule> = {
  US: { re: /^\d{5}(\d{4})?$/, format: (s) => (s.length === 9 ? dashAt(5)(s) : s), example: '94105 or 94105-1234' },
  GB: { re: /^(GIR0AA|[A-PR-UWYZ](\d[A-HJKPSTUW]?|\d\d|[A-HK-Y]\d[ABEHMNPRV-Y]?|[A-HK-Y]\d\d)\d[ABD-HJLNP-UW-Z]{2})$/, format: spaceBefore(3), example: 'SW1A 1AA' },
  CA: { re: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/, format: spaceBefore(3), example: 'K1A 0B1' },
  AU: { re: /^(0[289]\d{2}|[1-9]\d{3})$/, example: '2000' },
  NZ: { re: /^\d{4}$/, example: '6011' },
  DE: { re: /^(0[1-9]|[1-9]\d)\d{3}$/, example: '10115' },
  FR: { re: /^(0[1-9]|[1-8]\d|9[0-8])\d{3}$/, example: '75008' },
  NL: { re: /^[1-9]\d{3}(?!SA|SD|SS)[A-Z]{2}$/, format: spaceBefore(2), example: '1012 AB' },
  BE: { re: /^[1-9]\d{3}$/, example: '1000' },
  AT: { re: /^[1-9]\d{3}$/, example: '1010' },
  CH: { re: /^[1-9]\d{3}$/, example: '8001' },
  IE: { re: /^[AC-FHKNPRTV-Y]\d{2}[0-9AC-FHKNPRTV-Y]{4}$|^D6W[0-9AC-FHKNPRTV-Y]{4}$/, format: (s) => `${s.slice(0, 3)} ${s.slice(3)}`, example: 'D02 X285' },
  ES: { re: /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/, example: '28013' },
  IT: { re: /^\d{5}$/, example: '00184' },
  PT: { re: /^[1-9]\d{6}$/, format: dashAt(4), example: '1000-001' },
  SE: { re: /^[1-9]\d{4}$/, format: spaceBefore(2), example: '114 55' },
  NO: { re: /^\d{4}$/, example: '0150' },
  DK: { re: /^[1-9]\d{3}$/, example: '1050' },
  FI: { re: /^\d{5}$/, example: '00100' },
  PL: { re: /^\d{5}$/, format: dashAt(2), example: '00-950' },
  JP: { re: /^\d{7}$/, format: dashAt(3), example: '100-0001' },
  IN: { re: /^[1-9]\d{5}$/, example: '110001' },
  SG: { re: /^\d{6}$/, example: '018956' },
  BR: { re: /^\d{8}$/, format: dashAt(5), example: '01310-100' },
  MX: { re: /^\d{5}$/, example: '06500' },
  ZA: { re: /^\d{4}$/, example: '8001' },
}

/** Country calling codes (ITU E.164) for common ISO countries. */
export const CALLING_CODES: Record<string, string> = {
  US: '1', CA: '1', GB: '44', IE: '353', AU: '61', NZ: '64', DE: '49', FR: '33', NL: '31', BE: '32', LU: '352', AT: '43', CH: '41',
  IT: '39', ES: '34', PT: '351', SE: '46', NO: '47', DK: '45', FI: '358', IS: '354', PL: '48', CZ: '420', SK: '421', HU: '36',
  RO: '40', BG: '359', GR: '30', TR: '90', IL: '972', AE: '971', SA: '966', QA: '974', EG: '20', ZA: '27', NG: '234', KE: '254',
  IN: '91', PK: '92', BD: '880', LK: '94', SG: '65', MY: '60', TH: '66', VN: '84', PH: '63', ID: '62', CN: '86', HK: '852',
  TW: '886', JP: '81', KR: '82', MX: '52', BR: '55', AR: '54', CL: '56', CO: '57', PE: '51', UA: '380', RU: '7', FJ: '679',
}

/** Calling codes whose national numbers are dialled without a trunk 0. */
export const NO_TRUNK_PREFIX = new Set(['1', '39', '34', '351', '30', '45', '47', '352', '354', '420', '421', '852', '65', '974', '966', '971', '7'])

const ALL_CODES = new Set(Object.values(CALLING_CODES))

/** Split an international number (digits only, without +) into calling code + national number. */
export function splitCallingCode(digits: string): { code: string; national: string } | null {
  for (const len of [1, 2, 3]) {
    const code = digits.slice(0, len)
    if (ALL_CODES.has(code)) return { code, national: digits.slice(len) }
  }
  return null
}

export function countriesForCode(code: string): string[] {
  return Object.entries(CALLING_CODES).filter(([, c]) => c === code).map(([iso]) => iso)
}
