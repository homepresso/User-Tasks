'use server'

import { getCachedUser } from '@/lib/supabase/server'
import { getServiceDb } from '@/lib/providers/db'
import { auditOAuthEvent } from '@/lib/oauth/audit'
import {
  buildClientRedirect,
  consumeConsentRequest,
  issueAuthorizationCode,
  loadConsentRequest,
} from '@/lib/oauth/provider'

function service() {
  return getServiceDb()
}

/**
 * Consent decisions. Both verify the request row belongs to the currently
 * logged-in user and consume it atomically, so the consent form can be neither
 * forged (it carries only an opaque id) nor replayed.
 */

export async function approveOAuthConsent(requestId: string): Promise<{ redirectTo: string }> {
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const supabase = service()

  const req = await loadConsentRequest(supabase, requestId, user.id)
  if (!req) throw new Error('This authorization request has expired — start again from the application.')

  if (!(await consumeConsentRequest(supabase, req.id))) {
    throw new Error('This authorization request was already used.')
  }

  const code = await issueAuthorizationCode(supabase, req.payload, user.id)

  await auditOAuthEvent({
    supabase: supabase as any, tenantId: req.payload.tenant_id, actorId: user.id, clientId: req.payload.client_id,
    event: 'consent_granted', action: 'grant', scopes: req.payload.scopes,
    summary: `Approved OAuth access for "${req.payload.client_name}"`,
  })

  return {
    redirectTo: buildClientRedirect(req.payload.redirect_uri, { code, state: req.payload.state }),
  }
}

export async function denyOAuthConsent(requestId: string): Promise<{ redirectTo: string }> {
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const supabase = service()

  const req = await loadConsentRequest(supabase, requestId, user.id)
  if (!req) throw new Error('This authorization request has expired.')
  await consumeConsentRequest(supabase, req.id)

  await auditOAuthEvent({
    supabase: supabase as any, tenantId: req.payload.tenant_id, actorId: user.id, clientId: req.payload.client_id,
    event: 'consent_denied', action: 'update',
    summary: `Denied OAuth access for "${req.payload.client_name}"`,
  })

  return {
    redirectTo: buildClientRedirect(req.payload.redirect_uri, { error: 'access_denied', state: req.payload.state }),
  }
}

/** Load the consent request for rendering (read-only; server component uses it). */
export async function getConsentRequest(requestId: string): Promise<{
  clientName: string
  scopes: string[]
  tenantName: string | null
  /** 'first_party' = shipped by UserTasks; 'unverified' = self-registered (DCR); 'workspace' = registered by a workspace admin. */
  clientKind: 'first_party' | 'unverified' | 'workspace'
} | null> {
  const user = await getCachedUser()
  if (!user) return null
  const supabase = service()
  const req = await loadConsentRequest(supabase, requestId, user.id)
  if (!req) return null

  const { data: tenant } = await (supabase as any)
    .from('tenants')
    .select('name')
    .eq('id', req.payload.tenant_id)
    .maybeSingle()

  return {
    clientName: req.payload.client_name,
    scopes: req.payload.scopes,
    tenantName: (tenant as any)?.name ?? null,
    clientKind: req.payload.client_first_party
      ? 'first_party'
      : req.payload.client_dynamic === false ? 'workspace' : 'unverified',
  }
}
