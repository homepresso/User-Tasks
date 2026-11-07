/**
 * Agent version pins in published workflows.
 *
 * Publishing a workflow stamps every Run Agent step of the published
 * snapshot (workflow_versions.nodes) with `agent_version` — the agent's
 * version at publish time. Runs of the published version (any trigger,
 * REST, MCP, CLI, schedules) run that version (lib/agents/prepare.ts
 * pinnedAgent); saving the agent, or restoring an older version, creates a
 * newer version and leaves the pin alone. Drafts and Save & Test carry no
 * pin and run the latest version. The designer shows "pinned to v3 · newer
 * v5 available — update" (updatePinnedAgentVersion publishes a copy of the
 * live version with that step re-pinned; draft changes are not published).
 *
 * Pure helpers here (client-safe); the DB-reading ones take a client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const RUN_AGENT_NODE = 'run_agent'

export interface AgentPin { node_id: string; node_label: string | null; agent_id: string; version: number | null }

/** Run Agent steps with an agent, and their pins (null when unpinned). */
export function agentPins(nodes: unknown): AgentPin[] {
  if (!Array.isArray(nodes)) return []
  const out: AgentPin[] = []
  for (const node of nodes as any[]) {
    if (node?.type !== RUN_AGENT_NODE) continue
    const agentId = typeof node.config?.agent_id === 'string' ? node.config.agent_id.trim() : ''
    if (!agentId) continue
    const v = Number(node.config?.agent_version)
    out.push({ node_id: String(node.id ?? ''), node_label: typeof node.label === 'string' ? node.label : null, agent_id: agentId, version: Number.isFinite(v) && v >= 1 ? Math.floor(v) : null })
  }
  return out
}

/** Nodes with each Run Agent step pinned to `versions` (agent id → version); unknown agents stay unpinned. */
export function pinAgentVersions<T>(nodes: T, versions: Map<string, number>, onlyNodeId?: string): T {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((node: any) => {
    if (node?.type !== RUN_AGENT_NODE) return node
    if (onlyNodeId && node.id !== onlyNodeId) return node
    const id = typeof node.config?.agent_id === 'string' ? node.config.agent_id.trim() : ''
    if (!id || !versions.has(id)) {
      if (!node.config || !('agent_version' in node.config)) return node
      const { agent_version: _drop, ...config } = node.config
      return { ...node, config }
    }
    return { ...node, config: { ...node.config, agent_version: versions.get(id) } }
  }) as T
}

/** Draft copies of a published snapshot (revert, import): pins removed, so the draft follows the latest agent versions. */
export function unpinAgentVersions<T>(nodes: T): T {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((node: any) => {
    if (!node?.config || !('agent_version' in node.config)) return node
    const { agent_version: _pinned, ...config } = node.config
    return { ...node, config }
  }) as T
}

/** agent id → current version, for the tenant's agents. */
export async function currentAgentVersions(db: SupabaseClient, tenantId: string, agentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(agentIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id))
  if (!ids.length) return out
  const { data, error } = await (db as any).from('agents').select('id, version').eq('tenant_id', tenantId).in('id', ids)
  if (error) throw new Error(error.message)
  for (const row of (data ?? []) as any[]) out.set(String(row.id), Number(row.version) || 1)
  return out
}

/** Nodes for a published snapshot: Run Agent steps pinned to their agent's current version. */
export async function pinWorkflowAgents<T>(db: SupabaseClient, tenantId: string, nodes: T): Promise<T> {
  const pins = agentPins(nodes)
  if (!pins.length) return nodes
  return pinAgentVersions(nodes, await currentAgentVersions(db, tenantId, pins.map((p) => p.agent_id)))
}
