import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { createServiceClient, isAuthorizedServiceCall } from '@/lib/cron-auth'

/**
 * Shared dual-auth for the internal agent tool routes
 * (/api/agents/data-tool, /action-tool, /doc-tool and /api/references/execute).
 *
 * Two callers reach these routes:
 *   1. The browser, with a Supabase session cookie (interactive agent runs).
 *   2. The agent executor server-to-server, with the processor secret header
 *      (`x-processor-secret` / `Authorization: Bearer`), carrying `tenant_id`
 *      and (optionally) `acting_user_id` in the request body.
 *
 * SECURITY: `body.tenant_id` / `body.acting_user_id` are trusted ONLY on the
 * processor path (secret verified via `isAuthorizedServiceCall`). On the session
 * path the tenant and acting user are derived from the authenticated user — the
 * body is never consulted for identity.
 */
export type AgentToolContext = {
  tenantId: string
  /** null on the processor path when no acting user is supplied (e.g. queue). */
  actingUserId: string | null
  supabase: SupabaseClient
  via: 'session' | 'processor'
}

export async function resolveAgentToolContext(
  request: NextRequest,
  body: any,
): Promise<AgentToolContext | { error: NextResponse }> {
  // Processor path — trusted server-to-server call.
  if (isAuthorizedServiceCall(request)) {
    const tenantId = String(body?.tenant_id ?? '').trim()
    if (!tenantId) {
      return { error: NextResponse.json({ error: 'tenant_id is required for processor calls' }, { status: 400 }) }
    }
    const actingUserId = String(body?.acting_user_id ?? '').trim() || null
    return {
      tenantId,
      actingUserId,
      supabase: createServiceClient(),
      via: 'processor',
    }
  }

  // Session path — authenticated browser user. Body identity is NOT trusted here.
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', user.id)
    .single()
  const tenantId = (profile as any)?.current_tenant_id ?? (profile as any)?.tenant_id
  if (!tenantId) {
    return { error: NextResponse.json({ error: 'No tenant' }, { status: 400 }) }
  }

  return {
    tenantId: String(tenantId),
    actingUserId: user.id,
    supabase: supabase as unknown as SupabaseClient,
    via: 'session',
  }
}
