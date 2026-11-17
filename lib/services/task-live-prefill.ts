/**
 * Opening a task whose fields follow the trigger's record (lib/forms/
 * live-prefill.ts): read the record now and refresh the fields nobody has
 * edited yet. Called by the task page's read (tasks.detail — the app and
 * /embed/task/<id>), after the person's access to the task was checked.
 *
 *  - the record: a data table row (core), or the extension trigger's
 *    `readRecord` (as the person opening the task);
 *  - people as `{ email }` become workspace members; values are coerced by
 *    the field's type; only the form's declared value fields are written
 *    (template_values — never a task column), so the task field allowlist
 *    and secret-field rules are untouched;
 *  - written with the service role, only if the task did not change since
 *    it was read (updated_at), so a concurrent draft save always wins;
 *  - run variables used inside the form (lib/forms/workflow-tokens.ts):
 *    re-resolved from `metadata.workflow_templates` against the run's
 *    current variables (workflow_runs.variables);
 *  - open tasks only; at most one look per task every 30 s; any failure
 *    leaves the task as it was.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata is free-form JSON */

import { coerceTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { pickRecordValues, planLiveRefresh, readLivePrefill, LIVE_PREFILL_KEY, type LivePrefill } from '@/lib/forms/live-prefill'
import { isPlainObject } from '@/lib/utils/guards'
import { resolveWorkflowTokens, WORKFLOW_TEMPLATES_KEY } from '@/lib/forms/workflow-tokens'
import type { ServiceContext } from './context'

const RECENT = new Map<string, number>()
const THROTTLE_MS = 30_000

/** Test hook. */
export function clearLivePrefillThrottle() {
  RECENT.clear()
}

async function readRecord(ctx: ServiceContext, sys: any, tenantId: string, live: LivePrefill): Promise<Record<string, unknown> | null> {
  if (live.source.kind === 'table') {
    const { data } = await sys.from('custom_table_rows').select('data').eq('tenant_id', tenantId).eq('table_id', live.source.table_id).eq('id', live.source.row_id).maybeSingle()
    return data && isPlainObject(data.data) ? data.data as Record<string, unknown> : null
  }
  const m = /^ext\.([a-z0-9-]+)\.([a-z0-9_]+)$/i.exec(live.source.trigger ?? '')
  if (!m) return null
  const { getServerExtension } = await import('@/lib/extensions/server-registry')
  const handler = getServerExtension(m[1])?.triggers?.[m[2]]
  if (!handler?.readRecord) return null
  const { createExtensionContext } = await import('@/lib/extensions/host')
  const xctx = createExtensionContext({ extensionId: m[1], tenantId, actorId: ctx.actorId ?? undefined, permissions: ctx.permissions === null ? undefined : [...ctx.permissions] } as any)
  const values = await handler.readRecord({ ctx: xctx, config: { ...(live.source.config ?? {}) }, ids: { ...(live.source.ids ?? {}) } })
  return isPlainObject(values) ? values as Record<string, unknown> : null
}

/**
 * The task with its record-prefilled fields refreshed (the same object when
 * nothing changed). Never throws.
 */
export async function refreshTaskLivePrefill<T extends Record<string, any>>(ctx: ServiceContext, task: T, deps: { sys?: any; now?: () => number } = {}): Promise<T> {
  try {
    const metadata = isPlainObject(task?.metadata) ? task.metadata as Record<string, any> : null
    const live = readLivePrefill(metadata?.[LIVE_PREFILL_KEY])
    const templates = isPlainObject(metadata?.[WORKFLOW_TEMPLATES_KEY]) ? metadata![WORKFLOW_TEMPLATES_KEY] as Record<string, unknown> : null
    if (!metadata || (!live && !(templates && task.workflow_run_id)) || task.status === 'completed' || task.status === 'cancelled') return task
    const now = (deps.now ?? Date.now)()
    const last = RECENT.get(String(task.id))
    if (last && now - last < THROTTLE_MS) return task
    RECENT.set(String(task.id), now)
    if (RECENT.size > 5000) RECENT.delete(RECENT.keys().next().value as string)

    const tenantId = String(task.tenant_id)
    const sys = deps.sys ?? (await import('@/lib/cron-auth')).createServiceClient()
    const patch: Record<string, unknown> = {}

    // Run variables used inside the form: from the templates the task was created with, against the run's current variables.
    if (templates && task.workflow_run_id) {
      const { data: run } = await sys.from('workflow_runs').select('variables').eq('tenant_id', tenantId).eq('id', task.workflow_run_id).maybeSingle()
      if (run && isPlainObject(run.variables)) {
        const resolved = resolveWorkflowTokens(templates, run.variables as Record<string, unknown>)
        for (const key of ['fields', 'form_layout', 'form_buttons'] as const) {
          if (!Object.prototype.hasOwnProperty.call(resolved, key) || resolved[key] === null || resolved[key] === undefined) continue
          if (JSON.stringify(resolved[key]) !== JSON.stringify(metadata[key])) patch[key] = resolved[key]
        }
      }
    }

    if (live) {
      const record = await readRecord(ctx, sys, tenantId, live)
      if (record) {
        const fields = normalizeTaskFields(patch.fields ?? metadata.fields).filter((f) => Object.prototype.hasOwnProperty.call(live.fields, f.key))
        let raw = pickRecordValues(live.fields, record)
        const people = fields.filter((f) => f.type === 'user' && raw[f.key] !== undefined)
        if (people.length) {
          const { mapPeopleValues } = await import('./form-targets')
          raw = (await mapPeopleValues(sys, tenantId, people, raw)).values
        }
        const present = fields.filter((f) => raw[f.key] !== undefined)
        const fresh = coerceTaskFieldValues(present, Object.fromEntries(present.map((f) => [f.key, raw[f.key]])))
        const stored = isPlainObject(metadata.template_values) ? metadata.template_values as Record<string, unknown> : {}
        const plan = planLiveRefresh(stored, live, fresh)
        if (plan.changed.length) { patch.template_values = { ...stored, ...plan.values }; patch[LIVE_PREFILL_KEY] = plan.live }
      }
    }

    if (!Object.keys(patch).length) return task
    const nextMetadata = { ...metadata, ...patch }
    let q = sys.from('tasks').update({ metadata: nextMetadata }).eq('id', task.id).eq('tenant_id', tenantId)
    if (task.updated_at) q = q.eq('updated_at', task.updated_at)
    const { data, error } = await q.select('updated_at')
    if (error || !Array.isArray(data) || !data.length) return task
    return { ...task, metadata: nextMetadata, ...(data[0]?.updated_at ? { updated_at: data[0].updated_at } : {}) }
  } catch (error) {
    console.error('[tasks.live-prefill] refresh failed:', (error as Error)?.message)
    return task
  }
}
