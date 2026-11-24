/**
 * The public "try a PDF" preview's answer (the marketing site, anonymous):
 * a derived summary only — kind, counts, the fields (label, type, required),
 * what needs a person, and the first form as a working preview. Never the
 * file, its scripts or field names. The AI assist is never offered here.
 *
 * Styling (the PDF analysed with styling in 'public' mode): the preview
 * shows the theme, header and the printed headings / instructions / images
 * the import would bring in — images only inline in this answer (small PNGs,
 * size-capped: STYLING_IMAGE_CAPS.public), never stored.
 */
import type { PdfAnalysis } from './analyze'
import { buildForms } from './build'
import { ITEM_TYPE_LABEL, type PdfFormModel } from './model'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import { DEFAULT_STYLE_OPTIONS, type PlannedHeader } from './style-plan'

export interface PublicPdfSummary {
  name: string
  kind: PdfFormModel['kind']
  pages: number
  counts: { fields: number; required: number; rules: number; rules_enabled: number; scripts_translated: number; merged: number; tables: number }
  fields: Array<{ label: string; type: string; required?: boolean }>
  attention: Array<{ name: string; detail: string }>
  preview: { fields: TaskFieldDef[]; layout: FormLayout; header?: PlannedHeader; theme?: FormThemeOverrides } | null
  /** What styling the import would bring in (when the PDF was read with it). */
  styling?: { images: number; headings: number; texts: number; dividers: number; sections: number; theme: boolean }
}

export function publicPdfSummary(analysis: PdfAnalysis): PublicPdfSummary {
  const m = analysis.model
  const built = buildForms(m, { fileName: 'form.pdf', hash: analysis.hash, pages: 'steps', ...(analysis.styling ? { styling: analysis.styling, style: DEFAULT_STYLE_OPTIONS } : {}) })
  const first = built.forms.find((f) => f.counts.fields)
  const converted = (m.tables ?? []).filter((t) => built.converted.includes(t.id))
  const absorbed = new Set(converted.flatMap((t) => t.itemIds))
  const single = m.items.filter((i) => !absorbed.has(i.id))
  const attention: PublicPdfSummary['attention'] = []
  for (const r of m.rules.filter((x) => x.confidence === 'low').slice(0, 30)) attention.push({ name: r.original.slice(0, 160), detail: `Kept as a turned-off rule: ${r.reason ?? 'check it'}` })
  const untranslated = m.items.reduce((n, i) => n + (i.untranslated?.length ?? 0), 0)
  if (untranslated) attention.push({ name: `${untranslated} script${untranslated === 1 ? '' : 's'}`, detail: 'Not recognised: listed in the report (scripts are never run)' })
  const weak = m.items.filter((i) => i.labelSource === 'field_name').length
  if (weak) attention.push({ name: `${weak} label${weak === 1 ? '' : 's'}`, detail: 'Taken from the field\'s internal name: rename them in the designer' })
  if (built.forms.length > 1) attention.push({ name: `${built.forms.length} forms`, detail: 'More than 200 fields: the PDF becomes several forms' })
  const layout = first ? { ...first.layout } : null
  if (layout) delete (layout as Record<string, unknown>).source
  return {
    name: m.title,
    kind: m.kind,
    pages: m.pages,
    counts: {
      fields: single.length + converted.length,
      required: single.filter((i) => i.required).length,
      rules: m.rules.length,
      rules_enabled: m.rules.filter((r) => r.confidence === 'high').length,
      scripts_translated: m.items.filter((i) => i.notes.some((n) => n.startsWith('Acrobat script'))).length,
      merged: single.filter((i) => i.sourceFields.length > 1).length,
      tables: converted.length,
    },
    fields: [
      ...single.map((i) => ({ label: i.label, type: ITEM_TYPE_LABEL[i.type], ...(i.required ? { required: true } : {}) })),
      ...converted.map((t) => ({ label: t.name, type: `Repeating list (${t.columns.length} columns, ${t.rows} rows in the PDF)` })),
    ].slice(0, 300),
    attention,
    preview: first && layout ? { fields: first.fields, layout, ...(first.header ? { header: first.header } : {}), ...(first.theme ? { theme: first.theme } : {}) } : null,
    ...(built.styling ? { styling: { ...built.styling.counts, theme: Boolean(built.styling.theme) } } : {}),
  }
}
