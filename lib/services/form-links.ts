/**
 * Friendly form links: `/form/<system_name>` on a workspace address
 * (acme.usertasks.com/form/employee-onboarding).
 *
 *  - forms.system_name is unique per workspace and defaulted from the form
 *    name (migration 20261223000000); renaming keeps the old name as a
 *    redirect (form_system_name_history, written by a trigger).
 *  - Members open the form exactly like /f/<id> (forms.submit).
 *  - Visitors who are not signed in get the anonymous rendering of /p/<token>
 *    ONLY when the form's anonymous responses are on AND it opted in to
 *    "Allow friendly public link" (allow_friendly_link, off by default) —
 *    a system name is guessable, the /p/ token is not, so publishing a form
 *    under its name is a separate, explicit choice. Every other case sends
 *    the visitor to sign in (whether or not the name exists), so names can't
 *    be probed.
 */

import { isValidSystemName, nextFreeSystemName, suggestSystemName, systemNameProblem } from '@/lib/forms/system-name'
import { friendlyFormUrl } from '@/lib/workspace-address'
import { normalizeAnonymousSettings } from '@/lib/forms/anonymous'
import { ServiceError, requirePerm, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { workspaceUrlFor } from './workspace-address'

/* eslint-disable @typescript-eslint/no-explicit-any -- forms.system_name / history are not in the generated types */

export const formLinkDeps = {
  serviceClient: async (): Promise<AnySupabaseClient> => (await import('@/lib/cron-auth')).createServiceClient() as AnySupabaseClient,
}

export type ResolvedSystemName =
  | { kind: 'form'; id: string; name: string; system_name: string }
  /** An earlier name: redirect to the current one. */
  | { kind: 'moved'; id: string; system_name: string }

/** The form a system name names in a workspace (current names first, then earlier ones), or null. */
export async function resolveSystemName(db: AnySupabaseClient, tenantId: string, name: string): Promise<ResolvedSystemName | null> {
  if (!isValidSystemName(name)) return null
  const { data: form, error } = await (db as any).from('forms').select('id, name, system_name').eq('tenant_id', tenantId).eq('system_name', name).maybeSingle()
  if (error) throw dbError(error)
  if (form) return { kind: 'form', id: String(form.id), name: String(form.name), system_name: String(form.system_name) }
  const { data: old } = await (db as any).from('form_system_name_history').select('form_id').eq('tenant_id', tenantId).eq('system_name', name).maybeSingle()
  if (!old) return null
  const { data: current } = await (db as any).from('forms').select('id, system_name').eq('tenant_id', tenantId).eq('id', old.form_id).maybeSingle()
  if (!current?.system_name || current.system_name === name) return null
  return { kind: 'moved', id: String(current.id), system_name: String(current.system_name) }
}

/** resolveSystemName with the service client (pages; the tenant comes from the address or the session). */
export async function resolveFormLink(tenantId: string, name: string): Promise<ResolvedSystemName | null> {
  return resolveSystemName(await formLinkDeps.serviceClient(), tenantId, name)
}

/**
 * The /p/ token behind a friendly link for a visitor who is not signed in,
 * or null — unless the form takes anonymous responses AND allows its
 * friendly public link (and the workspace switch is on: resolveAnonymousForm
 * checks it again, with every other /p/ rule).
 */
export async function friendlyAnonymousToken(tenantId: string, formId: string): Promise<string | null> {
  const db = await formLinkDeps.serviceClient()
  const { data: row } = await (db as any).from('form_anonymous_access').select('token, enabled, settings').eq('tenant_id', tenantId).eq('form_id', formId).maybeSingle()
  if (!row || row.enabled !== true) return null
  if (!normalizeAnonymousSettings(row.settings).allow_friendly_link) return null
  return typeof row.token === 'string' ? row.token : null
}

/* ── Validation and availability (forms service) ─────────────────────── */

/** Why `value` can't be the form's system name (format, taken by another form of the workspace), or null. */
export async function systemNameAvailability(db: AnySupabaseClient, tenantId: string, formId: string | null, value: string): Promise<string | null> {
  const problem = systemNameProblem(value)
  if (problem) return problem
  let query = (db as any).from('forms').select('id').eq('tenant_id', tenantId).eq('system_name', value).limit(1)
  if (formId) query = query.neq('id', formId)
  const { data, error } = await query
  if (error) throw dbError(error)
  if ((data ?? []).length) return 'Another form in this workspace uses that system name.'
  return null
}

export interface SystemNameCheck {
  system_name: string
  available: boolean
  reason: string | null
  /** Shared links of another form that still redirect from this name (they would open this form instead). */
  redirects_from_form: string | null
}

/** Check a system name for a form (null = a new form). forms.view. */
export async function checkFormSystemName(ctx: ServiceContext, formId: string | null, value: unknown): Promise<SystemNameCheck> {
  requirePerm(ctx, 'forms.view')
  const name = String(value ?? '').trim().toLowerCase()
  const db = await serviceRoleClient(ctx)
  const reason = await systemNameAvailability(db, ctx.tenantId, formId, name)
  let redirectsFrom: string | null = null
  if (!reason) {
    const { data: old } = await (db as any).from('form_system_name_history').select('form_id').eq('tenant_id', ctx.tenantId).eq('system_name', name).maybeSingle()
    if (old && old.form_id !== formId) redirectsFrom = String(old.form_id)
  }
  return { system_name: name, available: reason === null, reason, redirects_from_form: redirectsFrom }
}

/** A free system name suggested from a form name (forms.view). */
export async function suggestFormSystemName(ctx: ServiceContext, name: unknown, formId: string | null = null): Promise<string> {
  requirePerm(ctx, 'forms.view')
  const base = suggestSystemName(String(name ?? ''))
  const db = await serviceRoleClient(ctx)
  const { data } = await (db as any).from('forms').select('id, system_name').eq('tenant_id', ctx.tenantId).like('system_name', `${base}%`).limit(1000)
  const { data: old } = await (db as any).from('form_system_name_history').select('form_id, system_name').eq('tenant_id', ctx.tenantId).like('system_name', `${base}%`).limit(1000)
  const taken = new Set<string>([
    ...((data ?? []) as any[]).filter((r) => r.id !== formId).map((r) => String(r.system_name)),
    ...((old ?? []) as any[]).filter((r) => r.form_id !== formId).map((r) => String(r.system_name)),
  ])
  return nextFreeSystemName(base, taken)
}

/** Clean and check a system name for a write; throws validation / conflict. */
export async function assertSystemName(db: AnySupabaseClient, tenantId: string, formId: string | null, value: unknown): Promise<string> {
  if (typeof value !== 'string') throw ServiceError.validation('system_name must be a string')
  const name = value.trim().toLowerCase()
  const reason = await systemNameAvailability(db, tenantId, formId, name)
  if (reason) throw reason.startsWith('Another form') ? ServiceError.conflict(reason) : ServiceError.validation(`system_name: ${reason}`)
  return name
}

/* ── Links ───────────────────────────────────────────────────────────── */

export interface FormFriendlyLink {
  /** https://<subdomain>.<base>/form/<system_name>, when the workspace has an address. */
  friendly_url: string | null
  system_name: string | null
  /** The workspace address origin, when set. */
  workspace_url: string | null
}

export interface FormLinks extends FormFriendlyLink {
  /** The /f/<id> page (absolute when APP_URL is set). */
  form_url: string
  /** The anonymous /p/<token> link, when anonymous responses are live (forms.view sees it, as in the designer). */
  public_url: string | null
}

/** Every link of a form (forms.view). */
export async function getFormLinks(ctx: ServiceContext, formId: string): Promise<FormLinks> {
  requirePerm(ctx, 'forms.view')
  const friendly = await getFormFriendlyLink(ctx, formId)
  const { publicFormPageUrl, publicAppOrigin } = await import('@/lib/forms/form-page-url')
  const access = await (await import('./anonymous-forms')).getFormAnonymousAccess(ctx, formId)
  return {
    ...friendly,
    form_url: publicFormPageUrl(formId),
    public_url: access.live && access.path ? `${publicAppOrigin()}${access.path}` : null,
  }
}

/** The friendly link of a form (any member who can see the form). */
export async function getFormFriendlyLink(ctx: ServiceContext, formId: string): Promise<FormFriendlyLink> {
  const db = await serviceRoleClient(ctx)
  const [{ data: form, error }, { data: tenant }] = await Promise.all([
    (db as any).from('forms').select('id, system_name').eq('tenant_id', ctx.tenantId).eq('id', formId).maybeSingle(),
    (db as any).from('tenants').select('subdomain').eq('id', ctx.tenantId).maybeSingle(),
  ])
  if (error) throw dbError(error)
  if (!form) throw ServiceError.notFound('Form not found')
  const origin = workspaceUrlFor(tenant?.subdomain ?? null)
  const systemName = (form.system_name ?? null) as string | null
  return { friendly_url: origin && systemName ? friendlyFormUrl(origin, systemName) : null, system_name: systemName, workspace_url: origin }
}
