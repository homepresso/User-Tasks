import { getProviderConfig } from '@/lib/config'
import { getServiceDb, hasServiceDb } from '@/lib/providers/db'
import { authSettings } from '../options'
import {
  chooseAutoIdp, cleanOrgHint, workspaceSsoFromTenantSettings,
  type AutoSsoCandidate, type AutoSsoPurpose, type WorkspaceSsoSettings,
} from './auto'

/**
 * Server side of automatic SSO (lib/providers/auth/sso/auto.ts): which
 * workspace a signed-out visitor is arriving at, its settings, and the IdP
 * to sign in with. Never decides who the visitor is — only where to ask.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings is untyped JSON */

/** Supabase Auth's OAuth buttons that accept prompt=none. */
const SUPABASE_PASSIVE = new Set(['microsoft', 'azure', 'google'])

export interface AutoSsoTarget {
  idpId: string
  idpName: string
  /** The workspace (slug) signed in to; null when no workspace is known. */
  org: string | null
  settings: WorkspaceSsoSettings
  instanceSsoOnly: boolean
}

export interface WorkspaceRef { id: string; slug: string; settings: unknown }

async function workspaceBySlug(slug: string): Promise<WorkspaceRef | null> {
  if (!hasServiceDb()) return null
  const { data } = await (getServiceDb() as any).from('tenants').select('id, slug, settings').eq('slug', slug).is('deleted_at', null).maybeSingle()
  return data ? { id: String(data.id), slug: String(data.slug), settings: data.settings } : null
}

async function workspaceById(id: string): Promise<WorkspaceRef | null> {
  if (!hasServiceDb()) return null
  const { data } = await (getServiceDb() as any).from('tenants').select('id, slug, settings').eq('id', id).is('deleted_at', null).maybeSingle()
  return data ? { id: String(data.id), slug: String(data.slug), settings: data.settings } : null
}

/**
 * The workspace a signed-out request is for: an explicit slug (?org= /
 * ?ut_org=), else the workspace address it arrived on, else the instance's
 * only workspace (self-hosted). Null when none can be told.
 */
export async function arrivalWorkspace(orgHint: string | null): Promise<WorkspaceRef | null> {
  const slug = cleanOrgHint(orgHint)
  if (slug) return workspaceBySlug(slug)
  const { getHostWorkspace } = await import('@/lib/workspace-host')
  const host = await getHostWorkspace()
  if (host.kind === 'workspace') return workspaceById(host.tenant.id)
  const { singleOrganisation } = await import('@/lib/setup/server')
  const only = await singleOrganisation()
  return only ? workspaceBySlug(only.slug) : null
}

/** The IdPs automatic sign-in can use with the configured auth provider. */
export async function autoSsoCandidates(): Promise<{ candidates: AutoSsoCandidate[]; implicit: boolean; instanceSsoOnly: boolean }> {
  const config = await getProviderConfig('auth')
  const instanceSsoOnly = authSettings(config.options).ssoOnly
  if (config.id === 'supabase') {
    const { getAuthProvider } = await import('@/lib/providers/auth')
    const options = await (await getAuthProvider()).loginOptions()
    // Supabase Auth's /authorize, then Microsoft / Google: where a framed passive attempt goes.
    const { writeSsoFrameSources } = await import('./frame-sources')
    const { supabaseUrl } = await import('@/lib/config/bootstrap')
    writeSsoFrameSources([supabaseUrl(), 'https://login.microsoftonline.com', 'https://accounts.google.com'])
    return { candidates: options.sso.filter((o) => SUPABASE_PASSIVE.has(o.id)).map((o) => ({ id: o.id, name: o.name })), implicit: false, instanceSsoOnly }
  }
  const { getSsoProviders, ssoDisplay } = await import('./config')
  const idps = await getSsoProviders()
  return { candidates: idps.map((idp) => ({ id: idp.id, name: ssoDisplay(idp).name, defaultOrg: idp.defaultOrg ?? null })), implicit: true, instanceSsoOnly }
}

/** Startup (instrumentation.ts): learn the IdPs' sign-in origins before the first embeddable page is served. */
export async function warmSsoFrameSources(): Promise<void> {
  await autoSsoCandidates()
}

/**
 * The automatic sign-in for a signed-out visitor, or null (→ the normal
 * sign-in page):
 *  - purpose `launch` (opened from another system): the workspace's
 *    auto_sign_in is on and an IdP resolves;
 *  - purpose `login` (the sign-in page itself): sso_only is on for the
 *    workspace or the instance, and an IdP resolves.
 */
export async function resolveAutoSso(input: { org?: string | null; purpose: AutoSsoPurpose }): Promise<AutoSsoTarget | null> {
  try {
    const [{ candidates, implicit, instanceSsoOnly }, workspace] = await Promise.all([autoSsoCandidates(), arrivalWorkspace(input.org ?? null)])
    if (!candidates.length) return null
    // An explicit workspace that doesn't exist: no automatic sign-in (the page says so).
    if (cleanOrgHint(input.org) && !workspace) return null
    const settings = workspaceSsoFromTenantSettings(workspace?.settings)
    const enabled = input.purpose === 'launch' ? settings.auto_sign_in : settings.sso_only || instanceSsoOnly
    if (!enabled) return null
    const idp = chooseAutoIdp(candidates, settings, workspace?.slug ?? null, implicit)
    if (!idp) return null
    return { idpId: idp.id, idpName: idp.name, org: workspace?.slug ?? null, settings, instanceSsoOnly }
  } catch (error) {
    console.warn('[auth] automatic sign-in unavailable:', (error as Error)?.message ?? error)
    return null
  }
}
