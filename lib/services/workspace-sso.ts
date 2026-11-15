/**
 * The workspace's automatic sign-in settings (lib/providers/auth/sso/auto.ts):
 * tenants.settings.sso — no table of its own, so no migration.
 *
 *   auto_sign_in  sign in automatically with SSO when UserTasks is opened from
 *                 another system (a SharePoint add-in button, a portal link to
 *                 an extension page) — default on
 *   sso_only      skip the sign-in page: /login goes straight to the IdP —
 *                 default off (/login?local=1 still shows it)
 *   idp           the identity provider to use; null = automatic (the IdP
 *                 provisioning into this workspace, else the only one)
 *
 * Any member reads them (with the IdPs available and the one in effect);
 * settings.edit changes them (audited).
 */

import {
  applyWorkspaceSsoPatch, chooseAutoIdp, workspaceSsoFromTenantSettings, workspaceSsoPatchProblem,
  type WorkspaceSsoSettings,
} from '@/lib/providers/auth/sso/auto'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings is untyped JSON */

export interface WorkspaceSsoView extends WorkspaceSsoSettings {
  /** The instance skips the sign-in page for every workspace (auth.sso_only / AUTH_SSO_ONLY). */
  instance_sso_only: boolean
  /** Identity providers automatic sign-in can use on this instance. */
  providers: Array<{ id: string; name: string }>
  /** The IdP signed-out visitors are sent to now (null: none applies — the sign-in page shows). */
  effective_idp: string | null
}

export const workspaceSsoDeps = {
  candidates: async () => (await import('@/lib/providers/auth/sso/auto-server')).autoSsoCandidates(),
}

async function view(settings: WorkspaceSsoSettings, slug: string | null): Promise<WorkspaceSsoView> {
  const { candidates, implicit, instanceSsoOnly } = await workspaceSsoDeps.candidates().catch(() => ({ candidates: [], implicit: false, instanceSsoOnly: false }))
  const effective = chooseAutoIdp(candidates, settings, slug, implicit)
  return {
    ...settings,
    instance_sso_only: instanceSsoOnly,
    providers: candidates.map((c) => ({ id: c.id, name: c.name })),
    effective_idp: effective?.id ?? null,
  }
}

export async function getWorkspaceSso(ctx: ServiceContext): Promise<WorkspaceSsoView> {
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('slug, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  return view(workspaceSsoFromTenantSettings(data.settings), typeof data.slug === 'string' ? data.slug : null)
}

/** Change some of the settings (settings.edit); every other key of tenants.settings is kept. Audited. */
export async function setWorkspaceSso(ctx: ServiceContext, input: unknown): Promise<WorkspaceSsoView> {
  requirePerm(ctx, 'settings.edit')
  const problem = workspaceSsoPatchProblem(input)
  if (problem) throw ServiceError.validation(problem)
  const patch = input as Record<string, unknown>
  if (typeof patch.idp === 'string' && patch.idp) {
    const { candidates } = await workspaceSsoDeps.candidates()
    if (!candidates.some((c) => c.id === patch.idp)) {
      throw ServiceError.validation(`"${patch.idp}" is not an identity provider of this instance${candidates.length ? ` (${candidates.map((c) => c.id).join(', ')})` : ' (none is configured)'}.`)
    }
  }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, slug, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = workspaceSsoFromTenantSettings(settings)
  const next = applyWorkspaceSsoPatch(before, patch)
  settings.sso = { ...(settings.sso && typeof settings.sso === 'object' && !Array.isArray(settings.sso) ? settings.sso : {}), ...next }
  const { error: writeError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (writeError) throw dbError(writeError)
  const changed = (Object.keys(next) as Array<keyof WorkspaceSsoSettings>).filter((k) => next[k] !== before[k])
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: changed.length ? `Changed single sign-on (${changed.map((k) => `${k} ${JSON.stringify(next[k])}`).join(', ')})` : 'Saved single sign-on (no change)',
    diff: { sso: { before, after: next } },
  })
  return view(next, typeof data.slug === 'string' ? data.slug : null)
}
