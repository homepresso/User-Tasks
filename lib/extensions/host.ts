/**
 * The host API (ExtensionContext) core hands to every extension hook.
 * Everything an extension does to core goes through here, so the same
 * extension code can later run out of process (remote tier) behind the same
 * interface.
 *
 * Server-only.
 */

import { ExtensionError, type EntitlementDecision, type ExtensionContext, type WorkflowCreateInput, type ExtensionLogger, type LimitOptions, type LimitVerdict } from '@/lib/extensions/sdk'
import { getServiceDb } from '@/lib/providers/db'
import { connectorFetch } from '@/lib/integrations/http'
import { writeAudit } from '@/lib/audit-log'
import { decryptSecret } from '@/lib/secret-crypto'
import { extensionEventPrefix } from './manifest'
import { getEntitlementPort } from './entitlement-port'
import { loadTenantExtensions } from './state'
import { getExtensionManifest } from './registry'
import { fetchWithExtensionConnection, getExtensionConnection, listExtensionConnections } from './connections'
import { assertEntitled, LicenceLimitError } from '@/lib/licensing/errors'
import { checkUsageLimit } from '@/lib/licensing/limits'
import { holdsPermission } from '@/lib/permissions'
import { hostForms } from './forms'
import { hostFormObjects, hostWorkflowObjects } from './objects-host'
import { waitRequest } from './event-waits'
import { hostInsightsForms, hostInsightsWorkflows } from './insights-host'
import { hostGrants } from './grants-host'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { escapeLikePattern } from '@/lib/utils'

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
  /** The caller's permissions (null / omitted = a system caller holding everything). */
  permissions?: ReadonlySet<string> | readonly string[] | null
}

/** Instance setting key of an extension's instance setting (`ext.<id>.<key>`). */
export function instanceSettingKey(extensionId: string, key: string): string {
  if (!/^[a-z][a-z0-9_.-]{0,80}$/.test(key)) throw new ExtensionError('invalid_key', `Invalid instance setting key "${key}"`, 400)
  return `ext.${extensionId}.${key}`
}

export function createExtensionContext(options: HostOptions): ExtensionContext {
  const { extensionId, tenantId } = options
  const actorId = options.actorId ?? null
  // Instance contexts (no workspace, no person: instance jobs, provider hooks,
  // the processor) are trusted; a person must be an instance administrator.
  let adminCheck: Promise<boolean> | null = null
  const isInstanceAdmin = () => {
    if (!tenantId && !actorId) return Promise.resolve(true)
    adminCheck ??= (async () => {
      if (!actorId) return false
      const { isInstanceAdminSession } = await import('./ui-server')
      return isInstanceAdminSession()
    })()
    return adminCheck
  }
  const db = (options.db ?? getServiceDb()) as any
  const log = logger(extensionId, tenantId)
  const held = options.permissions == null ? null : options.permissions instanceof Set ? options.permissions as ReadonlySet<string> : new Set(options.permissions as readonly string[])
  const objectsHost = { extensionId, tenantId, actorId, db, serviceDb: getServiceDb(), permissions: held }
  return {
    extensionId,
    tenantId,
    actorId,
    appUrl: (configuredAppUrl() ?? '').trim().replace(/\/+$/, '') || null,
    async workspaceUrl() {
      const { workspaceUrlFor } = await import('@/lib/embedding-server')
      return workspaceUrlFor(tenantId)
    },
    embedding: {
      async url(path) {
        const { embedUrlFor } = await import('@/lib/embedding-server')
        return embedUrlFor(tenantId, path)
      },
      async origins() {
        if (!tenantId) return { supported: false, origins: [], instanceOrigins: [], reason: 'needs a workspace' }
        const { loadWorkspaceEmbedding } = await import('@/lib/embedding-server')
        const e = await loadWorkspaceEmbedding(tenantId)
        return { supported: e.supported, origins: e.origins, instanceOrigins: e.instance_origins, reason: e.reason }
      },
    },
    gateways: {
      async list() {
        if (!tenantId) throw new Error('gateways.list needs a workspace')
        const { listExtensionGateways } = await import('@/lib/gateway/extension')
        return listExtensionGateways(tenantId)
      },
      async get(id) {
        if (!tenantId) throw new Error('gateways.get needs a workspace')
        const { getExtensionGateway } = await import('@/lib/gateway/extension')
        return getExtensionGateway(tenantId, id)
      },
      async relayUrl(gatewayId, path) {
        if (!tenantId) throw new Error('gateways.relayUrl needs a workspace')
        const { extensionRelayUrl } = await import('@/lib/gateway/extension')
        return extensionRelayUrl(tenantId, extensionId, gatewayId, path)
      },
    },
    async launchUrl(path) {
      if (!tenantId || !path.startsWith('/') || path.startsWith('//')) return path
      const { data } = await (getServiceDb() as any).from('tenants').select('slug').eq('id', tenantId).maybeSingle()
      if (typeof data?.slug !== 'string' || !data.slug) return path
      const { LAUNCH_ORG_PARAM } = await import('@/lib/providers/auth/sso/auto')
      const url = new URL(path, 'http://local.invalid')
      url.searchParams.set(LAUNCH_ORG_PARAM, data.slug)
      return `${url.pathname}${url.search}${url.hash}`
    },
    db,
    instance: {
      isAdmin: isInstanceAdmin,
      async db() {
        if (!(await isInstanceAdmin())) throw new ExtensionError('forbidden', 'Only instance administrators can do this', 403)
        return getServiceDb()
      },
      settings: {
        async get(key) {
          const { getInstanceSetting } = await import('@/lib/config/instance-settings')
          return getInstanceSetting(instanceSettingKey(extensionId, key))
        },
        async set(key, value) {
          if (!(await isInstanceAdmin())) throw new ExtensionError('forbidden', 'Only instance administrators can change this', 403)
          const { setInstanceSetting } = await import('@/lib/config/instance-settings')
          await setInstanceSetting(instanceSettingKey(extensionId, key), value, { updatedBy: actorId })
        },
      },
    },
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
        let data = payload
        if (opts?.inputs !== undefined || (opts?.workflowId && opts?.byPerson)) {
          // A hand start: the workflow's declared inputs, checked server-side, as start variables.
          if (!opts?.workflowId) throw new ExtensionError('invalid_request', 'inputs need a workflowId (one workflow started by hand)', 400)
          const { ownWorkflow } = await import('./objects-host')
          const { checkStartInputs, workflowInputFields } = await import('./inputs-host')
          await ownWorkflow(objectsHost, opts.workflowId)
          const values = checkStartInputs(await workflowInputFields(objectsHost, opts.workflowId), opts.inputs ?? {})
          data = { ...payload, ...values }
        }
        return startExtensionTrigger({ tenantId, extensionId, key, payload: data, dedupeKey: opts?.dedupeKey, workflowId: opts?.workflowId, startedBy: opts?.workflowId && opts?.byPerson ? actorId : null })
      },
      async inputs(workflowId) {
        if (!tenantId) throw new Error('workflows.inputs needs a workspace')
        const { ownWorkflow } = await import('./objects-host')
        const { canReadInputs, presentInput, workflowInputFields } = await import('./inputs-host')
        if (!canReadInputs(objectsHost)) return []
        await ownWorkflow(objectsHost, workflowId)
        return (await workflowInputFields(objectsHost, workflowId)).map(presentInput)
      },
      async create(input) {
        if (!tenantId) throw new Error('workflows.create needs a workspace')
        if (!actorId) throw new Error('workflows.create needs a person (a signed-in member)')
        return createTriggeredWorkflow({ extensionId, tenantId, actorId, db, permissions: held }, input)
      },
      async triggerConfigs(key) {
        if (!tenantId) throw new Error('workflows.triggerConfigs needs a workspace')
        const { listExtensionTriggerConfigs } = await import('./triggers')
        return listExtensionTriggerConfigs({ tenantId, extensionId, key })
      },
      ...hostWorkflowObjects(objectsHost),
      ...hostInsightsWorkflows(objectsHost),
    },
    users: {
      findByEmail: (emails) => findMembersByEmail(tenantId, emails),
      async current() {
        if (!tenantId || !actorId) return null
        const { data } = await (getServiceDb() as any).from('users').select('id, email, display_name, deleted_at').eq('id', actorId).maybeSingle()
        return data && !data.deleted_at ? { id: String(data.id), email: String(data.email), name: String(data.display_name ?? data.email) } : null
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
    can: (permission) => held === null || holdsPermission(held, permission),
    licence: {
      check: (feature) => getEntitlementPort().check({ tenantId, extensionId, feature }),
      async assert(feature) {
        assertEntitled(extensionId, await getEntitlementPort().check({ tenantId, extensionId, feature }), feature)
      },
      limit: (key, opts) => extensionLimit(extensionId, tenantId, key, opts),
      async assertLimit(key, opts) {
        const decision = await getEntitlementPort().check({ tenantId, extensionId })
        assertEntitled(extensionId, decision)
        const verdict = await extensionLimit(extensionId, tenantId, key, opts, decision)
        if (!verdict.allowed) throw new LicenceLimitError(verdict)
        return verdict
      },
      async pausedRuns() {
        if (!tenantId) return 0
        const { countLicencePausedRuns } = await import('@/lib/licensing/paused-runs')
        return countLicencePausedRuns(getServiceDb() as any, tenantId)
      },
      async resumePausedRuns(opts) {
        if (!tenantId) return { resumed: 0, failed: 0, remaining: 0 }
        assertEntitled(extensionId, await getEntitlementPort().check({ tenantId, extensionId }))
        const { resumeLicencePausedRuns } = await import('@/lib/licensing/paused-runs')
        return resumeLicencePausedRuns(getServiceDb() as any, { tenantId, extensionId, limit: opts?.limit, deadline: opts?.deadline })
      },
    },
    connections: {
      list: (opts) => listExtensionConnections(extensionId, tenantId, opts),
      get: (id) => getExtensionConnection(extensionId, tenantId, id),
      fetch: (id, url, init, opts) => fetchWithExtensionConnection(extensionId, tenantId, id, url, init, opts),
    },
    forms: { ...hostForms({ extensionId, tenantId, actorId, db: getServiceDb(), permissions: held }), ...hostFormObjects(objectsHost), ...hostInsightsForms(objectsHost) },
    directory: {
      async requestSync(key, opts) {
        if (!tenantId) throw new Error('directory.requestSync needs a workspace')
        const sources = await import('@/lib/directory-sync/sources')
        return sources.requestDirectorySourceSync(getServiceDb() as any, tenantId, ownSource(extensionId, key), { full: opts?.full, ifDue: opts?.ifDue, intervalMinutes: opts?.intervalMinutes, actorId })
      },
      async status(key) {
        if (!tenantId) throw new Error('directory.status needs a workspace')
        const sources = await import('@/lib/directory-sync/sources')
        return sources.directorySourceStatus(getServiceDb() as any, tenantId, ownSource(extensionId, key))
      },
      async lookupUsers(input, opts) {
        if (!tenantId) throw new Error('directory.lookupUsers needs a workspace')
        const sources = await import('@/lib/directory-sync/sources')
        return sources.lookupDirectoryUsers(getServiceDb() as any, tenantId, ownSources(extensionId, opts?.source), input ?? {})
      },
      async lookupGroups(input, opts) {
        if (!tenantId) throw new Error('directory.lookupGroups needs a workspace')
        const sources = await import('@/lib/directory-sync/sources')
        return sources.lookupDirectoryGroups(getServiceDb() as any, tenantId, ownSources(extensionId, opts?.source), input ?? {})
      },
    },
    importers: {
      async infopath(input) {
        if (!tenantId) throw new Error('importers.infopath needs a workspace')
        const { runInfoPathForExtension } = await import('@/lib/importers/host')
        return runInfoPathForExtension({ extensionId, tenantId, actorId, db, permissions: held }, input)
      },
    },
    runs: {
      waitFor(input) {
        return waitRequest(input)
      },
      async resume(input) {
        if (!tenantId) throw new Error('runs.resume needs a workspace')
        const { resumeWaits } = await import('./event-waits')
        return resumeWaits(getServiceDb(), { tenantId, extensionId }, input)
      },
    },
    archives: {
      async unpack(bytes, opts) {
        const { unpackArchive } = await import('@/lib/importers/archive')
        return unpackArchive(bytes, opts)
      },
    },
    logger: log,
    grants: hostGrants(objectsHost),
    elevate(reason) {
      if (!tenantId || !actorId) throw new Error('elevate needs a workspace and a person')
      const why = String(reason ?? '').trim().slice(0, 300)
      if (!why) throw new Error('elevate needs a reason (it is written to the audit log)')
      const elevated = createExtensionContext({ extensionId, tenantId, actorId, db: getServiceDb(), permissions: null })
      // Every elevated write is the person's (actorId), and the audit summary carries the reason.
      return { ...elevated, async audit(entry) { await elevated.audit({ ...entry, summary: `${entry.summary} (${why})`, metadata: { ...(entry.metadata ?? {}), elevated: why } }) } }
    },
    async forWorkspace(target) {
      if (tenantId) throw new Error('forWorkspace is for instance-level contexts (public routes without auth, instance jobs)')
      if (!UUID_RE.test(String(target ?? ''))) throw new ExtensionError('invalid_request', 'Invalid workspace id', 400)
      const { extensionAccess } = await import('./state')
      const access = await extensionAccess(target, extensionId)
      if (!access.usable) throw new ExtensionError(access.code ?? 'extension_disabled', access.reason ?? 'Extension not available in this workspace', access.status === 200 ? 403 : access.status)
      return createExtensionContext({ extensionId, tenantId: target, actorId: null })
    },
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ctx.workflows.create: a draft (inactive) workflow whose trigger node is
 * one of the extension's triggers, through the workflows service (same
 * permission checks, audit and validation as the API), as the person.
 */
async function createTriggeredWorkflow(
  host: { extensionId: string; tenantId: string; actorId: string; db: any; permissions: ReadonlySet<string> | null },
  input: WorkflowCreateInput,
): Promise<{ workflowId: string; path: string; warnings?: unknown[] }> {
  const trigger = getExtensionManifest(host.extensionId)?.contributes.triggers.find((t) => t.key === input?.trigger?.key)
  if (!trigger) throw new ExtensionError('invalid_request', `Unknown trigger "${String(input?.trigger?.key ?? '')}"`, 400)
  const type = `ext.${host.extensionId}.${trigger.key}`
  const config = input.trigger.config && typeof input.trigger.config === 'object' ? input.trigger.config : {}
  const graph = workflowGraph(host.extensionId, input)
  const [{ createWorkflow }, { isServiceError }, { PERMISSION_KEYS }] = await Promise.all([
    import('@/lib/services/workflows'), import('@/lib/services/context'), import('@/lib/permissions'),
  ])
  const ctx = {
    db: host.db, supabase: host.db, tenantId: host.tenantId, actorId: host.actorId,
    permissions: host.permissions ?? new Set<string>(PERMISSION_KEYS), authKind: 'session' as const, source: 'ui' as const,
  }
  try {
    const created = await createWorkflow(ctx as any, {
      name: String(input.name ?? '').slice(0, 200),
      description: input.description ?? null,
      trigger_type: type,
      trigger_config: {},
      nodes: [{ id: 'trigger', type, label: String(input.trigger.label ?? trigger.label).slice(0, 120), position: { x: 0, y: 0 }, config }, ...graph.nodes],
      edges: graph.edges,
      ...(graph.variables.length ? { user_variables: graph.variables } : {}),
      ...(graph.tags.length ? { tags: graph.tags } : {}),
    })
    return { workflowId: created.workflow_id, path: `/automations/${created.workflow_id}`, ...(created.warnings?.length ? { warnings: created.warnings } : {}) }
  } catch (error) {
    if (isServiceError(error)) throw new ExtensionError(error.code, error.message, error.status)
    throw error
  }
}

const NODE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/

/**
 * The steps an extension sends with ctx.workflows.create, checked for shape:
 * ids unique (`trigger` reserved), node types core or this extension's own,
 * edges between known nodes. The workflows service validates the graph.
 */
export function workflowGraph(extensionId: string, input: Pick<WorkflowCreateInput, 'nodes' | 'edges' | 'variables' | 'tags'>) {
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const edges = Array.isArray(input.edges) ? input.edges : []
  if (nodes.length > 500 || edges.length > 1000) throw new ExtensionError('invalid_request', 'A workflow may have at most 500 steps and 1,000 connections', 400)
  const ids = new Set<string>(['trigger'])
  const outNodes = nodes.map((n, i) => {
    const id = String(n?.id ?? '')
    if (!NODE_ID_RE.test(id)) throw new ExtensionError('invalid_request', `Step ${i + 1}: id must be 1–80 letters, digits, - or _`, 400)
    if (ids.has(id)) throw new ExtensionError('invalid_request', `Step id "${id}" is used twice (or is the reserved "trigger")`, 400)
    ids.add(id)
    const type = String(n?.type ?? '')
    if (!/^[a-z][a-z0-9_]{0,60}$/.test(type) && !type.startsWith(`ext.${extensionId}.`)) throw new ExtensionError('invalid_request', `Step "${id}": type "${type}" is neither a core step nor one of this extension's`, 400)
    const position = n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y) ? { x: n.position.x, y: n.position.y } : { x: 0, y: (i + 1) * 140 }
    return {
      id, type, label: String(n.label ?? type).slice(0, 120), position,
      config: n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? n.config : {},
      ...(n.parentId ? { parentId: String(n.parentId) } : {}),
    }
  })
  for (const n of outNodes) if (n.parentId && !ids.has(n.parentId)) throw new ExtensionError('invalid_request', `Step "${n.id}": parent "${n.parentId}" is not a step`, 400)
  const outEdges = edges.map((e, i) => {
    const source = String(e?.source ?? ''), target = String(e?.target ?? '')
    if (!ids.has(source) || !ids.has(target)) throw new ExtensionError('invalid_request', `Connection ${i + 1}: ${source} → ${target} names a step that does not exist`, 400)
    return { id: e.id && NODE_ID_RE.test(String(e.id)) ? String(e.id) : `e${i + 1}-${source}-${target}`.slice(0, 120), source, target, ...(e.label ? { label: String(e.label).slice(0, 120) } : {}) }
  })
  // user_variables rows: { id, name, type, defaultValue (text), description }.
  const variables = (Array.isArray(input.variables) ? input.variables : []).slice(0, 200).filter((v) => v && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(String(v.name))).map((v, i) => ({
    id: `v${i + 1}`, name: String(v.name), type: ['string', 'number', 'boolean', 'object', 'array'].includes(String(v.type)) ? String(v.type) : 'string',
    ...(v.type === 'date' ? { format: 'datetime' } : {}),
    defaultValue: v.default_value === undefined || v.default_value === null ? '' : typeof v.default_value === 'string' ? v.default_value : JSON.stringify(v.default_value),
    description: String(v.description ?? '').slice(0, 300),
  }))
  const tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 10)
  return { nodes: outNodes, edges: outEdges, variables, tags }
}

/** `ext.<id>.<key>` of one of this extension's declared directory sources. */
function ownSource(extensionId: string, key: string): string {
  const declared = getExtensionManifest(extensionId)?.contributes.directorySources.some((s) => s.key === key)
  if (!declared) throw new Error(`Directory source "${key}" is not declared in the manifest (contributes.directorySources)`)
  return `ext.${extensionId}.${key}`
}

function ownSources(extensionId: string, key?: string): string[] {
  if (key) return [ownSource(extensionId, key)]
  return (getExtensionManifest(extensionId)?.contributes.directorySources ?? []).map((s) => `ext.${extensionId}.${s.key}`)
}

/**
 * Active members of the workspace with one of these e-mail addresses
 * (case-insensitive) — id, e-mail and display name only. Lets an extension
 * map an external identity (a SharePoint or CRM user) to a UserTasks user.
 */
async function findMembersByEmail(tenantId: string | null, emails: string[]): Promise<Array<{ id: string; email: string; name: string }>> {
  if (!tenantId) throw new Error('users.findByEmail needs a workspace')
  const wanted = [...new Set((emails ?? []).map((e) => String(e ?? '').trim().toLowerCase()).filter((e) => e.includes('@') && e.length <= 320))].slice(0, 100)
  if (!wanted.length) return []
  const db = getServiceDb() as any
  const { data: users, error } = await db.from('users').select('id, email, display_name, deleted_at').in('email', wanted)
  if (error) throw new Error(`users.findByEmail failed: ${error.message}`)
  // E-mails are stored as entered: also match case-insensitively among exact misses.
  let rows = ((users ?? []) as any[]).filter((u) => !u.deleted_at)
  const found = new Set(rows.map((u) => String(u.email).toLowerCase()))
  const missing = wanted.filter((e) => !found.has(e))
  for (const email of missing.slice(0, 20)) {
    const { data } = await db.from('users').select('id, email, display_name, deleted_at').ilike('email', escapeLikePattern(email)).limit(2)
    rows = rows.concat(((data ?? []) as any[]).filter((u) => !u.deleted_at && String(u.email).toLowerCase() === email))
  }
  if (!rows.length) return []
  const { data: members } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', tenantId).in('user_id', rows.map((u) => u.id))
  const active = new Set(((members ?? []) as any[]).filter((m) => m.is_active !== false).map((m) => m.user_id))
  const seen = new Set<string>()
  return rows.filter((u) => active.has(u.id) && !seen.has(u.id) && seen.add(u.id)).map((u) => ({ id: u.id, email: u.email, name: u.display_name ?? u.email }))
}

/**
 * Usage vs. a licence limit of this extension. Limit keys are namespaced
 * `<id>.<name>`; usage comes from options.usage or the extension's
 * registered counter (ServerExtension.usageCounters). Scope follows where
 * limits come from: self-hosted licences are per instance, so the counter
 * runs with no workspace (instance-wide); in the cloud edition limits come
 * from each workspace's own entitlement (its subscription), so the counter
 * runs for that workspace only — one customer's farms never count against
 * another's. With options.unit the counter also says whether that unit is
 * already counted. A key without a counter counts as 0 used.
 */
async function extensionLimit(
  extensionId: string,
  tenantId: string | null,
  key: string,
  opts: LimitOptions = {},
  decision?: EntitlementDecision,
): Promise<LimitVerdict> {
  if (!key.startsWith(`${extensionId}.`)) throw new Error(`Licence limit "${key}" must be namespaced "${extensionId}.<name>"`)
  const resolved = decision ?? await getEntitlementPort().check({ tenantId, extensionId })
  let adding = opts.adding
  const countUsage = async () => {
    if (typeof opts.usage === 'number') return opts.usage
    const counter = (await import('./server-registry')).getServerExtension(extensionId)?.usageCounters?.[key]
    if (!counter) return 0
    const { isCloud } = await import('@/lib/deployment')
    const instanceCtx = createExtensionContext({ extensionId, tenantId: isCloud() ? tenantId : null })
    const usage = Math.max(0, Number(await counter({ ctx: instanceCtx })) || 0)
    if (opts.unit) adding = Math.max(0, (Number(await counter({ ctx: instanceCtx, unit: opts.unit })) || 0) - usage)
    return usage
  }
  if (resolved.allowed && resolved.state !== 'not_required') {
    const usage = await countUsage()
    return checkUsageLimit({ decision: resolved, key, adding, missing: opts.missing, countUsage: async () => usage })
  }
  return checkUsageLimit({ decision: resolved, key, adding, missing: opts.missing, countUsage })
}
