import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { getUserPermissions } from '@/lib/permissions-server'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import type { AgentToolRuntime } from '@/lib/agents/tools/runtime'

/**
 * Session auth for the agent tool routes (/api/agents/data-tool,
 * /action-tool, /doc-tool): a signed-in user with agents.test calls one of
 * an agent's tools directly, acting as themselves.
 *
 * The agent executor no longer calls these routes: tools run in-process
 * (lib/agents/tools) with a runtime built from the tenant-checked agent. The
 * former processor-secret path (identity taken from the request body, and an
 * origin derived from the Host header on two callers) is gone.
 */
export async function resolveSessionToolRuntime(
  _request: NextRequest,
  body: any,
): Promise<{ runtime: AgentToolRuntime; permissions: ReadonlySet<string> } | { error: NextResponse }> {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = String((profile as any)?.current_tenant_id ?? (profile as any)?.tenant_id ?? '')
  if (!tenantId) return { error: NextResponse.json({ error: 'No tenant' }, { status: 400 }) }
  const permissions = await getUserPermissions()
  if (!permissions.has('agents.test')) {
    return { error: NextResponse.json({ error: "Forbidden: the 'agents.test' permission is required" }, { status: 403 }) }
  }
  const agentId = String(body?.agent_id ?? '').trim()
  if (!agentId) return { error: NextResponse.json({ error: 'agent_id is required' }, { status: 400 }) }
  const db = createServiceClient()
  const { data: agent } = await (db as any).from('agents').select('id, output_config').eq('id', agentId).eq('tenant_id', tenantId).maybeSingle()
  // Unknown / foreign agent: refuse (it used to fall back to "all tables").
  if (!agent) return { error: NextResponse.json({ error: 'Agent not found' }, { status: 404 }) }
  const outputConfig = normalizeAgentOutputConfig(agent.output_config)
  return {
    permissions,
    runtime: {
      tenantId, agentId, actingUserId: user.id, outputConfig,
      db: () => db, permissions: async () => permissions,
      allowedHosts: outputConfig.egress.allowed_hosts, generatedFiles: [],
    },
  }
}
