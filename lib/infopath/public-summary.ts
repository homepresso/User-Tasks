/**
 * The public (anonymous) InfoPath preview on the marketing site: the
 * analyzer and generator run on an uploaded .xsn, and only a DERIVED summary
 * goes back — counts, views with their field labels and types, how each rule
 * class converts, and the first view as a form definition for the preview.
 * Nothing of the file is echoed raw: no XPath expressions, rule notes,
 * data-connection addresses, file lists, hashes or provenance.
 *
 * Tighter caps than the signed-in importer: 4 MB in, 40 MB unpacked, 400
 * files, an 8 s budget.
 */
import { analyzeInfoPath } from './analyze'
import { generateForms, type ReportStatus } from './generate'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FormLayout } from '@/lib/forms/layout'

const MB = 1024 * 1024
export const PUBLIC_INFOPATH_LIMITS = { maxInputBytes: 4 * MB, maxTotalBytes: 40 * MB, maxFiles: 400, budgetMs: 8000, previewFields: 80 } as const

export interface PublicInfoPathSummary {
  name: string
  views: Array<{ name: string; default: boolean; fields: Array<{ label: string; type: string; required?: boolean; columns?: string[] }> }>
  counts: { views: number; fields: number; repeating: number; rules: { total: number; converted: number; partial: number }; validations: { total: number; converted: number }; calculations: { total: number; converted: number }; formatting: { total: number; converted: number }; connections: number }
  /** Items that need a person after the import (area + a short, derived description). */
  attention: Array<{ area: string; name: string; detail: string }>
  /** The first view as a UserTasks form (rules left out: a static preview). */
  preview: { name: string; fields: TaskFieldDef[]; layout: FormLayout } | null
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function publicInfoPathSummary(bytes: Uint8Array, fileName = 'form.xsn'): PublicInfoPathSummary {
  const model = analyzeInfoPath(bytes, { fileName, budgetMs: PUBLIC_INFOPATH_LIMITS.budgetMs, limits: PUBLIC_INFOPATH_LIMITS })
  const { forms, report } = generateForms(model, { mode: 'per_view' })
  const s = report.summary
  const first = forms[0]
  const display = new Set(['heading', 'divider', 'label', 'button'])
  return {
    name: clip(report.form.name, 120),
    views: forms.map((f) => ({
      name: clip(f.view ?? f.name, 120),
      default: model.views.find((v) => v.name === f.view)?.default ?? false,
      fields: f.input.fields.filter((x) => !display.has(x.type)).slice(0, 200).map((x) => ({
        label: clip(x.label, 120), type: x.type, ...(x.required ? { required: true } : {}),
        ...(x.list ? { columns: x.list.columns.map((c) => clip(c.label, 60)) } : {}),
      })),
    })),
    counts: {
      views: s.views, fields: s.fields, repeating: s.repeating,
      rules: { total: s.rules.total, converted: s.rules.converted, partial: s.rules.partial },
      validations: { total: s.validations.total, converted: s.validations.converted },
      calculations: { total: s.calculations.total, converted: s.calculations.converted },
      formatting: { total: s.formatting.total, converted: s.formatting.converted },
      connections: s.connections,
    },
    attention: report.items.filter((i) => i.status === ('manual' satisfies ReportStatus)).slice(0, 30).map((i) => ({ area: i.area, name: clip(i.name, 120), detail: clip(i.detail.replace(/https?:\/\/\S+|\.\.\/\S+/g, '…'), 240) })),
    preview: first ? previewOf(first.name, first.input.fields, first.input.layout) : null,
  }
}

/** A static preview: no rules, no provenance, no notes, a bounded number of fields. */
function previewOf(name: string, fields: TaskFieldDef[], layout: FormLayout): PublicInfoPathSummary['preview'] {
  const kept = fields.filter((f) => f.type !== 'button').slice(0, PUBLIC_INFOPATH_LIMITS.previewFields)
  const keys = new Set(kept.map((f) => f.key))
  const rows = (layout.rows ?? []).map((r) => ({ ...r, cells: r.cells.filter((c) => keys.has(c.field_key)) })).filter((r) => r.cells.length).map((r) => ({ ...r, columns: Math.max(1, Math.min(r.columns, r.cells.length)) }))
  const out: FormLayout = { rows }
  if (layout.sections?.length) out.sections = layout.sections
  return { name: clip(name, 120), fields: kept.map((f) => { const { help_text: _h, ...rest } = f; return rest as TaskFieldDef }), layout: out }
}
