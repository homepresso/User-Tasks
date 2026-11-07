/**
 * Document OCR: the workspace's OCR provider (Settings → Document OCR,
 * /api/v1/document-ocr, MCP document_ocr_*, `usertasks document-ocr …`).
 *
 * The workspace brings its own Azure AI Document Intelligence key, or uses
 * built-in tesseract where the instance offers it, or turns OCR off. The
 * choice is tenants.settings.document_ocr = { provider, connector_id }; the
 * Azure endpoint and key live in a tenant connector of type
 * azure_document_intelligence (lib/services/connectors), so the key is
 * encrypted at rest, write-only on every surface ('__SECRET__' when read)
 * and scrubbed from exports. Endpoints must be https and pass the egress
 * guard (no private, loopback or metadata hosts — the connector SSRF rules).
 *
 * Reads: settings.view (the designer's status read: any member). Changes and
 * connection tests: settings.edit (plus the integrations.* permission the
 * connector service checks). Set, change, remove and test are audited
 * (object type `workspace`, metadata.kind = 'document_ocr'); the key never
 * appears in an audit row, a result or a log line.
 */

import { assertSafeEgressUrl } from '@/lib/egress-guard'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import {
  AZURE_DI_DEFAULT_API_VERSION, azureTarget, configuredOcrProvider, instanceOcrDefaultAllowed, instanceTesseractAvailable,
  isLocalMockEndpoint, testAzureOcr, type AzureOcrOptions,
} from '@/lib/documents/ocr'
import {
  AZURE_DI_CONNECTOR_KEY, DOCUMENT_OCR_SETTINGS_PATH, decideOcrSource, isWorkspaceOcrProvider, workspaceOcrFromTenantSettings,
  WORKSPACE_OCR_PROVIDERS, type WorkspaceOcrProvider, type WorkspaceOcrSetting,
} from '@/lib/documents/ocr-settings'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, SECRET_PLACEHOLDER, serviceRoleClient } from './_shared'
import { createConnector, deleteConnector, updateConnector } from './connectors'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants / connector JSON is untyped */

const CONNECTOR_LABEL = 'Document OCR (Azure AI Document Intelligence)'

export interface DocumentOcrAzureView {
  connector_id: string
  endpoint: string
  api_version: string | null
  /** Write-only: '__SECRET__' when a key is stored, else null. */
  key: typeof SECRET_PLACEHOLDER | null
  key_saved: boolean
  enabled: boolean
  last_test_status: string | null
  last_tested_at: string | null
  last_test_message: string | null
}

export type DocumentOcrStatus = 'ready' | 'not_configured' | 'off' | 'unavailable'

export interface DocumentOcrEffective {
  status: DocumentOcrStatus
  /** What a run would use (null when it would fail). */
  provider: 'azure_document_intelligence' | 'tesseract' | null
  source: 'workspace' | 'instance' | null
  message: string
}

export interface DocumentOcrView {
  provider: WorkspaceOcrProvider
  azure: DocumentOcrAzureView | null
  effective: DocumentOcrEffective
  instance: {
    /** DOCUMENT_OCR_INSTANCE_DEFAULT: may workspaces without a setting use the instance's OCR? */
    default_allowed: boolean
    /** Can a workspace pick built-in tesseract here? */
    tesseract_available: boolean
  }
  settings_path: string
}

/* ── Reads ─────────────────────────────────────────────────────────── */

async function readSettings(db: AnySupabaseClient, tenantId: string): Promise<{ settings: Record<string, unknown>; ocr: WorkspaceOcrSetting }> {
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  return { settings, ocr: workspaceOcrFromTenantSettings(settings) }
}

/** The workspace's Azure connector row (still encrypted), or null. */
async function loadAzureConnector(db: AnySupabaseClient, tenantId: string, connectorId: string | null): Promise<any | null> {
  if (!connectorId) return null
  const { data, error } = await (db as any).from('tenant_connectors')
    .select('id, connector_key, config, credentials, is_enabled, last_test_status, last_tested_at, last_test_message')
    .eq('id', connectorId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  return data && data.connector_key === AZURE_DI_CONNECTOR_KEY ? data : null
}

function presentAzure(row: any | null): DocumentOcrAzureView | null {
  if (!row) return null
  const config = (decryptSensitiveFields(row.config ?? {}) ?? {}) as Record<string, any>
  const credentials = (decryptSensitiveFields(row.credentials ?? {}) ?? {}) as Record<string, any>
  const keySaved = typeof credentials.api_key === 'string' && credentials.api_key.trim() !== '' && credentials.api_key !== SECRET_PLACEHOLDER
  return {
    connector_id: String(row.id),
    endpoint: String(config.endpoint ?? ''),
    api_version: config.api_version ? String(config.api_version) : null,
    key: keySaved ? SECRET_PLACEHOLDER : null,
    key_saved: keySaved,
    enabled: row.is_enabled !== false,
    last_test_status: row.last_test_status ?? null,
    last_tested_at: row.last_tested_at ?? null,
    last_test_message: row.last_test_message ?? null,
  }
}

/** What a run would do with this setting (mirrors lib/documents/ocr-workspace without opening anything). */
export function effectiveOcr(ocr: WorkspaceOcrSetting, azure: DocumentOcrAzureView | null, instance: { defaultAllowed: boolean; tesseractAvailable: boolean }): DocumentOcrEffective {
  const instanceProvider = configuredOcrProvider()
  const decision = decideOcrSource(ocr, { defaultAllowed: instance.defaultAllowed, provider: instanceProvider })
  switch (decision.kind) {
    case 'error':
      return { status: decision.code === 'not_configured' ? 'not_configured' : 'off', provider: null, source: null, message: decision.message }
    case 'workspace_azure':
      if (!azure) return { status: 'not_configured', provider: null, source: null, message: `The Azure connection was removed. Add the key again in Settings → Document OCR (${DOCUMENT_OCR_SETTINGS_PATH}).` }
      if (!azure.key_saved || !azure.enabled) return { status: 'not_configured', provider: null, source: null, message: `The Azure key needs to be entered (for example after an import) in Settings → Document OCR (${DOCUMENT_OCR_SETTINGS_PATH}).` }
      return { status: 'ready', provider: 'azure_document_intelligence', source: 'workspace', message: 'OCR uses this workspace\'s Azure AI Document Intelligence resource.' }
    case 'workspace_tesseract':
      return instance.tesseractAvailable
        ? { status: 'ready', provider: 'tesseract', source: 'workspace', message: 'OCR uses the built-in tesseract engine on this instance.' }
        : { status: 'unavailable', provider: null, source: null, message: 'Built-in OCR (tesseract) isn\'t available on this instance. Use an Azure AI Document Intelligence key instead.' }
    case 'instance':
      return { status: 'ready', provider: instanceProvider === 'azure_document_intelligence' ? 'azure_document_intelligence' : 'tesseract', source: 'instance', message: 'OCR uses this instance\'s configuration.' }
  }
}

async function buildView(db: AnySupabaseClient, tenantId: string): Promise<DocumentOcrView> {
  const { ocr } = await readSettings(db, tenantId)
  const azure = presentAzure(await loadAzureConnector(db, tenantId, ocr.connector_id))
  const instance = { defaultAllowed: instanceOcrDefaultAllowed(), tesseractAvailable: await instanceTesseractAvailable() }
  return {
    provider: ocr.provider,
    azure,
    effective: effectiveOcr(ocr, azure, instance),
    instance: { default_allowed: instance.defaultAllowed, tesseract_available: instance.tesseractAvailable },
    settings_path: DOCUMENT_OCR_SETTINGS_PATH,
  }
}

/** The workspace's OCR setting (settings.view). The key is never returned. */
export async function getDocumentOcr(ctx: ServiceContext): Promise<DocumentOcrView> {
  requirePerm(ctx, 'settings.view')
  return buildView(await serviceRoleClient(ctx), ctx.tenantId)
}

/** Whether OCR would work in this workspace (any member: the designer's warning). */
export async function getDocumentOcrStatus(ctx: ServiceContext): Promise<DocumentOcrEffective & { settings_path: string }> {
  const view = await buildView(await serviceRoleClient(ctx), ctx.tenantId)
  return { ...view.effective, settings_path: view.settings_path }
}

/* ── Validation ────────────────────────────────────────────────────── */

/**
 * The endpoint a workspace types in: absolute https (http only for a local
 * mock with ALLOW_PRIVATE_EGRESS=true), no credentials, query or fragment,
 * and a host the egress guard allows (no private, loopback, link-local or
 * metadata addresses, also via DNS). Returns it without a trailing slash.
 */
export async function validateAzureEndpoint(raw: unknown): Promise<string> {
  const endpoint = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!endpoint) throw ServiceError.validation('endpoint is required (Azure portal → your Document Intelligence resource → Keys and Endpoint)')
  let url: URL
  try { url = new URL(endpoint) } catch { throw ServiceError.validation('endpoint must be a valid absolute URL, e.g. https://my-resource.cognitiveservices.azure.com') }
  if (url.protocol !== 'https:' && !isLocalMockEndpoint(endpoint)) throw ServiceError.validation('endpoint must use https://')
  if (url.username || url.password || url.hash || url.search) throw ServiceError.validation('endpoint cannot contain credentials, a query or a fragment')
  try {
    await assertSafeEgressUrl(endpoint)
  } catch (error) {
    throw ServiceError.validation(`endpoint is not allowed: ${(error as Error).message}`)
  }
  return endpoint
}

function validateApiVersion(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  try {
    azureTarget({ endpoint: 'https://x', apiVersion: value })
  } catch (error) {
    throw ServiceError.validation((error as Error).message)
  }
  return value
}

/** A key the caller actually sent ('' and '__SECRET__' mean "keep the stored one"). */
function newKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw ServiceError.validation('key must be a string')
  const key = raw.trim()
  if (!key || key === SECRET_PLACEHOLDER) return null
  if (key.length > 512 || /\s/.test(key)) throw ServiceError.validation('key is not a valid Azure key')
  return key
}

/* ── Writes ────────────────────────────────────────────────────────── */

export interface DocumentOcrUpdateInput {
  provider: WorkspaceOcrProvider | string
  /** Azure: the resource endpoint. Omit to keep the stored one. */
  endpoint?: string | null
  /** Azure: KEY 1 or KEY 2. Write-only; omit, '' or '__SECRET__' keeps the stored key. */
  key?: string | null
  /** Azure: API version (default 2024-11-30). Omit to keep, '' to reset to the default. */
  api_version?: string | null
}

async function writeSetting(ctx: ServiceContext, db: AnySupabaseClient, settings: Record<string, unknown>, next: WorkspaceOcrSetting) {
  const { error } = await (db as any).from('tenants').update({ settings: { ...settings, document_ocr: next } }).eq('id', ctx.tenantId)
  if (error) throw dbError(error)
}

const hostOf = (endpoint: string | null | undefined) => { try { return endpoint ? new URL(endpoint).host : null } catch { return null } }

/** Set or change the workspace's OCR provider (settings.edit). */
export async function updateDocumentOcr(ctx: ServiceContext, input: DocumentOcrUpdateInput): Promise<DocumentOcrView> {
  requirePerm(ctx, 'settings.edit')
  const provider = input?.provider
  if (!isWorkspaceOcrProvider(provider)) throw ServiceError.validation(`provider must be one of ${WORKSPACE_OCR_PROVIDERS.join(', ')}`)
  const db = await serviceRoleClient(ctx)
  const { settings, ocr: before } = await readSettings(db, ctx.tenantId)
  const existing = await loadAzureConnector(db, ctx.tenantId, before.connector_id)
  const existingView = presentAzure(existing)
  const next: WorkspaceOcrSetting = { provider, connector_id: existing ? String(existing.id) : null }
  let keyChanged = false
  let endpointChanged = false

  if (provider === 'azure_document_intelligence') {
    const endpoint = await validateAzureEndpoint(input.endpoint ?? existingView?.endpoint)
    const apiVersion = input.api_version === undefined ? (existingView?.api_version ?? null) : validateApiVersion(input.api_version)
    const key = newKey(input.key)
    if (!key && !existingView?.key_saved) throw ServiceError.validation('key is required (KEY 1 or KEY 2 from the Azure portal → your resource → Keys and Endpoint)')
    const config = { endpoint, ...(apiVersion ? { api_version: apiVersion } : {}) }
    keyChanged = Boolean(key)
    endpointChanged = endpoint !== existingView?.endpoint || apiVersion !== (existingView?.api_version ?? null)
    if (existing) {
      if (keyChanged || endpointChanged || !existingView?.enabled) {
        await updateConnector(ctx, String(existing.id), { config, ...(key ? { credentials: { api_key: key } } : {}), enabled: true }, { mode: 'replace' })
      }
    } else {
      const created = await createConnector(ctx, { connector_key: AZURE_DI_CONNECTOR_KEY, display_name: CONNECTOR_LABEL, config, credentials: { api_key: key } })
      next.connector_id = created.connector.id
    }
  } else if (provider === 'tesseract' && !(await instanceTesseractAvailable())) {
    throw ServiceError.validation('Built-in OCR (tesseract) is not available on this instance; use azure_document_intelligence with your own key')
  }

  await writeSetting(ctx, db, settings, next)
  const view = await buildView(db, ctx.tenantId)
  const firstTime = before.provider === 'instance_default' && !existing && provider !== 'instance_default'
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: firstTime ? 'create' : 'update',
    summary: provider === 'azure_document_intelligence'
      ? `${keyChanged ? (existingView?.key_saved ? 'Replaced the' : 'Saved an') : 'Kept the'} Azure AI Document Intelligence key for document OCR (${hostOf(view.azure?.endpoint) ?? 'endpoint'})`
      : `Set document OCR to ${provider}`,
    diff: { 'document_ocr.provider': { before: before.provider, after: provider } },
    metadata: {
      kind: 'document_ocr', provider, endpoint_host: hostOf(view.azure?.endpoint),
      key_changed: keyChanged, endpoint_changed: endpointChanged, connector_id: next.connector_id,
    },
  })
  return view
}

/**
 * Remove the workspace's Azure key (deletes its connector) and stop using
 * it: an Azure setting falls back to the instance default (which on the
 * cloud means "not configured").
 */
export async function removeDocumentOcrKey(ctx: ServiceContext): Promise<DocumentOcrView> {
  requirePerm(ctx, 'settings.edit')
  const db = await serviceRoleClient(ctx)
  const { settings, ocr: before } = await readSettings(db, ctx.tenantId)
  const existing = await loadAzureConnector(db, ctx.tenantId, before.connector_id)
  if (existing) await deleteConnector(ctx, String(existing.id))
  const next: WorkspaceOcrSetting = { provider: before.provider === 'azure_document_intelligence' ? 'instance_default' : before.provider, connector_id: null }
  await writeSetting(ctx, db, settings, next)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'delete',
    summary: existing ? 'Removed the Azure AI Document Intelligence key for document OCR' : 'Cleared the document OCR setting',
    diff: { 'document_ocr.provider': { before: before.provider, after: next.provider } },
    metadata: { kind: 'document_ocr', provider: next.provider, connector_id: existing ? String(existing.id) : null },
  })
  return buildView(db, ctx.tenantId)
}

export interface DocumentOcrTestInput {
  /** Test these values instead of (or on top of) the saved ones. */
  endpoint?: string | null
  key?: string | null
  api_version?: string | null
}

export interface DocumentOcrTestResult {
  status: 'success' | 'error'
  message: string
  http_status: number | null
}

/**
 * Check an Azure endpoint + key with a free call (resource info), saved or
 * typed in (unsaved values win; a blank / '__SECRET__' key uses the saved
 * one). The outcome is recorded on the saved connection and audited.
 */
export async function testDocumentOcr(ctx: ServiceContext, input: DocumentOcrTestInput = {}, options: AzureOcrOptions = {}): Promise<DocumentOcrTestResult> {
  requirePerm(ctx, 'settings.edit')
  const db = await serviceRoleClient(ctx)
  const { ocr } = await readSettings(db, ctx.tenantId)
  const existing = await loadAzureConnector(db, ctx.tenantId, ocr.connector_id)
  const storedConfig = (existing ? decryptSensitiveFields(existing.config ?? {}) : {}) as Record<string, any>
  const storedCredentials = (existing ? decryptSensitiveFields(existing.credentials ?? {}) : {}) as Record<string, any>

  let result: DocumentOcrTestResult
  let endpoint: string | null = null
  try {
    endpoint = await validateAzureEndpoint(input.endpoint ?? storedConfig.endpoint)
    const apiVersion = input.api_version === undefined || input.api_version === null ? (storedConfig.api_version ?? null) : validateApiVersion(input.api_version)
    const key = newKey(input.key) ?? (typeof storedCredentials.api_key === 'string' && storedCredentials.api_key !== SECRET_PLACEHOLDER ? storedCredentials.api_key : '')
    if (!key) throw ServiceError.validation('Enter the key to test (KEY 1 or KEY 2 from the Azure portal)')
    const probe = await testAzureOcr({ endpoint, key, apiVersion: apiVersion ?? AZURE_DI_DEFAULT_API_VERSION }, { ...options, guarded: true })
    result = { status: probe.ok ? 'success' : 'error', message: probe.message, http_status: probe.statusCode ?? null }
  } catch (error) {
    result = { status: 'error', message: (error as Error)?.message || 'Connection failed', http_status: null }
  }

  const testedSaved = existing && (input.endpoint === undefined || input.endpoint === null || endpoint === String(storedConfig.endpoint ?? '').replace(/\/+$/, '')) && !newKey(input.key)
  if (testedSaved) {
    const row = { last_tested_at: new Date().toISOString(), last_test_status: result.status, last_test_message: result.message }
    await (db as any).from('tenant_connectors').update(row).eq('id', existing.id).eq('tenant_id', ctx.tenantId)
  }
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'test',
    summary: `Tested the document OCR connection: ${result.status === 'success' ? 'connected' : 'failed'}`,
    metadata: { kind: 'document_ocr', status: result.status, http_status: result.http_status, endpoint_host: hostOf(endpoint), saved: Boolean(testedSaved) },
  })
  return result
}

/* ── Config as code (singleton `document_ocr` section) ─────────────── */

/** The manifest form: the choice and the connector it uses; never a key or endpoint (those travel with the connector, key scrubbed). */
export interface DocumentOcrManifest {
  provider: WorkspaceOcrProvider
  connector_id: string | null
}

export async function readDocumentOcrManifest(db: AnySupabaseClient, tenantId: string): Promise<DocumentOcrManifest> {
  try {
    const { data } = await (db as any).from('tenants').select('id, settings').eq('id', tenantId).maybeSingle()
    const ocr = workspaceOcrFromTenantSettings(data?.settings)
    return { provider: ocr.provider, connector_id: ocr.connector_id }
  } catch {
    return { provider: 'instance_default', connector_id: null }
  }
}

/** Validate an incoming `document_ocr` value. */
export function parseDocumentOcrManifest(value: unknown): { manifest?: DocumentOcrManifest; error?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'document_ocr must be an object' }
  const raw = value as Record<string, unknown>
  if (!isWorkspaceOcrProvider(raw.provider)) return { error: `document_ocr.provider must be one of ${WORKSPACE_OCR_PROVIDERS.join(', ')}` }
  const connectorId = typeof raw.connector_id === 'string' && raw.connector_id.trim() ? raw.connector_id.trim() : null
  return { manifest: { provider: raw.provider, connector_id: connectorId } }
}

/**
 * Apply an imported setting. `connectorId` is the LOCAL connector id (the
 * caller remaps the source id); a connector imported without its key stays
 * disabled, so OCR reports "re-enter the key" until an admin does.
 */
export async function applyDocumentOcrManifest(ctx: ServiceContext, manifest: DocumentOcrManifest, connectorId: string | null, label: string) {
  requirePerm(ctx, 'settings.edit')
  const db = await serviceRoleClient(ctx)
  const { settings, ocr: before } = await readSettings(db, ctx.tenantId)
  const connector = await loadAzureConnector(db, ctx.tenantId, connectorId)
  const next: WorkspaceOcrSetting = { provider: manifest.provider, connector_id: connector ? String(connector.id) : null }
  await writeSetting(ctx, db, settings, next)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: `Applied the document OCR setting (${manifest.provider}) from configuration (${label})`,
    diff: { 'document_ocr.provider': { before: before.provider, after: next.provider } },
    metadata: { kind: 'document_ocr', provider: next.provider, connector_id: next.connector_id },
  })
  return next
}
