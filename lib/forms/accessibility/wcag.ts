/**
 * The WCAG 2.2 success criteria the form checker refers to: title, level and
 * the "Understanding" page slug (https://www.w3.org/WAI/WCAG22/Understanding/<slug>).
 */

import type { WcagLevel } from './types'

export interface WcagCriterion {
  title: string
  level: WcagLevel
  slug: string
}

export const WCAG_CRITERIA: Record<string, WcagCriterion> = {
  '1.1.1': { title: 'Non-text Content', level: 'A', slug: 'non-text-content' },
  '1.3.1': { title: 'Info and Relationships', level: 'A', slug: 'info-and-relationships' },
  '1.3.2': { title: 'Meaningful Sequence', level: 'A', slug: 'meaningful-sequence' },
  '1.3.5': { title: 'Identify Input Purpose', level: 'AA', slug: 'identify-input-purpose' },
  '1.4.1': { title: 'Use of Color', level: 'A', slug: 'use-of-color' },
  '1.4.3': { title: 'Contrast (Minimum)', level: 'AA', slug: 'contrast-minimum' },
  '1.4.11': { title: 'Non-text Contrast', level: 'AA', slug: 'non-text-contrast' },
  '2.1.1': { title: 'Keyboard', level: 'A', slug: 'keyboard' },
  '2.2.1': { title: 'Timing Adjustable', level: 'A', slug: 'timing-adjustable' },
  '2.4.2': { title: 'Page Titled', level: 'A', slug: 'page-titled' },
  '2.4.3': { title: 'Focus Order', level: 'A', slug: 'focus-order' },
  '2.4.6': { title: 'Headings and Labels', level: 'AA', slug: 'headings-and-labels' },
  '2.4.7': { title: 'Focus Visible', level: 'AA', slug: 'focus-visible' },
  '2.5.3': { title: 'Label in Name', level: 'A', slug: 'label-in-name' },
  '2.5.8': { title: 'Target Size (Minimum)', level: 'AA', slug: 'target-size-minimum' },
  '3.1.1': { title: 'Language of Page', level: 'A', slug: 'language-of-page' },
  '3.1.2': { title: 'Language of Parts', level: 'AA', slug: 'language-of-parts' },
  '3.3.1': { title: 'Error Identification', level: 'A', slug: 'error-identification' },
  '3.3.2': { title: 'Labels or Instructions', level: 'A', slug: 'labels-or-instructions' },
  '3.3.3': { title: 'Error Suggestion', level: 'AA', slug: 'error-suggestion' },
  '4.1.2': { title: 'Name, Role, Value', level: 'A', slug: 'name-role-value' },
  '4.1.3': { title: 'Status Messages', level: 'AA', slug: 'status-messages' },
}

export function wcagUrl(sc: string): string | null {
  const c = WCAG_CRITERIA[sc]
  return c ? `https://www.w3.org/WAI/WCAG22/Understanding/${c.slug}` : null
}

/** The strictest level among criteria ('A' when any is level A). */
export function levelOf(criteria: string[]): WcagLevel {
  return criteria.some((sc) => WCAG_CRITERIA[sc]?.level === 'A') ? 'A' : 'AA'
}

/** axe-core tags (wcag111, wcag2a, …) → success criteria numbers. */
export function criteriaFromAxeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const tag of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag)
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`)
  }
  return [...new Set(out)]
}
