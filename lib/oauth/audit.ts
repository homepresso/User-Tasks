import { writeAudit, type WriteAuditParams } from '@/lib/audit-log'

/**
 * Security audit rows for the OAuth provider. Written to object_audit_log with
 * object_type 'oauth_client'; `metadata.event` names the security event and
 * becomes the event_stream type (security.oauth.<event>). Metadata carries
 * identifiers only — never token or secret material.
 */
export type OAuthSecurityEvent =
  | 'consent_granted'
  | 'consent_denied'
  | 'token_issued'
  | 'token_revoked'
  | 'code_replay'
  | 'refresh_reuse'

export async function auditOAuthEvent(params: {
  supabase: WriteAuditParams['supabase']
  tenantId: string | null | undefined
  actorId: string | null | undefined
  clientId: string
  event: OAuthSecurityEvent
  action: 'grant' | 'revoke' | 'update'
  summary: string
  grantType?: string
  scopes?: string[]
  tokenType?: 'access' | 'refresh'
}): Promise<void> {
  if (!params.tenantId) return
  await writeAudit({
    supabase: params.supabase,
    tenantId: params.tenantId,
    actorId: params.actorId ?? null,
    objectType: 'oauth_client',
    objectId: params.clientId,
    action: params.action,
    summary: params.summary,
    metadata: {
      event: params.event,
      client_id: params.clientId,
      ...(params.grantType ? { grant_type: params.grantType } : {}),
      ...(params.scopes ? { scopes: params.scopes } : {}),
      ...(params.tokenType ? { token_type: params.tokenType } : {}),
    },
  })
}

/** Normalise the stored grant_type ("authorization_code:<code id>") to the grant name. */
export function grantName(grantType: string | null | undefined): string {
  return String(grantType ?? '').split(':')[0] || 'unknown'
}
