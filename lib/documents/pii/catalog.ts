/**
 * The information-type catalogue used by Redact Document (`doc_redact`):
 * what each type is, where it applies, how it is recognised and how sure a
 * match is. Pure data, client-safe (no imports): the designer's picker, the
 * docs reference table and the detection engine (./detect) all read it, so
 * they cannot drift apart.
 */

export type InfoCategory = 'identity' | 'financial' | 'contact' | 'health' | 'technical' | 'credentials'
export type Confidence = 'low' | 'medium' | 'high'
export type InfoRegion = 'global' | 'US' | 'UK' | 'CA' | 'AU' | 'NZ' | 'EU' | 'DE' | 'FR' | 'ES' | 'IT' | 'NL' | 'IN' | 'SG'

export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 1, medium: 2, high: 3 }

export interface InfoTypeMeta {
  id: string
  label: string
  category: InfoCategory
  regions: InfoRegion[]
  /** `label` redaction style: `[TOKEN]`. */
  token: string
  /** What it looks like (docs / designer tooltip). */
  format: string
  /** The check applied after the pattern matches. */
  validation: string
  /** Nearby words that raise (or, when `contextRequired`, are needed for) a match. */
  context: string
  contextRequired?: boolean
  /** How sure a match is without and with context. */
  confidence: string
  /** The highest confidence a match can reach (for "all high-confidence types"). */
  best: Confidence
  /** Found by an AI model (opt-in), not by patterns. */
  ai?: boolean
}

export const INFO_CATEGORIES: Array<{ id: InfoCategory; label: string }> = [
  { id: 'identity', label: 'Identity' },
  { id: 'financial', label: 'Financial' },
  { id: 'contact', label: 'Contact' },
  { id: 'health', label: 'Health' },
  { id: 'technical', label: 'Technical' },
  { id: 'credentials', label: 'Credentials' },
]

export const INFO_REGIONS: Array<{ id: InfoRegion; label: string }> = [
  { id: 'global', label: 'Global' },
  { id: 'US', label: 'United States' },
  { id: 'UK', label: 'United Kingdom' },
  { id: 'CA', label: 'Canada' },
  { id: 'AU', label: 'Australia' },
  { id: 'NZ', label: 'New Zealand' },
  { id: 'EU', label: 'Europe' },
  { id: 'IN', label: 'India' },
  { id: 'SG', label: 'Singapore' },
]

/** Country regions that also count as Europe in the region filter. */
const EU_COUNTRIES: InfoRegion[] = ['DE', 'FR', 'ES', 'IT', 'NL']

const T = (m: InfoTypeMeta) => m

export const INFO_TYPES: InfoTypeMeta[] = [
  /* ── Identity ── */
  T({ id: 'us_ssn', label: 'US Social Security number', category: 'identity', regions: ['US'], token: 'SSN', format: '`123-45-6789`, `123 45 6789`; 9 digits in a row only next to a context word', validation: 'Area not 000, 666 or 900–999; group not 00; serial not 0000; not all one digit', context: 'SSN, social security, SS#', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'us_itin', label: 'US ITIN', category: 'identity', regions: ['US'], token: 'ITIN', format: '`9XX-7X-XXXX` (dashes or spaces)', validation: 'Starts with 9; middle group 50–65, 70–88, 90–92 or 94–99', context: 'ITIN, taxpayer identification', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'us_passport', label: 'US passport number', category: 'identity', regions: ['US'], token: 'PASSPORT', format: '9 digits, or a letter and 8 digits', validation: 'Context word required', context: 'passport', contextRequired: true, confidence: 'high (with context)', best: 'high' }),
  T({ id: 'us_drivers_license', label: 'US driver\'s license', category: 'identity', regions: ['US'], token: 'DRIVER_LICENSE', format: 'State formats vary: up to 2 letters and 5–14 digits, or a letter and digit groups (`D123-4567-8901`)', validation: 'Context word required', context: 'driver\'s license, driver license, DL, DLN', contextRequired: true, confidence: 'medium (with context)', best: 'medium' }),
  T({ id: 'date_of_birth', label: 'Date of birth', category: 'identity', regions: ['global'], token: 'DATE_OF_BIRTH', format: 'Any date format: `1985-03-12`, `12/03/1985`, `03/12/1985`, `12.03.85`, `12 March 1985`, `Mar 12, 1985`, `12-Mar-1985`', validation: 'A real calendar date in the last 120 years (not in the future); the context word must come just before it on the same line (within 16 characters, no other number in between)', context: 'DOB, D.O.B., date of birth, birth date, born, birthday, geboren, né(e) le, fecha de nacimiento, data di nascita', contextRequired: true, confidence: 'high (with context); without it the date is a plain Date', best: 'high' }),
  T({ id: 'date', label: 'Date', category: 'identity', regions: ['global'], token: 'DATE', format: 'The same formats as Date of birth', validation: 'A real calendar date (day/month or month/day)', context: '—', confidence: 'medium', best: 'medium' }),
  T({ id: 'uk_nino', label: 'UK National Insurance number', category: 'identity', regions: ['UK'], token: 'NI_NUMBER', format: '`QQ 12 34 56 C` (spaces optional)', validation: 'Valid prefix letters (not D, F, I, Q, U, V; second not O; not BG, GB, KN, NK, NT, TN, ZZ); suffix A–D', context: 'national insurance, NI number, NINO', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'uk_passport', label: 'UK passport number', category: 'identity', regions: ['UK'], token: 'PASSPORT', format: '9 digits, or 2 letters and 7 digits', validation: 'Context word required', context: 'passport (UK, British, HM)', contextRequired: true, confidence: 'high (with context)', best: 'high' }),
  T({ id: 'ca_sin', label: 'Canada Social Insurance number', category: 'identity', regions: ['CA'], token: 'SIN', format: '`046 454 286`, `046-454-286` or 9 digits', validation: 'Luhn check; does not start with 0 or 8', context: 'SIN, social insurance', confidence: 'low (9 digits) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'au_tfn', label: 'Australia Tax File Number', category: 'identity', regions: ['AU'], token: 'TFN', format: '`123 456 782` or 8–9 digits', validation: 'Weighted mod-11 checksum', context: 'TFN, tax file number', confidence: 'low (digits only) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'nz_ird', label: 'New Zealand IRD number', category: 'identity', regions: ['NZ'], token: 'IRD_NUMBER', format: '`49-091-850`, `136-410-132` or 8–9 digits', validation: 'IRD mod-11 check digit (primary and secondary weights); 10,000,000–150,000,000', context: 'IRD, inland revenue, tax number, GST number', confidence: 'low (digits only) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'nz_drivers_licence', label: 'New Zealand driver licence', category: 'identity', regions: ['NZ'], token: 'DRIVER_LICENCE', format: '2 letters and 6 digits: `AB123456`', validation: 'Context word required', context: 'driver licence, licence number, DL', contextRequired: true, confidence: 'high (with context)', best: 'high' }),
  T({ id: 'de_tax_id', label: 'German tax ID (Steuer-ID)', category: 'identity', regions: ['DE'], token: 'TAX_ID', format: '11 digits (spaces allowed): `86 095 742 719`', validation: 'ISO 7064 MOD 11,10 check digit; first digit not 0; one digit repeated 2–3 times in the first ten', context: 'Steuer-ID, Steueridentifikationsnummer, IdNr, tax ID', confidence: 'low; high with context', best: 'high' }),
  T({ id: 'fr_nir', label: 'French social security number (NIR / INSEE)', category: 'identity', regions: ['FR'], token: 'NIR', format: '15 digits: `2 84 12 75 123 456 87` (Corsica `2A` / `2B` allowed)', validation: 'Sex 1/2, month 01–12 (or 20+), and the 2-digit key (97 − number mod 97)', context: 'sécurité sociale, NIR, INSEE, numéro de sécu', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'es_dni', label: 'Spanish DNI / NIE', category: 'identity', regions: ['ES'], token: 'DNI', format: '`12345678Z` (DNI) or `X1234567L` (NIE)', validation: 'Control letter (number mod 23)', context: 'DNI, NIE, documento nacional', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'it_fiscal_code', label: 'Italian fiscal code (codice fiscale)', category: 'identity', regions: ['IT'], token: 'FISCAL_CODE', format: '16 characters: `RSSMRA85T10A562S`', validation: 'Structure (surname, name, year, month letter, day, place) and the control character', context: 'codice fiscale, CF', confidence: 'high', best: 'high' }),
  T({ id: 'nl_bsn', label: 'Dutch citizen service number (BSN)', category: 'identity', regions: ['NL'], token: 'BSN', format: '9 digits: `111222333`, `1112.22.333`', validation: '11-proef (elfproef)', context: 'BSN, burgerservicenummer, sofinummer', confidence: 'low; high with context', best: 'high' }),
  T({ id: 'in_aadhaar', label: 'India Aadhaar number', category: 'identity', regions: ['IN'], token: 'AADHAAR', format: '`2345 6789 0124` (12 digits, first 2–9)', validation: 'Verhoeff check digit', context: 'Aadhaar, UIDAI, UID', confidence: 'low (digits only) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'in_pan', label: 'India PAN', category: 'identity', regions: ['IN'], token: 'PAN', format: '`AAAPZ1234C`', validation: 'Structure: 5 letters (4th is the holder type), 4 digits, a letter', context: 'PAN, permanent account number, income tax', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'sg_nric', label: 'Singapore NRIC / FIN', category: 'identity', regions: ['SG'], token: 'NRIC', format: '`S1234567D` (S, T, F, G or M, 7 digits, a letter)', validation: 'Check letter (weighted mod 11; M series by format)', context: 'NRIC, FIN, IC number', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'passport_mrz', label: 'Passport / ID machine-readable zone (MRZ)', category: 'identity', regions: ['global'], token: 'MRZ', format: 'The `P<…<<…` name line and the 44-character data line of a passport (TD3), or the 30-character lines of an ID card (TD1)', validation: 'ICAO 9303 check digits (document number, birth date, expiry, composite)', context: '—', confidence: 'high (check digits pass); name line medium', best: 'high' }),

  /* ── Financial ── */
  T({ id: 'credit_card', label: 'Credit / debit card number', category: 'financial', regions: ['global'], token: 'CREDIT_CARD', format: '13–19 digits, spaces or dashes allowed: `4111 1111 1111 1111`', validation: 'Luhn check, issuer prefix and length (Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, Maestro)', context: 'card, credit, debit, Visa, Mastercard', confidence: 'high (known issuer); low (Luhn only)', best: 'high' }),
  T({ id: 'iban', label: 'IBAN', category: 'financial', regions: ['global', 'EU'], token: 'IBAN', format: '`GB82 WEST 1234 5698 7654 32`', validation: 'ISO 13616 mod-97 check', context: 'IBAN', confidence: 'high', best: 'high' }),
  T({ id: 'swift_bic', label: 'SWIFT / BIC code', category: 'financial', regions: ['global'], token: 'SWIFT_BIC', format: '8 or 11 characters: `DEUTDEFF`, `DEUTDEFF500`', validation: 'Bank code, a real country code, location; a context word is needed for medium', context: 'SWIFT, BIC', confidence: 'low; medium with context', best: 'medium' }),
  T({ id: 'us_routing_number', label: 'US ABA routing number', category: 'financial', regions: ['US'], token: 'ROUTING_NUMBER', format: '9 digits: `021000021`', validation: 'ABA 3-7-1 checksum and a valid Federal Reserve prefix', context: 'routing, ABA, RTN, transit', confidence: 'low; high with context', best: 'high' }),
  T({ id: 'us_bank_account', label: 'US bank account number', category: 'financial', regions: ['US'], token: 'BANK_ACCOUNT', format: '8–17 digits', validation: 'Context word required', context: 'account number, acct, checking, savings', contextRequired: true, confidence: 'medium (with context)', best: 'medium' }),
  T({ id: 'uk_bank_account', label: 'UK sort code and account', category: 'financial', regions: ['UK'], token: 'BANK_ACCOUNT', format: '`12-34-56 12345678`; a sort code alone next to "sort code"', validation: 'Sort code `NN-NN-NN` with an 8-digit account, or a context word', context: 'sort code, account', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'au_bank_account', label: 'Australia BSB and account', category: 'financial', regions: ['AU'], token: 'BANK_ACCOUNT', format: '`062-000 12345678`; a BSB alone next to "BSB"', validation: 'BSB `NNN-NNN` with a 6–10 digit account, or a context word', context: 'BSB, account', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'nz_bank_account', label: 'New Zealand bank account', category: 'financial', regions: ['NZ'], token: 'BANK_ACCOUNT', format: '`01-0902-0068389-00` (bank, branch, account, suffix)', validation: 'Known bank and branch range; the Payments NZ check digit raises it to high', context: 'account, bank account', confidence: 'medium (bank and branch valid); high (check digit passes or context)', best: 'high' }),
  T({ id: 'crypto_wallet', label: 'Crypto wallet address', category: 'financial', regions: ['global'], token: 'CRYPTO_WALLET', format: 'Bitcoin `1…` / `3…` (Base58) or `bc1…` (Bech32); Ethereum `0x` and 40 hex digits', validation: 'Bitcoin: Base58Check (double SHA-256) or Bech32/Bech32m checksum. Ethereum: format', context: 'wallet, bitcoin, BTC, ethereum, ETH', confidence: 'Bitcoin high; Ethereum medium, high with context', best: 'high' }),

  /* ── Contact ── */
  T({ id: 'email', label: 'Email address', category: 'contact', regions: ['global'], token: 'EMAIL', format: '`name@example.com`', validation: 'Domain with a 2–24 letter top-level domain', context: '—', confidence: 'high', best: 'high' }),
  T({ id: 'phone', label: 'Phone number', category: 'contact', regions: ['global'], token: 'PHONE', format: 'E.164 (`+64 21 555 0100`) and national formats with spaces, dots, dashes or brackets', validation: '7–15 digits; not a date; not one digit repeated', context: 'phone, tel, mobile, cell, fax, call', confidence: 'high (+ country code or context); medium (grouped); low (digits only)', best: 'high' }),
  T({ id: 'postal_address', label: 'Street address', category: 'contact', regions: ['global'], token: 'ADDRESS', format: 'A number, capitalised street name and a street type (Street, Rd, Ave, …), optionally a town and postcode', validation: 'Heuristic (pattern only)', context: 'address, lives at, resides, deliver to', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'uk_postcode', label: 'UK postcode', category: 'contact', regions: ['UK'], token: 'POSTCODE', format: '`SW1A 1AA`', validation: 'Royal Mail outward / inward letters', context: 'postcode, address', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'us_zip', label: 'US ZIP code', category: 'contact', regions: ['US'], token: 'ZIP', format: '`94105`, `94105-1234`', validation: 'Context required: a state abbreviation just before it, or "ZIP"', context: 'ZIP, state abbreviation (CA 94105)', contextRequired: true, confidence: 'medium (with context)', best: 'medium' }),
  T({ id: 'ca_postal_code', label: 'Canada postal code', category: 'contact', regions: ['CA'], token: 'POSTAL_CODE', format: '`K1A 0B1`', validation: 'Canada Post letters (no D, F, I, O, Q, U; first not W or Z)', context: 'postal code', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'au_postcode', label: 'Australia postcode', category: 'contact', regions: ['AU'], token: 'POSTCODE', format: '4 digits after a state: `NSW 2000`', validation: 'Context required: state abbreviation just before it, or "postcode"', context: 'NSW, VIC, QLD, SA, WA, TAS, NT, ACT, postcode', contextRequired: true, confidence: 'medium (with context)', best: 'medium' }),
  T({ id: 'nz_postcode', label: 'New Zealand postcode', category: 'contact', regions: ['NZ'], token: 'POSTCODE', format: '4 digits after a town: `Wellington 6011`', validation: 'Context required: a New Zealand town or city just before it, or "postcode"', context: 'Auckland, Wellington, Christchurch, … , postcode, New Zealand', contextRequired: true, confidence: 'medium (with context)', best: 'medium' }),

  /* ── Health ── */
  T({ id: 'uk_nhs', label: 'UK NHS number', category: 'health', regions: ['UK'], token: 'NHS_NUMBER', format: '`943 476 5919` or 10 digits', validation: 'NHS mod-11 check digit', context: 'NHS, health service', confidence: 'low (10 digits) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'nz_nhi', label: 'New Zealand NHI number', category: 'health', regions: ['NZ'], token: 'NHI_NUMBER', format: '`ZZZ0016` (3 letters, 4 digits) or the new `ZZZ00AC` format', validation: 'NHI mod-11 (old) or mod-23 (new) check character; no I or O', context: 'NHI, national health index, patient', confidence: 'low; high with context', best: 'high' }),
  T({ id: 'au_medicare', label: 'Australia Medicare number', category: 'health', regions: ['AU'], token: 'MEDICARE_NUMBER', format: '`2123 45670 1` (10 digits, optional issue number)', validation: 'First digit 2–6; weighted check digit', context: 'Medicare', confidence: 'low (digits only) or medium (grouped); high with context', best: 'high' }),
  T({ id: 'us_mbi', label: 'US Medicare Beneficiary Identifier', category: 'health', regions: ['US'], token: 'MBI', format: '`1EG4-TE5-MK73` (11 characters)', validation: 'CMS MBI structure (letters exclude S, L, O, I, B, Z)', context: 'Medicare, MBI, beneficiary', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'medical_record_number', label: 'Medical record number', category: 'health', regions: ['global'], token: 'MRN', format: '5–12 digits, optionally with a letter prefix or a dash', validation: 'Context word required', context: 'MRN, medical record, patient ID, hospital number, chart number', contextRequired: true, confidence: 'high (with context)', best: 'high' }),

  /* ── Technical ── */
  T({ id: 'ip_address', label: 'IPv4 address', category: 'technical', regions: ['global'], token: 'IP_ADDRESS', format: '`192.0.2.10`', validation: 'Four octets 0–255; not a version number like 1.2.3.4 in "version 1.2.3.4"', context: 'IP, host, server, address', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'ipv6_address', label: 'IPv6 address', category: 'technical', regions: ['global'], token: 'IP_ADDRESS', format: '`2001:db8::1`', validation: 'A valid IPv6 address', context: 'IP, host', confidence: 'high', best: 'high' }),
  T({ id: 'mac_address', label: 'MAC address', category: 'technical', regions: ['global'], token: 'MAC_ADDRESS', format: '`00:1A:2B:3C:4D:5E`, `00-1A-…`, `001a.2b3c.4d5e`', validation: 'Six hex pairs with one separator', context: 'MAC, hardware address, ethernet', confidence: 'medium; high with context', best: 'high' }),
  T({ id: 'url', label: 'URL', category: 'technical', regions: ['global'], token: 'URL', format: '`https://…`', validation: 'http / https link', context: '—', confidence: 'medium', best: 'medium' }),

  /* ── Credentials ── */
  T({ id: 'api_key', label: 'API key or token', category: 'credentials', regions: ['global'], token: 'API_KEY', format: 'Known prefixes (`sk-`, `sk_live_`, `AKIA`, `ghp_`, `github_pat_`, `xoxb-`, `AIza`, `glpat-`, `npm_`, `SG.`) or a long random value after key / secret / token =', validation: 'Prefix and length; others: Shannon entropy ≥ 3.5 bits per character', context: 'api key, secret, token, access key', confidence: 'high (known prefix); medium (entropy)', best: 'high' }),
  T({ id: 'jwt', label: 'JSON Web Token', category: 'credentials', regions: ['global'], token: 'JWT', format: '`eyJ….eyJ….…`', validation: 'The header decodes to JSON with `alg`', context: '—', confidence: 'high', best: 'high' }),
  T({ id: 'private_key', label: 'Private key', category: 'credentials', regions: ['global'], token: 'PRIVATE_KEY', format: '`-----BEGIN … PRIVATE KEY-----` … `-----END … PRIVATE KEY-----`', validation: 'PEM armour', context: '—', confidence: 'high', best: 'high' }),
  T({ id: 'password', label: 'Password', category: 'credentials', regions: ['global'], token: 'PASSWORD', format: 'The value after `password:`, `pwd=`, `passcode:`', validation: '4–64 characters (only the value is redacted)', context: 'password, passwd, pwd, passcode, PIN', contextRequired: true, confidence: 'high', best: 'high' }),

  /* ── AI (opt-in) ── */
  T({ id: 'person_name', label: 'Person name (AI)', category: 'identity', regions: ['global'], token: 'NAME', format: 'Names of people, found by the AI model you choose', validation: 'Probabilistic: a model\'s judgement, not a pattern', context: '—', confidence: 'medium (AI)', best: 'medium', ai: true }),
]

export const INFO_TYPE_BY_ID: Record<string, InfoTypeMeta> = Object.fromEntries(INFO_TYPES.map((t) => [t.id, t]))

/** Pattern-based types (the AI ones are added only when AI detection is on). */
export const PATTERN_INFO_TYPES = INFO_TYPES.filter((t) => !t.ai)

/** Does a type apply to any of the chosen regions? (Empty list = all.) */
export function inRegions(t: InfoTypeMeta, regions: readonly string[] | undefined): boolean {
  if (!regions?.length) return true
  if (t.regions.includes('global')) return true
  return t.regions.some((r) => regions.includes(r) || (regions.includes('EU') && EU_COUNTRIES.includes(r)))
}

/**
 * Resolve the chosen info types: `*` is every pattern type, `@high` every
 * pattern type that can reach high confidence, `category:<id>` a category;
 * the region filter then applies.
 */
export function resolveInfoTypes(ids: readonly string[] | undefined, regions?: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of ids ?? []) {
    const id = String(raw).trim()
    if (id === '*') PATTERN_INFO_TYPES.forEach((t) => out.add(t.id))
    else if (id === '@high') PATTERN_INFO_TYPES.filter((t) => t.best === 'high').forEach((t) => out.add(t.id))
    else if (id.startsWith('category:')) PATTERN_INFO_TYPES.filter((t) => t.category === id.slice(9)).forEach((t) => out.add(t.id))
    else if (INFO_TYPE_BY_ID[id]) out.add(id)
  }
  return [...out].filter((id) => inRegions(INFO_TYPE_BY_ID[id], regions))
}

/** Markdown reference table (docs). */
export function infoTypeReferenceMarkdown(): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  const rows = INFO_TYPES.map((t) => `| ${esc(t.label)} | \`${t.id}\` | ${INFO_CATEGORIES.find((c) => c.id === t.category)!.label} | ${t.regions.join(', ')} | ${esc(t.format)} | ${esc(t.validation)} | ${esc(t.context)}${t.contextRequired ? ' (required)' : ''} | ${esc(t.confidence)} |`)
  return ['| Type | `info_types` value | Category | Regions | Format | Validation | Context words | Confidence |', '|---|---|---|---|---|---|---|---|', ...rows].join('\n')
}
