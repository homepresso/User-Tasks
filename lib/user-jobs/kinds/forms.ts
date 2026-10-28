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
    source: z.enum(['standalone', 'task', 'api']).nullish(),
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
