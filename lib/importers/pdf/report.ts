/**
 * The PDF importer's mapping report (pure): every field, rule, script and
 * note — nothing silently dropped — with its status (lib/importers/report):
 *
 *   mapped       a faithful field / an enabled rule (label from a tooltip
 *                or the XFA caption)
 *   partial      converted, review it: label from nearby text or the field
 *                name, merged boxes, a pattern from a validation script, a
 *                calculation; everything the AI assist added ("AI — review")
 *   placeholder  a rule created turned off (low confidence) with the original
 *   skipped      buttons, scripts not translated, rules over the limit
 *   info         facts (the kind of PDF, flat / scanned)
 */

import type { ImportReport, ImportReportItem } from '@/lib/extensions/sdk'
import { importComplexityLevel, importCoverage, importReadiness } from '@/lib/importers/report'
import type { BuildResult } from './build'
import { ITEM_TYPE_LABEL, LABEL_SOURCE_TEXT, type PdfColumnLabelSource, type PdfFormModel } from './model'

const COLUMN_SOURCE_TEXT: Record<PdfColumnLabelSource, string> = {
  header: 'header', spanning_header: 'header over several columns', tooltip: 'tooltip', xfa_caption: 'XFA caption', field_name: 'field name — rename it',
}

const KIND_TEXT: Record<PdfFormModel['kind'], string> = {
  acroform: 'Fillable PDF (AcroForm)',
  hybrid: 'Fillable PDF with an XFA template (captions and groups read from it)',
  xfa: 'Dynamic XFA form (LiveCycle / AEM Designer)',
  flat: 'Flat PDF: no fillable fields',
  scanned: 'Scanned PDF: no fillable fields, no text',
}

const SHORT_KIND: Record<PdfFormModel['kind'], string> = { acroform: 'a fillable PDF', hybrid: 'a fillable PDF with an XFA template', xfa: 'a dynamic XFA form', flat: 'a flat PDF', scanned: 'a scanned PDF' }

const REQUIRED_TEXT = { flag: 'required in the PDF', xfa: 'required in the XFA template', asterisk: 'required (an asterisk in its label)', text: 'required (its label says so)', ai: 'required (AI assist)' } as const

function displayText(d: { headings: number; texts: number; dividers: number; images: number }): string {
  const n = d.headings + d.texts + d.dividers + d.images
  return n ? `, ${n} display element${n === 1 ? '' : 's'} (${[d.headings ? `${d.headings} heading${d.headings === 1 ? '' : 's'}` : '', d.texts ? `${d.texts} text` : '', d.dividers ? `${d.dividers} divider${d.dividers === 1 ? '' : 's'}` : '', d.images ? `${d.images} image${d.images === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')})` : ''
}

export function pdfReport(model: PdfFormModel, built: BuildResult, extra: { fileName: string; warnings: string[]; aiUsed?: boolean; aiChanges?: string[] }): ImportReport {
  const items: ImportReportItem[] = []
  const keyOf = new Map<string, string>()
  for (const f of built.forms) for (const [id, key] of Object.entries(f.keys)) keyOf.set(id, key)
  const fieldCount = built.forms.length ? built.forms.reduce((n, f) => n + f.counts.fields, 0) : model.items.length
  const converted = new Set(built.converted ?? [])
  const absorbed = new Set((model.tables ?? []).filter((t) => converted.has(t.id)).flatMap((t) => t.itemIds))
  const boxes = model.items.length - absorbed.size
  items.push({ kind: 'pdf', name: extra.fileName, status: 'info', detail: `${KIND_TEXT[model.kind]} · ${model.pages} page${model.pages === 1 ? '' : 's'} · ${model.items.length} field${model.items.length === 1 ? '' : 's'}${absorbed.size ? ` (${absorbed.size} of them in ${converted.size} table${converted.size === 1 ? '' : 's'} → repeating lists)` : ''}` })
  for (const note of model.notes) items.push({ kind: 'note', name: note.slice(0, 120), status: /left out/i.test(note) ? 'skipped' : 'info', detail: note })
  // Tables: one entry each — its columns (and where their labels came from) and the PDF fields it absorbed.
  for (const t of model.tables ?? []) {
    const builtTable = built.forms.flatMap((f) => f.tables ?? []).find((b) => b.id === t.id)
    const names = t.itemIds.map((id) => model.items.find((i) => i.id === id)?.sourceFields[0] ?? id)
    const columns = t.columns.map((c) => `"${c.label}" (${ITEM_TYPE_LABEL[c.type].toLowerCase()}, label from the ${COLUMN_SOURCE_TEXT[c.labelSource]}${c.required ? ', required' : ''})`).join(', ')
    const rows = t.rowLabelMode === 'generic' ? `row labels ${t.rowLabels?.[0] ? `"${t.rowLabels[0]}" …` : ''} dropped (the list is named after them)` : t.rowLabelMode === 'category' ? `row labels kept as a choice column "${t.rowLabelHeader ?? t.noun ?? 'Item'}" (${(t.rowLabels ?? []).slice(0, 5).join(', ')}${(t.rowLabels?.length ?? 0) > 5 ? ' …' : ''})` : ''
    const totals = t.totals.map((x) => `"${model.items.find((i) => i.id === x.item)?.label ?? x.item}" adds up "${t.columns[x.column]?.label}"${builtTable?.totals.some((b) => b.item === x.item) ? ' (a calculated field over the list)' : ''}`).join('; ')
    const absorbedText = `absorbs ${names.length} PDF field${names.length === 1 ? '' : 's'}: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` … (+${names.length - 12})` : ''}`
    const detail = [`Columns: ${columns}`, rows, totals, `Found by: ${t.evidence.join('; ')}`, absorbedText].filter(Boolean).join('. ')
    items.push(builtTable
      ? { kind: 'table', name: t.name, status: t.columns.some((c) => c.labelSource === 'field_name') ? 'partial' : 'mapped', mappedTo: `Repeating section "${builtTable.key}" — ${t.columns.length} column${t.columns.length === 1 ? '' : 's'}, up to ${builtTable.maxItems} row${builtTable.maxItems === 1 ? '' : 's'}, starts with 1`, detail, location: `page${t.pages.length > 1 ? 's' : ''} ${t.pages.join(', ')} · ${t.rows} rows in the PDF` }
      : { kind: 'table', name: t.name, status: 'info', detail: `Kept as ${names.length} separate fields (labelled "column (row)"). ${detail}`, location: `page${t.pages.length > 1 ? 's' : ''} ${t.pages.join(', ')}` })
  }
  for (const it of model.items) {
    if (absorbed.has(it.id)) continue
    const ai = it.origin === 'ai'
    const key = keyOf.get(it.id)
    // A calculation became a calculated (Label) field — unless an operand was on another part of the form.
    const calcBuilt = Boolean(it.calc && key && built.forms.some((f) => f.keys[it.id] === key && f.fields.some((x) => x.key === key && x.type === 'label' && x.label_config?.expression)))
    const review = it.labelSource === 'field_name' || it.notes.some((n) => /check|merged|from its label|validation script/i.test(n)) || Boolean(it.calc && !calcBuilt)
    const detail = [
      `Label from ${LABEL_SOURCE_TEXT[it.labelSource]}`,
      it.required && it.requiredSource ? REQUIRED_TEXT[it.requiredSource] : '',
      it.hidden ? 'starts hidden' : '',
      ...it.notes,
      it.calc ? (calcBuilt ? `calculated (${it.calc.op === 'EXPR' ? 'arithmetic' : it.calc.op}): a calculated field, worked out as people type and again on the server` : `calculated (${it.calc.op}): some of its fields are on another part, rebuild as a Label expression`) : '',
    ].filter(Boolean).join('; ')
    items.push({
      kind: 'field', name: it.label, status: !key ? 'skipped' : ai || review ? 'partial' : 'mapped',
      mappedTo: key ? `${ITEM_TYPE_LABEL[it.type]} "${key}"` : null,
      detail: key ? detail : `${detail}; not placed (the form limit)`,
      location: `page ${it.page}${it.question ? `, question ${it.question}` : ''}${it.sourceFields.length ? ` · ${it.sourceFields.slice(0, 3).join(', ')}${it.sourceFields.length > 3 ? ' …' : ''}` : ''}`,
      ...(ai ? { origin: 'ai' as const } : {}),
    })
    for (const u of it.untranslated ?? []) items.push({ kind: 'script', name: `${it.label} (${u.event})`, status: 'skipped', detail: `Acrobat script not translated (never run): ${u.js}`, location: `page ${it.page}` })
  }
  const dropped = new Set(built.dropped.map((d) => d.rule.id))
  for (const r of model.rules) {
    const ai = r.origin === 'ai'
    const where = r.source === 'printed_text' ? 'printed instruction' : r.source === 'acrobat_js' ? 'Acrobat script' : r.source === 'xfa_script' ? 'XFA script' : 'AI assist'
    const targets = r.targets.map((t) => keyOf.get(t) ?? t).slice(0, 8).join(', ')
    const why = built.dropped.find((d) => d.rule.id === r.id)?.why
    const remap = built.remapped?.find((d) => d.rule.id === r.id)?.note
    items.push({
      kind: 'rule', name: r.original.slice(0, 200),
      status: ai ? 'partial' : r.confidence === 'high' && !dropped.has(r.id) ? 'mapped' : 'placeholder',
      mappedTo: `${r.mode === 'show' ? 'Show' : 'Hide'}${targets ? ` ${targets}` : ''}${r.when ? ` while ${keyOf.get(r.when.item) ?? r.when.item} ${r.when.op.replace('_', ' ')}${r.when.value !== undefined ? ` "${r.when.value}"` : ''}` : ''}`,
      detail: r.confidence === 'high' && !why ? `From the ${where}: an enabled rule${remap ? ` — ${remap}` : ''}.` : `From the ${where}: created turned off — ${why ?? r.reason ?? 'check it'}.`,
      ...(ai ? { origin: 'ai' as const } : {}),
    })
  }
  // What the AI assist changed, as a trail (the items themselves carry the marks and count once).
  for (const c of extra.aiChanges ?? []) items.push({ kind: 'ai', name: c.slice(0, 200), status: 'info', detail: c, origin: 'ai' })
  // "Bring in styling and images": the theme, fonts, header, every image (placed / skipped and why), headings, text, dividers.
  for (const s of built.styling?.log ?? []) items.push(s)
  const coverage = importCoverage(items)
  const low = model.rules.filter((r) => r.confidence === 'low').length
  const untranslated = model.items.reduce((n, i) => n + (i.untranslated?.length ?? 0), 0)
  const score = Math.min(100, Math.round(fieldCount / 6 + model.rules.length * 1.5 + low * 2 + untranslated * 2 + (model.kind === 'xfa' ? 15 : 0) + (built.forms.length > 1 ? 15 : 0) + (!model.items.length ? 60 : 0)))
  const factors = [
    `${fieldCount} fields`,
    converted.size ? `${converted.size} table${converted.size === 1 ? '' : 's'} as repeating lists` : '',
    model.rules.length ? `${model.rules.length} rules (${low} turned off for review)` : '',
    untranslated ? `${untranslated} scripts not translated` : '',
    built.forms.length > 1 ? `split into ${built.forms.length} forms (200 fields each at most)` : '',
    model.kind === 'flat' || model.kind === 'scanned' ? 'no fillable fields' : '',
  ].filter(Boolean)
  const sc = built.styling?.counts
  const styleBits = sc ? [
    built.styling?.theme ? 'a theme from its colours and fonts' : '',
    sc.images ? `${sc.images} image${sc.images === 1 ? '' : 's'}` : '',
    sc.sections ? `${sc.sections} section${sc.sections === 1 ? '' : 's'} from its headings` : '',
    sc.headings ? `${sc.headings} heading${sc.headings === 1 ? '' : 's'}` : '',
    sc.texts ? `${sc.texts} text block${sc.texts === 1 ? '' : 's'}` : '',
    sc.dividers ? `${sc.dividers} divider${sc.dividers === 1 ? '' : 's'}` : '',
  ].filter(Boolean) : []
  const styleSummary = styleBits.length ? ` Styling brought in: ${styleBits.join(', ')}.` : ''
  const summary = !model.items.length
    ? (model.kind === 'scanned' ? 'This PDF has no fillable fields and no text layer (it looks scanned).' : 'This PDF has no fillable fields.') + (extra.aiUsed ? ' The AI assist found no questions in it.' : ' Turn on "Use AI for the hard parts" to read its questions, or build the form by hand.')
    : `${fieldCount} field${fieldCount === 1 ? '' : 's'}${converted.size ? ` (${boxes} single field${boxes === 1 ? '' : 's'} and ${converted.size} repeating list${converted.size === 1 ? '' : 's'} in place of ${absorbed.size} table boxes)` : ''} and ${model.rules.length} rule${model.rules.length === 1 ? '' : 's'} from ${SHORT_KIND[model.kind]}${extra.aiUsed ? '; items marked "AI — review" came from the AI assist' : ''}.${styleSummary}`
  return {
    title: model.title,
    source: 'PDF form',
    summary,
    coverage,
    complexity: { score, level: importComplexityLevel(score), factors },
    readiness: model.items.length ? importReadiness(coverage, score) : 'rebuild',
    items,
    warnings: extra.warnings,
    outputs: built.forms.filter((f) => f.counts.fields).map((f) => ({ kind: 'form' as const, name: f.name, detail: `${f.counts.fields} fields, ${f.counts.rules} rules${f.counts.disabled_rules ? ` (${f.counts.disabled_rules} turned off)` : ''}${f.layout.pages?.length ? `, ${f.layout.pages.length} steps` : ''}${f.display ? displayText(f.display) : ''}` })),
  }
}
