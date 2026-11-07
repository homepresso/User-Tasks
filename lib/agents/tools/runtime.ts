/**
 * The context an agent's tools run in (server only).
 *
 * Tools used to be internal HTTP routes the executor called with the
 * processor secret, passing tenant / agent / acting user in the body (and
 * the origin came from the request's Host header on two paths). They now run
 * in-process with this runtime, built by lib/agents/prepare.ts from the
 * tenant-checked agent row:
 *
 *  - `db` is a service-role client; every query filters `tenantId`.
 *  - `actingUserId` is the person the agent acts for (or null: the agent's
 *    own configured scope only). `permissions` are that person's live role
 *    permissions — tool actions need the same permission the person would
 *    need (tasks.complete, workflows.activate, data.manage_rows, …).
 *    With no acting user, task and workflow *write* actions are refused.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'

export interface AgentGeneratedFile {
  name: string
  url: string
  path?: string
  ref?: string
  size: number
  content_type: string
}

export interface AgentToolRuntime {
  tenantId: string
  agentId: string
  actingUserId: string | null
  outputConfig: NormalizedAgentOutputConfig
  /** Service-role client (lazy so pure tools never need one). */
  db: () => SupabaseClient
  /** Live permissions of the acting user (null when there is none). Cached per run. */
  permissions: () => Promise<ReadonlySet<string> | null>
  traceId?: string | null
  /** Hostnames URL tools may reach (empty = any public host). */
  allowedHosts: string[]
  /** Files produced by tools this run (generate_excel, …). */
  generatedFiles: AgentGeneratedFile[]
  signal?: AbortSignal
}

export type ToolResult = Record<string, unknown>

export class AgentToolError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'AgentToolError'
  }
}

/** Resolve (and cache) the acting user's role permissions in the tenant. */
export function permissionsResolver(db: () => SupabaseClient, tenantId: string, actingUserId: string | null): () => Promise<ReadonlySet<string> | null> {
  let cached: Promise<ReadonlySet<string> | null> | null = null
  return () => {
    if (!actingUserId) return Promise.resolve(null)
    if (!cached) {
      cached = (async () => {
        const { userRolePermissions } = await import('@/lib/services/roles')
        const ctx = { supabase: db(), db: db(), tenantId, actorId: actingUserId, permissions: null, authKind: 'job', source: 'job' } as any
        try { return await userRolePermissions(ctx, actingUserId) } catch { return new Set<string>() }
      })()
    }
    return cached
  }
}

/** Refuse unless the acting user holds every permission (no acting user → refuse when `requireUser`). */
export async function requireActingPermission(runtime: AgentToolRuntime, perms: readonly string[], options: { requireUser: boolean; what: string }): Promise<void> {
  if (!runtime.actingUserId) {
    if (options.requireUser) {
      throw new AgentToolError(`${options.what} needs a signed-in person to act for, and this run has none (it was started by a schedule, webhook, public form or a tenant API key). Ask a person to run it, or set the Run Agent step to act as the workflow owner.`, 403)
    }
    return
  }
  if (perms.length === 0) return
  const held = await runtime.permissions()
  const missing = perms.find((p) => !held?.has(p))
  if (missing) throw new AgentToolError(`The person this agent acts for lacks the '${missing}' permission`, 403)
}
