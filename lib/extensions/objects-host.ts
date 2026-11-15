/**
 * Managing the workflows and forms an extension made (ctx.workflows.list /
 * publish / setActive / delete / setTags, ctx.forms.delete / setTags /
 * editors): an extension page that shows "everything bound to this record"
 * (e.g. a SharePoint list) can manage those objects without core UI, as the
 * person — through the same services (permissions, audit, validation) as the
 * API.
 *
 * Scope: only workflows whose trigger is one of the calling extension's
 * triggers, only forms bound to one of its form targets. Tags: an extension
 * owns the tags that start with its `prefix` (e.g. "sharepoint:"), so it can
 * keep a badge / filter in the Automations and Forms lists in step with its
 * bindings without touching people's own tags. Server-only.
 */

import { ExtensionError, type ExtensionWorkflowRun, type ExtensionWorkflowSummary } from '@/lib/extensions/sdk'
import { layoutDataTarget } from '@/lib/forms/data-target'

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase rows */

interface ObjectsHost {
  extensionId: string
  tenantId: string | null
  actorId: string | null
  /** The caller's client (RLS for people) — used for service calls. */
  db: any
  /** Service-role client (reads, tag updates). */
  serviceDb: any
  permissions: ReadonlySet<string> | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG_MAX = 40

function tenantOf(host: ObjectsHost, what: string): string {
  if (!host.tenantId) throw new Error(`${what} needs a workspace`)
  return host.tenantId
}

async function serviceContext(host: ObjectsHost) {
  const { PERMISSION_KEYS } = await import('@/lib/permissions')
  return {
    db: host.db, supabase: host.db, tenantId: tenantOf(host, 'workflows'), actorId: host.actorId,
    permissions: host.permissions ?? new Set<string>(PERMISSION_KEYS), authKind: host.actorId ? 'session' as const : 'job' as const, source: 'ui' as const,
  }
}

async function asExtensionError<T>(run: () => Promise<T>): Promise<T> {
  const { isServiceError } = await import('@/lib/services/context')
  try {
    return await run()
  } catch (error) {
    if (isServiceError(error)) throw new ExtensionError(error.code, error.message, error.status)
    throw error
  }
}

function triggerTypes(extensionId: string, key?: string): Promise<string[]> {
  return import('./registry').then(({ getExtensionManifest }) => (getExtensionManifest(extensionId)?.contributes.triggers ?? [])
    .filter((t) => !key || t.key === key).map((t) => `ext.${extensionId}.${t.key}`))
}

/** The workflow, when its trigger belongs to this extension (else 404: never another extension's or a plain workflow). */
async function ownWorkflow(host: ObjectsHost, workflowId: string): Promise<{ id: string; name: string; trigger_type: string }> {
  const tenantId = tenantOf(host, 'workflows')
  if (!UUID_RE.test(String(workflowId))) throw new ExtensionError('not_found', 'Workflow not found', 404)
  const { data } = await host.serviceDb.from('workflows').select('id, name, trigger_type').eq('tenant_id', tenantId).eq('id', workflowId).maybeSingle()
  if (!data || !(await triggerTypes(host.extensionId)).includes(String(data.trigger_type))) throw new ExtensionError('not_found', 'Workflow not found', 404)
  return data
}

/** Last person who changed each object (object_audit_log), by object id. */
async function lastEditors(host: ObjectsHost, objectType: string, ids: string[]): Promise<Map<string, { name: string | null; at: string }>> {
  const out = new Map<string, { name: string | null; at: string }>()
  if (!ids.length) return out
  const { data } = await host.serviceDb.from('object_audit_log').select('object_id, actor_id, created_at').eq('tenant_id', host.tenantId).eq('object_type', objectType)
    .in('object_id', ids).not('actor_id', 'is', null).order('created_at', { ascending: false }).limit(ids.length * 20)
  const actors = new Map<string, string>()
  for (const r of (data ?? []) as Array<{ object_id: string; actor_id: string; created_at: string }>) {
    if (out.has(r.object_id)) continue
    out.set(r.object_id, { name: null, at: r.created_at })
    actors.set(r.object_id, r.actor_id)
  }
  const userIds = [...new Set(actors.values())]
  if (userIds.length) {
    const { data: users } = await host.serviceDb.from('users').select('id, display_name, email').in('id', userIds)
    const names = new Map(((users ?? []) as Array<{ id: string; display_name: string | null; email: string }>).map((u) => [u.id, u.display_name || u.email]))
    for (const [objectId, actor] of actors) out.get(objectId)!.name = names.get(actor) ?? null
  }
  return out
}

/** Replace the tags that start with `prefix`, keep every other tag. */
export function mergeManagedTags(current: unknown, tags: string[], prefix: string): string[] {
  const p = prefix.trim().toLowerCase()
  if (!p || p.length > 20) throw new ExtensionError('invalid_request', 'A tag prefix (1–20 characters, e.g. "sharepoint:") is required', 400)
  const wanted = tags.map((t) => String(t).trim().toLowerCase().slice(0, TAG_MAX)).filter((t) => t.startsWith(p))
  const kept = (Array.isArray(current) ? current.map(String) : []).filter((t) => !t.toLowerCase().startsWith(p))
  return [...new Set([...kept, ...wanted])]
}

export function hostWorkflowObjects(host: ObjectsHost) {
  return {
    async list(options: { trigger?: string } = {}): Promise<ExtensionWorkflowSummary[]> {
      const tenantId = tenantOf(host, 'workflows.list')
      if (host.permissions && !host.permissions.has('workflows.view')) return []
      const types = await triggerTypes(host.extensionId, options.trigger)
      if (!types.length) return []
      const { data, error } = await host.serviceDb.from('workflows')
        .select('id, name, trigger_type, nodes, is_active, published_version_id, has_unpublished_changes, run_count, last_run_at, tags, updated_at')
        .eq('tenant_id', tenantId).in('trigger_type', types).order('updated_at', { ascending: false }).limit(2000)
      if (error) throw new Error(`workflows.list failed: ${error.message}`)
      const rows = (data ?? []) as Array<Record<string, any>>
      const editors = await lastEditors(host, 'workflow', rows.map((r) => String(r.id)))
      return rows.map((r) => {
        const trigger = (Array.isArray(r.nodes) ? r.nodes : []).find((n: any) => n?.type === r.trigger_type)
        const published = Boolean(r.published_version_id)
        return {
          id: String(r.id), name: String(r.name), trigger: String(r.trigger_type).split('.').pop() ?? '',
          config: trigger?.config && typeof trigger.config === 'object' ? trigger.config : {},
          status: !published ? 'draft' : r.is_active ? 'active' : 'disabled',
          published, active: r.is_active === true, hasUnpublishedChanges: r.has_unpublished_changes !== false,
          runCount: Number(r.run_count ?? 0), lastRunAt: r.last_run_at ?? null, tags: Array.isArray(r.tags) ? r.tags : [],
          updatedAt: r.updated_at ?? null, updatedBy: editors.get(String(r.id))?.name ?? null, path: `/automations/${r.id}`,
        } satisfies ExtensionWorkflowSummary
      })
    },
    async publish(workflowId: string) {
      await ownWorkflow(host, workflowId)
      const ctx = await serviceContext(host)
      const { publishWorkflow, setWorkflowActive } = await import('@/lib/services/workflows')
      return asExtensionError(async () => {
        const published: any = await publishWorkflow(ctx as any, workflowId, 'Published from an extension page')
        await setWorkflowActive(ctx as any, workflowId, true)
        return { id: workflowId, version: Number(published?.version_number ?? published?.version?.version_number ?? 0) || null }
      })
    },
    async setActive(workflowId: string, active: boolean) {
      await ownWorkflow(host, workflowId)
      const ctx = await serviceContext(host)
      const { setWorkflowActive } = await import('@/lib/services/workflows')
      await asExtensionError(() => setWorkflowActive(ctx as any, workflowId, Boolean(active)))
    },
    async delete(workflowId: string) {
      await ownWorkflow(host, workflowId)
      const ctx = await serviceContext(host)
      const { deleteWorkflow } = await import('@/lib/services/workflows')
      await asExtensionError(() => deleteWorkflow(ctx as any, workflowId))
    },
    async runs(options: { trigger?: string; match: Record<string, string | number>; limit?: number }): Promise<ExtensionWorkflowRun[]> {
      const tenantId = tenantOf(host, 'workflows.runs')
      if (host.permissions && !host.permissions.has('workflows.view')) return []
      const types = await triggerTypes(host.extensionId, options?.trigger)
      const match = Object.entries(options?.match ?? {}).filter(([k]) => /^[a-z_][a-z0-9_]{0,62}$/i.test(k))
      if (!types.length || !match.length) return []
      let q = host.serviceDb.from('workflow_queue').select('id, workflow_id, status, trigger_data, result, created_at, started_at, completed_at, error')
        .eq('tenant_id', tenantId).in('trigger_type', types)
      for (const [k, v] of match) q = q.filter(`trigger_data->>${k}`, 'eq', String(v))
      const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(options?.limit) || 10, 1), 50))
      if (error) throw new Error(`workflows.runs failed: ${error.message}`)
      const jobs = (data ?? []) as Array<Record<string, any>>
      const runIds = jobs.map((j) => j.result?.run_id).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
      const wfIds = [...new Set(jobs.map((j) => String(j.workflow_id)))]
      const [{ data: runs }, { data: wfs }] = await Promise.all([
        runIds.length ? host.serviceDb.from('workflow_runs').select('id, status, started_at, completed_at').eq('tenant_id', tenantId).in('id', runIds) : Promise.resolve({ data: [] }),
        wfIds.length ? host.serviceDb.from('workflows').select('id, name').eq('tenant_id', tenantId).in('id', wfIds) : Promise.resolve({ data: [] }),
      ])
      const runById = new Map(((runs ?? []) as Array<Record<string, any>>).map((r) => [String(r.id), r]))
      const names = new Map(((wfs ?? []) as Array<Record<string, any>>).map((w) => [String(w.id), String(w.name)]))
      return jobs.map((j) => {
        const runId = typeof j.result?.run_id === 'string' ? j.result.run_id : null
        const run = runId ? runById.get(runId) : null
        return {
          workflowId: String(j.workflow_id), workflowName: names.get(String(j.workflow_id)) ?? null, runId,
          status: String(run?.status ?? j.status ?? 'queued'), event: typeof j.trigger_data?.event === 'string' ? j.trigger_data.event : null,
          queuedAt: j.created_at ?? null, startedAt: run?.started_at ?? j.started_at ?? null, completedAt: run?.completed_at ?? j.completed_at ?? null,
          path: runId ? `/automations/runs/${runId}` : null,
        } satisfies ExtensionWorkflowRun
      })
    },
    async setTags(workflowId: string, tags: string[], options: { prefix: string }) {
      await ownWorkflow(host, workflowId)
      const { data } = await host.serviceDb.from('workflows').select('tags').eq('tenant_id', host.tenantId).eq('id', workflowId).maybeSingle()
      const next = mergeManagedTags(data?.tags, tags, options?.prefix ?? '')
      if (JSON.stringify(next) === JSON.stringify(data?.tags ?? [])) return
      const { error } = await host.serviceDb.from('workflows').update({ tags: next }).eq('tenant_id', host.tenantId).eq('id', workflowId)
      if (error) throw new Error(`workflows.setTags failed: ${error.message}`)
    },
  }
}

/** The form, when it is bound to one of this extension's form targets. */
async function ownForm(host: ObjectsHost, formId: string): Promise<{ id: string; tags: string[] }> {
  const tenantId = tenantOf(host, 'forms')
  if (!UUID_RE.test(String(formId))) throw new ExtensionError('not_found', 'Form not found', 404)
  const { data } = await host.serviceDb.from('forms').select('id, layout, tags').eq('tenant_id', tenantId).eq('id', formId).maybeSingle()
  if (!data || layoutDataTarget(data.layout)?.extension !== host.extensionId) throw new ExtensionError('not_found', 'Form not found', 404)
  return { id: String(data.id), tags: Array.isArray(data.tags) ? data.tags : [] }
}

export function hostFormObjects(host: ObjectsHost) {
  return {
    async setTags(formId: string, tags: string[], options: { prefix: string }) {
      const form = await ownForm(host, formId)
      const next = mergeManagedTags(form.tags, tags, options?.prefix ?? '').slice(0, 20)
      if (JSON.stringify(next) === JSON.stringify(form.tags)) return
      const { error } = await host.serviceDb.from('forms').update({ tags: next }).eq('tenant_id', host.tenantId).eq('id', formId)
      if (error) throw new Error(`forms.setTags failed: ${error.message}`)
    },
    /** Last editor per form (display name), from the audit log. */
    async editors(ids: string[]): Promise<Map<string, string | null>> {
      const map = await lastEditors(host, 'form', ids)
      return new Map([...map].map(([k, v]) => [k, v.name]))
    },
  }
}
