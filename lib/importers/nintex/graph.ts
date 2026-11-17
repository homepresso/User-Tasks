/**
 * Structured blocks → a workflow graph (nodes with positions, labelled
 * edges) for importers: conditions and switches branch by edge label,
 * parallel blocks join, loops run their body on "Each Item" then "Done",
 * Go To Activity steps end their path.
 */
import type { WorkflowGraphEdge, WorkflowGraphNode } from '@/lib/extensions/sdk'

export type GBlock =
  /** terminal: nothing follows the step (Go To Activity). */
  | { kind: 'node'; node: WorkflowGraphNode; outcomes?: string[]; terminal?: boolean }
  /** elseLabel: the fall-through edge's label (switch_case: "default"); noElse: every outcome is a branch. */
  | { kind: 'if'; node: WorkflowGraphNode; branches: Array<{ label: string; blocks: GBlock[] }>; elseBlocks: GBlock[] | null; elseLabel?: string; noElse?: boolean }
  | { kind: 'parallel'; node: WorkflowGraphNode; branches: Array<{ label: string; blocks: GBlock[] }> }
  | { kind: 'loop'; node: WorkflowGraphNode; body: GBlock[] }

type Exit = { source: string; label?: string }

/** A name usable as a workflow variable: snake_case, starts with a letter, at most 60 characters. */
export function varName(raw: string): string {
  const s = String(raw ?? '').normalize('NFKD').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  const v = /^[a-z_]/.test(s) ? s : `v_${s}`
  return (v || 'var').slice(0, 60)
}

export function lowerBlocks(blocks: GBlock[]): { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] } {
  const nodes: WorkflowGraphNode[] = []
  const edges: WorkflowGraphEdge[] = []
  let row = 0
  const connect = (exits: Exit[], target: string) => {
    for (const e of exits) edges.push({ source: e.source, target, ...(e.label ? { label: e.label } : {}) })
  }
  const place = (node: WorkflowGraphNode, col: number) => {
    row += 1
    nodes.push({ ...node, position: { x: col * 320, y: row * 140 } })
  }
  const emit = (list: GBlock[], entries: Exit[], col: number): Exit[] => {
    let exits = entries
    for (const b of list) {
      place(b.node, col)
      connect(exits, b.node.id)
      if (b.kind === 'node') {
        exits = b.terminal ? [] : b.outcomes?.length ? b.outcomes.map((o) => ({ source: b.node.id, label: o })) : [{ source: b.node.id }]
      } else if (b.kind === 'if') {
        const out: Exit[] = []
        const elseLabel = b.elseLabel ?? 'Else'
        b.branches.forEach((br, i) => out.push(...emit(br.blocks, [{ source: b.node.id, label: br.label }], col + i)))
        if (!b.noElse) out.push(...(b.elseBlocks?.length ? emit(b.elseBlocks, [{ source: b.node.id, label: elseLabel }], col + b.branches.length) : [{ source: b.node.id, label: elseLabel }]))
        exits = out
      } else if (b.kind === 'loop') {
        emit(b.body, [{ source: b.node.id, label: 'Each Item' }], col + 1)
        exits = [{ source: b.node.id, label: 'Done' }]
      } else {
        b.branches.forEach((br, i) => emit(br.blocks, [{ source: b.node.id, label: br.label }], col + i))
        exits = [{ source: b.node.id, label: 'Done' }]
      }
    }
    return exits
  }
  emit(blocks, [{ source: 'trigger' }], 0)
  return { nodes, edges }
}
