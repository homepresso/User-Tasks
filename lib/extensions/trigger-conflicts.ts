/**
 * Trigger conflicts (TriggerHandler.conflicts / resolveConflicts): when a workflow's extension
 * trigger overlaps with other workflows (e.g. two workflows starting on the same event of the same
 * SharePoint list), the person decides — keep both, or take the event over from the other
 * workflow. The designer asks when the trigger settings change and stores the answer in the
 * draft (config[TRIGGER_CONFLICT_CHOICES]); every publish path (designer, REST `on_conflict`,
 * MCP, services) checks again, so there are no silent duplicates. Server-only.
 */

import { TRIGGER_CONFLICT_CHOICES, type TriggerConflict, type TriggerConflictChoice } from '@/lib/extensions/sdk'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow nodes */

export interface ConflictCaller { tenantId: string; actorId: string | null; permissions: ReadonlySet<string> | Iterable<string> | null }

export class TriggerConflictError extends Error {
  readonly conflicts: TriggerConflict[]
  constructor(conflicts: TriggerConflict[]) {
    super(`This workflow overlaps with other workflows: ${conflicts.map((c) => c.message).join(' ')} Choose "keep both" or "take over" (on_conflict) to publish.`)
    this.name = 'TriggerConflictError'
    this.conflicts = conflicts
  }
}

export function isChoice(v: unknown): v is TriggerConflictChoice {
  return v === 'keep_both' || v === 'take_over'
}

async function handlerFor(nodes: unknown) {
  const { getExtensionManifest } = await import('./registry')
  const { getServerExtension } = await import('./server-registry')
  for (const node of (Array.isArray(nodes) ? nodes : []) as any[]) {
    const m = /^ext\.([a-z0-9-]+)\.([a-z0-9_]+)$/i.exec(String(node?.type ?? ''))
    if (!m) continue
    const [, extensionId, key] = m
    if (!getExtensionManifest(extensionId)?.contributes.triggers.some((t) => t.key === key)) continue
    const handler = getServerExtension(extensionId)?.triggers?.[key]
    if (!handler?.conflicts) return null
    return { extensionId, handler, config: (node.config && typeof node.config === 'object' ? node.config : {}) as Record<string, unknown> }
  }
  return null
}

async function contextFor(caller: ConflictCaller, extensionId: string) {
  const { createExtensionContext } = await import('./host')
  return createExtensionContext({ extensionId, tenantId: caller.tenantId, actorId: caller.actorId ?? undefined, permissions: caller.permissions === null ? undefined : [...caller.permissions] } as any)
}

/** Conflicts of a trigger configuration, with the answers already stored in it. */
export async function triggerConflicts(caller: ConflictCaller, workflowId: string | null, nodes: unknown): Promise<{ conflicts: TriggerConflict[]; unanswered: TriggerConflict[]; choices: Record<string, TriggerConflictChoice> }> {
  const found = await handlerFor(nodes)
  if (!found) return { conflicts: [], unanswered: [], choices: {} }
  const ctx = await contextFor(caller, found.extensionId)
  const conflicts = await found.handler.conflicts!({ ctx, workflowId, config: found.config })
  const stored = (found.config[TRIGGER_CONFLICT_CHOICES] ?? {}) as Record<string, unknown>
  const choices = Object.fromEntries(conflicts.filter((c) => isChoice(stored[c.key])).map((c) => [c.key, stored[c.key] as TriggerConflictChoice]))
  return { conflicts, unanswered: conflicts.filter((c) => !choices[c.key]), choices }
}

/**
 * Before a publish: unanswered conflicts stop it (TriggerConflictError) unless `onConflict`
 * answers them all; then the extension applies every answer (take-overs change the other
 * workflows as new versions of those). Returns the extension's notes.
 */
export async function resolveConflictsForPublish(caller: ConflictCaller, workflowId: string, nodes: unknown, onConflict?: TriggerConflictChoice | null): Promise<string[]> {
  const found = await handlerFor(nodes)
  if (!found) return []
  const { conflicts, unanswered, choices } = await triggerConflicts(caller, workflowId, nodes)
  if (!conflicts.length) return []
  if (unanswered.length && !isChoice(onConflict)) throw new TriggerConflictError(unanswered)
  const all = { ...choices, ...Object.fromEntries(unanswered.map((c) => [c.key, onConflict as TriggerConflictChoice])) }
  if (!found.handler.resolveConflicts) return []
  const ctx = await contextFor(caller, found.extensionId)
  return (await found.handler.resolveConflicts({ ctx, workflowId, config: found.config, choices: all }))?.notes ?? []
}
