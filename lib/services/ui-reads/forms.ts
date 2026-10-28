import { z } from 'zod'
import * as forms from '../forms'
import { resolvePage } from '../_shared'
import { defineRead, id, NO_ARGS } from './define'

/**
 * Forms library and the form designer's pickers. The forms tables have no
 * client write grants; reads go through lib/services/forms (forms.view).
 */

const VIEW = 'forms.view'

export const reads = {
  'forms.list': defineRead({
    args: z.object({ search: z.string().max(200).optional(), tag: z.string().max(40).optional() }).optional(),
    perm: VIEW,
    run: async (ctx, args) => forms.listForms(ctx, { search: args?.search, tag: args?.tag }, resolvePage({ limit: 0 })),
  }),

  'forms.get': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id: formId }) => forms.getForm(ctx, formId),
  }),

  'forms.versions': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id: formId }) => (await forms.listFormVersions(ctx, formId, resolvePage({ limit: 100 }))).versions,
  }),

  'forms.themes': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => (await forms.listFormThemes(ctx, {}, resolvePage({ limit: 0 }))).form_themes,
  }),

  /** A form as its own page (/f/<id>) draws it (forms.submit). */
  'forms.submittable': defineRead({
    args: z.object({ id }),
    perm: 'forms.submit',
    run: async (ctx, { id: formId }) => (await import('../form-submissions')).getSubmittableForm(ctx, formId),
  }),

  /** Submissions of a form (own; all with forms.edit). */
  'forms.submissions': defineRead({
    args: z.object({
      form_id: id,
      submitted_by: id.optional(),
      source: z.enum(['standalone', 'task', 'api']).optional(),
      since: z.string().max(40).optional(),
      until: z.string().max(40).optional(),
      offset: z.number().int().min(0).max(100_000).optional(),
    }),
    perm: 'forms.submit',
    run: async (ctx, args) => (await import('../form-submissions')).listFormSubmissions(ctx, args, resolvePage({ limit: 50, offset: args.offset ?? 0 })),
  }),

  'forms.submission': defineRead({
    args: z.object({ id }),
    perm: 'forms.submit',
    run: async (ctx, { id: submissionId }) => (await import('../form-submissions')).getFormSubmission(ctx, submissionId),
  }),

  /** The QR code of a form page link (SVG, plain and captioned) — any member; the code only encodes the link. */
  'forms.qr': defineRead({
    args: z.object({ form_id: id }),
    run: async (ctx, args) => (await import('../form-qr')).getFormQrCode(ctx, args.form_id),
  }),

  /** Data tables + columns for "options from a data table column". */
  'forms.tableColumns': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { getDb } = await import('../context')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom_tables.columns is free-form JSON
      const { data } = await (getDb(ctx) as any).from('custom_tables').select('id, name, columns').order('name')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name), columns: (Array.isArray(t.columns) ? t.columns : []).map((c: any) => ({ key: String(c?.key ?? ''), label: String(c?.label ?? c?.name ?? c?.key ?? '') })).filter((c: { key: string }) => c.key) }))
    },
  }),
}
