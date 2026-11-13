/**
 * Licence / enablement gates for workflows that use extension steps
 * (`ext.<id>.<key>` node and trigger types):
 *
 *   - publish (lib/services/workflows publishWorkflow, the designer's publish
 *     action): refused unless every extension the graph uses is installed,
 *     enabled in the workspace and entitled (feature included);
 *   - new runs (lib/workflow-engine executeWorkflow): refused while an
 *     extension's licence is expired (past the 24-hour cutoff) or missing.
 *     A disabled extension does not refuse the run here; its step fails as
 *     before.
 *
 * Denials throw the extension access errors (./state extensionAccessError):
 * 402 extension_licence_expired (retryable) / extension_not_licensed,
 * 403 extension_disabled. Server-only.
 */

import { ServiceError } from '@/lib/services/context'
import { extensionCatalogEntry } from './nodes'
import { parseExtKey } from './manifest'
import { extensionAccess, extensionAccessError, type ExtensionAccess } from './state'

/** A workflow graph's nodes (only type and label are read). */
export type GraphNodes = ReadonlyArray<{ type?: unknown; label?: unknown }> | null | undefined

export interface WorkflowExtensionRef {
  type: string
  label: string
  extensionId: string
  feature?: string
  installed: boolean
}

/** The distinct extension node / trigger types a graph uses (with their extension and licence feature). */
export function workflowExtensionRefs(nodes: GraphNodes): WorkflowExtensionRef[] {
  const out = new Map<string, WorkflowExtensionRef>()
  for (const node of nodes ?? []) {
    const type = typeof node?.type === 'string' ? node.type : ''
    if (!type.startsWith('ext.') || out.has(type)) continue
    const entry = extensionCatalogEntry(type)
    const parsed = parseExtKey(type)
    if (!parsed) continue
    out.set(type, {
      type,
      label: typeof node.label === 'string' && node.label ? node.label : entry?.label ?? type,
      extensionId: parsed.extensionId,
      feature: entry?.feature,
      installed: Boolean(entry),
    })
  }
  return [...out.values()]
}

export interface WorkflowExtensionDenial {
  ref: WorkflowExtensionRef
  access: ExtensionAccess | null
}

/** The first extension step of the graph the workspace may not use (null: all usable). */
export async function workflowExtensionDenial(tenantId: string, nodes: GraphNodes, options: { licenceOnly?: boolean } = {}): Promise<WorkflowExtensionDenial | null> {
  const refs = workflowExtensionRefs(nodes)
  const decisions = new Map<string, ExtensionAccess>()
  for (const ref of refs) {
    if (!ref.installed) {
      if (options.licenceOnly) continue
      return { ref, access: null }
    }
    const key = `${ref.extensionId}\u0000${ref.feature ?? ''}`
    let access = decisions.get(key)
    if (!access) {
      access = await extensionAccess(tenantId, ref.extensionId, ref.feature)
      decisions.set(key, access)
    }
    if (access.usable) continue
    if (options.licenceOnly && access.code !== 'extension_licence_expired' && access.code !== 'extension_not_licensed') continue
    return { ref, access }
  }
  return null
}

function denialError(denial: WorkflowExtensionDenial, what: string): ServiceError {
  const { ref, access } = denial
  if (!access) return ServiceError.validation(`${what}: step "${ref.label}" uses ${ref.type}, which is not installed in this build`)
  return extensionAccessError({ ...access, reason: `${what}: step "${ref.label}" (${ref.type}) — ${access.reason ?? 'not available'}` }, ref.extensionId, ref.feature)
}

/** Publish gate: every extension step installed, enabled and entitled. */
export async function assertWorkflowExtensionsPublishable(tenantId: string, nodes: GraphNodes): Promise<void> {
  const denial = await workflowExtensionDenial(tenantId, nodes)
  if (denial) throw denialError(denial, 'Cannot publish')
}

/** Run-start gate: no extension step with an expired or missing licence. */
export async function assertWorkflowExtensionsLicensed(tenantId: string, nodes: GraphNodes): Promise<void> {
  const denial = await workflowExtensionDenial(tenantId, nodes, { licenceOnly: true })
  if (denial) throw denialError(denial, 'Run refused')
}

/** The publish-block message for the designer (null: publishable). */
export async function workflowExtensionPublishBlock(tenantId: string, nodes: GraphNodes): Promise<string | null> {
  const denial = await workflowExtensionDenial(tenantId, nodes)
  return denial ? denialError(denial, 'Cannot publish').message : null
}
