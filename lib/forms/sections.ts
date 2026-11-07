/**
 * Sections: named groups of rows on a form's grid (lib/forms/layout.ts —
 * `layout.sections` declares them, a row joins one with `row.section`).
 *
 *   { key: 'spouse', title: 'Spouse details', description?, optional?,
 *     collapsible?, collapsed?, style?: 'bordered' | 'plain', add_label?,
 *     visible_when? }
 *
 * A section is the run of consecutive rows carrying its key, on one page of
 * a steps / tabs form. One level only: a row belongs to at most one section.
 *
 * Optional sections. The person chooses to fill one in ("Add <title>",
 * "Remove"). The choice travels as the value `<key>_included` (true / false)
 * — the browser sets it, an API caller may send it. While a section is not
 * included its fields are not required, not validated, and NOT KEPT: the
 * server stores them as empty (null; false for a checkbox, [] for lists) and
 * stores `<key>_included: false`, so a workflow can branch on
 * `{{task_data.<key>_included}}`. Only optional sections can be left out:
 * `<key>_included: false` sent for any other section is ignored, so a forged
 * value never skips a required field.
 *
 * Visibility. A section hides like a field: its own `visible_when`, a
 * Show / hide action or rule on `section:<key>` (bounded on the server by
 * sanitizeFormState, like every other target). A hidden section's fields are
 * not required and not checked — the same rule as hidden fields.
 *
 * Collapsing is presentation only (`__form_state.collapsed`): a collapsed
 * section's required fields are still required (it opens on an error).
 *
 * Back-compat. Before sections, `section:<heading key>` targets meant "a
 * heading and the rows under it, up to the next heading or divider". They
 * keep meaning that: a target names a declared section when its key is one
 * (section keys never equal field keys), else the heading-made section.
 *
 * Pure and isomorphic; reads stored layouts structurally (no import of the
 * field schema or layout module at runtime — both import this file).
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { FormRow, FormSection } from './layout'
import { FORM_STATE_KEY, declaredSectionKeys, readFormState, sectionRowFieldKeys, stateRuleFlag } from './form-state'

export const SECTION_INCLUDED_SUFFIX = '_included'

/** The value key recording whether an optional section was included. */
export function sectionIncludedKey(key: string): string {
  return `${key}${SECTION_INCLUDED_SUFFIX}`
}

/** The declared sections of a (stored or normalized) layout, read structurally. */
export function layoutSections(layout: unknown): FormSection[] {
  if (!isPlainObject(layout) || !Array.isArray(layout.sections)) return []
  return layout.sections.filter(isPlainObject).filter((s) => typeof s.key === 'string').map((s) => s as unknown as FormSection)
}

/** Whether a section counts as included: always for a non-optional one; an optional one only when `<key>_included` is true. */
export function isSectionIncluded(section: Pick<FormSection, 'key' | 'optional'>, values: Record<string, unknown> | null | undefined): boolean {
  if (section.optional !== true) return true
  const v = values?.[sectionIncludedKey(section.key)]
  return v === true || v === 'true'
}

/** Field keys of a declared section. */
export function sectionFieldKeys(layout: unknown, key: string): string[] {
  return sectionRowFieldKeys(layout, key)
}

/** The section a field sits in, or null. */
export function sectionOfField(layout: unknown, fieldKey: string): FormSection | null {
  for (const section of layoutSections(layout)) if (sectionFieldKeys(layout, section.key).includes(fieldKey)) return section
  return null
}

/** Fields of optional sections that are not included (not required, not checked, stored empty). */
export function excludedSectionFieldKeys(layout: unknown, values: Record<string, unknown> | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const section of layoutSections(layout)) {
    if (isSectionIncluded(section, values)) continue
    for (const key of sectionFieldKeys(layout, section.key)) out.add(key)
  }
  return out
}

/** Whether a `visible_when` holds — injected (the field schema owns the operator semantics). */
export type RuleCheck = (rule: NonNullable<FormSection['visible_when']>, values: Record<string, unknown>) => boolean

/**
 * Fields of sections whose own `visible_when` does not hold. A rule on a
 * field (or state flag) the form does not have is ignored.
 */
export function sectionRuleHiddenFieldKeys(layout: unknown, values: Record<string, unknown>, isMet: RuleCheck, knownKeys?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const section of layoutSections(layout)) {
    const rule = section.visible_when
    if (!rule || typeof rule.field !== 'string') continue
    if (!stateRuleFlag(rule.field) && knownKeys && !knownKeys.has(rule.field)) continue
    if (isMet(rule, values)) continue
    for (const key of sectionFieldKeys(layout, section.key)) out.add(key)
  }
  return out
}

/**
 * The section part of a submission: `<key>_included` for each optional
 * section, and the fields of excluded ones blanked (the caller coerces them
 * to their types' empty value). Non-optional sections add nothing.
 */
export function sectionInclusionPatch(layout: unknown, values: Record<string, unknown>): { included: Record<string, boolean>; blank: string[] } {
  const included: Record<string, boolean> = {}
  const blank: string[] = []
  for (const section of layoutSections(layout)) {
    if (section.optional !== true) continue
    const yes = isSectionIncluded(section, values)
    included[sectionIncludedKey(section.key)] = yes
    if (!yes) blank.push(...sectionFieldKeys(layout, section.key))
  }
  return { included, blank }
}

/** `<key>_included` value keys of the optional sections (downstream variables, drafts). */
export function sectionIncludedKeys(layout: unknown): string[] {
  return layoutSections(layout).filter((s) => s.optional === true).map((s) => sectionIncludedKey(s.key))
}

/** Is `key` a section's `<key>_included` value? */
export function isSectionIncludedKey(layout: unknown, key: string): boolean {
  return sectionIncludedKeys(layout).includes(key)
}

/** Consecutive rows grouped by section (rows outside a section: section null). */
export function sectionBlocks<R extends Pick<FormRow, 'section'>>(rows: R[]): Array<{ section: string | null; rows: R[]; start: number }> {
  const out: Array<{ section: string | null; rows: R[]; start: number }> = []
  rows.forEach((row, i) => {
    const key = row.section ?? null
    const last = out[out.length - 1]
    if (last && last.section === key && key !== null) last.rows.push(row)
    else out.push({ section: key, rows: [row], start: i })
  })
  return out
}

/** Is the section hidden by the state (a button / rule hid `section:<key>`)? */
export function sectionStateHidden(layout: unknown, values: Record<string, unknown> | null | undefined, key: string): boolean {
  return readFormState(layout, values).hidden.includes(`section:${key}`)
}

/** Is the section collapsed (the state; else its "start collapsed")? */
export function isSectionCollapsed(layout: unknown, values: Record<string, unknown> | null | undefined, key: string): boolean {
  return (readFormState(layout, values).collapsed ?? []).includes(`section:${key}`)
}

/**
 * `section.<key>.included` / `section.<key>.visible` in rule conditions
 * (lib/forms/form-rules.ts ruleValue). `visible` reads the state (shown
 * unless a button / rule hid it); `included` the `<key>_included` value.
 * Null when the path is not one of these.
 */
export function sectionConditionValue(path: string, values: Record<string, unknown>): boolean | null {
  const m = /^section\.([a-z][a-z0-9_]{0,51})\.(included|visible)$/.exec(path)
  if (!m) return null
  if (m[2] === 'included') { const v = values[sectionIncludedKey(m[1])]; return v === true || v === 'true' }
  const state = isPlainObject(values[FORM_STATE_KEY]) ? values[FORM_STATE_KEY] as { hidden?: unknown } : null
  return !(Array.isArray(state?.hidden) && state.hidden.includes(`section:${m[1]}`))
}

/** Problems with section keys (designer): a key equal to a field key, or whose `<key>_included` is one. */
export function sectionKeyProblem(key: string, fieldKeys: Iterable<string>, otherSections: Iterable<string> = []): string | null {
  const fields = new Set(fieldKeys)
  if (!/^[a-z][a-z0-9_]{0,51}$/.test(key)) return 'Key: lowercase letters, digits and _ (start with a letter)'
  if (fields.has(key)) return `A field already uses the key "${key}"`
  if (fields.has(sectionIncludedKey(key))) return `A field uses "${sectionIncludedKey(key)}" (an optional section stores whether it was added there)`
  if ([...otherSections].includes(key)) return `Another section uses the key "${key}"`
  return null
}

/** A section key from a title, unique against the field and section keys. */
export function sectionKeyFromTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = (title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '') || 'section').slice(0, 40)
  const free = (k: string) => !used.has(k) && !used.has(sectionIncludedKey(k))
  if (free(base)) return base
  for (let n = 2; ; n++) if (free(`${base}_${n}`)) return `${base}_${n}`
}

export { declaredSectionKeys }
