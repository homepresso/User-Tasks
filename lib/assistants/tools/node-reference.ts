/**
 * workflow_node_reference: the canonical config of the node types (and item
 * kinds) the Agent is about to build with — so it never reads existing
 * workflows to learn the format (in production one "build this process"
 * request spent its whole 400k-token budget reading the catalog and three
 * full workflow definitions, and built nothing).
 *
 * For each requested node type: label, purpose, settings (config keys), what
 * validation requires, the variables it sets and one minimal example — from
 * lib/workflow-schema.ts NODE_CATALOG, lib/docs/node-docs.ts NODE_DOCS (the
 * hand-written reference behind /docs/workflows/nodes, typed per NodeType so a
 * new node cannot go undocumented) and lib/workflow-validation.ts
 * validateNode. For each requested item kind (form, data_table,
 * decision_table, report, workflow, custom_action, …): its create tool's full
 * argument schema with every help text — the tool list the model always sees
 * carries shortened descriptions (designer.ts trimSchema) pointing here.
 */
import { NODE_CATALOG, type NodeType } from '@/lib/workflow-schema'
import { NODE_DOCS } from '@/lib/docs/node-docs'
import { validateNode } from '@/lib/workflow-validation'
import type { AssistantToolDef } from '../engine'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const NODE_REFERENCE_TOOL = 'workflow_node_reference'

/** Item kinds → their create tool (the reference is that tool's full argument schema). */
export const ITEM_REFERENCE: Record<string, string> = {
  workflow: 'workflows_create',
  form: 'forms_create',
  data_table: 'data_tables_create',
  decision_table: 'decision_tables_create',
  report: 'reports_create',
  custom_action: 'workflow_activities_create',
  form_control: 'form_controls_create',
  email_template: 'email_templates_create',
  agent: 'agents_create',
}

/** The reference item kind for a tool name (forms_update → form), or null. */
export function referenceKindOf(tool: string): string | null {
  for (const [kind, create] of Object.entries(ITEM_REFERENCE)) {
    const prefix = create.replace(/_create$/, '')
    if (tool === create || tool.startsWith(`${prefix}_`)) return kind
  }
  return null
}

const WORKFLOW_SHAPE = 'A workflow: { name, trigger_type, nodes: [{ id, type, label, config }], edges: [{ source, target, label? }] } — the trigger node (type = trigger_type) first; positions are optional (laid out automatically). A condition / switch_case / user_task edge label must equal its branch label / case / outcome. Reference values with {{…}} as in the wiring guide.'

/** Markdown links and docs pointers out of a NODE_DOCS text. */
const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s*[—-]\s*see \/docs\/[\w/#-]+/g, '').replace(/\s*\(see \/docs\/[\w/#-]+\)/g, '')

/** The reference entry of one node type (null: unknown type). */
export function nodeReference(type: string): Record<string, unknown> | null {
  const node = NODE_CATALOG.find((n) => n.type === type)
  if (!node) return null
  const doc = NODE_DOCS[node.type as NodeType]
  let required: string[] = []
  try { required = validateNode({ id: 'ref', type: node.type as NodeType, label: node.label, position: { x: 0, y: 0 }, config: {} }) } catch { required = [] }
  return {
    type: node.type,
    label: node.label,
    category: node.category,
    purpose: node.description,
    settings: plain(doc?.settings ?? ''),
    ...(required.length ? { required: required.slice(0, 8) } : {}),
    ...(doc?.outputs ? { sets: plain(doc.outputs) } : {}),
    ...(doc?.example ? { example: { id: node.type.replace(/_/g, '-'), type: node.type, label: node.label, config: doc.example } } : {}),
  }
}

/** The closest known node types for an unknown name (typo / guessed name). */
function suggestions(type: string): string[] {
  const t = type.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  const parts = t.split('_').filter((p) => p.length > 2)
  return NODE_CATALOG.filter((n) => n.type.includes(t) || parts.some((p) => n.type.includes(p) || n.label.toLowerCase().includes(p))).map((n) => n.type).slice(0, 5)
}

export interface NodeReferenceDeps {
  /** The create tool's full model-facing argument schema and description (before trimming), or null when not offered. */
  itemSchema: (tool: string) => { description: string; parameters: Record<string, unknown> } | null
}

/** The reference payload for some node types and item kinds. */
export function buildReference(args: Record<string, any>, deps: NodeReferenceDeps): Record<string, unknown> {
  const types = (Array.isArray(args.types) ? args.types : typeof args.types === 'string' ? args.types.split(',') : []).map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 25)
  const items = (Array.isArray(args.items) ? args.items : typeof args.items === 'string' ? args.items.split(',') : []).map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 6)
  if (!types.length && !items.length) return { error: 'Pass `types` (node types, e.g. ["form_submitted", "user_task"]) and / or `items` (form, data_table, decision_table, report, workflow, custom_action) — workflows_catalog lists the node types.' }
  const nodes: Record<string, unknown>[] = []
  const unknown: Array<{ type: string; did_you_mean: string[] }> = []
  for (const t of [...new Set(types as string[])]) {
    const ref = nodeReference(t)
    if (ref) nodes.push(ref)
    else unknown.push({ type: t, did_you_mean: suggestions(t) })
  }
  const itemRefs: Record<string, unknown> = {}
  for (const kind of [...new Set(items as string[])]) {
    const tool = ITEM_REFERENCE[kind]
    const schema = tool ? deps.itemSchema(tool) : null
    itemRefs[kind] = schema ? { create_tool: tool, description: schema.description, arguments: schema.parameters } : { error: tool ? `You can't create ${kind.replace(/_/g, ' ')}s here` : `Unknown item kind: ${kind} (one of ${Object.keys(ITEM_REFERENCE).join(', ')})` }
  }
  return {
    ...(nodes.length ? { workflow_shape: WORKFLOW_SHAPE, nodes } : {}),
    ...(unknown.length ? { unknown_types: unknown } : {}),
    ...(items.length ? { items: itemRefs } : {}),
  }
}

export function nodeReferenceTool(deps: NodeReferenceDeps): AssistantToolDef {
  return {
    name: NODE_REFERENCE_TOOL,
    description: 'The canonical format to build with: for each workflow node type, its config keys, required settings, the variables it sets and a minimal example; for each item kind (form, data_table, decision_table, report, workflow, custom_action), the full arguments of its create tool. Use this instead of reading existing workflows / forms to learn the format. Ask only for what you will use.',
    parameters: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, description: 'Node types (from workflows_catalog), e.g. ["form_submitted", "user_task", "update_data_table", "condition", "send_email"]' },
        items: { type: 'array', items: { type: 'string', enum: Object.keys(ITEM_REFERENCE) }, description: 'Item kinds whose create arguments you need, e.g. ["form", "data_table", "decision_table"]' },
      },
    },
    mode: 'read',
    label: () => 'Reading the build reference',
    maxResultChars: 40_000,
    run: async (args) => {
      const result = buildReference(args, deps)
      return { result, ok: !('error' in result) }
    },
  }
}
