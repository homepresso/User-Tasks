/**
 * Wiring warnings (lib/workflow-wiring.ts) for programmatic builders: REST
 * create / update, MCP workflows_create / workflows_update /
 * workflows_validate. The linked forms the nodes name are read once (one
 * query) so `{{form.<key>}}` and User Task fields can be checked even when a
 * node has no cached `fields` copy. Never throws: warnings are advisory.
 */

import type { LinkedFormLike, PickerWorkflowVariable } from '@/lib/workflow-data-picker'
import { validateWorkflowWiring, type WiringWarning } from '@/lib/workflow-wiring'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow JSON is untyped here */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_WARNINGS = 100

/** Latest versions of the forms `nodes` link (form_id), by id. */
export async function loadWiringForms(db: any, tenantId: string, nodes: unknown): Promise<Record<string, LinkedFormLike>> {
  const ids = new Set<string>()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const formId = (node as any)?.config?.form_id
    if (typeof formId === 'string' && UUID.test(formId)) ids.add(formId)
  }
  if (!ids.size) return {}
  const { data } = await db.from('forms').select('id, name, version, fields, layout').eq('tenant_id', tenantId).in('id', [...ids].slice(0, 50))
  return Object.fromEntries(((data ?? []) as any[]).map((form) => [String(form.id), { fields: form.fields, layout: form.layout, version: form.version, name: form.name }]))
}

/** The response shape: `{ node_id, node_label, kind, message, suggestion?, reference?, key? }`. */
export type WorkflowWarning = WiringWarning

export async function workflowWiringWarnings(
  db: any,
  tenantId: string,
  definition: { nodes?: unknown; edges?: unknown; user_variables?: unknown },
): Promise<WorkflowWarning[]> {
  try {
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : []
    if (!nodes.length) return []
    const linkedForms = await loadWiringForms(db, tenantId, nodes).catch(() => ({}))
    return validateWorkflowWiring({
      nodes,
      edges: Array.isArray(definition.edges) ? definition.edges : [],
      workflowVariables: Array.isArray(definition.user_variables) ? (definition.user_variables as PickerWorkflowVariable[]) : [],
      linkedForms,
    }).slice(0, MAX_WARNINGS)
  } catch {
    return []
  }
}
