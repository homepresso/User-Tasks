import { columnKey } from '@/lib/data-table-cells'
import { z } from 'zod'
import * as forms from '../forms'
import { resolvePage } from '../_shared'
import { defineRead, id, NO_ARGS } from './define'
import { getDb } from '../context'

/**
 * Forms library and the form designer's pickers. The forms tables have no
 * client write grants; reads go through lib/services/forms (forms.view).
 */

const VIEW = 'forms.view'

/** Columns made before keys existed only have a name; their rows are stored under the slug of it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacyColumnKey = (c: any) => (c?.key ? String(c.key) : c?.name ? columnKey({ name: String(c.name) }) : '')

export const reads = {
  'forms.list': defineRead({
    args: z.object({ search: z.string().max(200).optional(), tag: z.string().max(40).optional() }).optional(),
    perm: VIEW,
    run: async (ctx, args) => forms.listForms(ctx, { search: args?.search, tag: args?.tag }, resolvePage({ limit: 0 })),
  }),

  /**
   * The sidebar Forms menu ("Available forms"): forms marked available that
   * the signed-in person has an explicit grant on and can submit. Every
   * signed-in member asks (no forms.view needed); the service returns []
   * without forms.submit.
   */
  'forms.available': defineRead({
    args: NO_ARGS,
    run: async (ctx) => forms.listAvailableForms(ctx),
  }),

  /** The signed-in person as form rules read them ({{user.id}}, {{user.email}}, {{user.name}}). */
  'forms.ruleUser': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      if (!ctx.actorId) return null
      const { data } = await (getDb(ctx) as any).from('users').select('id, email, display_name').eq('id', ctx.actorId).maybeSingle() // eslint-disable-line @typescript-eslint/no-explicit-any -- users is read untyped
      return { id: ctx.actorId, email: (data?.email ?? null) as string | null, name: (data?.display_name ?? null) as string | null }
    },
  }),

    /** The workspace's pre-publish accessibility check (designer save, Settings → Forms). */
  'forms.accessibilitySettings': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (await import('../form-accessibility')).getFormAccessibilitySettings(ctx),
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

  /** A form's anonymous (public) link, options and warnings (forms.view). */
  'forms.anonymous': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id: formId }) => (await import('../anonymous-forms')).getFormAnonymousAccess(ctx, formId),
  }),

  /** The workspace's "Allow anonymous forms" switch and bot protection (never the secret). */
  'forms.anonymousWorkspace': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (await import('../anonymous-forms')).getAnonymousWorkspaceSettings(ctx),
  }),

  /** Settings → Forms → Form sign-in page (any member reads it; settings.edit changes it). */
  'forms.signInPage': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (await import('../form-sign-in-page')).getFormSignInSettings(ctx),
  }),

  /** A form as its own page (/f/<id>) draws it (forms.submit). */
  'forms.submittable': defineRead({
    args: z.object({ id }),
    perm: 'forms.submit',
    run: async (ctx, { id: formId }) => (await import('../form-submissions')).getSubmittableForm(ctx, formId),
  }),

  /** My saved draft of a form (the Save draft icon), or null. */
  'forms.draft': defineRead({
    args: z.object({ id }),
    perm: 'forms.submit',
    run: async (ctx, { id: formId }) => (await import('../form-drafts')).getFormDraft(ctx, formId),
  }),

  /** Submissions of a form (own; all with forms.edit). */
  'forms.submissions': defineRead({
    args: z.object({
      form_id: id,
      submitted_by: id.optional(),
      source: z.enum(['standalone', 'task', 'api', 'anonymous']).optional(),
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

  /** The friendly link of a form (/form/<system name> on the workspace address) — any member. */
  'forms.friendlyLink': defineRead({
    args: z.object({ form_id: id }),
    run: async (ctx, args) => (await import('../form-links')).getFormFriendlyLink(ctx, args.form_id),
  }),

  /** Form Settings: is this system name valid and free in the workspace? */
  'forms.systemNameCheck': defineRead({
    args: z.object({ system_name: z.string().max(200), form_id: id.optional() }),
    perm: VIEW,
    run: async (ctx, args) => (await import('../form-links')).checkFormSystemName(ctx, args.form_id ?? null, args.system_name),
  }),

  /** Form Settings: a free system name suggested from a form name. */
  'forms.systemNameSuggest': defineRead({
    args: z.object({ name: z.string().max(200), form_id: id.optional() }),
    perm: VIEW,
    run: async (ctx, args) => (await import('../form-links')).suggestFormSystemName(ctx, args.name, args.form_id ?? null),
  }),

  /** The QR code of a form page link (SVG, plain and captioned) — any member; the code only encodes the link. */
  'forms.qr': defineRead({
    args: z.object({ form_id: id, params: z.record(z.string(), z.string().max(500)).optional(), anonymous: z.boolean().optional(), kind: z.enum(['friendly', 'signed_in', 'anonymous']).optional() }),
    run: async (ctx, args) => (await import('../form-qr')).getFormQrCode(ctx, args.form_id, args.params, { anonymous: args.anonymous, kind: args.kind }),
  }),

  /** Custom form controls the designer palette offers (enabled ones; the whole library with extensibility.view). */
  'forms.controls': defineRead({
    args: z.object({ all: z.boolean().optional() }).optional(),
    perm: [VIEW, 'extensibility.view'],
    run: async (ctx, args) => (await (await import('../form-controls')).listFormControls(ctx, args?.all ? {} : { enabled: true }, { limit: 500, offset: 0 })).form_controls,
  }),

  /** One custom control version's manifest (designer: switch versions). */
  'forms.controlVersion': defineRead({
    args: z.object({ tag: z.string().min(1).max(100), version: z.string().min(1).max(64) }),
    perm: [VIEW, 'extensibility.view'],
    run: async (ctx, args) => (await (await import('../form-controls')).getFormControlVersion(ctx, args.tag, args.version)).version,
  }),

  /** Where a custom control is used (Extensibility → Form controls). */
  'forms.controlUsages': defineRead({
    args: z.object({ id }),
    perm: 'extensibility.view',
    run: async (ctx, args) => (await import('../form-controls')).getFormControlUsages(ctx, args.id),
  }),

  /**
   * Which of these controls an instance admin marked trusted (inline
   * rendering) — any member viewing a form; everything else runs in the
   * sandboxed frame. The bundle route enforces the flag again.
   */
  'forms.controlRuntime': defineRead({
    args: z.object({ tags: z.array(z.string().min(1).max(100)).max(50) }),
    run: async (ctx, args) => {
      if (!args.tags.length) return []
      const { getDb } = await import('../context')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- form_controls is not in the generated types
      const { data } = await (getDb(ctx) as any).from('form_controls').select('tag, trusted, enabled').in('tag', args.tags)
      return ((data ?? []) as Array<{ tag: string; trusted: boolean; enabled: boolean }>).map((r) => ({ tag: String(r.tag), trusted: r.trusted === true, enabled: r.enabled !== false }))
    },
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
      return ((data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name), columns: (Array.isArray(t.columns) ? t.columns : []).map((c: any) => ({ key: legacyColumnKey(c), label: String(c?.label ?? c?.name ?? c?.key ?? ''), type: String(c?.type ?? 'text'), ...(Array.isArray(c?.options) ? { options: c.options.map(String).slice(0, 200) } : {}) })).filter((c: { key: string }) => c.key) }))
    },
  }),
}
