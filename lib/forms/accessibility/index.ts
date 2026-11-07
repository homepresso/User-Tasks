/**
 * WCAG 2.2 AA checker for form definitions: static rules over the field
 * list, grid, header, buttons and mini theme (colours via the theme
 * engine), a 0–100 score, and the fixes the designer applies. Pure and
 * isomorphic — the designer's Accessibility tab, the pre-publish gate in
 * lib/services/forms, POST /api/v1/forms/{id}/accessibility, the MCP tool
 * forms_check_accessibility and the report job all call
 * checkFormAccessibility.
 *
 *   const result = checkFormAccessibility(def, { theme: { light, dark, overrides }, language: 'en' })
 *   result.score          // 100 = no findings
 *   result.findings[0].fix // apply with applyAccessibilityFix(def, fix)
 *
 * A scan of the rendered form (axe-core, ./axe.ts) adds findings with
 * mergeFindings; the score is recomputed from the merged list.
 */

import type { FormDefinition } from '@/lib/forms/definition'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeFormHeader } from '@/lib/forms/header'
import { layoutKeyOrder } from '@/lib/forms/layout'
import { isDisplayField, type TaskFieldDef } from '@/lib/task-field-schema'
import { contrastFindings, selectedStateFindings } from './contrast'
import { STRUCTURAL_RULES, type RuleContext } from './rules'
import {
  SEVERITIES, type AccessibilityFinding, type AccessibilityFix, type AccessibilityResult, type AccessibilityRuleInfo,
  type AccessibilitySummary, type CheckOptions, type Severity,
} from './types'

export * from './types'
export { suggestAutocomplete } from './input-purpose'
export { wcagUrl, WCAG_CRITERIA } from './wcag'

export const CHECKER_VERSION = 1

/** Every rule the checker runs (static + colour). */
export const RULES: AccessibilityRuleInfo[] = [
  ...STRUCTURAL_RULES.map((r) => r.info),
  { rule: 'contrast-text', title: 'Text contrast (4.5:1)', wcag: ['1.4.3'], level: 'AA' },
  { rule: 'contrast-placeholder', title: 'Placeholder contrast (4.5:1)', wcag: ['1.4.3'], level: 'AA' },
  { rule: 'contrast-non-text', title: 'Input borders (3:1)', wcag: ['1.4.11'], level: 'AA' },
  { rule: 'contrast-focus', title: 'Focus indicator (3:1)', wcag: ['2.4.7', '1.4.11'], level: 'AA' },
  { rule: 'contrast-button', title: 'Button text (4.5:1)', wcag: ['1.4.3'], level: 'AA' },
  { rule: 'contrast-theme', title: 'Form theme colours meet their targets', wcag: ['1.4.3', '1.4.11'], level: 'AA' },
  { rule: 'color-only-state', title: 'Selected state is not colour alone', wcag: ['1.4.1', '1.4.11'], level: 'A' },
]

const COLOUR_RULES = new Set(['contrast-text', 'contrast-placeholder', 'contrast-non-text', 'contrast-focus', 'contrast-button', 'contrast-theme', 'color-only-state'])

/** Points a finding takes off the score; a rule loses at most RULE_CAP. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, serious: 6, moderate: 3, minor: 1, review: 0.5 }
export const RULE_CAP = 20

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3, review: 4 }

/** 100 minus each rule's (capped) weighted findings. 100 only with no findings at all. */
export function scoreFindings(findings: AccessibilityFinding[]): number {
  const byRule = new Map<string, number>()
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + SEVERITY_WEIGHT[f.severity])
  let penalty = 0
  for (const points of byRule.values()) penalty += Math.min(RULE_CAP, points)
  return Math.max(0, Math.floor(100 - penalty))
}

export function summarize(findings: AccessibilityFinding[]): AccessibilitySummary {
  const summary: AccessibilitySummary = { total: findings.length, critical: 0, serious: 0, moderate: 0, minor: 0, review: 0 }
  for (const f of findings) summary[f.severity] += 1
  return summary
}

function sortFindings(findings: AccessibilityFinding[]): AccessibilityFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id))
}

/** Fields in the order keyboard users meet them (the grid's reading order). */
function readingOrder(def: FormDefinition): TaskFieldDef[] {
  if (!def.layout) return def.fields
  const byKey = new Map(def.fields.map((f) => [f.key, f]))
  const order = layoutKeyOrder(def.layout).map((k) => byKey.get(k)).filter((f): f is TaskFieldDef => Boolean(f))
  const placed = new Set(order.map((f) => f.key))
  return [...order, ...def.fields.filter((f) => !placed.has(f.key))]
}

/** Result for a list of findings (score, summary, rules that passed). */
export function resultFrom(findings: AccessibilityFinding[], opts: CheckOptions = {}): AccessibilityResult {
  const sorted = sortFindings(findings)
  const failing = new Set(sorted.map((f) => f.rule))
  const ran = opts.structuralOnly ? RULES.filter((r) => !COLOUR_RULES.has(r.rule)) : RULES
  return {
    score: scoreFindings(sorted),
    findings: sorted,
    summary: summarize(sorted),
    passed: ran.filter((r) => !failing.has(r.rule)),
    version: CHECKER_VERSION,
  }
}

export function checkFormAccessibility(def: FormDefinition, opts: CheckOptions = {}): AccessibilityResult {
  const ordered = readingOrder(def)
  const context: RuleContext = {
    def,
    opts,
    ordered,
    // Labels are display text, not inputs: the dynamic-labels rule checks them.
    values: ordered.filter((f) => !isDisplayField(f) && f.type !== 'label'),
    byKey: new Map(def.fields.map((f) => [f.key, f])),
  }
  const findings = STRUCTURAL_RULES.flatMap((rule) => rule.run(context))
  if (!opts.structuralOnly) findings.push(...contrastFindings(def, opts), ...selectedStateFindings(def, opts))
  return resultFrom(dedupe(findings), opts)
}

function dedupe(findings: AccessibilityFinding[]): AccessibilityFinding[] {
  const seen = new Set<string>()
  return findings.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
}

/**
 * Checker findings plus another source's (axe): duplicates — same id, or
 * the same rule on the same field / targets — are dropped, then the score
 * is recomputed.
 */
/** Rules that report the same problem (a missing name) for dedupe. */
const family = (rule: string) => (rule === 'label-placeholder-only' ? 'label-missing' : rule)

export function mergeFindings(result: AccessibilityResult, extra: AccessibilityFinding[], opts: CheckOptions = {}): AccessibilityResult {
  const all = [...result.findings]
  const ids = new Set(all.map((f) => f.id))
  const onField = new Set(all.filter((f) => f.field_key).map((f) => `${family(f.rule)}|${f.field_key}`))
  const onTargets = new Set(all.filter((f) => f.targets?.length).map((f) => `${f.rule}|${f.targets!.join(',')}`))
  for (const f of extra) {
    if (ids.has(f.id)) continue
    if (f.field_key && onField.has(`${family(f.rule)}|${f.field_key}`)) continue
    if (f.targets?.length && onTargets.has(`${f.rule}|${f.targets.join(',')}`)) continue
    ids.add(f.id)
    if (f.field_key) onField.add(`${family(f.rule)}|${f.field_key}`)
    if (f.targets?.length) onTargets.add(`${f.rule}|${f.targets.join(',')}`)
    all.push(f)
  }
  return resultFrom(all, opts)
}

/** Top findings as one line each (validation errors, CLI). */
export function describeFindings(findings: AccessibilityFinding[], limit = 5): string {
  const shown = findings.slice(0, limit).map((f) => `[${f.severity}] ${f.message} (WCAG ${f.wcag.join(', ')})`)
  const more = findings.length > limit ? ` …and ${findings.length - limit} more` : ''
  return shown.join('; ') + more
}

/** The fix's patch with a prompt answer filled in. */
export function fixPatch(fix: AccessibilityFix, answer?: string): Record<string, unknown> {
  if (!fix.prompt || answer === undefined) return fix.patch
  return { ...fix.patch, [fix.prompt.property]: answer }
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

/** Apply a fix to a definition (pure). `answer` fills a prompt (alt text, a label). */
export function applyAccessibilityFix(def: FormDefinition, fix: AccessibilityFix, answer?: string): FormDefinition {
  const patch = fixPatch(fix, answer)
  switch (fix.kind) {
    case 'field':
      return { ...def, fields: def.fields.map((f) => (f.key === fix.field_key ? withoutUndefined({ ...f, ...patch } as Record<string, unknown>) as unknown as TaskFieldDef : f)) }
    case 'header':
      return { ...def, header: normalizeFormHeader({ ...(def.header ?? { enabled: true, image: 'none' }), ...patch }) }
    case 'theme':
      return patch.theme ? { ...def, theme: patch.theme as FormDefinition['theme'] } : def
    case 'button': {
      const buttons = normalizeFormButtons(def.buttons ?? null).map((b) => (b.id === fix.button_id ? { ...b, ...patch } : b))
      return { ...def, buttons }
    }
  }
}

export { SEVERITIES }
