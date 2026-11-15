/**
 * ctx.connections — an extension's view of the workspace's connections
 * (integrations rows) made with ITS OWN connectors (`ext.<id>.<key>`), and
 * a fetch that sends a request with one of them: the connection's transport
 * (core `windows` NTLM / Negotiate with CA bundle and proxy, or an extension
 * transport), its auth headers and default headers, through connectorFetch
 * (egress guard on every hop, timeout budget, retries, redirect rules).
 *
 * Rules:
 *  - only connections whose connector key starts with `ext.<id>.` are
 *    visible; other integrations (and other workspaces) are not found;
 *  - credentials are bound to the connection's origin: a URL on another
 *    origin is refused before anything is sent;
 *  - metadata never carries secrets (authSummary lists only non-sensitive
 *    auth settings such as mode and username).
 *
 * Server-only.
 */

import type { ConnectionFetchOptions, ExtensionConnection } from '@/lib/extensions/sdk'
import { getServiceDb } from '@/lib/providers/db'
import { decryptSensitiveFields, isSensitiveKey } from '@/lib/secret-fields'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'
import { connectorFetch } from '@/lib/integrations/http'
import { resolveTransportFetch, transportKindOf } from '@/lib/integrations/transports'
import { stripHeaderBreaks } from '@/lib/integrations/request-template'

/* eslint-disable @typescript-eslint/no-explicit-any -- integration config is free-form JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUMMARY_KEYS = new Set(['mode', 'username', 'domain', 'spn', 'proxy_url', 'scheme', 'client_id', 'tenant', 'realm'])
/** Keys connector definitions keep in integration headers that are not HTTP headers. */
const NON_HTTP_HEADER_KEYS = new Set(['_executor', 'db_type', 'host', 'port', 'database', 'ssl', 'encrypt', 'trustservercertificate'])

export class ConnectionAccessError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'cross_origin' | 'no_workspace' | 'invalid_url') {
    super(message)
    this.name = 'ConnectionAccessError'
  }
}

function connectorPrefix(extensionId: string): string {
  return `ext.${extensionId}.`
}

interface LoadedConnection {
  row: any
  config: Record<string, any>
}

function summarise(row: any, config: Record<string, any>): ExtensionConnection {
  const authConfig = (config.auth_config ?? {}) as Record<string, unknown>
  const authSummary: Record<string, string> = {}
  for (const [key, value] of Object.entries(authConfig)) {
    if (key.startsWith('_') || !SUMMARY_KEYS.has(key) || isSensitiveKey(key)) continue
    if (typeof value === 'string' && value && !/^enc:v\d+:/.test(value)) authSummary[key] = value.slice(0, 200)
  }
  if (typeof authConfig.ca_bundle === 'string' && authConfig.ca_bundle.trim()) authSummary.ca_bundle = 'set'
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    connector: String(row.type),
    baseUrl: typeof config.base_url === 'string' ? config.base_url : '',
    authType: typeof config.auth_type === 'string' ? config.auth_type : 'none',
    transport: transportKindOf(config),
    active: row.is_active !== false,
    authSummary,
    lastTest: { status: row.last_test_status ?? null, message: row.last_test_message ?? null, at: row.last_tested_at ?? null },
  }
}

async function decryptedConfig(row: any): Promise<Record<string, any>> {
  let config = (decryptSensitiveFields(row.config) ?? {}) as Record<string, any>
  const { getConnectorDefinition } = await import('@/lib/connectors/registry')
  const upgrade = getConnectorDefinition(String(row.type))?.upgradeIntegrationConfig
  if (upgrade) config = upgrade(config)
  return config
}

async function loadConnection(extensionId: string, tenantId: string | null, id: string): Promise<LoadedConnection | null> {
  if (!tenantId) throw new ConnectionAccessError('Connections need a workspace', 'no_workspace')
  if (!UUID_RE.test(String(id ?? ''))) return null
  const { data, error } = await (getServiceDb() as any).from('integrations').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new Error(`Could not load the connection: ${error.message}`)
  if (!data || !String(data.type ?? '').startsWith(connectorPrefix(extensionId))) return null
  return { row: data, config: await decryptedConfig(data) }
}

export async function listExtensionConnections(extensionId: string, tenantId: string | null, options: { connector?: string } = {}): Promise<ExtensionConnection[]> {
  if (!tenantId) throw new ConnectionAccessError('Connections need a workspace', 'no_workspace')
  const prefix = connectorPrefix(extensionId)
  const wanted = options.connector ? (options.connector.startsWith(prefix) ? options.connector : `${prefix}${options.connector}`) : null
  let query = (getServiceDb() as any).from('integrations').select('*').eq('tenant_id', tenantId)
  query = wanted ? query.eq('type', wanted) : query.like('type', `${prefix}%`)
  const { data, error } = await query
  if (error) throw new Error(`Could not list connections: ${error.message}`)
  const rows = ((data ?? []) as any[]).filter((r) => String(r.type ?? '').startsWith(prefix))
  rows.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
  return Promise.all(rows.map(async (row) => summarise(row, await decryptedConfig(row))))
}

export async function getExtensionConnection(extensionId: string, tenantId: string | null, id: string): Promise<ExtensionConnection | null> {
  const loaded = await loadConnection(extensionId, tenantId, id)
  return loaded ? summarise(loaded.row, loaded.config) : null
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers)
  for (const [k, v] of entries) out[k] = String(v)
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

/** Resolve `url` against the connection's base URL and refuse other origins. */
export function resolveConnectionUrl(baseUrl: string, url: string): URL {
  let base: URL
  try { base = new URL(baseUrl) } catch { throw new ConnectionAccessError('The connection has no valid base URL', 'invalid_url') }
  let target: URL
  try {
    target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? new URL(url) : new URL(url.replace(/^\/+/, ''), base.href.endsWith('/') ? base.href : `${base.href}/`)
  } catch { throw new ConnectionAccessError(`Invalid URL "${String(url).slice(0, 200)}"`, 'invalid_url') }
  if (target.origin !== base.origin) throw new ConnectionAccessError(`The connection's credentials are only sent to ${base.origin}`, 'cross_origin')
  return target
}

export async function fetchWithExtensionConnection(
  extensionId: string,
  tenantId: string | null,
  id: string,
  url: string,
  init: RequestInit = {},
  options: ConnectionFetchOptions = {},
): Promise<Response> {
  const loaded = await loadConnection(extensionId, tenantId, id)
  if (!loaded) throw new ConnectionAccessError('Connection not found', 'not_found')
  const { config, row } = loaded
  const target = resolveConnectionUrl(String(config.base_url ?? ''), url)
  const headers = headerRecord(init.headers)
  // Connection-level default headers (the connector's buildIntegrationConfig `headers`), never overriding the call's own.
  for (const [k, v] of Object.entries((config.headers ?? {}) as Record<string, unknown>)) {
    if (NON_HTTP_HEADER_KEYS.has(k.toLowerCase()) || typeof v !== 'string' || hasHeader(headers, k)) continue
    headers[k] = stripHeaderBreaks(v)
  }
  if (!options.anonymous) {
    const query: Record<string, string> = {}
    await applyAuthHeaders(config, headers, { supabase: getServiceDb() as any, integrationId: String(row.id), tenantId }, query)
    for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v)
  }
  const fetchImpl = await resolveTransportFetch({ tenantId, integrationConfig: config, anonymous: options.anonymous === true })
  return connectorFetch(target.toString(), { ...init, headers }, { fetchImpl, timeoutMs: options.timeoutMs, maxAttempts: options.maxAttempts, retry: options.retry })
}
