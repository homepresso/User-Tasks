import type { SupabaseClient } from '@supabase/supabase-js'
import { assertTenantSecretRef as assertTenantRef, resolveTenantSecretRefs } from '@/lib/config/tenant-secret-refs'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import type { DirectoryLinkProvider } from '@/lib/directory-sync/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenant_connectors rows carry free-form JSON */

/**
 * Directory connector storage on tenant_connectors — mirror of
 * lib/github-sync/connection.ts. One connector row per provider:
 *   connector_key 'entra_directory' | 'okta_directory' | 'ldap_directory'
 *                 | 'google_directory' | 'scim_directory'
 *   config      {provider, org_name, sync_groups, auto_provision, last_sync_at,
 *                last_sync_stats, settings, delta_cursor, last_full_sync_at}
 *   credentials entra:  {tenant_id, client_id, client_secret}   (client_secret encrypted)
 *               okta:   {org_url, api_token}                    (api_token encrypted)
 *               ldap:   {bind_password}                         (encrypted)
 *               google: {service_account_json}                  (encrypted)
 *               scim:   {} (bearer tokens live in scim_tokens, hashed)
 *
 * `settings` holds the provider's non-secret options (LDAP URL / TLS / base
 * DNs / filters / attribute mapping, Google admin email / customer). A secret
 * credential may also be a `secret://tenants/<workspace id>/<name>` reference
 * resolved from the instance secret store at sync time (resolveCredentialRefs).
 */

export const DIRECTORY_CONNECTOR_KEYS: Record<DirectoryLinkProvider, string> = {
  entra: 'entra_directory',
  okta: 'okta_directory',
  ldap: 'ldap_directory',
  google: 'google_directory',
  scim: 'scim_directory',
}

export const DIRECTORY_PROVIDER_LABELS: Record<DirectoryLinkProvider, string> = {
  entra: 'Entra ID',
  okta: 'Okta',
  ldap: 'LDAP',
  google: 'Google Workspace',
  scim: 'SCIM',
}

export function providerForConnectorKey(key: string): DirectoryLinkProvider | null {
  const found = Object.entries(DIRECTORY_CONNECTOR_KEYS).find(([, value]) => value === key)
  return found ? (found[0] as DirectoryLinkProvider) : null
}

export interface EntraStoredCredentials {
  tenant_id: string
  client_id: string
  client_secret: string
}

export interface OktaStoredCredentials {
  org_url: string
  api_token: string
}

export interface LdapStoredCredentials {
  bind_password: string
}

export interface GoogleStoredCredentials {
  service_account_json: string
}

export type DirectoryStoredCredentials =
  | EntraStoredCredentials
  | OktaStoredCredentials
  | LdapStoredCredentials
  | GoogleStoredCredentials
  | Record<string, never>

export interface DirectoryConnection {
  id: string
  provider: DirectoryLinkProvider
  orgName: string | null
  syncGroups: boolean
  autoProvision: boolean
  lastSyncAt: string | null
  lastSyncStats: Record<string, number> | null
  isEnabled: boolean
  /** Provider options (non-secret). */
  settings: Record<string, unknown>
  /** Delta sync state (LDAP). */
  deltaCursor: string | null
  lastFullSyncAt: string | null
  /** Decrypted credentials — only present when loaded with includeCredentials. */
  credentials?: DirectoryStoredCredentials
}

function rowToConnection(row: any, provider: DirectoryLinkProvider, includeCredentials: boolean): DirectoryConnection {
  const config = (row.config ?? {}) as Record<string, any>
  const connection: DirectoryConnection = {
    id: String(row.id),
    provider,
    orgName: config.org_name ?? null,
    syncGroups: Boolean(config.sync_groups),
    autoProvision: Boolean(config.auto_provision),
    lastSyncAt: config.last_sync_at ?? null,
    lastSyncStats: (config.last_sync_stats as Record<string, number> | undefined) ?? null,
    isEnabled: Boolean(row.is_enabled),
    settings: (config.settings && typeof config.settings === 'object' ? config.settings : {}) as Record<string, unknown>,
    deltaCursor: typeof config.delta_cursor === 'string' ? config.delta_cursor : null,
    lastFullSyncAt: config.last_full_sync_at ?? null,
  }
  if (includeCredentials) {
    connection.credentials = decryptSensitiveFields(
      (row.credentials ?? {}) as Record<string, any>,
    ) as DirectoryStoredCredentials
  }
  return connection
}

export async function getDirectoryConnection(
  supabase: SupabaseClient,
  tenantId: string,
  provider: DirectoryLinkProvider,
  opts?: { includeCredentials?: boolean },
): Promise<DirectoryConnection | null> {
  const { data } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, config, credentials, is_enabled')
    .eq('tenant_id', tenantId)
    .eq('connector_key', DIRECTORY_CONNECTOR_KEYS[provider])
    .maybeSingle()
  if (!data) return null
  return rowToConnection(data, provider, Boolean(opts?.includeCredentials))
}

export async function saveDirectoryConnection(params: {
  supabase: SupabaseClient
  tenantId: string
  provider: DirectoryLinkProvider
  orgName?: string | null
  syncGroups: boolean
  autoProvision: boolean
  /** undefined = keep the stored settings */
  settings?: Record<string, unknown>
  /** undefined = keep existing stored credentials */
  credentials?: DirectoryStoredCredentials
  /** Connection-defining settings changed: the next sync is a full one. */
  resetDelta?: boolean
  actorId?: string | null
}): Promise<void> {
  const { supabase, tenantId, provider } = params
  const connectorKey = DIRECTORY_CONNECTOR_KEYS[provider]
  const existing = await (supabase as any)
    .from('tenant_connectors')
    .select('id, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('connector_key', connectorKey)
    .maybeSingle()

  const previous = (existing.data?.config ?? {}) as Record<string, any>
  const config: Record<string, unknown> = {
    ...previous,
    provider,
    org_name: params.orgName ?? previous.org_name ?? null,
    sync_groups: params.syncGroups,
    auto_provision: params.autoProvision,
    ...(params.settings !== undefined ? { settings: params.settings } : {}),
  }
  if (params.resetDelta) {
    delete config.delta_cursor
    delete config.last_full_sync_at
  }

  const credentials = params.credentials !== undefined
    ? encryptSensitiveFields(params.credentials as Record<string, any>)
    : existing.data?.credentials ?? {}

  if (existing.data?.id) {
    const { error } = await (supabase as any)
      .from('tenant_connectors')
      .update({ config, credentials, is_enabled: true, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await (supabase as any)
      .from('tenant_connectors')
      .insert({
        tenant_id: tenantId,
        connector_key: connectorKey,
        display_name: `${DIRECTORY_PROVIDER_LABELS[provider]} Directory`,
        config,
        credentials,
        is_enabled: true,
        ...(params.actorId ? { created_by: params.actorId } : {}),
      })
    if (error) throw new Error(error.message)
  }
}

/** Merge a partial config patch (sync options, last-sync state) into the connector. */
export async function updateDirectorySyncState(
  supabase: SupabaseClient,
  tenantId: string,
  provider: DirectoryLinkProvider,
  patch: {
    last_sync_at?: string
    last_sync_stats?: Record<string, number>
    sync_groups?: boolean
    auto_provision?: boolean
    delta_cursor?: string | null
    last_full_sync_at?: string
  },
): Promise<void> {
  const existing = await (supabase as any)
    .from('tenant_connectors')
    .select('id, config')
    .eq('tenant_id', tenantId)
    .eq('connector_key', DIRECTORY_CONNECTOR_KEYS[provider])
    .maybeSingle()
  if (!existing.data?.id) return
  await (supabase as any)
    .from('tenant_connectors')
    .update({ config: { ...(existing.data.config ?? {}), ...patch } })
    .eq('id', existing.data.id)
}

/**
 * Disable the connector and remove its stored credentials (re-connect
 * requires re-entering the secret). The row's config and directory_links are
 * kept so a re-connect reuses existing user/team links instead of duplicating
 * them.
 */
export async function disconnectDirectory(
  supabase: SupabaseClient,
  tenantId: string,
  provider: DirectoryLinkProvider,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('tenant_connectors')
    .update({ is_enabled: false, credentials: {}, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('connector_key', DIRECTORY_CONNECTOR_KEYS[provider])
  if (error) throw new Error(error.message)
}

// ── secret:// credentials ────────────────────────────────────────────────────

/** The secret-store names a workspace may reference (lib/config/tenant-secret-refs). */
export { tenantSecretPrefix } from '@/lib/config/tenant-secret-refs'

export function assertTenantSecretRef(ref: string, tenantId: string, label: string): void {
  assertTenantRef(ref, tenantId, label, 'ldap-bind-password')
}

/**
 * Resolve `secret://` values in a connector's credentials (only references
 * under the workspace's own prefix; others are refused) from the configured
 * secret store. Plain values pass through.
 */
export function resolveCredentialRefs<T extends Record<string, unknown>>(tenantId: string, credentials: T): Promise<T> {
  return resolveTenantSecretRefs(tenantId, credentials, 'directory credential', 'ldap-bind-password')
}
