/**
 * HTML autofill tokens (WHATWG "autocomplete" attribute) a form field may
 * declare as its input purpose (WCAG 2.2 SC 1.3.5 Identify Input Purpose).
 * Stored on a field as `autocomplete` (lib/task-field-schema.ts) and
 * rendered on its <input> / <textarea>; the accessibility checker
 * (lib/forms/accessibility) suggests one for personal-data fields.
 *
 * Only the standard grammar is accepted: `on`, `off`, or an optional
 * `shipping` / `billing` hint, an optional contact hint (home, work, mobile,
 * fax, pager — before tel* / email / impp only) and one field name.
 * Pure and isomorphic.
 */

export const AUTOCOMPLETE_FIELD_NAMES = [
  'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix', 'nickname',
  'username', 'new-password', 'current-password', 'one-time-code',
  'organization-title', 'organization',
  'street-address', 'address-line1', 'address-line2', 'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1',
  'country', 'country-name', 'postal-code',
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
  'transaction-currency', 'transaction-amount', 'language',
  'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo',
  'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix', 'tel-extension',
  'email', 'impp',
] as const

export type AutocompleteFieldName = (typeof AUTOCOMPLETE_FIELD_NAMES)[number]

const FIELD_NAMES: ReadonlySet<string> = new Set(AUTOCOMPLETE_FIELD_NAMES)
const CONTACT_FIELDS: ReadonlySet<string> = new Set(['tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix', 'tel-extension', 'email', 'impp'])
const CONTACT_HINTS: ReadonlySet<string> = new Set(['home', 'work', 'mobile', 'fax', 'pager'])

/** A valid autocomplete value (lower-cased, single-spaced), or undefined. */
export function normalizeAutocomplete(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 3) return undefined
  if (tokens.length === 1 && (tokens[0] === 'on' || tokens[0] === 'off')) return tokens[0]
  const field = tokens[tokens.length - 1]
  if (!FIELD_NAMES.has(field)) return undefined
  let i = 0
  if (tokens[i] === 'shipping' || tokens[i] === 'billing') i += 1
  if (i < tokens.length - 1 && CONTACT_HINTS.has(tokens[i])) {
    if (!CONTACT_FIELDS.has(field)) return undefined
    i += 1
  }
  if (i !== tokens.length - 1) return undefined
  return tokens.join(' ')
}

/** Labels for the designer's picker. */
export const AUTOCOMPLETE_LABELS: Partial<Record<AutocompleteFieldName, string>> = {
  name: 'Full name',
  'given-name': 'First name',
  'additional-name': 'Middle name',
  'family-name': 'Last name',
  nickname: 'Nickname',
  'honorific-prefix': 'Title (Mr, Ms, Dr…)',
  username: 'Username',
  organization: 'Organization',
  'organization-title': 'Job title',
  'street-address': 'Street address (multi-line)',
  'address-line1': 'Address line 1',
  'address-line2': 'Address line 2',
  'address-level2': 'City / town',
  'address-level1': 'State / province / region',
  'postal-code': 'Postal code',
  'country-name': 'Country',
  email: 'Email',
  tel: 'Phone',
  url: 'Website',
  bday: 'Date of birth',
  sex: 'Gender',
  language: 'Preferred language',
  'cc-name': 'Name on card',
  'one-time-code': 'One-time code',
}
