/**
 * "Compare with published": a readable summary of what a form draft changes
 * against the published version — fields added, removed or changed (and
 * which of their settings), rules added / removed / changed, layout, theme,
 * buttons and header. Pure; shared by the designer's Compare dialog, the
 * Publish dialog, REST GET /forms/{id}/draft/compare and MCP
 * forms_draft_compare.
 */

import { layoutFormRules } from './form-rules'

/* eslint-disable @typescript-eslint/no-explicit-any -- form content is free-form JSON */

export interface FormContentLike {
  fields?: unknown
  layout?: unknown
  theme?: unknown
  buttons?: unknown
  header?: unknown
}

export interface FormDraftDiff {
  fields: {
    added: Array<{ key: string; label: string; type: string }>
    removed: Array<{ key: string; label: string; type: string }>
    changed: Array<{ key: string; label: string; settings: string[] }>
  }
  rules: { added: string[]; removed: string[]; changed: string[] }
  layout_changed: boolean
  theme_changed: boolean
  buttons_changed: boolean
  header_changed: boolean
  /** Nothing differs. */
  unchanged: boolean
  /** One line per change, for people ("Added 2 fields: “Amount”, “Notes”"). */
  lines: string[]
}

const stable = (v: unknown): string => JSON.stringify(sortKeys(v ?? null))

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) {
      if (k === '_id') continue
      out[k] = sortKeys((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

function fieldList(raw: unknown): any[] {
  return Array.isArray(raw) ? raw.filter((f) => f && typeof f === 'object' && typeof f.key === 'string') : []
}

const label = (f: any) => String(f?.label || f?.key || '')
const quote = (xs: string[], max = 6) => xs.slice(0, max).map((x) => `“${x}”`).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The layout without its rules (rules are compared on their own). */
function layoutShape(layout: unknown): unknown {
  if (!layout || typeof layout !== 'object') return null
  const rest = { ...(layout as Record<string, unknown>) }
  delete rest.rules
  return rest
}

function ruleName(r: any, i: number): string {
  return String(r?.name || r?.id || `Rule ${i + 1}`)
}

export function diffFormContent(published: FormContentLike, draft: FormContentLike): FormDraftDiff {
  const before = new Map(fieldList(published.fields).map((f) => [String(f.key), f]))
  const after = new Map(fieldList(draft.fields).map((f) => [String(f.key), f]))
  const added = [...after.values()].filter((f) => !before.has(String(f.key))).map((f) => ({ key: String(f.key), label: label(f), type: String(f.type ?? '') }))
  const removed = [...before.values()].filter((f) => !after.has(String(f.key))).map((f) => ({ key: String(f.key), label: label(f), type: String(f.type ?? '') }))
  const changed: FormDraftDiff['fields']['changed'] = []
  for (const [key, f] of after) {
    const old = before.get(key)
    if (!old || stable(old) === stable(f)) continue
    const keys = new Set([...Object.keys(old), ...Object.keys(f)].filter((k) => k !== '_id'))
    const settings = [...keys].filter((k) => stable((old as any)[k]) !== stable((f as any)[k])).sort()
    changed.push({ key, label: label(f), settings })
  }

  const rulesBefore = layoutFormRules(published.layout)
  const rulesAfter = layoutFormRules(draft.layout)
  const ruleKey = (r: any, i: number) => String(r?.id ?? `#${i}`)
  const rb = new Map(rulesBefore.map((r, i) => [ruleKey(r, i), { r, name: ruleName(r, i) }]))
  const ra = new Map(rulesAfter.map((r, i) => [ruleKey(r, i), { r, name: ruleName(r, i) }]))
  const rules = {
    added: [...ra].filter(([k]) => !rb.has(k)).map(([, v]) => v.name),
    removed: [...rb].filter(([k]) => !ra.has(k)).map(([, v]) => v.name),
    changed: [...ra].filter(([k, v]) => rb.has(k) && stable(rb.get(k)!.r) !== stable(v.r)).map(([, v]) => v.name),
  }

  const layout_changed = stable(layoutShape(published.layout)) !== stable(layoutShape(draft.layout))
  const theme_changed = stable(published.theme ?? { source: 'workspace' }) !== stable(draft.theme ?? { source: 'workspace' })
  const buttons_changed = stable(published.buttons) !== stable(draft.buttons)
  const header_changed = stable(published.header) !== stable(draft.header)

  const lines: string[] = []
  if (added.length) lines.push(`Added ${plural(added.length, 'field')}: ${quote(added.map((f) => f.label))}`)
  if (removed.length) lines.push(`Removed ${plural(removed.length, 'field')}: ${quote(removed.map((f) => f.label))}`)
  for (const c of changed.slice(0, 10)) lines.push(`Changed “${c.label}”: ${c.settings.slice(0, 6).join(', ')}${c.settings.length > 6 ? '…' : ''}`)
  if (changed.length > 10) lines.push(`Changed ${changed.length - 10} more fields`)
  if (rules.added.length) lines.push(`Added ${plural(rules.added.length, 'rule')}: ${quote(rules.added)}`)
  if (rules.removed.length) lines.push(`Removed ${plural(rules.removed.length, 'rule')}: ${quote(rules.removed)}`)
  if (rules.changed.length) lines.push(`Changed ${plural(rules.changed.length, 'rule')}: ${quote(rules.changed)}`)
  if (layout_changed) lines.push('Layout changed (rows, steps, sections or settings)')
  if (theme_changed) lines.push('Theme changed')
  if (buttons_changed) lines.push('Buttons changed')
  if (header_changed) lines.push('Header changed')

  return {
    fields: { added, removed, changed },
    rules,
    layout_changed, theme_changed, buttons_changed, header_changed,
    unchanged: lines.length === 0,
    lines: lines.length ? lines : ['No changes from the published version'],
  }
}
