/**
 * The host API (ExtensionContext) core hands to every extension hook.
 * Everything an extension does to core goes through here, so the same
 * extension code can later run out of process (remote tier) behind the same
 * interface.
 *
 * Server-only.
 */

import type { ExtensionContext, ExtensionLogger } from '@/lib/extensions/sdk'
import { getServiceDb } from '@/lib/providers/db'
import { connectorFetch } from '@/lib/integrations/http'
import { writeAudit } from '@/lib/audit-log'
import { decryptSecret } from '@/lib/secret-crypto'
import { extensionEventPrefix } from './manifest'
import { getEntitlementPort } from './entitlement-port'
import { loadTenantExtensions } from './state'
import { getExtensionManifest } from './registry'

/* eslint-disable @typescript-eslint/no-explicit-any -- extension tables are not in the generated Database types */

const EVENT_NAME_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/

function logger(extensionId: string, tenantId: string | null): ExtensionLogger {
  const tag = `[ext:${extensionId}${tenantId ? `:${tenantId.slice(0, 8)}` : ''}]`
  return {
    info: (message, metadata) => console.info(tag, message, metadata ?? ''),
    warn: (message, metadata) => console.warn(tag, message, metadata ?? ''),
    error: (message, metadata) => console.error(tag, message, metadata ?? ''),
  }
}

/** A secret / certificate settings value (workspace first, then instance), decrypted. */
export async function readExtensionSecret(extensionId: string, tenantId: string | null, key: string): Promise<string | null> {
  const db = getServiceDb() as any
  if (tenantId) {
    const { data } = await db.from('tenant_extensions').select('secrets').eq('tenant_id', tenantId).eq('extension_id', extensionId).maybeSingle()
    const value = (data?.secrets as Record<string, string> | undefined)?.[key]
    if (typeof value === 'string' && value) return decryptSecret(value)
  }
  const { data } = await db.from('instance_extensions').select('secrets').eq('extension_id', extensionId).maybeSingle()
  const value = (data?.secrets as Record<string, string> | undefined)?.[key]
  return typeof value === 'string' && value ? decryptSecret(value) : null
}

export interface HostOptions {
  extensionId: string
  tenantId: string | null
  actorId?: string | null
  /** The caller's client; defaults to the service-role client. */
  db?: unknown
}

export function createExtensionContext(options: HostOptions): ExtensionContext {
  const { extensionId, tenantId } = options
  const actorId = options.actorId ?? null
  const db = (options.db ?? getServiceDb()) as any
  const log = logger(extensionId, tenantId)
  return {
    extensionId,
    tenantId,
    actorId,
    db,
    config: {
      async get() {
        if (!tenantId) return {}
        const { rows } = await loadTenantExtensions(tenantId)
        return { ...(rows.get(extensionId)?.config ?? {}) }
      },
      secret: (key) => readExtensionSecret(extensionId, tenantId, key),
    },
    http: {
      fetch: (url, init, opts) => connectorFetch(url, init ?? {}, { timeoutMs: opts?.timeoutMs }),
    },
    events: {
      async emit(name, input) {
        if (!tenantId) throw new Error('events.emit needs a workspace')
        if (!EVENT_NAME_RE.test(name)) throw new Error(`Invalid event name "${name}" (lower-case dotted segments)`)
        const { error } = await (getServiceDb() as any).from('event_stream').insert({
          tenant_id: tenantId,
          type: `${extensionEventPrefix(extensionId)}${name}`,
          category: 'system',
          severity: input.severity ?? 'info',
          message: String(input.message ?? name).slice(0, 1000),
          source_table: 'extension',
          source_id: extensionId,
          actor_id: actorId,
          attributes: { extension: extensionId, ...(input.attributes ?? {}) },
        })
        if (error) throw new Error(`events.emit failed: ${error.message}`)
      },
    },
    workflows: {
      async trigger(key, payload, opts) {
        if (!tenantId) throw new Error('workflows.trigger needs a workspace')
        const { startExtensionTrigger } = await import('./triggers')
        return startExtensionTrigger({ tenantId, extensionId, key, payload, dedupeKey: opts?.dedupeKey })
      },
    },
    async audit(entry) {
      if (!tenantId) return
      await writeAudit({
        supabase: getServiceDb() as any,
        tenantId,
        actorId,
        objectType: 'extension',
        objectId: entry.objectId ?? extensionId,
        action: entry.action,
        summary: entry.summary,
        metadata: { extension: extensionId, ...(entry.metadata ?? {}) },
      })
    },
    async notify(input) {
      if (!tenantId) throw new Error('notify needs a workspace')
      const declared = getExtensionManifest(extensionId)?.contributes.ui.notificationTypes.some((t) => t.key === input.type)
      if (!declared) throw new Error(`Notification type "${input.type}" is not declared in the manifest`)
      if (input.href && !/^\/(?!\/)/.test(input.href)) throw new Error('href must be an app path starting with /')
      const db = getServiceDb() as any
      const { data: membership } = await db.from('user_memberships').select('user_id').eq('user_id', input.userId).eq('tenant_id', tenantId).maybeSingle()
      if (!membership) throw new Error('notify: the user is not a member of this workspace')
      const row = {
        user_id: input.userId, tenant_id: tenantId, type: `ext.${extensionId}.${input.type}`,
        title: String(input.title).slice(0, 300), body: input.body ? String(input.body).slice(0, 2000) : null, task_id: input.taskId ?? null,
      }
      let { error } = await db.from('notifications').insert({ ...row, href: input.href ?? null })
      // Before migration 20270112000000 there is no href column: send without the link.
      if (error && /href/.test(error.message ?? '')) ({ error } = await db.from('notifications').insert(row))
      if (error) throw new Error(`notify failed: ${error.message}`)
    },
    licence: {
      check: (feature) => getEntitlementPort().check({ tenantId, extensionId, feature }),
    },
    logger: log,
  }
}
