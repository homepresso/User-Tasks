/**
 * Check-digit and structure validators for the information types in
 * ./catalog. Pure functions on the matched text (separators allowed; each
 * validator strips what it does not need). Server-side: the Bitcoin Base58
 * check uses node:crypto.
 */

import { createHash } from 'node:crypto'

export const digitsOf = (s: string) => s.replace(/\D/g, '')
const allSame = (d: string) => /^(\d)\1*$/.test(d)

export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

/* ── Cards ── */

/** The card issuer for a number that passes Luhn, or null. */
export function cardIssuer(raw: string): string | null {
  const d = digitsOf(raw)
  if (d.length < 12 || d.length > 19 || !luhn(d) || allSame(d)) return null
  const n = d.length
  const p2 = Number(d.slice(0, 2))
  const p3 = Number(d.slice(0, 3))
  const p4 = Number(d.slice(0, 4))
  const p6 = Number(d.slice(0, 6))
  if (d[0] === '4' && (n === 13 || n === 16 || n === 19)) return 'visa'
  if (((p2 >= 51 && p2 <= 55) || (p6 >= 222100 && p6 <= 272099)) && n === 16) return 'mastercard'
  if ((p2 === 34 || p2 === 37) && n === 15) return 'amex'
  if ((p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) && n >= 16 && n <= 19) return 'discover'
  if (p4 >= 3528 && p4 <= 3589 && n >= 16 && n <= 19) return 'jcb'
  if (((p3 >= 300 && p3 <= 305) || p2 === 36 || p2 === 38 || p2 === 39) && n >= 14 && n <= 19) return 'diners'
  if (p2 === 62 && n >= 16 && n <= 19) return 'unionpay'
  if ((p2 === 50 || (p2 >= 56 && p2 <= 69)) && n >= 12 && n <= 19) return 'maestro'
  return null
}

/* ── Identity ── */

export function usSsnValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 9 || allSame(d)) return false
  const area = Number(d.slice(0, 3))
  if (area === 0 || area === 666 || area >= 900) return false
  if (d.slice(3, 5) === '00' || d.slice(5) === '0000') return false
  // Common placeholders.
  return d !== '123456789' && d !== '987654321'
}

export function usItinValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 9 || d[0] !== '9') return false
  const g = Number(d.slice(3, 5))
  return (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || (g >= 94 && g <= 99)
}

export function ukNinoValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(s)) return false
  return !['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ'].includes(s.slice(0, 2))
}

export function nhsValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 10 || allSame(d)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i)
  let check = 11 - (sum % 11)
  if (check === 11) check = 0
  return check !== 10 && check === Number(d[9])
}

export function caSinValid(raw: string): boolean {
  const d = digitsOf(raw)
  return d.length === 9 && d[0] !== '0' && d[0] !== '8' && !allSame(d) && luhn(d)
}

export function auTfnValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (allSame(d)) return false
  const w = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : d.length === 8 ? [10, 7, 8, 4, 6, 3, 5, 1] : null
  if (!w) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) sum += Number(d[i]) * w[i]
  return sum % 11 === 0
}

export function auMedicareValid(raw: string): boolean {
  const d = digitsOf(raw)
  if ((d.length !== 10 && d.length !== 11) || !/^[2-6]/.test(d)) return false
  const w = [1, 3, 7, 9, 1, 3, 7, 9]
  let sum = 0
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * w[i]
  return sum % 10 === Number(d[8]) && d[9] !== '0'
}

export function nzIrdValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 8 && d.length !== 9) return false
  const n = Number(d)
  if (n < 10_000_000 || n > 150_000_000) return false
  const padded = d.padStart(9, '0')
  const base = padded.slice(0, 8)
  const given = Number(padded[8])
  const calc = (w: number[]) => {
    let sum = 0
    for (let i = 0; i < 8; i++) sum += Number(base[i]) * w[i]
    const rem = sum % 11
    return rem === 0 ? 0 : 11 - rem
  }
  let check = calc([3, 2, 7, 6, 5, 4, 3, 2])
  if (check === 10) check = calc([7, 4, 3, 2, 5, 2, 7, 6])
  return check !== 10 && check === given
}

/** NHI letters: A–Z without I and O, valued 1–24. */
const NHI_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const nhiValue = (ch: string) => (/\d/.test(ch) ? Number(ch) : NHI_ALPHA.indexOf(ch) + 1)

export function nzNhiValid(raw: string): boolean {
  const s = raw.toUpperCase()
  const weights = [7, 6, 5, 4, 3, 2]
  if (/^[A-HJ-NP-Z]{3}\d{4}$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 6; i++) sum += nhiValue(s[i]) * weights[i]
    const rem = sum % 11
    if (rem === 0) return false
    const check = (11 - rem) % 10
    return check === Number(s[6])
  }
  if (/^[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2}$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 6; i++) sum += nhiValue(s[i]) * weights[i]
    const rem = sum % 23
    if (rem === 0) return false
    return NHI_ALPHA[23 - rem - 1] === s[6]
  }
  return false
}

/** German Steuer-ID: ISO 7064 MOD 11,10 and the digit-repetition rule. */
export function deTaxIdValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 11 || d[0] === '0') return false
  const counts = new Map<string, number>()
  for (const ch of d.slice(0, 10)) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  const repeated = [...counts.values()].filter((c) => c > 1)
  if (repeated.length !== 1 || repeated[0] > 3) return false
  let product = 10
  for (let i = 0; i < 10; i++) {
    let sum = (Number(d[i]) + product) % 10
    if (sum === 0) sum = 10
    product = (sum * 2) % 11
  }
  let check = 11 - product
  if (check === 10) check = 0
  return check === Number(d[10])
}

/** French NIR (numéro de sécurité sociale) with its 2-digit key. */
export function frNirValid(raw: string): boolean {
  const s = raw.replace(/[\s.-]/g, '').toUpperCase()
  const m = /^([12])(\d{2})(0[1-9]|1[0-2]|[2-9]\d)(\d{2}|2A|2B)(\d{3})(\d{3})(\d{2})$/.exec(s)
  if (!m) return false
  const body = (m[1] + m[2] + m[3] + m[4] + m[5] + m[6]).replace('2A', '19').replace('2B', '18')
  const key = 97 - Number(BigInt(body) % BigInt(97))
  return key === Number(m[7])
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
export function esDniValid(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase()
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s)
  if (!m) return false
  if (m[1] && m[2].length !== 7) return false
  if (!m[1] && m[2].length !== 8) return false
  const n = Number((m[1] ? String('XYZ'.indexOf(m[1])) : '') + m[2])
  return DNI_LETTERS[n % 23] === m[3]
}

const CF_ODD: Record<string, number> = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 }
export function itFiscalCodeValid(raw: string): boolean {
  const s = raw.toUpperCase()
  // Omocodia: digits in the numeric positions may be replaced by L–V.
  if (!/^[A-Z]{6}[\dLMNP-V]{2}[A-EHLMPR-T][\dLMNP-V]{2}[A-Z][\dLMNP-V]{3}[A-Z]$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const ch = s[i]
    sum += i % 2 === 0 ? CF_ODD[ch] : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15]
}

export function nlBsnValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 9 || allSame(d)) return false
  let sum = 0
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * (9 - i)
  sum -= Number(d[8])
  return sum % 11 === 0 && sum !== 0
}

const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
export function verhoeff(digits: string): boolean {
  let c = 0
  const r = digits.split('').reverse()
  for (let i = 0; i < r.length; i++) c = V_D[c][V_P[i % 8][Number(r[i])]]
  return c === 0
}

export function aadhaarValid(raw: string): boolean {
  const d = digitsOf(raw)
  return d.length === 12 && /^[2-9]/.test(d) && !allSame(d) && verhoeff(d)
}

export function sgNricValid(raw: string): boolean {
  const s = raw.toUpperCase()
  const m = /^([STFGM])(\d{7})([A-Z])$/.exec(s)
  if (!m) return false
  if (m[1] === 'M') return true // M series (FIN from 2022): format only.
  const w = [2, 7, 6, 5, 4, 3, 2]
  let sum = 0
  for (let i = 0; i < 7; i++) sum += Number(m[2][i]) * w[i]
  if (m[1] === 'T' || m[1] === 'G') sum += 4
  const table = m[1] === 'S' || m[1] === 'T' ? 'JZIHGFEDCBA' : 'XWUTRQPNMLK'
  return table[sum % 11] === m[3]
}

/* ── MRZ (ICAO 9303) ── */

export function mrzCheck(field: string): number {
  const w = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < field.length; i++) {
    const ch = field[i]
    const v = ch === '<' ? 0 : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55
    sum += v * w[i % 3]
  }
  return sum % 10
}

const mrzDigit = (field: string, check: string) => (check === '<' ? /^<+$/.test(field) : mrzCheck(field) === Number(check))

/** TD3 (passport) second line, 44 characters. */
export function mrzTd3Line2Valid(line: string): boolean {
  if (!/^[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}\d[MFX<]\d{6}\d[A-Z0-9<]{14}[0-9<]\d$/.test(line)) return false
  if (!mrzDigit(line.slice(0, 9), line[9]) || !mrzDigit(line.slice(13, 19), line[19]) || !mrzDigit(line.slice(21, 27), line[27]) || !mrzDigit(line.slice(28, 42), line[42])) return false
  return mrzCheck(line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43)) === Number(line[43])
}

/** TD1 (ID card) first line, 30 characters: document number check. */
export function mrzTd1Line1Valid(line: string): boolean {
  if (!/^[AIC][A-Z<][A-Z<]{3}[A-Z0-9<]{9}[0-9<][A-Z0-9<]{15}$/.test(line)) return false
  return mrzDigit(line.slice(5, 14), line[14])
}

/** TD1 second line, 30 characters: birth date and expiry checks. */
export function mrzTd1Line2Valid(line: string): boolean {
  if (!/^\d{6}\d[MFX<]\d{6}\d[A-Z<]{3}[A-Z0-9<]{11}\d$/.test(line)) return false
  return mrzDigit(line.slice(0, 6), line[6]) && mrzDigit(line.slice(8, 14), line[14])
}

/* ── Financial ── */

export function abaValid(raw: string): boolean {
  const d = digitsOf(raw)
  if (d.length !== 9 || allSame(d)) return false
  const p = Number(d.slice(0, 2))
  if (!((p <= 12) || (p >= 21 && p <= 32) || (p >= 61 && p <= 72) || p === 80)) return false
  const n = d.split('').map(Number)
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0
}

const ISO_COUNTRIES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' '))
export function bicValid(raw: string): boolean {
  const s = raw.toUpperCase()
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(s) && ISO_COUNTRIES.has(s.slice(4, 6))
}

/** New Zealand bank codes and their branch ranges (Payments NZ register). */
const NZ_BRANCHES: Record<string, Array<[number, number]>> = {
  '01': [[1, 999], [1100, 1199], [1800, 1899]],
  '02': [[1, 999], [1200, 1299]],
  '03': [[1, 999], [1300, 1399], [1500, 1599], [1700, 1799], [1900, 1999]],
  '04': [[2020, 2024]],
  '06': [[1, 999], [1400, 1499]],
  '08': [[6500, 6599]],
  '09': [[0, 0]],
  '10': [[5165, 5169]],
  '11': [[5000, 6499], [6600, 8999]],
  '12': [[3000, 3299], [3400, 3499], [3600, 3699]],
  '13': [[4900, 4999]],
  '14': [[4700, 4799]],
  '15': [[3900, 3999]],
  '16': [[4400, 4499]],
  '17': [[3300, 3399]],
  '18': [[3500, 3599]],
  '19': [[4600, 4649]],
  '20': [[4100, 4199]],
  '21': [[4800, 4899]],
  '22': [[4000, 4049]],
  '23': [[3700, 3799]],
  '24': [[4300, 4349]],
  '25': [[2500, 2599]],
  '26': [[2600, 2699]],
  '27': [[3800, 3849]],
  '28': [[2100, 2149]],
  '29': [[2150, 2299]],
  '30': [[2900, 2949]],
  '31': [[2800, 2849]],
  '33': [[6700, 6799]],
  '35': [[2400, 2499]],
  '38': [[9000, 9499]],
}

export interface NzBankCheck { format: boolean; checksum: boolean }

/** NZ account: known bank / branch, then the Payments NZ check-digit algorithm. */
export function nzBankAccount(raw: string): NzBankCheck {
  const m = /^(\d{2})[- ]?(\d{4})[- ]?(\d{7,8})[- ]?(\d{2,4})$/.exec(raw.trim())
  if (!m) return { format: false, checksum: false }
  const [, bank, branchS, account, suffix] = m
  const branch = Number(branchS)
  const ranges = NZ_BRANCHES[bank]
  if (!ranges || !ranges.some(([a, b]) => branch >= a && branch <= b)) return { format: false, checksum: false }
  const acc = account.padStart(8, '0')
  const digits = (bank + branchS + acc + suffix.padStart(4, '0')).split('').map(Number)
  const algo = bank === '08' ? 'D' : bank === '09' ? 'E' : bank === '25' || bank === '33' ? 'F' : bank === '26' || bank === '28' || bank === '29' ? 'G' : bank === '31' ? 'X' : Number(acc) < 990000 ? 'A' : 'B'
  const W: Record<string, { w: number[]; mod: number; fold?: boolean }> = {
    A: { w: [0, 0, 6, 3, 7, 9, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0], mod: 11 },
    B: { w: [0, 0, 0, 0, 0, 0, 0, 0, 10, 5, 8, 4, 2, 1, 0, 0, 0, 0], mod: 11 },
    D: { w: [0, 0, 0, 0, 0, 0, 0, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0], mod: 11 },
    E: { w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 4, 3, 2, 0, 0, 0, 1], mod: 11, fold: true },
    F: { w: [0, 0, 0, 0, 0, 0, 0, 1, 7, 3, 1, 7, 3, 1, 0, 0, 0, 0], mod: 10 },
    G: { w: [0, 0, 0, 0, 0, 0, 0, 1, 3, 7, 1, 3, 7, 1, 0, 3, 7, 1], mod: 10, fold: true },
  }
  if (algo === 'X') return { format: true, checksum: true }
  const { w, mod, fold } = W[algo]
  let sum = 0
  for (let i = 0; i < 18; i++) {
    let p = digits[i] * w[i]
    if (fold) { p = Math.floor(p / 10) + (p % 10); p = Math.floor(p / 10) + (p % 10) }
    sum += p
  }
  return { format: true, checksum: sum % mod === 0 }
}

/* ── Crypto ── */

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58CheckValid(s: string): boolean {
  let n = BigInt(0)
  for (const ch of s) {
    const v = B58.indexOf(ch)
    if (v < 0) return false
    n = n * BigInt(58) + BigInt(v)
  }
  const bytes: number[] = []
  while (n > BigInt(0)) { bytes.unshift(Number(n % BigInt(256))); n /= BigInt(256) }
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break }
  if (bytes.length !== 25) return false
  const payload = Buffer.from(bytes.slice(0, 21))
  const sum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest()
  return sum.subarray(0, 4).equals(Buffer.from(bytes.slice(21)))
}

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
export function bech32Valid(raw: string): boolean {
  const s = raw.toLowerCase()
  if (s !== raw && raw.toUpperCase() !== raw) return false
  const pos = s.lastIndexOf('1')
  if (pos < 1 || s.length - pos < 7 || s.length > 90) return false
  const hrp = s.slice(0, pos)
  const data: number[] = []
  for (const ch of s.slice(pos + 1)) { const v = BECH32.indexOf(ch); if (v < 0) return false; data.push(v) }
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  const step = (v: number) => {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]
  }
  for (const c of hrp) step(c.charCodeAt(0) >>> 5)
  step(0)
  for (const c of hrp) step(c.charCodeAt(0) & 31)
  for (const v of data) step(v)
  return chk === 1 || chk === 0x2bc830a3 // bech32 / bech32m
}

/* ── Secrets ── */

export function shannonEntropy(s: string): number {
  if (!s) return 0
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const c of counts.values()) { const p = c / s.length; h -= p * Math.log2(p) }
  return h
}

export function jwtValid(token: string): boolean {
  const [head] = token.split('.')
  try {
    const json = JSON.parse(Buffer.from(head.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return !!json && typeof json === 'object' && 'alg' in json
  } catch {
    return false
  }
}

/* ── Dates ── */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

function realDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const fullYear = (y: string) => (y.length === 2 ? (Number(y) > (new Date().getUTCFullYear() % 100) ? 1900 : 2000) + Number(y) : Number(y))

/** The possible calendar dates a matched date string can mean (DMY and MDY both tried). */
export function parseDateCandidates(raw: string): Array<{ y: number; m: number; d: number }> {
  const s = raw.trim().toLowerCase()
  const out: Array<{ y: number; m: number; d: number }> = []
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) out.push({ y: +m[1], m: +m[2], d: +m[3] })
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const y = fullYear(m[3])
    out.push({ y, m: +m[2], d: +m[1] }, { y, m: +m[1], d: +m[2] })
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*\.?,?[\s-]+(\d{4}|\d{2})$/.exec(s))) {
    if (MONTHS[m[2]]) out.push({ y: fullYear(m[3]), m: MONTHS[m[2]], d: +m[1] })
  } else if ((m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    if (MONTHS[m[1]]) out.push({ y: +m[3], m: MONTHS[m[1]], d: +m[2] })
  }
  return out.filter((c) => c.y >= 1000 && c.y <= 2999 && realDate(c.y, c.m, c.d))
}

/** A date a living person could have been born on (last 120 years, not in the future). */
export function birthDatePlausible(raw: string, now = new Date()): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return parseDateCandidates(raw).some(({ y, m, d }) => {
    const t = Date.UTC(y, m - 1, d)
    return t <= today && y >= now.getUTCFullYear() - 120
  })
}
