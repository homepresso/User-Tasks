/**
 * Pure helpers for live instance migration (lib/services/workflow-runs.ts):
 * where a migrated run continues in the target version, which defaults new
 * variables get, and which variables the target path references that the
 * instance does not have (a warning, never a block). No I/O, so the planner
 * logic is unit-tested directly and shared with the UI wizard.
 */

import { NODE_CATALOG } from '@/lib/workflow-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow node configs are free-form */

export interface MigrationNode {
  id: string
  type: string
  label?: string
  config?: Record<string, any>
}

export interface MigrationEdge {
  source: string
  target: string
}

const TRIGGER_TYPES = new Set(NODE_CATALOG.filter((n) => n.category === 'trigger').map((n) => n.type as string))

/** Trigger nodes start a run; a migrated run must continue at a step after them. */
export function isTriggerNodeType(type: string | null | undefined): boolean {
  return !!type && TRIGGER_TYPES.has(type)
}

/** Nodes a run can continue at (no triggers, no section containers). */
export function migratableNodes<T extends MigrationNode>(nodes: readonly T[]): T[] {
  return nodes.filter((n) => n && n.id && !isTriggerNodeType(n.type) && n.type !== 'section_group')
}

/** User-variable defaults exactly as the engine computes them when a run starts. */
export function userVariableDefaults(
  userVariables: ReadonlyArray<{ name?: string; type?: string; defaultValue?: unknown }> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const uv of userVariables ?? []) {
    if (!uv?.name) continue
    let val: any = uv.defaultValue ?? ''
    if (uv.type === 'number') val = Number(val) || 0
    else if (uv.type === 'boolean') val = val === 'true' || val === true
    else if (uv.type === 'object') {
      try {
        val = typeof val === 'string' ? JSON.parse(val) : val
      } catch {
        val = {}
      }
    }
    out[uv.name] = val
  }
  return out
}

export type TargetVia = 'map' | 'default' | 'same_id'

/**
 * Target node for an instance currently at `sourceNodeId`:
 * node_map[source] → default target → the node with the same id. Returns
 * null when none applies (e.g. the node was removed and nothing was chosen).
 */
export function resolveTargetNode(
  sourceNodeId: string | null | undefined,
  opts: { nodeMap?: Record<string, string> | null; defaultTargetNodeId?: string | null; targetNodeIds: ReadonlySet<string> },
): { nodeId: string | null; via: TargetVia | null } {
  const mapped = sourceNodeId ? opts.nodeMap?.[sourceNodeId] : undefined
  if (mapped) return { nodeId: mapped, via: 'map' }
  if (opts.defaultTargetNodeId) return { nodeId: opts.defaultTargetNodeId, via: 'default' }
  if (sourceNodeId && opts.targetNodeIds.has(sourceNodeId)) return { nodeId: sourceNodeId, via: 'same_id' }
  return { nodeId: null, via: null }
}

/** `startId` and every node reachable from it. */
export function reachableFrom(startId: string, edges: readonly MigrationEdge[]): Set<string> {
  const out = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    for (const edge of edges) {
      if (edge.source === id && !out.has(edge.target)) {
        out.add(edge.target)
        queue.push(edge.target)
      }
    }
  }
  return out
}

/** Namespaces and engine-provided variables that are always present (or set at run time). */
const BUILTIN_ROOTS = new Set([
  'task', 'trigger', 'nodes', 'node', 'env', 'secrets', 'secret', 'now', 'today', 'item', 'index', 'loop', 'row', 'rows',
  'tenant_id', 'task_id', 'outcome', 'outcome_notes', 'app_url', 'event_id', 'event_name', 'trigger_type', '_trigger_type',
  'has_error', 'api_response', 'api_status', 'agent_response',
])
const BUILTIN_PREFIXES = ['workflow_', 'user_task_', 'last_error', 'sub_workflow_', 'live_', 'agent_response_']

/** Config keys whose string value names a variable a node writes. */
const PRODUCER_KEYS = /^(name|variable|variable_?name|output_?variable|item_?var(iable)?|index_?var(iable)?|result_?variable|target_?variable|rows?_?var(iable)?)$/i
/** Config keys holding a map/list of variables a node writes. */
const PRODUCER_CONTAINERS = /^(variables|assignments|outputs|output_variables|mappings|set)$/i

function slugPrefix(node: MigrationNode): string {
  const custom = node.config?._output_prefix
  if (typeof custom === 'string' && custom) return custom
  const slug = String(node.label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
  return slug || node.id.slice(0, 8)
}

function collectProduced(value: unknown, key: string | null, out: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectProduced(item, key, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (key && PRODUCER_CONTAINERS.test(key) && /^[A-Za-z_]\w*$/.test(k) && !Array.isArray(value)) out.add(k)
      if (typeof v === 'string' && PRODUCER_KEYS.test(k) && /^[A-Za-z_]\w*$/.test(v)) out.add(v)
      if (k === 'variableName' && typeof v === 'string') out.add(v)
      collectProduced(v, k, out)
    }
  }
}

function collectReferences(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*([A-Za-z_][\w]*)/g)) out.add(match[1])
  } else if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectReferences(v, out)
  }
}

export interface MissingVariable {
  name: string
  /** Labels of the nodes on the target path that reference it. */
  nodes: string[]
}

/**
 * Variables referenced (`{{name…}}`) by the target node or anything after it
 * that the migrated instance will not have: not carried over, not a user
 * variable of the target version, not engine-provided and not written by any
 * node of the target version. Heuristic — reported as a warning.
 */
export function missingVariables(params: {
  nodes: readonly MigrationNode[]
  edges: readonly MigrationEdge[]
  startNodeId: string
  available: Iterable<string>
}): MissingVariable[] {
  const available = new Set(params.available)
  const produced = new Set<string>()
  const prefixes: string[] = []
  for (const node of params.nodes) {
    collectProduced(node.config ?? {}, null, produced)
    prefixes.push(`${slugPrefix(node)}_`)
  }
  const downstream = reachableFrom(params.startNodeId, params.edges)
  const missing = new Map<string, string[]>()
  for (const node of params.nodes) {
    if (!downstream.has(node.id)) continue
    const refs = new Set<string>()
    collectReferences(node.config ?? {}, refs)
    for (const name of refs) {
      if (available.has(name) || produced.has(name) || BUILTIN_ROOTS.has(name)) continue
      if (BUILTIN_PREFIXES.some((p) => name.startsWith(p)) || prefixes.some((p) => name.startsWith(p))) continue
      const list = missing.get(name) ?? []
      list.push(node.label || node.id)
      missing.set(name, list)
    }
  }
  return [...missing.entries()].map(([name, nodes]) => ({ name, nodes })).sort((a, b) => a.name.localeCompare(b.name))
}

