/**
 * Extension jobs and event subscriptions on the one-minute tick
 * (lib/jobs/registry.ts, lib/jobs/tick.ts).
 *
 *  - Each extension job becomes a JobDefinition named `ext.<id>.<name>`.
 *    Tenant-scoped jobs (the default) run once per workspace that has the
 *    extension enabled and licensed, until the tick's deadline; instance
 *    jobs run once.
 *  - `extension-events` (every minute, only when some extension subscribes)
 *    reads the event_stream outbox after each subscription's cursor
 *    (extension_event_cursors), hands matching events of workspaces where
 *    the extension is usable to the handler, and advances the cursor. A
 *    failing handler is logged and skipped (at-most-once per event). It also
 *    purges extension trigger dedupe keys older than 30 days, hourly.
 *
 * With no extensions in the build there are no extra jobs. Server-only.
 */

import type { JobContext, JobDefinition } from '@/lib/jobs/registry'
import { getServiceDb } from '@/lib/providers/db'
import { typeMatchesGlob } from '@/lib/services/events'
import { createExtensionContext } from './host'
import { getServerExtensions } from './server-registry'
import { extensionAccess, isMissingTable, tenantsWithExtension } from './state'
import { purgeTriggerDedupe } from './triggers'

/* eslint-disable @typescript-eslint/no-explicit-any -- event_stream rows */

const EVENT_BATCH = 200

export function extensionJobDefinitions(): JobDefinition[] {
  const out: JobDefinition[] = []
  for (const server of getServerExtensions()) {
    for (const job of server.jobs ?? []) {
      const scope = job.scope ?? 'tenant'
      out.push({
        name: `ext.${server.id}.${job.name}`,
        cadence: job.cadence,
        endpoint: '/api/cron/tick',
        budgetMs: Math.min(job.budgetMs ?? 20_000, 50_000),
        isEnabled: async () => scope === 'instance' || (await tenantsWithExtension(server.id)).length > 0,
        run: async (ctx: JobContext) => {
          if (scope === 'instance') {
            const access = await extensionAccess(null, server.id)
            if (!access.usable) return { skipped: access.reason }
            return job.run({ ctx: createExtensionContext({ extensionId: server.id, tenantId: null }), deadline: ctx.deadline })
          }
          const results: Record<string, unknown> = {}
          for (const tenantId of await tenantsWithExtension(server.id)) {
            if (Date.now() >= ctx.deadline) { results._stopped = 'deadline'; break }
            const access = await extensionAccess(tenantId, server.id)
            if (!access.usable) continue
            try {
              results[tenantId] = await job.run({ ctx: createExtensionContext({ extensionId: server.id, tenantId }), deadline: ctx.deadline })
            } catch (error) {
              results[tenantId] = { error: error instanceof Error ? error.message : String(error) }
            }
          }
          return results
        },
      })
    }
  }
  const subscribers = getServerExtensions().some((s) => (s.events ?? []).length > 0)
  if (out.length || subscribers || getServerExtensions().some((s) => s.triggers && Object.keys(s.triggers).length)) {
    out.push({
      name: 'extension-events',
      cadence: { every: 1 },
      endpoint: '/api/cron/tick',
      budgetMs: 20_000,
      isEnabled: async () => true,
      run: (ctx) => dispatchExtensionEvents({ deadline: ctx.deadline, minute: ctx.minute }),
    })
  }
  return out
}

async function readCursor(db: any, subscriber: string): Promise<number | null> {
  const { data, error } = await db.from('extension_event_cursors').select('last_event_id').eq('subscriber', subscriber).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  if (data) return Number(data.last_event_id)
  // A new subscription starts at the end of the outbox (no replay of history).
  const { data: latest } = await db.from('event_stream').select('id').order('id', { ascending: false }).limit(1)
  const start = Number(latest?.[0]?.id ?? 0)
  await db.from('extension_event_cursors').upsert({ subscriber, last_event_id: start, updated_at: new Date().toISOString() }, { onConflict: 'subscriber' })
  return start
}

/** One pass of the event dispatcher (exported for tests and manual runs). */
export async function dispatchExtensionEvents(options: { deadline: number; minute?: Date; db?: any }): Promise<Record<string, unknown>> {
  const db = options.db ?? getServiceDb()
  const summary: Record<string, unknown> = {}
  if ((options.minute ?? new Date()).getUTCMinutes() === 0) await purgeTriggerDedupe(30)
  for (const server of getServerExtensions()) {
    for (const [index, sub] of (server.events ?? []).entries()) {
      const subscriber = `${server.id}:${index}:${sub.pattern}`
      const cursor = await readCursor(db, subscriber)
      if (cursor === null) return { skipped: 'extension_event_cursors missing (migration 20270112000000)' }
      const tenants = new Set(await tenantsWithExtension(server.id))
      if (!tenants.size) continue
      const { data, error } = await db.from('event_stream')
        .select('id, tenant_id, type, category, message, occurred_at, attributes, task_id, run_id, workflow_id')
        .gt('id', cursor).in('tenant_id', [...tenants]).order('id', { ascending: true }).limit(EVENT_BATCH)
      if (error) throw new Error(error.message)
      let last = cursor
      let delivered = 0
      for (const row of (data ?? []) as any[]) {
        if (Date.now() >= options.deadline) break
        last = Number(row.id)
        if (!typeMatchesGlob(row.type, sub.pattern)) continue
        if (!(await extensionAccess(row.tenant_id, server.id)).usable) continue
        try {
          await sub.handler({
            ctx: createExtensionContext({ extensionId: server.id, tenantId: row.tenant_id }),
            event: { id: Number(row.id), type: row.type, category: row.category, message: row.message, occurred_at: row.occurred_at, attributes: row.attributes ?? {}, task_id: row.task_id ?? null, run_id: row.run_id ?? null, workflow_id: row.workflow_id ?? null },
          })
          delivered++
        } catch (error) {
          console.warn(`[ext:${server.id}] event handler ${sub.pattern} failed on event ${row.id}:`, error instanceof Error ? error.message : error)
        }
      }
      if (last !== cursor) await db.from('extension_event_cursors').update({ last_event_id: last, updated_at: new Date().toISOString() }).eq('subscriber', subscriber)
      summary[subscriber] = { delivered, cursor: last }
    }
  }
  return summary
}
