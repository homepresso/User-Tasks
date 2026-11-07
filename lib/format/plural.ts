/**
 * Counted nouns without the "1 runs" bug (docs/design/foundations.md →
 * Formatting). English plural rules via Intl.PluralRules; pass the plural
 * form for irregular nouns.
 *
 *   plural(1, 'run')                 → "1 run"
 *   plural(3, 'reference')           → "3 references"
 *   plural(2, 'entry')               → "2 entries"
 *   plural(0, 'person', 'people')    → "0 people"
 *   plural(1234, 'row')              → "1,234 rows"
 */

import { formatCount } from './number'

const rules = new Intl.PluralRules('en')

/** Regular English plural of a lower- or title-case noun. */
export function pluralForm(noun: string): string {
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}${noun.endsWith('Y') ? 'IES' : 'ies'}`
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`
  return `${noun}s`
}

/** The noun alone, singular or plural for `n`. */
export function pluralWord(n: number, singular: string, pluralNoun?: string): string {
  return rules.select(n) === 'one' ? singular : (pluralNoun ?? pluralForm(singular))
}

/** `n` (grouped) plus the noun in the right number. */
export function plural(n: number, singular: string, pluralNoun?: string, opts: { locale?: string } = {}): string {
  return `${formatCount(n, { locale: opts.locale, maxFractionDigits: 2 })} ${pluralWord(n, singular, pluralNoun)}`
}
