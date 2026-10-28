/**
 * Directory sync connections, runs and SCIM tokens: shared by
 * /api/v1/directory-sync, the MCP directory_sync_* tools and the settings
 * page (app/actions/directory-sync.ts).
 *
 * Permissions: reads need settings.view; writes settings.edit. Every
 * connection is verified against the directory before it is saved (and again
 * when its settings or credentials change). Credentials are encrypted at rest
 * (lib/secret-fields), never returned ('__SECRET__'), '__SECRET__' on update
 * keeps the stored value, and a value may be a secret:// reference under
 * tenants/<workspace id>/.
 *
 * tenant_connectors, directory_* and scim_tokens are read and written with a
 * service-role client and an explicit tenant filter (scim_tokens has no client
 * grants at all).
 */

import { z } from 'zod'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { isSecretRef } from '@/lib/config/secret-refs'
import {
  assertTenantSecretRef,
  DIRECTORY_PROVIDER_LABELS,
  disconnectDirectory,
  getDirectoryConnection as loadConnection,
  resolveCredentialRefs,
  saveDirectoryConnection,
  type DirectoryConnection,
  type DirectoryStoredCredentials,
} from '@/lib/directory-sync/connection'
import { createEntraClient } from '@/lib/directory-sync/entra'
import { createGoogleDirectoryClient, googleSettingsSchema, parseServiceAccountJson } from '@/lib/directory-sync/google'
import { kickDirectorySyncWorker } from '@/lib/directory-sync/kick'
import { createLdapClient, LdapError, ldapSettingsSchema, type LdapTestResult } from '@/lib/directory-sync/ldap'
import { createOktaClient } from '@/lib/directory-sync/okta'
import { DirectoryApiError, type DirectoryClient, type DirectoryLinkProvider, type DirectoryProvider } from '@/lib/directory-sync/types'
import { generateScimToken, SCIM_SCOPES, type ScimScope } from '@/lib/scim/tokens'
import { isPlainObject } from '@/lib/utils/guards'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, SECRET_PLACEHOLDER, serviceRoleClient, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- connector rows carry free-form JSON */

export const CONNECTION_PROVIDERS: readonly DirectoryLinkProvider[] = ['entra', 'okta', 'ldap', 'google', 'scim']

const intervalSetting = { sync_interval_minutes: z.number().int().min(10).max(10_080).optional() }

/** Settings per provider (stored in tenant_connectors.config.settings). */
const SETTINGS_SCHEMAS: Record<DirectoryLinkProvider, z.ZodType<Record<string, unknown>>> = {
  entra: z.object(intervalSetting),
  okta: z.object(intervalSetting),
  ldap: ldapSettingsSchema.extend(intervalSetting),
  google: googleSettingsSchema.extend(intervalSetting),
  scim: z.object({ rate_limit_per_minute: z.number().int().min(60).max(10_000).optional() }),
}

const nonEmpty = z.string().trim().min(1).max(20_000)

/** Credentials per provider; `secret` lists the write-only fields. */
const CREDENTIALS: Record<DirectoryLinkProvider, { schema: z.ZodType<Record<string, unknown>>; secret: string[] }> = {
  entra: { schema: z.object({ tenant_id: nonEmpty, client_id: nonEmpty, client_secret: nonEmpty }), secret: ['client_secret'] },
  okta: { schema: z.object({ org_url: nonEmpty, api_token: nonEmpty }), secret: ['api_token'] },
  ldap: { schema: z.object({ bind_password: z.string().min(1).max(1000) }), secret: ['bind_password'] },
  google: { schema: z.object({ service_account_json: nonEmpty }), secret: ['service_account_json'] },
  scim: { schema: z.object({}), secret: [] },
}

export interface DirectoryConnectionView {
  provider: DirectoryLinkProvider
  enabled: boolean
  org_name: string | null
  settings: Record<string, unknown>
  credentials: Record<string, unknown>
  sync_groups: boolean
  auto_provision: boolean
  last_sync_at: string | null
  last_sync_stats: Record<string, number> | null
  linked_users: number
  linked_groups: number
  scim_url?: string
}

export function scimUrl(): string {
  return `${(configuredAppUrl()?.trim() || 'http://localhost:3000').replace(/\/+$/, '')}/scim/v2`
}

function parseProvider(value: unknown): DirectoryLinkProvider {
  if (typeof value === 'string' && (CONNECTION_PROVIDERS as readonly string[]).includes(value)) return value as DirectoryLinkProvider
  throw ServiceError.validation(`Unknown directory provider "${String(value)}" (entra, okta, ldap, google or scim)`)
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ')
}

function maskCredentials(provider: DirectoryLinkProvider, credentials: Record<string, unknown>): Record<string, unknown> {
  const secret = new Set(CREDENTIALS[provider].secret)
  return Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, secret.has(key) && value ? SECRET_PLACEHOLDER : value]))
}

async function linkCounts(db: AnySupabaseClient, tenantId: string, provider: DirectoryLinkProvider): Promise<{ users: number; groups: number }> {
  const count = async (objectType: 'user' | 'group') => {
    const { count: n, error } = await (db as any).from('directory_links').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('provider', provider).eq('object_type', objectType)
    return error ? 0 : (n ?? 0)
  }
  const [users, groups] = await Promise.all([count('user'), count('group')])
  return { users, groups }
}

async function toView(db: AnySupabaseClient, tenantId: string, connection: DirectoryConnection): Promise<DirectoryConnectionView> {
  const counts = await linkCounts(db, tenantId, connection.provider)
  return {
    provider: connection.provider,
    enabled: connection.isEnabled,
    org_name: connection.orgName,
    settings: connection.settings,
    credentials: maskCredentials(connection.provider, (connection.credentials ?? {}) as Record<string, unknown>),
    sync_groups: connection.syncGroups,
    auto_provision: connection.autoProvision,
    last_sync_at: connection.lastSyncAt,
    last_sync_stats: connection.lastSyncStats,
    linked_users: counts.users,
    linked_groups: counts.groups,
    ...(connection.provider === 'scim' ? { scim_url: scimUrl() } : {}),
  }
}

function friendlyError(provider: DirectoryLinkProvider, error: unknown): ServiceError {
  if (error instanceof ServiceError) return error
  if (error instanceof LdapError) return ServiceError.validation(`LDAP: ${error.message}`)
  if (error instanceof DirectoryApiError) {
    if (provider === 'entra' && (error.status === 400 || error.status === 401)) {
      return ServiceError.validation('Microsoft Entra rejected the credentials. Check the Directory (tenant) ID, Application (client) ID and client secret, and that the app registration has admin-consented APPLICATION permissions User.Read.All and GroupMember.Read.All.')
    }
    if (provider === 'entra' && error.status === 403) {
      return ServiceError.validation('Microsoft Graph returned 403 — grant User.Read.All and GroupMember.Read.All (Application, not Delegated) and admin consent.')
    }
    if (provider === 'okta' && (error.status === 401 || error.status === 403)) {
      return ServiceError.validation('Okta rejected the API token. Check the org URL and create an API token (Security → API → Tokens) with permission to read users and groups.')
    }
    if (provider === 'okta' && error.status === 404) return ServiceError.validation('Okta org not found — check the org URL (e.g. https://your-org.okta.com).')
    if (provider === 'google' && (error.status === 401 || error.status === 403)) {
      return ServiceError.validation(`Google rejected the request (${error.message}). Check that the service account has domain-wide delegation for the read-only directory scopes (admin.directory.user.readonly, admin.directory.group.readonly, admin.directory.group.member.readonly) and that admin_email is a Workspace admin.`)
    }
    return ServiceError.validation(error.message)
  }
  const message = (error as Error)?.message ?? String(error)
  if (/secret reference|secret store|secret "/i.test(message)) return ServiceError.validation(message)
  if (/not allowed/i.test(message) && /Connection to/i.test(message)) return ServiceError.validation(message)
  return ServiceError.validation(`${DIRECTORY_PROVIDER_LABELS[provider]}: ${message}`)
}

/** Validate settings and the merged credentials for a provider. */
function validate(provider: DirectoryLinkProvider, tenantId: string, settings: Record<string, unknown>, credentials: Record<string, unknown>) {
  const parsedSettings = SETTINGS_SCHEMAS[provider].safeParse(settings)
  if (!parsedSettings.success) throw ServiceError.validation(`Invalid settings: ${zodMessage(parsedSettings.error)}`)
  const normalized = { ...credentials }
  if (provider === 'google' && isPlainObject(normalized.service_account_json)) normalized.service_account_json = JSON.stringify(normalized.service_account_json)
  if (provider === 'okta' && typeof normalized.org_url === 'string') {
    let orgUrl = normalized.org_url.trim().replace(/\/+$/, '')
    if (orgUrl && !/^https?:\/\//i.test(orgUrl)) orgUrl = `https://${orgUrl}`
    normalized.org_url = orgUrl
  }
  const parsedCredentials = CREDENTIALS[provider].schema.safeParse(normalized)
  if (!parsedCredentials.success) throw ServiceError.validation(`Invalid credentials: ${zodMessage(parsedCredentials.error)}`)
  for (const [key, value] of Object.entries(parsedCredentials.data)) {
    if (isSecretRef(value)) {
      try {
        assertTenantSecretRef(value, tenantId, `credentials.${key}`)
      } catch (error) {
        throw ServiceError.validation((error as Error).message)
      }
    } else if (provider === 'google' && key === 'service_account_json') {
      try {
        parseServiceAccountJson(String(value))
      } catch (error) {
        throw ServiceError.validation((error as Error).message)
      }
    }
  }
  return { settings: parsedSettings.data, credentials: parsedCredentials.data as unknown as DirectoryStoredCredentials }
}

async function clientFor(provider: DirectoryProvider, tenantId: string, settings: Record<string, unknown>, credentials: Record<string, unknown>): Promise<DirectoryClient> {
  const c = await resolveCredentialRefs(tenantId, credentials) as Record<string, string>
  switch (provider) {
    case 'entra': return createEntraClient({ tenantId: c.tenant_id, clientId: c.client_id, clientSecret: c.client_secret })
    case 'okta': return createOktaClient({ orgUrl: c.org_url, apiToken: c.api_token })
    case 'ldap': return createLdapClient({ settings, bindPassword: c.bind_password })
    case 'google': return createGoogleDirectoryClient({ settings, serviceAccountJson: c.service_account_json })
  }
}

/** Connect and verify; LDAP also returns its test details. */
async function verify(provider: DirectoryLinkProvider, tenantId: string, settings: Record<string, unknown>, credentials: Record<string, unknown>): Promise<{ orgName: string | null; details: LdapTestResult | null }> {
  if (provider === 'scim') return { orgName: null, details: null }
  let client: DirectoryClient | null = null
  try {
    client = await clientFor(provider, tenantId, settings, credentials)
    if (provider === 'ldap') {
      const details = await (client as ReturnType<typeof createLdapClient>).test()
      return { orgName: details.server, details }
    }
    return { orgName: (await client.verify()).orgName, details: null }
  } catch (error) {
    throw friendlyError(provider, error)
  } finally {
    await client?.close?.().catch(() => undefined)
  }
}

/** Merge a partial object over a stored one: null removes a key, __SECRET__ keeps the stored value. */
function merge(stored: Record<string, unknown>, patch: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!patch) return { ...stored }
  const out: Record<string, unknown> = { ...stored }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else if (value === SECRET_PLACEHOLDER) continue
    else out[key] = value
  }
  return out
}

// ─── Connections ───

export async function listDirectoryConnections(ctx: ServiceContext): Promise<{ connections: DirectoryConnectionView[]; total: number; scim_url: string }> {
  requirePerm(ctx, 'settings.view')
  const db = await serviceRoleClient(ctx)
  const found = await Promise.all(CONNECTION_PROVIDERS.map((provider) => loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true }).catch(() => null)))
  const connections = await Promise.all(found.filter((c): c is DirectoryConnection => Boolean(c)).map((c) => toView(db, ctx.tenantId, c)))
  return { connections, total: connections.length, scim_url: scimUrl() }
}

export async function getDirectoryConnectionView(ctx: ServiceContext, rawProvider: string): Promise<{ connection: DirectoryConnectionView }> {
  requirePerm(ctx, 'settings.view')
  const provider = parseProvider(rawProvider)
  const db = await serviceRoleClient(ctx)
  const connection = await loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true })
  if (!connection) throw ServiceError.notFound(`${DIRECTORY_PROVIDER_LABELS[provider]} is not connected`)
  return { connection: await toView(db, ctx.tenantId, connection) }
}

export interface DirectoryConnectionInput {
  provider?: string
  settings?: Record<string, unknown>
  credentials?: Record<string, unknown>
  sync_groups?: boolean
  auto_provision?: boolean
}

export async function createDirectoryConnection(ctx: ServiceContext, input: DirectoryConnectionInput): Promise<{ connection: DirectoryConnectionView; test?: LdapTestResult }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(input.provider)
  const db = await serviceRoleClient(ctx)
  const existing = await loadConnection(db as any, ctx.tenantId, provider)
  if (existing?.isEnabled) throw ServiceError.conflict(`${DIRECTORY_PROVIDER_LABELS[provider]} is already connected: update it instead`)
  const { settings, credentials } = validate(provider, ctx.tenantId, input.settings ?? {}, input.credentials ?? {})
  const { orgName, details } = await verify(provider, ctx.tenantId, settings, credentials as Record<string, unknown>)
  await saveDirectoryConnection({
    supabase: db as any,
    tenantId: ctx.tenantId,
    provider,
    orgName,
    syncGroups: input.sync_groups ?? true,
    autoProvision: input.auto_provision ?? true,
    settings,
    credentials,
    resetDelta: true,
    actorId: ctx.actorId,
  })
  const connection = (await loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true }))!
  await audit(ctx, {
    objectType: 'directory_sync', objectId: connection.id, action: 'create',
    summary: `Connected ${DIRECTORY_PROVIDER_LABELS[provider]} directory${orgName ? ` (${orgName})` : ''}`,
    metadata: { provider, org_name: orgName },
  })
  return { connection: await toView(db, ctx.tenantId, connection), ...(details ? { test: details } : {}) }
}

export async function updateDirectoryConnection(ctx: ServiceContext, rawProvider: string, input: DirectoryConnectionInput): Promise<{ connection: DirectoryConnectionView; changed: boolean }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(rawProvider)
  if (input.provider !== undefined && input.provider !== provider) throw ServiceError.validation('The provider of a connection cannot change')
  const db = await serviceRoleClient(ctx)
  const existing = await loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true })
  if (!existing?.isEnabled) throw ServiceError.notFound(`${DIRECTORY_PROVIDER_LABELS[provider]} is not connected`)

  const storedCredentials = (existing.credentials ?? {}) as Record<string, unknown>
  const nextSettings = merge(existing.settings, input.settings)
  const nextCredentials = merge(storedCredentials, input.credentials)
  const connectionChanged = JSON.stringify(nextSettings) !== JSON.stringify(existing.settings)
    || JSON.stringify(nextCredentials) !== JSON.stringify(storedCredentials)
  const optionsChanged = (input.sync_groups !== undefined && input.sync_groups !== existing.syncGroups)
    || (input.auto_provision !== undefined && input.auto_provision !== existing.autoProvision)
  if (!connectionChanged && !optionsChanged) return { connection: await toView(db, ctx.tenantId, existing), changed: false }

  let orgName = existing.orgName
  let settings = existing.settings
  let credentials: DirectoryStoredCredentials | undefined
  if (connectionChanged) {
    const validated = validate(provider, ctx.tenantId, nextSettings, nextCredentials)
    orgName = (await verify(provider, ctx.tenantId, validated.settings, validated.credentials as Record<string, unknown>)).orgName ?? orgName
    settings = validated.settings
    credentials = validated.credentials
  }
  await saveDirectoryConnection({
    supabase: db as any,
    tenantId: ctx.tenantId,
    provider,
    orgName,
    syncGroups: input.sync_groups ?? existing.syncGroups,
    autoProvision: input.auto_provision ?? existing.autoProvision,
    settings,
    credentials,
    resetDelta: connectionChanged,
  })
  const connection = (await loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true }))!
  await audit(ctx, {
    objectType: 'directory_sync', objectId: connection.id, action: 'update',
    summary: `Updated ${DIRECTORY_PROVIDER_LABELS[provider]} directory connection`,
    metadata: { provider, connection_changed: connectionChanged },
  })
  return { connection: await toView(db, ctx.tenantId, connection), changed: true }
}

export async function deleteDirectoryConnection(ctx: ServiceContext, rawProvider: string): Promise<{ deleted: true }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(rawProvider)
  const db = await serviceRoleClient(ctx)
  const existing = await loadConnection(db as any, ctx.tenantId, provider)
  if (!existing) throw ServiceError.notFound(`${DIRECTORY_PROVIDER_LABELS[provider]} is not connected`)
  await disconnectDirectory(db as any, ctx.tenantId, provider)
  if (provider === 'scim') {
    await (db as any).from('scim_tokens').update({ revoked_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId).is('revoked_at', null)
  }
  await audit(ctx, {
    objectType: 'directory_sync', objectId: existing.id, action: 'delete',
    summary: `Disconnected ${DIRECTORY_PROVIDER_LABELS[provider]} directory sync`,
    metadata: { provider },
  })
  return { deleted: true }
}

export async function testDirectoryConnection(ctx: ServiceContext, rawProvider: string, input: { settings?: Record<string, unknown>; credentials?: Record<string, unknown> } = {}): Promise<{ ok: boolean; org_name: string | null; error: string | null; details: LdapTestResult | null }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(rawProvider)
  if (provider === 'scim') throw ServiceError.validation('SCIM is pushed by the identity provider: there is nothing to test from here')
  const db = await serviceRoleClient(ctx)
  const existing = await loadConnection(db as any, ctx.tenantId, provider, { includeCredentials: true })
  const storedCredentials = existing?.isEnabled ? (existing.credentials ?? {}) as Record<string, unknown> : {}
  try {
    const { settings, credentials } = validate(provider, ctx.tenantId, merge(existing?.settings ?? {}, input.settings), merge(storedCredentials, input.credentials))
    const result = await verify(provider, ctx.tenantId, settings, credentials as Record<string, unknown>)
    return { ok: true, org_name: result.orgName, error: null, details: result.details }
  } catch (error) {
    return { ok: false, org_name: null, error: (error as Error).message, details: null }
  }
}

// ─── Runs ───

export async function startDirectorySyncRun(ctx: ServiceContext, rawProvider: string, input: { full?: boolean } = {}): Promise<{ run_id: string; already_running: boolean }> {
  requirePerm(ctx, 'settings.edit')
  const provider = parseProvider(rawProvider)
  if (provider === 'scim') throw ServiceError.validation('SCIM is pushed by the identity provider: start provisioning there')
  const db = await serviceRoleClient(ctx)
  const connection = await loadConnection(db as any, ctx.tenantId, provider)
  if (!connection?.isEnabled) throw ServiceError.notFound(`${DIRECTORY_PROVIDER_LABELS[provider]} directory sync is not connected`)

  // One in-flight run per tenant+provider — a second sync would just race the first.
  const { data: active } = await (db as any).from('directory_sync_runs').select('id')
    .eq('tenant_id', ctx.tenantId).eq('provider', provider).in('status', ['pending', 'running']).limit(1)
  if ((active ?? []).length > 0) return { run_id: String((active as any[])[0].id), already_running: true }

  const { data, error } = await (db as any).from('directory_sync_runs')
    .insert({ tenant_id: ctx.tenantId, provider, created_by: ctx.actorId, ...(input.full ? { mode: 'full' } : {}) })
    .select('id').single()
  if (error) {
    if (error.code === '23505') return startDirectorySyncRun(ctx, provider, input)
    throw new Error(error.message)
  }
  kickDirectorySyncWorker()
  return { run_id: String(data.id), already_running: false }
}

export async function listDirectorySyncRuns(ctx: ServiceContext, page: Page, filters: { provider?: string } = {}): Promise<{ runs: any[]; total: number }> {
  requirePerm(ctx, 'settings.view')
  const db = await serviceRoleClient(ctx)
  let query = (db as any).from('directory_sync_runs')
    .select('id, provider, status, mode, progress, stats, error, created_at, started_at, completed_at', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if (filters.provider) query = query.eq('provider', filters.provider)
  const { data, error, count } = await applyPage(query, page)
  if (error) throw new Error(error.message)
  return { runs: data ?? [], total: count ?? (data ?? []).length }
}

// ─── SCIM tokens ───

const TOKEN_COLUMNS = 'id, name, token_prefix, scopes, created_by, created_at, last_used_at, expires_at, revoked_at, rotated_from'

async function ensureScimConnector(ctx: ServiceContext, db: AnySupabaseClient): Promise<void> {
  const existing = await loadConnection(db as any, ctx.tenantId, 'scim')
  if (existing?.isEnabled) return
  await saveDirectoryConnection({
    supabase: db as any,
    tenantId: ctx.tenantId,
    provider: 'scim',
    orgName: null,
    syncGroups: existing?.syncGroups ?? true,
    autoProvision: existing?.autoProvision ?? true,
    settings: existing?.settings ?? {},
    credentials: {},
    actorId: ctx.actorId,
  })
}

export async function listScimTokens(ctx: ServiceContext): Promise<{ scim_tokens: any[]; total: number }> {
  requirePerm(ctx, 'settings.view')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('scim_tokens').select(TOKEN_COLUMNS)
    .eq('tenant_id', ctx.tenantId).is('revoked_at', null).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return { scim_tokens: data ?? [], total: (data ?? []).length }
}

function scopesFrom(raw: unknown): ScimScope[] {
  if (raw === undefined) return [...SCIM_SCOPES]
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((s) => !(SCIM_SCOPES as readonly string[]).includes(String(s)))) {
    throw ServiceError.validation(`scopes must be a non-empty list of ${SCIM_SCOPES.join(', ')}`)
  }
  return [...new Set(raw as ScimScope[])]
}

export async function createScimToken(ctx: ServiceContext, input: { name: string; scopes?: string[]; expires_in_days?: number }): Promise<{ scim_token: any; token: string; scim_url: string }> {
  requirePerm(ctx, 'settings.edit')
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 200) throw ServiceError.validation('name is required (at most 200 characters)')
  const scopes = scopesFrom(input.scopes)
  const days = input.expires_in_days
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) throw ServiceError.validation('expires_in_days must be 1–3650')
  const db = await serviceRoleClient(ctx)
  await ensureScimConnector(ctx, db)
  const { token, hash, prefix } = generateScimToken()
  const { data, error } = await (db as any).from('scim_tokens').insert({
    tenant_id: ctx.tenantId,
    name,
    token_hash: hash,
    token_prefix: prefix,
    scopes,
    created_by: ctx.actorId,
    ...(days ? { expires_at: new Date(Date.now() + days * 86_400_000).toISOString() } : {}),
  }).select(TOKEN_COLUMNS).single()
  if (error) throw new Error(error.message)
  await audit(ctx, { objectType: 'directory_sync', objectId: data.id, action: 'create', summary: `Created SCIM token "${name}"`, metadata: { provider: 'scim', scopes } })
  return { scim_token: data, token, scim_url: scimUrl() }
}

async function getToken(db: AnySupabaseClient, ctx: ServiceContext, id: string): Promise<any> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw ServiceError.notFound('SCIM token not found')
  const { data } = await (db as any).from('scim_tokens').select(TOKEN_COLUMNS).eq('tenant_id', ctx.tenantId).eq('id', id).maybeSingle()
  if (!data || data.revoked_at) throw ServiceError.notFound('SCIM token not found')
  return data
}

export async function deleteScimToken(ctx: ServiceContext, id: string): Promise<{ deleted: true }> {
  requirePerm(ctx, 'settings.edit')
  const db = await serviceRoleClient(ctx)
  const token = await getToken(db, ctx, id)
  const { error } = await (db as any).from('scim_tokens').delete().eq('tenant_id', ctx.tenantId).eq('id', id)
  if (error) throw new Error(error.message)
  await audit(ctx, { objectType: 'directory_sync', objectId: id, action: 'revoke', summary: `Revoked SCIM token "${token.name}"`, metadata: { provider: 'scim' } })
  return { deleted: true }
}

export async function rotateScimToken(ctx: ServiceContext, id: string, input: { grace_minutes?: number } = {}): Promise<{ scim_token: any; token: string; previous: any }> {
  requirePerm(ctx, 'settings.edit')
  const grace = input.grace_minutes ?? 0
  if (!Number.isInteger(grace) || grace < 0 || grace > 10_080) throw ServiceError.validation('grace_minutes must be 0–10080')
  const db = await serviceRoleClient(ctx)
  const old = await getToken(db, ctx, id)
  const { token, hash, prefix } = generateScimToken()
  const { data, error } = await (db as any).from('scim_tokens').insert({
    tenant_id: ctx.tenantId,
    name: old.name,
    token_hash: hash,
    token_prefix: prefix,
    scopes: old.scopes,
    created_by: ctx.actorId,
    expires_at: old.expires_at,
    rotated_from: old.id,
  }).select(TOKEN_COLUMNS).single()
  if (error) throw new Error(error.message)
  const now = Date.now()
  const patch = grace > 0
    ? { expires_at: new Date(Math.min(now + grace * 60_000, old.expires_at ? new Date(old.expires_at).getTime() : Infinity)).toISOString() }
    : { revoked_at: new Date(now).toISOString() }
  const { data: previous } = await (db as any).from('scim_tokens').update(patch).eq('tenant_id', ctx.tenantId).eq('id', old.id).select(TOKEN_COLUMNS).single()
  await audit(ctx, { objectType: 'directory_sync', objectId: data.id, action: 'rotate', summary: `Rotated SCIM token "${old.name}"`, metadata: { provider: 'scim', previous: old.id, grace_minutes: grace } })
  return { scim_token: data, token, previous: previous ?? old }
}
