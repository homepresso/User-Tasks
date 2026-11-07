/**
 * axe-core scans of the rendered form (the designer's preview): the
 * violations become checker findings, mapped onto the checker's own rules
 * where they mean the same thing so mergeFindings can drop duplicates.
 * axe-core is loaded on demand in the browser only.
 */

import type { AccessibilityFinding, Severity } from './types'
import { criteriaFromAxeTags, levelOf } from './wcag'

/** The parts of an axe result this module reads. */
export interface AxeNodeLike { target: unknown[]; failureSummary?: string; html?: string }
export interface AxeViolationLike {
  id: string
  impact?: 'minor' | 'moderate' | 'serious' | 'critical' | null
  tags: string[]
  help: string
  description: string
  helpUrl?: string
  nodes: AxeNodeLike[]
}
export interface AxeResultsLike { violations: AxeViolationLike[]; incomplete?: AxeViolationLike[] }

/** axe rule → the checker rule reporting the same problem. */
export const AXE_RULE_MAP: Record<string, string> = {
  label: 'label-missing',
  'label-title-only': 'label-placeholder-only',
  'aria-input-field-name': 'label-missing',
  'aria-toggle-field-name': 'label-missing',
  'select-name': 'label-missing',
  'color-contrast': 'contrast-text',
  'image-alt': 'image-alt',
  'button-name': 'button-names',
  'autocomplete-valid': 'input-purpose',
  'empty-heading': 'headings',
  'heading-order': 'headings',
  'html-has-lang': 'language',
  'html-lang-valid': 'language',
  'target-size': 'target-size',
  'link-in-text-block': 'color-only-state',
}

const SEVERITY: Record<string, Severity> = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' }

const targetString = (t: unknown[]): string => t.map((part) => (Array.isArray(part) ? part.join(' ') : String(part))).join(' ')

/**
 * Field key from a node selector: the renderer's input ids are
 * `<prefix><key>` (`#preview-first_name`, `#preview-first_name-label`).
 */
export function fieldKeyFromTarget(target: string, idPrefix: string, keys: string[]): string | undefined {
  const m = new RegExp(`#${idPrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([a-z0-9_]+)`).exec(target)
  if (!m) return undefined
  const id = m[1]
  // Longest key that the id starts with (`first_name-label` → first_name).
  return keys.filter((k) => id === k || id.startsWith(`${k}-`) || id.startsWith(`${k}_label`)).sort((a, b) => b.length - a.length)[0]
}

export function axeResultsToFindings(results: AxeResultsLike, options: { mode?: 'light' | 'dark'; idPrefix?: string; fieldKeys?: string[] } = {}): AccessibilityFinding[] {
  const out: AccessibilityFinding[] = []
  for (const v of results.violations ?? []) {
    const wcag = criteriaFromAxeTags(v.tags)
    // Best practices (no WCAG criterion) are left out: the score is about WCAG 2.2 AA.
    if (!wcag.length) continue
    const rule = AXE_RULE_MAP[v.id] ?? `axe-${v.id}`
    for (const node of v.nodes) {
      const target = targetString(node.target)
      const fieldKey = options.fieldKeys ? fieldKeyFromTarget(target, options.idPrefix ?? 'preview-', options.fieldKeys) : undefined
      out.push({
        id: `axe:${v.id}:${target}`,
        rule,
        severity: SEVERITY[v.impact ?? ''] ?? 'moderate',
        wcag,
        level: levelOf(wcag),
        ...(fieldKey ? { field_key: fieldKey } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        message: `${v.help}${fieldKey ? '' : ` (${target})`}`,
        help: [node.failureSummary?.split('\n').slice(0, 3).join(' '), v.helpUrl].filter(Boolean).join(' — ') || v.description,
        source: 'axe',
        targets: [target],
      })
    }
  }
  return out
}

/**
 * Run axe-core on a rendered element (browser only): WCAG 2.0–2.2 A / AA
 * rules, scoped to `element`.
 */
export async function runAxeScan(element: Element, options: { mode?: 'light' | 'dark'; idPrefix?: string; fieldKeys?: string[] } = {}): Promise<AccessibilityFinding[]> {
  const mod = await import('axe-core')
  const axe = (mod as unknown as { default?: typeof mod }).default ?? mod
  const results = await axe.run(element, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    resultTypes: ['violations'],
  })
  return axeResultsToFindings(results as unknown as AxeResultsLike, options)
}
