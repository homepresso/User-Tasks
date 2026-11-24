/**
 * A dynamic XFA form (no AcroForm widgets: LiveCycle / AEM Designer forms)
 * → the intermediate model, from its template alone (pure).
 *
 *   fields      field / exclGroup → items (caption → toolTip → the text drawn
 *               before it → the name); choiceList items, checkButtons,
 *               dateTimeEdit, numericEdit, signature
 *   sections    subforms two levels down (Part → Section) with their first
 *               drawn text as the title; repeating subforms are noted
 *   required    validate nullTest="error", or an asterisk in the caption
 *   presence    presence="hidden" → starts hidden; presence scripts → rules
 *   split dates DOBDay / DOBMonth / DOBYear in one subform → one date
 *
 * Buttons, barcodes and images are left out (reported).
 */

import { cleanLabel, humanizeFieldName, type PdfFormModel, type PdfItem, type PdfRule, type PdfSection } from './model'
import { requiredFromText } from './infer'
import type { XfaTemplate } from './xfa'
import { xfaScriptRules } from './xfa-rules'
import { detectXfaTables } from './tables'

const DATE_PART = /(day|month|year|dd|mm|yyyy|yy)$/i

export function modelFromXfa(t: XfaTemplate, title: string): PdfFormModel {
  const notes: string[] = []
  const sectionIds = new Map<string, string>()
  const sections: PdfSection[] = []
  for (const s of t.sections) {
    if (s.depth !== 2) continue
    const id = `s${sections.length + 1}`
    sectionIds.set(s.som, id)
    const name = s.som.replace(/\[\d+\]/g, '').split('.').pop() ?? ''
    sections.push({ id, title: cleanLabel(s.title || humanizeFieldName(name)).slice(0, 120), origin: 'deterministic', ...(s.hidden ? { hidden: true } : {}), ...(s.repeats ? { repeats: true } : {}) })
    if (s.repeats) notes.push(`"${s.title || name}" repeats in the PDF (add another): imported as a repeating list when its fields can be (see the tables), otherwise once`)
  }
  const items: PdfItem[] = []
  const idOfSom = new Map<string, string>()
  const skipped: string[] = []
  // Page: the depth-1 subform a field sits in (dynamic forms flow; this is a rough page order).
  const pageOf = new Map<string, number>()
  let page = 0
  for (const s of t.sections) if (s.depth === 1) pageOf.set(s.som, ++page)
  const pageFor = (som: string) => {
    let best = 1
    for (const [p, n] of pageOf) if (som.startsWith(`${p}.`)) best = n
    return best
  }
  const used = new Set<string>()
  // Fields a script shows (by name): hidden ones that are never shown are the form's bookkeeping.
  const shown = new Set<string>()
  for (const sc of t.scripts) for (const m of sc.body.matchAll(/([A-Za-z_$][\w.$[\]]*?)\.presence\s*=\s*["']visible["']/g)) shown.add(m[1].replace(/\[\d+\]/g, '').split('.').pop() ?? '')
  for (const f of t.fields) {
    if (!f.type) { skipped.push(`${f.name} (${f.ui})`); continue }
    if (f.hidden && (f.readOnly || !shown.has(f.name))) { skipped.push(`${f.name} (hidden)`); continue }
    let labelSource: PdfItem['labelSource'] = 'xfa_caption'
    let raw = f.caption || f.tooltip
    if (!raw && f.context) raw = f.context
    if (!raw) { raw = humanizeFieldName(f.name); labelSource = 'field_name' }
    const label = cleanLabel(raw)
    let id = f.name.replace(/[^A-Za-z0-9_]/g, '_') || `field_${items.length + 1}`
    for (let i = 2; used.has(id); i++) id = `${f.name}_${i}`
    used.add(id)
    idOfSom.set(f.som, id)
    const reqText = requiredFromText(f.caption || f.tooltip || '')
    const item: PdfItem = {
      id, type: f.type, label: label.length > 150 ? `${label.slice(0, 140).replace(/\s+\S*$/, '')}…` : label, labelSource,
      page: pageFor(f.som), sourceFields: [f.som], origin: 'deterministic', notes: [],
      ...(label.length > 150 ? { help: label.slice(0, 1000) } : {}),
      ...(f.section && sectionIds.has(f.section) ? { section: sectionIds.get(f.section) } : {}),
      ...(f.required ? { required: true, requiredSource: 'xfa' as const } : reqText ? { required: true, requiredSource: reqText } : {}),
      ...(f.hidden ? { hidden: true } : {}),
      ...(f.readOnly ? { readOnly: true } : {}),
      ...(f.maxChars && (f.type === 'text' || f.type === 'textarea') ? { maxLength: f.maxChars } : {}),
    }
    if (f.type === 'choice' || f.type === 'multi_choice') {
      item.options = f.options.filter((o, i, all) => o.value && all.findIndex((x) => x.value === o.value) === i).map((o) => ({ value: o.value, label: cleanLabel(o.label) || o.value })).slice(0, 200)
      item.display = f.kind === 'exclGroup' ? 'radio' : f.type === 'multi_choice' ? 'listbox' : 'dropdown'
      if (!item.options.length) { item.type = 'text'; item.notes.push('a list without items in the template (filled by a script): kept as text') }
    }
    if (f.type === 'currency') item.currency = 'USD'
    if (f.picture) item.notes.push(`display pattern ${f.picture}`)
    items.push(item)
  }
  // Split dates inside one subform.
  const byParent = new Map<string, PdfItem[]>()
  for (const it of items) {
    const parent = it.sourceFields[0].replace(/\.[^.]+$/, '')
    byParent.set(parent, [...(byParent.get(parent) ?? []), it])
  }
  const dead = new Set<PdfItem>()
  for (const [parent, list] of byParent) {
    const parts = list.filter((i) => (i.type === 'text' || i.type === 'number') && (DATE_PART.test(i.id) || /^\*?(dd|mm|yyyy|yy|day|month|year)$/i.test(i.label)))
    if (parts.length < 2 || parts.length > 3) continue
    const head = parts[0]
    const parentName = parent.replace(/\[\d+\]/g, '').split('.').pop() ?? 'Date'
    head.type = 'date'
    head.label = /^(dd|mm|yyyy|yy|day|month|year)$/i.test(cleanLabel(head.label)) ? humanizeFieldName(parentName.replace(/DOB/i, 'Date of birth')) : head.label
    delete head.maxLength
    head.notes.push(`${parts.length} boxes (${parts.map((p) => p.id).join(', ')}) merged into one date`)
    if (parts.some((p) => p.required)) { head.required = true; head.requiredSource = head.requiredSource ?? 'xfa' }
    for (const p of parts.slice(1)) { dead.add(p); head.sourceFields.push(...p.sourceFields); for (const s of p.sourceFields) idOfSom.set(s, head.id) }
  }
  const live = items.filter((i) => !dead.has(i))
  // Rules from presence scripts.
  const xr = xfaScriptRules(t, {
    field: (som) => idOfSom.get(som) ?? null,
    section: (som) => (sectionIds.has(som) ? `section:${sectionIds.get(som)}` : null),
  })
  const rules: PdfRule[] = xr.rules.map((r, i) => ({ id: `rule_${i + 1}`, ...r }))
  for (const target of xr.startHidden) {
    if (target.startsWith('section:')) { const s = sections.find((x) => `section:${x.id}` === target); if (s) s.hidden = true }
    else { const it = live.find((x) => x.id === target); if (it) it.hidden = true }
  }
  if (skipped.length) notes.push(`${skipped.length} element${skipped.length === 1 ? '' : 's'} left out (buttons, barcodes, images, hidden script fields): ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ' …' : ''}`)
  const usedSections = new Set(live.map((i) => i.section).filter(Boolean))
  const model: PdfFormModel = { title, kind: 'xfa', pages: Math.max(1, page), sections: sections.filter((s) => usedSections.has(s.id)), items: live, rules, notes }
  const tables = detectXfaTables(model, t)
  if (tables.length) model.tables = tables
  return model
}
