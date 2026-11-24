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

  /** The signed-in person as form rules read them ({{user.id}}, {{user.email}}, {{user.name}}, user.roles, user.teams — lib/services/form-rule-user.ts). */
  'forms.ruleUser': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      if (!ctx.actorId) return null
      const { loadRuleUser } = await import('../form-rule-user')
      return loadRuleUser(getDb(ctx), ctx.tenantId, ctx.actorId)
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
    // viewer_can_design: the designer may save drafts — forms.edit, or an Edit grant on this form (design-access.ts).
    run: async (ctx, { id: formId }) => {
      const form = await forms.getForm(ctx, formId)
      const { canDesignObject } = await import('../design-access')
      return { ...form, viewer_can_design: await canDesignObject(ctx, 'form', String(form.id)) }
    },
  }),

  /** The form designer: problems of a form's data target (lib/forms/data-target.ts) — fields removed or changed in the external system. */
  'forms.targetCheck': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id: formId }) => {
      const form = await forms.getForm(ctx, formId)
      const { normalizeFormDefinition } = await import('@/lib/forms/definition')
      const def = normalizeFormDefinition(form as never)
      return (await import('../form-targets')).checkFormTarget(ctx, { id: String(form.id), name: String(form.name), version: Number(form.version), fields: def.fields, layout: def.layout })
    },
  }),

  /** The form designer: the working draft (content, who saved it, publish problems) and whether drafts are on (forms.edit). */
  'forms.designDraft': defineRead({
    args: z.object({ id }),
    perm: 'forms.edit',
    run: async (ctx, { id: formId }) => (await import('../form-design-drafts')).getDesignDraft(ctx, formId),
  }),

  /** "Compare with published": what the draft changes (forms.edit). */
  'forms.draftCompare': defineRead({
    args: z.object({ id }),
    perm: 'forms.edit',
    run: async (ctx, { id: formId }) => (await import('../form-design-drafts')).compareDesignDraft(ctx, formId),
  }),

  /** Who the draft is shared with (forms.edit). */
  'forms.draftReviewers': defineRead({
    args: z.object({ id }),
    perm: 'forms.edit',
    run: async (ctx, { id: formId }) => (await import('../form-design-drafts')).listDraftReviewers(ctx, formId),
  }),

  /** People and teams of the workspace for "Share draft" (forms.edit). */
  'forms.draftReviewerTargets': defineRead({
    args: NO_ARGS,
    perm: 'forms.edit',
    run: async (ctx) => {
      const { serviceRoleClient } = await import('../_shared')
      const db = await serviceRoleClient(ctx) as any
      const [members, teams] = await Promise.all([
        db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).limit(2000),
        db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(500),
      ])
      const ids = ((members.data ?? []) as any[]).map((m) => String(m.user_id))
      const { data: users } = ids.length ? await db.from('users').select('id, display_name, email').in('id', ids).is('deleted_at', null) : { data: [] }
      return {
        users: ((users ?? []) as any[]).map((u) => ({ id: String(u.id), name: String(u.display_name || u.email || 'Someone'), email: (u.email ?? null) as string | null }))
          .sort((x, y) => x.name.localeCompare(y.name)),
        teams: ((teams.data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name ?? 'Team') })),
      }
    },
  }),

  /**
   * The draft preview (/forms/<id>/draft-preview): editors (forms.edit) and
   * the people / teams the draft is shared with — no forms.view needed; the
   * service checks the reviewer rows and answers 404 to everyone else.
   */
  'forms.draftPreview': defineRead({
    args: z.object({ id }),
    run: async (ctx, { id: formId }) => (await import('../form-design-drafts')).getDraftPreview(ctx, formId),
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

  /** Settings → Sign-in page (forms and apps; any member reads it; settings.edit changes it). */
  'forms.signInPage': defineRead({
    args: NO_ARGS,
    run: async (ctx) => (await import('../form-sign-in-page')).getFormSignInSettings(ctx),
  }),

  /** The sign-in page's support link (an app's "not available" state offers it; already public on the sign-in page). */
  'forms.signInSupport': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const s = await (await import('../form-sign-in-page')).getFormSignInSettings(ctx)
      return s.support_link_url ? { label: s.support_link_label || 'Get help', url: s.support_link_url } : null
    },
  }),

  /**
   * The designer's "Connected to …" / Data panel: what a bound form's
   * provider says about its binding, for the designer's current (unsaved)
   * fields and layout. forms.view (the designer).
   */
  'forms.targetDescribe': defineRead({
    args: z.object({ id, fields: z.array(z.record(z.string(), z.unknown())).max(500).optional(), layout: z.record(z.string(), z.unknown()).optional() }),
    perm: VIEW,
    run: async (ctx, { id: formId, fields, layout }) => {
      const form = await forms.getForm(ctx, formId)
      const { normalizeFormDefinition } = await import('@/lib/forms/definition')
      const def = normalizeFormDefinition(form as never)
      const { normalizeTaskFields } = await import('@/lib/task-field-schema')
      return (await import('../form-targets')).describeFormTarget(ctx, { id: String(form.id), name: String(form.name), version: Number(form.version), fields: fields ? normalizeTaskFields(fields) : def.fields, layout: layout ?? def.layout })
    },
  }),

  /**
   * The hosts outside the app that button redirects and links may go to
   * (FORM_REDIRECT_ALLOWLIST), so the designer judges an address the way
   * the server does. forms.view (the designer).
   */
  'forms.redirectHosts': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async () => ({ allowedHosts: (await import('@/lib/forms/buttons')).redirectAllowlistFromEnv() }),
  }),

  /**
   * The designer's Data panel (data binding): the source the form is bound
   * to — an extension target (its provider's describe) or a Data table / API
   * reference (lib/services/form-sources.ts) — with its fields and the
   * mapping, for the designer's current (unsaved) fields and layout. A new,
   * unsaved form has no id. forms.view (the designer).
   */
  'forms.sourceDescribe': defineRead({
    args: z.object({ id: z.string().uuid().optional(), name: z.string().max(200).optional(), fields: z.array(z.record(z.string(), z.unknown())).max(500), layout: z.record(z.string(), z.unknown()).nullable() }),
    perm: VIEW,
    run: async (ctx, { id: formId, name, fields, layout }) => {
      const { normalizeTaskFields } = await import('@/lib/task-field-schema')
      const form = formId ? await forms.getForm(ctx, formId) : null
      return (await import('../form-sources')).describeFormSource(ctx, { id: form ? String(form.id) : null, name: form ? String(form.name) : name ?? 'New form', version: form ? Number(form.version) : null, fields: normalizeTaskFields(fields), layout: layout ?? {} })
    },
  }),

  /** A form as its own page (/f/<id>) draws it (forms.submit). */
  'forms.submittable': defineRead({
    // query: the page's URL query — the form's declared URL parameters are read from it on the server (a form with a data target loads the record they name).
    args: z.object({ id, query: z.record(z.string().max(64), z.union([z.string().max(2000), z.array(z.string().max(2000)).max(50)])).optional() }),
    perm: 'forms.submit',
    run: async (ctx, { id: formId, query }) => (await import('../form-submissions')).getSubmittableForm(ctx, formId, { query: query ?? null }),
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

  /** Lists extensions offer as lookup sources (e.g. connected SharePoint lists) with their columns: the designer's "Connected list" source. */
  'forms.lookupLists': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { extensionLookupLists } = await import('../form-lookup')
      return extensionLookupLists(ctx)
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
