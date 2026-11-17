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

export interface ObjectsHost {
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

export async function serviceContext(host: ObjectsHost) {
  const { PERMISSION_KEYS } = await import('@/lib/permissions')
  return {
    db: host.db, supabase: host.db, tenantId: tenantOf(host, 'workflows'), actorId: host.actorId,
    permissions: host.permissions ?? new Set<string>(PERMISSION_KEYS), authKind: host.actorId ? 'session' as const : 'job' as const, source: 'ui' as const,
  }
}

export async function asExtensionError<T>(run: () => Promise<T>): Promise<T> {
  const { isServiceError } = await import('@/lib/services/context')
  try {
    return await run()
  } catch (error) {
    if (isServiceError(error)) throw new ExtensionError(error.code, error.message, error.status, error.details as Record<string, unknown> | undefined)
    throw error
  }
}

function triggerTypes(extensionId: string, key?: string): Promise<string[]> {
  return import('./registry').then(({ getExtensionManifest }) => (getExtensionManifest(extensionId)?.contributes.triggers ?? [])
    .filter((t) => !key || t.key === key).map((t) => `ext.${extensionId}.${t.key}`))
}

/** The workflow, when its trigger belongs to this extension (else 404: never another extension's or a plain workflow). */
export async function ownWorkflow(host: ObjectsHost, workflowId: string): Promise<{ id: string; name: string; trigger_type: string }> {
  const tenantId = tenantOf(host, 'workflows')
  if (!UUID_RE.test(String(workflowId))) throw new ExtensionError('not_found', 'Workflow not found', 404)
  const { data } = await host.serviceDb.from('workflows').select('id, name, trigger_type').eq('tenant_id', tenantId).eq('id', workflowId).maybeSingle()
  if (!data || !(await triggerTypes(host.extensionId)).includes(String(data.trigger_type))) throw new ExtensionError('not_found', 'Workflow not found', 404)
  return data
}

/**
 * ctx.workflows.grantDesign / ctx.forms.grantDesign: give the signed-in
 * person an Edit grant (object_permissions can_view + can_edit, other flags
 * kept) on ONE object of this extension, so the designers let them save /
 * restore / test it without workflows.edit / forms.edit
 * (lib/services/design-access.ts). For an extension that authorised the
 * person against an outside system (e.g. Manage Lists in SharePoint): it
 * calls this on ctx.elevate(reason), or as someone holding
 * team.change_roles. Written to the object's audit log as a grant.
 */
async function grantDesign(host: ObjectsHost, objectType: 'workflow' | 'form', objectId: string, name: string): Promise<{ granted: boolean }> {
  const tenantId = tenantOf(host, objectType === 'workflow' ? 'workflows' : 'forms')
  if (!host.actorId) throw new ExtensionError('forbidden', 'grantDesign needs a signed-in person', 403)
  if (host.permissions !== null && !host.permissions.has('team.change_roles')) {
    throw new ExtensionError('forbidden', 'grantDesign needs ctx.elevate(reason) or the team.change_roles permission', 403)
  }
  const db = host.serviceDb
  const { data: existing, error } = await db.from('object_permissions').select('id, can_view, can_edit, can_delete, can_execute')
    .eq('tenant_id', tenantId).eq('object_type', objectType).eq('object_id', objectId).eq('user_id', host.actorId).maybeSingle()
  if (error) throw new Error(`grantDesign failed: ${error.message}`)
  if (existing?.can_edit && existing?.can_view) return { granted: false }
  const write = existing
    ? db.from('object_permissions').update({ can_view: true, can_edit: true, granted_by: host.actorId, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('tenant_id', tenantId)
    : db.from('object_permissions').insert({ tenant_id: tenantId, object_type: objectType, object_id: objectId, user_id: host.actorId, can_view: true, can_edit: true, can_delete: false, can_execute: false, granted_by: host.actorId })
  const { error: writeError } = await write
  if (writeError) throw new Error(`grantDesign failed: ${writeError.message}`)
  const { writeAudit } = await import('@/lib/audit-log')
  await writeAudit({
    supabase: db, tenantId, actorId: host.actorId, objectType, objectId, action: 'grant',
    summary: `Gave themselves Edit on ${objectType} "${name}" through extension ${host.extensionId}${host.permissions === null ? ' (elevated)' : ''}`,
    metadata: { grantee_type: 'user', grantee_id: host.actorId, can_view: true, can_edit: true, extension: host.extensionId, elevated: host.permissions === null },
  })
  return { granted: true }
}

/**
 * ctx.workflows.revokeDesign / ctx.forms.revokeDesign: take back a design
 * grant made by grantDesign (the person's own grant: user_id = granted_by)
 * from `userId` (default: the signed-in person) — e.g. when the extension
 * finds they no longer manage the record outside UserTasks. Grants an admin
 * gave are never touched. Elevated or team.change_roles; audited as a revoke.
 */
async function revokeDesign(host: ObjectsHost, objectType: 'workflow' | 'form', objectId: string, name: string, userId?: string | null): Promise<{ revoked: boolean }> {
  const tenantId = tenantOf(host, objectType === 'workflow' ? 'workflows' : 'forms')
  const target = String(userId ?? host.actorId ?? '')
  if (!UUID_RE.test(target)) throw new ExtensionError('invalid_request', 'revokeDesign needs a person', 400)
  if (host.permissions !== null && !host.permissions.has('team.change_roles')) {
    throw new ExtensionError('forbidden', 'revokeDesign needs ctx.elevate(reason) or the team.change_roles permission', 403)
  }
  const db = host.serviceDb
  const { data: row, error } = await db.from('object_permissions').select('id, can_view, can_edit, can_delete, can_execute, granted_by')
    .eq('tenant_id', tenantId).eq('object_type', objectType).eq('object_id', objectId).eq('user_id', target).maybeSingle()
  if (error) throw new Error(`revokeDesign failed: ${error.message}`)
  if (!row || row.granted_by !== target || !row.can_edit) return { revoked: false }
  // Only the design part goes: a grant someone widened since (start, delete) keeps those.
  const write = row.can_execute || row.can_delete
    ? db.from('object_permissions').update({ can_edit: false, updated_at: new Date().toISOString() }).eq('id', row.id).eq('tenant_id', tenantId)
    : db.from('object_permissions').delete().eq('id', row.id).eq('tenant_id', tenantId)
  const { error: writeError } = await write
  if (writeError) throw new Error(`revokeDesign failed: ${writeError.message}`)
  const { writeAudit } = await import('@/lib/audit-log')
  await writeAudit({
    supabase: db, tenantId, actorId: host.actorId, objectType, objectId, action: 'revoke',
    summary: `Removed the Edit grant ${target === host.actorId ? 'they had given themselves' : 'a person had given themselves'} on ${objectType} "${name}" through extension ${host.extensionId}`,
    metadata: { grantee_type: 'user', grantee_id: target, extension: host.extensionId, elevated: host.permissions === null },
  })
  return { revoked: true }
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

/**
 * A workflow's trigger settings as the extension sees them: the trigger node's config (the
 * designer's), over the workflow-level `trigger_config` some older rows still carry, so a
 * workflow is never left out of its list because of where its settings were stored.
 */
export function summaryTriggerConfig(r: { trigger_type?: unknown; trigger_config?: unknown; nodes?: unknown }): Record<string, unknown> {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
  const nodes = Array.isArray(r.nodes) ? r.nodes : []
  const node = nodes.find((n: any) => n?.type === r.trigger_type) ?? nodes.find((n: any) => n?.type === 'trigger' || n?.data?.type === r.trigger_type)
  return { ...obj(r.trigger_config), ...obj((node as any)?.config) }
}

export function hostWorkflowObjects(host: ObjectsHost) {
  return {
    async list(options: { trigger?: string } = {}): Promise<ExtensionWorkflowSummary[]> {
      const tenantId = tenantOf(host, 'workflows.list')
      if (host.permissions && !host.permissions.has('workflows.view')) return []
      const types = await triggerTypes(host.extensionId, options.trigger)
      if (!types.length) return []
      // Every one of the extension's workflows: the data API returns at most 1 000 rows a request, so page.
      const PAGE = 1000
      const rows: Array<Record<string, any>> = []
      for (let from = 0; from < 20 * PAGE; from += PAGE) {
        const { data, error } = await host.serviceDb.from('workflows')
          .select('id, name, trigger_type, trigger_config, nodes, is_active, published_version_id, has_unpublished_changes, run_count, last_run_at, tags, updated_at')
          .eq('tenant_id', tenantId).in('trigger_type', types).order('updated_at', { ascending: false }).order('id').range(from, from + PAGE - 1)
        if (error) throw new Error(`workflows.list failed: ${error.message}`)
        rows.push(...((data ?? []) as Array<Record<string, any>>))
        if ((data ?? []).length < PAGE) break
      }
      const editors = await lastEditors(host, 'workflow', rows.map((r) => String(r.id)))
      return rows.map((r) => {
        const published = Boolean(r.published_version_id)
        return {
          id: String(r.id), name: String(r.name), trigger: String(r.trigger_type).split('.').pop() ?? '',
          config: summaryTriggerConfig(r),
          status: !published ? 'draft' : r.is_active ? 'active' : 'disabled',
          published, active: r.is_active === true, hasUnpublishedChanges: r.has_unpublished_changes !== false,
          runCount: Number(r.run_count ?? 0), lastRunAt: r.last_run_at ?? null, tags: Array.isArray(r.tags) ? r.tags : [],
          updatedAt: r.updated_at ?? null, updatedBy: editors.get(String(r.id))?.name ?? null, path: `/automations/${r.id}`,
        } satisfies ExtensionWorkflowSummary
      })
    },
    async publish(workflowId: string, options: { onConflict?: 'keep_both' | 'take_over'; notes?: string } = {}) {
      await ownWorkflow(host, workflowId)
      const ctx = await serviceContext(host)
      const { publishWorkflow, setWorkflowActive } = await import('@/lib/services/workflows')
      return asExtensionError(async () => {
        const published: any = await publishWorkflow(ctx as any, workflowId, options.notes ?? 'Published from an extension page', { onConflict: options.onConflict ?? null })
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
    async grantDesign(workflowId: string) {
      const wf = await ownWorkflow(host, workflowId)
      return grantDesign(host, 'workflow', wf.id, String(wf.name ?? wf.id))
    },
    async revokeDesign(workflowId: string, userId?: string | null) {
      const wf = await ownWorkflow(host, workflowId)
      return revokeDesign(host, 'workflow', wf.id, String(wf.name ?? wf.id), userId)
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
        .eq('tenant_id', tenantId).in('trigger_type', types).like('trigger_type', 'ext.%')
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
    /** The workflow's draft graph (one of this extension's): nodes, edges and variables, the trigger node marked. */
    async definition(workflowId: string) {
      if (host.permissions && !host.permissions.has('workflows.view')) throw new ExtensionError('forbidden', 'Forbidden: you lack workflows.view', 403)
      const wf = await ownWorkflow(host, workflowId)
      const { data } = await host.serviceDb.from('workflows').select('nodes, edges, user_variables, has_unpublished_changes, published_version_id, is_active').eq('tenant_id', host.tenantId).eq('id', wf.id).maybeSingle()
      const nodes = (Array.isArray(data?.nodes) ? data.nodes : []) as Array<Record<string, unknown>>
      const trigger = nodes.find((n) => n?.type === wf.trigger_type)
      return {
        id: wf.id, triggerNodeId: trigger ? String(trigger.id) : null, triggerConfig: (trigger?.config && typeof trigger.config === 'object' ? trigger.config : {}) as Record<string, unknown>,
        nodes, edges: (Array.isArray(data?.edges) ? data.edges : []) as Array<Record<string, unknown>>, variables: (Array.isArray(data?.user_variables) ? data.user_variables : []) as Array<Record<string, unknown>>,
        hasUnpublishedChanges: data?.has_unpublished_changes !== false, published: Boolean(data?.published_version_id), active: data?.is_active === true,
      }
    },
    /**
     * Replace the trigger node's settings in the draft (as the person, through the workflow update
     * service: workflows.edit or a design grant; audited). Publish to make it a new version.
     */
    async setTriggerConfig(workflowId: string, config: Record<string, unknown>) {
      const wf = await ownWorkflow(host, workflowId)
      const { data } = await host.serviceDb.from('workflows').select('nodes').eq('tenant_id', host.tenantId).eq('id', wf.id).maybeSingle()
      const nodes = (Array.isArray(data?.nodes) ? data.nodes : []) as Array<Record<string, any>>
      if (!nodes.some((n) => n?.type === wf.trigger_type)) throw new ExtensionError('conflict', 'The workflow has no trigger step', 409)
      const next = nodes.map((n) => (n?.type === wf.trigger_type ? { ...n, config: { ...(config ?? {}) } } : n))
      const ctx = await serviceContext(host)
      const { updateWorkflow } = await import('@/lib/services/workflows')
      const saved: any = await asExtensionError(() => updateWorkflow(ctx as any, wf.id, { nodes: next } as any))
      return { changed: Boolean(saved?.changed ?? true) }
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
export async function ownForm(host: ObjectsHost, formId: string): Promise<{ id: string; tags: string[] }> {
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
    async grantDesign(formId: string) {
      const form = await ownForm(host, formId)
      return grantDesign(host, 'form', form.id, form.id)
    },
    async revokeDesign(formId: string, userId?: string | null) {
      const form = await ownForm(host, formId)
      return revokeDesign(host, 'form', form.id, form.id, userId)
    },
    /** Last editor per form (display name), from the audit log. */
    async editors(ids: string[]): Promise<Map<string, string | null>> {
      const map = await lastEditors(host, 'form', ids)
      return new Map([...map].map(([k, v]) => [k, v.name]))
    },
  }
}
