/**
 * Downstream references to a form field: `{{task_data.<key>}}` (what a User
 * Task returns to the workflow) and `task.data.<key>` (the task object —
 * task triggers, expressions, conditions). Used when a field key is renamed
 * in the designer: list where the old key is used and, if the author agrees,
 * rewrite those references to the new key.
 *
 * References are matched inside any string of any node config (expressions,
 * conditions, templates, mappings), as whole path segments: renaming
 * `amount` never touches `task_data.amount_total`. Pure.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

export interface RefNode {
  id: string
  type: string
  label?: string
  config?: Record<string, any>
}

export interface FieldReference {
  node_id: string
  node_label: string
  /** Config path where the reference appears (e.g. `expression`, `conditions.0.value`). */
  path: string
  count: number
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function referenceRegex(key: string): RegExp {
  // task_data.<key> or task.data.<key>, followed by a non-word character or end.
  return new RegExp(`\\b(task_data|task\\.data)\\.${escape(key)}(?![\\w])`, 'g')
}

function walkStrings(value: unknown, path: string[], visit: (text: string, path: string[]) => string | void, depth = 0): unknown {
  if (depth > 40) return value
  if (typeof value === 'string') {
    const next = visit(value, path)
    return next === undefined ? value : next
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((item, i) => {
      const next = walkStrings(item, [...path, String(i)], visit, depth + 1)
      if (next !== item) changed = true
      return next
    })
    return changed ? out : value
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      const next = walkStrings(child, [...path, k], visit, depth + 1)
      if (next !== child) changed = true
      out[k] = next
    }
    return changed ? out : value
  }
  return value
}

/** Every place a field key is referenced in `nodes` (excluding `skipNodeId`, the form's own node). */
export function findFieldReferences(nodes: RefNode[], key: string, skipNodeId?: string): FieldReference[] {
  if (!key) return []
  const out: FieldReference[] = []
  for (const node of nodes) {
    if (node.id === skipNodeId) continue
    walkStrings(node.config ?? {}, [], (text, path) => {
      const matches = text.match(referenceRegex(key))
      if (matches?.length) out.push({ node_id: node.id, node_label: node.label || node.type, path: path.join('.'), count: matches.length })
    })
  }
  return out
}

/** Replace references to `from` with `to` in a string. */
export function renameFieldReferencesInText(text: string, from: string, to: string): string {
  return text.replace(referenceRegex(from), (_m, prefix: string) => `${prefix}.${to}`)
}

/**
 * `nodes` with every reference to field `from` rewritten to `to`
 * (`skipNodeId` untouched). Nodes without references are returned as the
 * same objects.
 */
export function renameFieldReferences<N extends RefNode>(nodes: N[], from: string, to: string, skipNodeId?: string): N[] {
  if (!from || !to || from === to) return nodes
  return nodes.map((node) => {
    if (node.id === skipNodeId || !node.config) return node
    const config = walkStrings(node.config, [], (text) => {
      const next = renameFieldReferencesInText(text, from, to)
      return next === text ? undefined : next
    })
    return config === node.config ? node : { ...node, config: config as Record<string, any> }
  })
}
