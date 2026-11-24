/**
 * XFA presence scripts → show / hide rules (pure). Matched, never run.
 *
 *   JavaScript   if (this.rawValue == "1") { A.presence = "visible"; } else { A.presence = "hidden"; }
 *   FormCalc     if ($.rawValue == 1) then A.presence = "visible" else A.presence = "hidden" endif
 *   radio option click: if (!this.isNull) { Section.presence = "visible"; }  (or no condition)
 *   initialize:  this.presence = "hidden"   → starts hidden
 *
 * A rule is HIGH confidence when the structure and the condition are
 * recognised and every target resolves to a field or subform; otherwise
 * LOW (created turned off, the script kept in its description).
 */

import { splitIfElse } from './js-actions'
import type { PdfCondition, PdfRule } from './model'
import type { XfaField, XfaScript, XfaSection, XfaTemplate } from './xfa'

export interface XfaRuleResult {
  rules: Array<Omit<PdfRule, 'id'>>
  /** Item ids / `section:<id>` targets an initialize script hides. */
  startHidden: string[]
}

const PRESENCE_RE = /([A-Za-z_$][\w.$[\]]*?)\.presence\s*=\s*["'](visible|hidden|invisible|inactive)["']/g

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n\r]*/g, '$1').trim()

function split(body: string): { cond: string; then: string; else: string } | null {
  const js = splitIfElse(body)
  if (js) return js
  const m = /^\s*if\s*\(([\s\S]*?)\)\s*then\b([\s\S]*?)(?:\belse\b([\s\S]*?))?\bendif\s*$/i.exec(body)
  if (m) return { cond: m[1], then: m[2], else: m[3] ?? '' }
  return null
}

interface Cond { subject: string | null; op: 'equals' | 'not_equals' | 'is_set' | 'is_not_set'; value?: string }

function parseCond(raw: string): Cond | null {
  const c = raw.trim().replace(/^\(+|\)+$/g, '').trim()
  let m = /^(this|\$|[A-Za-z_][\w.[\]]*)(?:\.rawValue)?\s*(==|===|!=|!==|<>|eq|ne)\s*(?:"([^"]*)"|'([^']*)'|(-?\d+(?:\.\d+)?)|(null))$/i.exec(c)
  if (m) {
    const neg = /^(!=|!==|<>|ne)$/i.test(m[2])
    const subject = m[1] === 'this' || m[1] === '$' ? null : m[1]
    if (m[6]) return { subject, op: neg ? 'is_set' : 'is_not_set' }
    return { subject, op: neg ? 'not_equals' : 'equals', value: m[3] ?? m[4] ?? m[5] ?? '' }
  }
  m = /^(!)?\s*(this|\$|[A-Za-z_][\w.[\]]*)\.isNull$/.exec(c)
  if (m) return { subject: m[2] === 'this' || m[2] === '$' ? null : m[2], op: m[1] ? 'is_set' : 'is_not_set' }
  return null
}

const lastName = (path: string) => (path.replace(/\[\d+\]/g, '').split('.').filter(Boolean).pop() ?? '')
const somNames = (som: string) => som.replace(/\[\d+\]/g, '').split('.')

/** Resolve a script's reference (a SOM-ish path or a bare name) to a field / section, nearest to the owner. */
function resolver(t: XfaTemplate) {
  const byName = new Map<string, Array<{ som: string; field?: XfaField; section?: XfaSection }>>()
  const put = (name: string, v: { som: string; field?: XfaField; section?: XfaSection }) => { const list = byName.get(name) ?? []; list.push(v); byName.set(name, list) }
  for (const f of t.fields) put(f.name, { som: f.som, field: f })
  for (const s of t.sections) put(lastName(s.som), { som: s.som, section: s })
  return (ref: string, ownerSom: string) => {
    const list = byName.get(lastName(ref)) ?? []
    if (!list.length) return null
    if (list.length === 1) return list[0]
    // Prefer the one whose path shares the longest prefix with the owner, then the reference's own path.
    const own = somNames(ownerSom)
    const want = ref.replace(/\[\d+\]/g, '').split('.')
    const score = (som: string) => {
      const names = somNames(som)
      let s = 0
      while (s < names.length && s < own.length && names[s] === own[s]) s++
      const tail = want.every((w) => names.includes(w)) ? 100 : 0
      return tail + s
    }
    return [...list].sort((a, b) => score(b.som) - score(a.som))[0]
  }
}

export function xfaScriptRules(
  t: XfaTemplate,
  ids: { field: (som: string) => string | null; section: (som: string) => string | null },
): XfaRuleResult {
  const out: XfaRuleResult = { rules: [], startHidden: [] }
  const resolve = resolver(t)
  const fieldBySom = new Map(t.fields.map((f) => [f.som, f]))
  const sectionBySom = new Map(t.sections.map((s) => [s.som, s]))
  const targetId = (ref: string, script: XfaScript): string | null => {
    if (ref === 'this' || ref === '$') {
      const f = fieldBySom.get(script.owner)
      if (f) return ids.field(f.som)
      const s = sectionBySom.get(script.owner)
      return s ? ids.section(s.som) : null
    }
    const hit = resolve(ref, script.owner)
    if (!hit) return null
    return hit.field ? ids.field(hit.som) : hit.section ? ids.section(hit.som) : null
  }
  for (const script of t.scripts) {
    const body = strip(script.body)
    if (!/\.presence\s*=/.test(body)) continue
    const activity = script.activity.toLowerCase()
    const assignments = (block: string) => [...block.matchAll(PRESENCE_RE)].map((m) => ({ ref: m[1], hide: m[2] !== 'visible' }))
    if (activity === 'initialize' || activity === 'docready' || activity === 'ready') {
      if (!/\bif\b/.test(body)) for (const a of assignments(body)) { if (!a.hide) continue; const id = targetId(a.ref, script); if (id) out.startHidden.push(id) }
      continue
    }
    if (!['click', 'change', 'exit', 'validate'].includes(activity)) continue
    const owner = fieldBySom.get(script.owner)
    if (!owner) continue
    const ownerId = ids.field(owner.som)
    if (!ownerId) continue
    const original = script.body.replace(/\s+/g, ' ').trim().slice(0, 600)
    const shape = split(body)
    const cond = shape ? parseCond(shape.cond) : null
    // The subject and value the condition is about, as an item condition.
    const toWhen = (c: Cond | null, negate: boolean): PdfCondition | null => {
      let subjectField: XfaField | undefined = owner
      if (c?.subject) {
        const hit = resolve(c.subject, script.owner)
        subjectField = hit?.field
        if (!subjectField) return null
      }
      const subjectId = ids.field(subjectField.som)
      if (!subjectId) return null
      const flip = (op: PdfCondition['op']): PdfCondition['op'] => (op === 'equals' ? 'not_equals' : op === 'not_equals' ? 'equals' : op === 'is_set' ? 'is_not_set' : 'is_set')
      // A radio option's own script: "this" is the option — selected = the group equals its value.
      if (script.member && !c?.subject) {
        const member = owner.members?.find((m) => m.name === script.member)
        if (!member) return null
        const selected = !c || c.op === 'is_set' || (c.op === 'equals' && c.value === member.onValue)
        const notSelected = c && (c.op === 'is_not_set' || (c.op === 'not_equals' && c.value === member.onValue))
        if (!selected && !notSelected) return null
        const op: PdfCondition['op'] = (selected ? !negate : negate) ? 'equals' : 'not_equals'
        return { item: subjectId, op, value: member.onValue }
      }
      if (!c) return null
      if (subjectField.ui === 'checkButton' && (c.op === 'equals' || c.op === 'not_equals')) {
        const on = c.value === (subjectField.onValue ?? '1') || c.value === '1'
        const checked = (c.op === 'equals') === on
        return { item: subjectId, op: 'equals', value: (checked !== negate) ? 'true' : 'false' }
      }
      return { item: subjectId, op: negate ? flip(c.op) : c.op, ...(c.value !== undefined ? { value: c.value } : {}) }
    }
    const push = (block: string, when: PdfCondition | null, high: boolean) => {
      const list = assignments(block)
      const byMode = new Map<'show' | 'hide', string[]>()
      let unresolved = 0
      for (const a of list) {
        const id = targetId(a.ref, script)
        if (!id) { unresolved++; continue }
        const mode = a.hide ? 'hide' : 'show'
        const arr = byMode.get(mode) ?? []
        if (!arr.includes(id)) arr.push(id)
        byMode.set(mode, arr)
      }
      for (const [mode, targets] of byMode) {
        const ok = high && when !== null && unresolved === 0
        out.rules.push({
          mode, when, targets, confidence: ok ? 'high' : 'low', source: 'xfa_script', original, origin: 'deterministic',
          ...(ok ? {} : { reason: !when ? 'the script\'s condition is not one the importer understands' : unresolved ? `${unresolved} of its targets were not found` : 'the script does more than show / hide' }),
        })
      }
      if (!byMode.size && list.length) out.rules.push({ mode: 'hide', when, targets: [], confidence: 'low', source: 'xfa_script', original, origin: 'deterministic', reason: 'its targets were not found' })
    }
    // Calls, message boxes and loops make a script more than a presence toggle.
    const simple = (s: string) => !/\b(messageBox|xfa\.host|util\.|for\s*\(|while\s*\(|function\b|resetData|execEvent)/.test(s)
    if (shape && cond) {
      push(shape.then, toWhen(cond, false), simple(body))
      if (shape.else.trim()) push(shape.else, toWhen(cond, true), simple(body))
    } else if (!/\bif\b|\?/.test(body) && script.member) {
      push(body, toWhen(null, false), simple(body))
    } else {
      push(body, null, false)
    }
  }
  return out
}
