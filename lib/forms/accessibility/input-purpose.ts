/**
 * Input purpose (WCAG 1.3.5): the autofill token a field that collects
 * personal data about the person filling it in should declare, guessed from
 * its type, key and label.
 */

import type { TaskFieldDef } from '@/lib/task-field-schema'

/** Field types that render an <input> / <textarea> the token can go on. */
export const AUTOCOMPLETE_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'email', 'phone', 'url', 'date', 'number'])

/** [pattern on "key label" (lower case, separators as spaces), token], first match wins. */
const RULES: Array<[RegExp, string, ReadonlyArray<string>?]> = [
  [/\b(e ?mail|email address)\b/, 'email'],
  [/\b(phone|mobile|cell|telephone|tel)\b/, 'tel'],
  [/\b(first name|given name|forename|firstname|givenname)\b/, 'given-name'],
  [/\b(last name|surname|family name|lastname|familyname)\b/, 'family-name'],
  [/\b(middle name|middlename)\b/, 'additional-name'],
  [/\bnickname\b/, 'nickname'],
  [/\b(full name|fullname|your name|contact name|applicant name|legal name)\b|^name( name)?$/, 'name'],
  [/\b(user ?name|login)\b/, 'username'],
  [/\b(job title|position|role title)\b/, 'organization-title'],
  [/\b(company|organi[sz]ation|employer|business name)\b/, 'organization'],
  [/\b(address line ?1|address1|street)\b/, 'address-line1'],
  [/\b(address line ?2|address2|apartment|suite)\b/, 'address-line2'],
  [/\b(post ?code|postal code|zip|zip code|postcode)\b/, 'postal-code'],
  [/\b(city|town|suburb)\b/, 'address-level2'],
  [/\b(province|region|county|state)\b/, 'address-level1'],
  [/\bcountry\b/, 'country-name'],
  [/\b(address|home address|postal address|mailing address|street address)\b/, 'street-address'],
  [/\b(birth ?date|date of birth|dob|birthday|bday)\b/, 'bday'],
  [/\b(gender|sex)\b/, 'sex'],
  [/\b(website|homepage|home page|web site)\b/, 'url'],
  [/\b(card number|credit card|cc number)\b/, 'cc-number'],
  [/\b(preferred language|language)\b/, 'language'],
]

/** Words that mean the field is about something else (an order's status, a project's country of origin…). */
const NOT_PERSONAL = /\b(status|statement|estate|manager|approver|supplier|vendor|customer|product|project|order|ship(ping)? date|due|invoice|ticket|item)\b/

/** Tokens a field type can sensibly carry. */
function fitsType(token: string, type: string): boolean {
  if (type === 'email') return token === 'email'
  if (type === 'phone') return token === 'tel'
  if (type === 'url') return token === 'url'
  if (type === 'date') return token === 'bday'
  if (type === 'number') return token === 'postal-code' || token === 'cc-number'
  if (token === 'bday') return false
  return true
}

/** The autofill token this field should declare, or null when it isn't recognisably personal data. */
export function suggestAutocomplete(field: Pick<TaskFieldDef, 'key' | 'label' | 'type'>): string | null {
  if (!AUTOCOMPLETE_TYPES.has(field.type)) return null
  if (field.type === 'email') return 'email'
  if (field.type === 'phone') return 'tel'
  const text = `${field.key} ${field.label}`.toLowerCase().replace(/[_\-./]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (NOT_PERSONAL.test(text)) return null
  for (const [re, token] of RULES) {
    if (re.test(text)) return fitsType(token, field.type) ? token : null
  }
  return null
}
