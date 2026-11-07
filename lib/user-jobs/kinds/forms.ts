import { z } from 'zod'
import { defineJobKind } from '../define'
import { requirePerm } from '@/lib/services/context'
import { formSubmissionsCsv } from '@/lib/services/form-submissions'

/** A form's submissions as CSV (Forms library → Submissions → Export CSV). */
export const formSubmissionsCsvJob = defineJobKind({
  kind: 'form.submissions_csv',
  effect: 'download',
  maxAttempts: 3,
  params: z.object({
    form_id: z.string().uuid(),
    submitted_by: z.string().uuid().nullish(),
    source: z.enum(['standalone', 'task', 'api', 'anonymous']).nullish(),
    since: z.string().max(40).nullish(),
    until: z.string().max(40).nullish(),
  }),
  title: () => 'Form submissions (CSV)',
  authorize: (ctx) => requirePerm(ctx, 'forms.submit'),
  async run({ ctx, params, progress }) {
    await progress(10, 'Collecting submissions')
    const csv = await formSubmissionsCsv(ctx, {
      form_id: params.form_id,
      submitted_by: params.submitted_by ?? undefined,
      source: params.source ?? undefined,
      since: params.since ?? undefined,
      until: params.until ?? undefined,
    })
    return { file: { name: csv.file_name, contentType: 'text/csv; charset=utf-8', body: csv.csv }, counts: { rows: csv.rows }, summary: `${csv.rows} submission${csv.rows === 1 ? '' : 's'}` }
  },
})

const findingSchema = z.object({
  id: z.string().max(400),
  rule: z.string().max(80),
  severity: z.enum(['critical', 'serious', 'moderate', 'minor', 'review']),
  wcag: z.array(z.string().max(10)).max(10),
  level: z.enum(['A', 'AA']),
  field_key: z.string().max(80).optional(),
  mode: z.enum(['light', 'dark']).optional(),
  message: z.string().max(1000),
  help: z.string().max(2000),
  source: z.literal('axe').optional(),
  targets: z.array(z.string().max(400)).max(5).optional(),
})

/** What the designer sends: its unsaved definition and the axe findings of its preview scan. */
const accessibilityInput = z.object({
  definition: z.record(z.string(), z.unknown()),
  extra_findings: z.array(findingSchema).max(500).optional(),
})

/**
 * A form's accessibility report (designer → Accessibility → Export report):
 * the checker run on the server (workspace theme colours resolved here)
 * over the designer's definition (job input) or a saved reusable form,
 * plus the preview's axe findings; CSV or PDF.
 */
export const formAccessibilityReportJob = defineJobKind({
  kind: 'form.accessibility_report',
  effect: 'download',
  maxAttempts: 2,
  input: { maxBytes: 1024 * 1024 },
  params: z.object({
    format: z.enum(['csv', 'pdf']),
    name: z.string().trim().min(1).max(120),
    form_id: z.string().uuid().nullish(),
  }),
  title: (params) => `Accessibility report (${params.format.toUpperCase()})`,
  authorize: (ctx) => requirePerm(ctx, 'forms.view'),
  async run({ ctx, params, progress, readInput }) {
    await progress(10, 'Checking the form')
    const { normalizeFormDefinition } = await import('@/lib/forms/definition')
    const { mergeFindings } = await import('@/lib/forms/accessibility')
    const { checkDefinition } = await import('@/lib/services/form-accessibility')
    const { accessibilityReportCsv, accessibilityReportPdf, reportFileName } = await import('@/lib/forms/accessibility/report')
    const { getDb, ServiceError } = await import('@/lib/services/context')
    const bytes = await readInput()
    let definition: Record<string, unknown> | null = null
    let extra: z.infer<typeof findingSchema>[] = []
    if (bytes) {
      const parsed = accessibilityInput.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
      if (!parsed.success) throw ServiceError.validation('The report input is not a form definition')
      definition = parsed.data.definition
      extra = parsed.data.extra_findings ?? []
    } else if (params.form_id) {
      const { getForm } = await import('@/lib/services/forms')
      definition = await getForm(ctx, params.form_id) as unknown as Record<string, unknown>
    } else {
      throw ServiceError.validation('Pass a form_id or the definition to check')
    }
    const def = normalizeFormDefinition(definition as Parameters<typeof normalizeFormDefinition>[0])
    const result = mergeFindings(await checkDefinition(getDb(ctx), ctx.tenantId, def), extra.map((f) => ({ ...f, source: 'axe' as const })))
    await progress(60, 'Writing the report')
    const name = reportFileName(params.name, params.format)
    const counts = { score: result.score, findings: result.summary.total }
    const summary = `Score ${result.score}/100 · ${result.summary.total} finding${result.summary.total === 1 ? '' : 's'}`
    if (params.format === 'csv') return { file: { name, contentType: 'text/csv; charset=utf-8', body: accessibilityReportCsv(result) }, counts, summary }
    return { file: { name, contentType: 'application/pdf', body: await accessibilityReportPdf(result, { name: params.name }) }, counts, summary }
  },
})
