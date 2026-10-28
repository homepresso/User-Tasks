/**
 * Connectors: built-in templates (lib/connectors/registry) instantiated per
 * tenant as a tenant_connectors row + a backing integration + generated
 * references. Shared by /api/v1/connectors, the MCP connectors_* tools and
 * the connector server actions.
 *
 * Credentials are write-only: stored encrypted (encryptSensitiveFields) and
 * returned masked ('__SECRET__'). Updates accept the sentinel to keep a value.
 * The GitHub-sync connection row is managed by /github-sync and hidden here.
 * Connectors are a config-as-code / GitHub-sync asset ('connectors' section:
 * non-secret config only, see applyConnectorManifest); their backing
 * integration and references are generated and never synced on their own.
 */

import { CONNECTOR_CATALOG, getConnectorDefinition, type ConnectorCategory, type ConnectorDefinition } from '@/lib/connectors/registry'
import { getMissingConnectorFields, validateConnectorFieldFormats, validateConnectorFields } from '@/lib/connectors/form-state'
import { runConnectorPreflight } from '@/lib/connectors/preflight'
import { buildConnectorTestResult } from '@/lib/connectors/test-diagnostics'
import { runConnectorProbe } from '@/lib/connectors/test-probes'
import { GITHUB_CONNECTOR_KEY } from '@/lib/github-sync/connection'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, maskSecrets, resolveSecretPlaceholders, SECRET_PLACEHOLDER, syncChange, type Page } from './_shared'
import { normalizeReferenceInput, normalizeReferenceOutput } from './references'
import { schemaFromOutputs } from '@/lib/response-schema'
import { presentIntegration } from './integrations'

/* eslint-disable @typescript-eslint/no-explicit-any -- connector config/credentials are free-form JSON */

type Values = Record<string, any>

const DATABASE_CONNECTOR_KEYS = ['postgres', 'mssql', 'mysql', 'oracle', 'snowflake', 'mongodb']

export function listConnectorCatalog(ctx: ServiceContext, filters: { category?: ConnectorCategory } = {}) {
  requirePerm(ctx, 'integrations.view')
  const connectors = CONNECTOR_CATALOG
    .filter((connector) => !filters.category || connector.category === filters.category)
    .map((connector) => ({
      key: connector.key,
      name: connector.name,
      description: connector.description,
      category: connector.category,
      docs_url: connector.docsUrl ?? null,
      fields: connector.fields,
      credential_fields: connector.credentialFields,
      reference_template_count: connector.referenceTemplates.length,
    }))
  return { connectors, count: connectors.length }
}

function requireDefinition(key: string): ConnectorDefinition {
  const definition = getConnectorDefinition(key)
  if (!definition) throw ServiceError.validation(`Unknown connector: ${key}`)
  return definition
}

/** Throws a 400 when required fields are missing or malformed. */
function validateValues(definition: ConnectorDefinition, config: Values, credentials: Values) {
  try {
    validateConnectorFields(definition.credentialFields, credentials, 'credentials')
    validateConnectorFields(definition.fields, config, 'configuration fields')
    validateConnectorFieldFormats(definition.credentialFields, credentials, 'credentials')
    validateConnectorFieldFormats(definition.fields, config, 'configuration fields')
  } catch (error: any) {
    throw ServiceError.validation(error?.message ?? 'Connector validation failed')
  }
}

function integrationConfigFor(definition: ConnectorDefinition, config: Values, credentials: Values) {
  const built = definition.buildIntegrationConfig(config, credentials)
  return { ...built, headers: { ...(built.headers ?? {}) } }
}

function referenceRowsFor(definition: ConnectorDefinition, ctx: ServiceContext, integrationId: string, label: string) {
  return definition.referenceTemplates.map((template) => ({
    integration_id: integrationId,
    tenant_id: ctx.tenantId,
    name: `${label}: ${template.name}`,
    description: template.description,
    inputs: template.inputs.map((input) => normalizeReferenceInput({ ...input, default_value: input.defaultValue ?? '' })),
    outputs: template.outputs.map((output) => normalizeReferenceOutput(output)),
    request_config: {
      method: template.method,
      path_template: template.pathTemplate,
      body_template: template.bodyTemplate ?? '',
      headers: template.headers ?? {},
      // The catalogue's declared outputs are the response's top-level fields.
      ...(template.outputs.length ? { response_schema: { version: 1, source: 'connector', root: schemaFromOutputs(template.outputs.map((output) => ({ ...output, path: output.name }))) } } : {}),
    },
  }))
}

/** Raw (still encrypted) connector row owned by the tenant. */
async function loadOwned(ctx: ServiceContext, connectorId: string) {
  const { data, error } = await ctx.supabase.from('tenant_connectors')
    .select('*, integration:integrations(id, name, type, config, is_active, last_test_status, last_tested_at, last_test_message)')
    .eq('id', connectorId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!data || data.connector_key === GITHUB_CONNECTOR_KEY) throw ServiceError.notFound('Connector not found')
  return data as any
}

/** Connector row for responses: config/credentials masked, never decrypted. */
function presentConnector(row: any) {
  return {
    id: row.id,
    connector_key: row.connector_key,
    display_name: row.display_name,
    integration_id: row.integration_id ?? null,
    config: maskSecrets(row.config ?? {}),
    credentials: maskSecrets(row.credentials ?? {}),
    is_enabled: row.is_enabled,
    last_test_status: row.last_test_status ?? null,
    last_tested_at: row.last_tested_at ?? null,
    last_test_message: row.last_test_message ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  }
}

export async function listConnectors(ctx: ServiceContext, filters: { enabled?: boolean; connectorKey?: string }, page: Page) {
  requirePerm(ctx, 'integrations.view')
  let query = ctx.supabase.from('tenant_connectors')
    .select('*', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .neq('connector_key', GITHUB_CONNECTOR_KEY)
    .order('created_at', { ascending: false })
  if (filters.enabled !== undefined) query = query.eq('is_enabled', filters.enabled)
  if (filters.connectorKey) query = query.eq('connector_key', filters.connectorKey)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { connectors: (data ?? []).map(presentConnector), total: count ?? (data ?? []).length }
}

/** Connector with its template, backing integration (masked) and generated references. */
export async function getConnector(ctx: ServiceContext, connectorId: string) {
  requirePerm(ctx, 'integrations.view')
  const connector = await loadOwned(ctx, connectorId)
  const definition = getConnectorDefinition(connector.connector_key)
  const { data: references } = connector.integration_id
    ? await ctx.supabase.from('integration_references')
      .select('id, name, description, request_config, inputs, outputs')
      .eq('integration_id', connector.integration_id)
      .eq('tenant_id', ctx.tenantId)
      .order('name')
    : { data: [] }

  return {
    connector: presentConnector(connector),
    connector_template: definition ? {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      docs_url: definition.docsUrl ?? null,
      fields: definition.fields,
      credential_fields: definition.credentialFields,
      recommended_permissions: definition.recommendedPermissions ?? null,
    } : null,
    integration: connector.integration ? presentIntegration(connector.integration) : null,
    references: (references ?? []).map((ref: any) => ({ ...ref, request_config: maskSecrets(ref.request_config ?? {}) })),
  }
}

export interface ConnectorCreateInput {
  connector_key: string
  display_name?: string
  config?: Values
  credentials?: Values
}

/**
 * Insert the backing integration, the tenant connector and its templated
 * references (all rolled back on failure). `enabled` = false creates both
 * the connector and its integration switched off.
 */
async function insertConnector(
  ctx: ServiceContext,
  definition: ConnectorDefinition,
  label: string,
  config: Values,
  credentials: Values,
  enabled: boolean,
) {
  const { data: integration, error: intError } = await ctx.supabase.from('integrations').insert({
    tenant_id: ctx.tenantId,
    name: `${label} (Connector)`,
    type: definition.key,
    // Encrypt credential fields (tokens, passwords, keys) at rest
    config: encryptSensitiveFields(integrationConfigFor(definition, config, credentials)),
    is_active: enabled,
    tags: [definition.key.replace(/_/g, '-')],
    created_by: ctx.actorId,
  }).select('id, name, type').single()
  if (intError || !integration) throw dbError(intError, 'Failed to create integration')

  try {
    const { data: connector, error: connError } = await ctx.supabase.from('tenant_connectors').insert({
      tenant_id: ctx.tenantId,
      connector_key: definition.key,
      display_name: label,
      config: encryptSensitiveFields(config),
      credentials: encryptSensitiveFields(credentials),
      integration_id: integration.id,
      is_enabled: enabled,
      created_by: ctx.actorId,
    }).select('id').single()
    if (connError || !connector) throw dbError(connError, 'Failed to create connector')

    const rows = referenceRowsFor(definition, ctx, integration.id, label)
    let references: Array<{ id: string; name: string }> = []
    if (rows.length > 0) {
      const { data: inserted, error: refError } = await ctx.supabase.from('integration_references').insert(rows).select('id, name')
      if (refError) throw dbError(refError)
      references = (inserted ?? []) as Array<{ id: string; name: string }>
    }
    return { connectorId: connector.id as string, integration: integration as { id: string; name: string; type: string }, references }
  } catch (error) {
    await ctx.supabase.from('tenant_connectors').delete().eq('integration_id', integration.id).eq('tenant_id', ctx.tenantId)
    await ctx.supabase.from('integration_references').delete().eq('integration_id', integration.id).eq('tenant_id', ctx.tenantId)
    await ctx.supabase.from('integrations').delete().eq('id', integration.id).eq('tenant_id', ctx.tenantId)
    throw error
  }
}

/** Enable a connector: backing integration + tenant connector + templated references (rolled back on failure). */
export async function createConnector(ctx: ServiceContext, input: ConnectorCreateInput) {
  requirePerm(ctx, 'integrations.create')
  const definition = requireDefinition(input.connector_key)
  // Tolerate round-tripped, already-encrypted values from edit UIs
  const config = decryptSensitiveFields(input.config ?? {})
  const credentials = decryptSensitiveFields(input.credentials ?? {})
  validateValues(definition, config, credentials)
  const label = input.display_name?.trim() || definition.name

  const created = await insertConnector(ctx, definition, label, config, credentials, true)
  await audit(ctx, {
    objectType: 'integration', objectId: created.connectorId, action: 'create',
    summary: `Enabled ${definition.name} connector "${label}"`,
    metadata: { kind: 'connector', connector_key: input.connector_key, integration_id: created.integration.id },
  })
  await syncChange(ctx, 'connector', { id: created.connectorId, name: label })
  return {
    connector: { id: created.connectorId, key: input.connector_key, display_name: label },
    integration: created.integration,
    references_created: created.references.length,
  }
}

export interface ConnectorUpdateInput {
  display_name?: string
  config?: Values
  credentials?: Values
  enabled?: boolean
  regenerate_references?: boolean
}

async function replaceReferences(ctx: ServiceContext, definition: ConnectorDefinition, integrationId: string, label: string) {
  const { error: deleteError } = await ctx.supabase.from('integration_references')
    .delete().eq('integration_id', integrationId).eq('tenant_id', ctx.tenantId)
  if (deleteError) throw dbError(deleteError)
  const rows = referenceRowsFor(definition, ctx, integrationId, label)
  if (rows.length > 0) {
    const { error } = await ctx.supabase.from('integration_references').insert(rows)
    if (error) throw dbError(error)
  }
  return rows.length
}

/**
 * Update a connector and keep its backing integration in step.
 *  - mode 'merge' (API/MCP): config/credentials are patched over the stored values.
 *  - mode 'replace' (settings UI): the given objects replace the stored ones.
 * Either way '__SECRET__' sentinels keep the stored value.
 */
export async function updateConnector(
  ctx: ServiceContext,
  connectorId: string,
  input: ConnectorUpdateInput,
  options: { mode?: 'merge' | 'replace' } = {},
) {
  requirePerm(ctx, 'integrations.edit')
  const connector = await loadOwned(ctx, connectorId)
  const definition = requireDefinition(connector.connector_key)
  const mode = options.mode ?? 'merge'

  // Decrypt both the stored row and any round-tripped values so validation
  // and buildIntegrationConfig always operate on plaintext.
  const storedConfig = decryptSensitiveFields(connector.config ?? {})
  const storedCredentials = decryptSensitiveFields(connector.credentials ?? {})
  const next = (stored: Values, incoming: Values | undefined) => {
    if (incoming === undefined) return stored
    const resolved = decryptSensitiveFields(resolveSecretPlaceholders(incoming, stored))
    return mode === 'merge' ? { ...stored, ...resolved } : resolved
  }
  const nextConfig = next(storedConfig, input.config)
  const nextCredentials = next(storedCredentials, input.credentials)
  validateValues(definition, nextConfig, nextCredentials)

  const label = input.display_name?.trim() || connector.display_name || definition.name
  const connectorUpdates: Values = { updated_at: new Date().toISOString() }
  if (input.display_name !== undefined) connectorUpdates.display_name = label
  if (input.config !== undefined) connectorUpdates.config = encryptSensitiveFields(nextConfig)
  if (input.credentials !== undefined) connectorUpdates.credentials = encryptSensitiveFields(nextCredentials)
  if (input.enabled !== undefined) connectorUpdates.is_enabled = input.enabled

  const { error: connectorError } = await ctx.supabase.from('tenant_connectors')
    .update(connectorUpdates).eq('id', connectorId).eq('tenant_id', ctx.tenantId)
  if (connectorError) throw dbError(connectorError)

  if (connector.integration_id) {
    const integrationUpdates: Values = {}
    if (input.config !== undefined || input.credentials !== undefined) {
      integrationUpdates.config = encryptSensitiveFields(integrationConfigFor(definition, nextConfig, nextCredentials))
    }
    if (input.enabled !== undefined) integrationUpdates.is_active = input.enabled
    if (input.display_name !== undefined) integrationUpdates.name = `${label} (Connector)`
    if (Object.keys(integrationUpdates).length > 0) {
      const { error } = await ctx.supabase.from('integrations')
        .update(integrationUpdates).eq('id', connector.integration_id).eq('tenant_id', ctx.tenantId)
      if (error) throw dbError(error)
    }
  }

  let referencesRegenerated = 0
  if (input.regenerate_references) {
    if (!connector.integration_id) throw ServiceError.validation('Connector has no linked integration')
    referencesRegenerated = await replaceReferences(ctx, definition, connector.integration_id, label)
  }

  await audit(ctx, {
    objectType: 'integration', objectId: connectorId, action: 'update',
    summary: `Updated connector "${label}"`,
    metadata: {
      kind: 'connector', connector_key: connector.connector_key,
      fields: Object.keys(input).filter((key) => (input as Values)[key] !== undefined),
    },
  })
  await syncChange(ctx, 'connector', { id: connectorId, name: label })
  return {
    id: connectorId,
    display_name: label,
    enabled: input.enabled ?? connector.is_enabled,
    references_regenerated: Boolean(input.regenerate_references),
    reference_count: input.regenerate_references ? referencesRegenerated : undefined,
  }
}

/** Enable/disable the connector and its backing integration. */
export async function setConnectorEnabled(ctx: ServiceContext, connectorId: string, enabled: boolean) {
  requirePerm(ctx, 'integrations.edit')
  const connector = await loadOwned(ctx, connectorId)
  const { error } = await ctx.supabase.from('tenant_connectors')
    .update({ is_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', connectorId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  if (connector.integration_id) {
    const { error: intError } = await ctx.supabase.from('integrations')
      .update({ is_active: enabled }).eq('id', connector.integration_id).eq('tenant_id', ctx.tenantId)
    if (intError) throw dbError(intError)
  }
  await audit(ctx, {
    objectType: 'integration', objectId: connectorId, action: 'toggle',
    summary: `${enabled ? 'Enabled' : 'Disabled'} connector "${connector.display_name ?? connector.connector_key}"`,
    metadata: { kind: 'connector', connector_key: connector.connector_key, enabled },
  })
  await syncChange(ctx, 'connector', { id: connectorId, name: connector.display_name })
  return { id: connectorId, enabled }
}

/** Delete the connector, its generated references and its backing integration. */
export async function deleteConnector(ctx: ServiceContext, connectorId: string) {
  requirePerm(ctx, 'integrations.delete')
  const connector = await loadOwned(ctx, connectorId)
  if (connector.integration_id) {
    const { error } = await ctx.supabase.from('integration_references')
      .delete().eq('integration_id', connector.integration_id).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  }
  const { error: connectorError } = await ctx.supabase.from('tenant_connectors')
    .delete().eq('id', connectorId).eq('tenant_id', ctx.tenantId)
  if (connectorError) throw dbError(connectorError)
  if (connector.integration_id) {
    const { error } = await ctx.supabase.from('integrations')
      .delete().eq('id', connector.integration_id).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  }
  await audit(ctx, {
    objectType: 'integration', objectId: connectorId, action: 'delete',
    summary: `Deleted connector "${connector.display_name ?? connector.connector_key}"`,
    metadata: { kind: 'connector', connector_key: connector.connector_key, integration_id: connector.integration_id ?? null },
  })
  await syncChange(ctx, 'connector', { id: connectorId, name: connector.display_name }, 'delete')
  return { deleted: true as const, id: connectorId, integration_id: (connector.integration_id ?? null) as string | null }
}

/** Replace the generated references with the current template set. */
export async function regenerateConnectorReferences(ctx: ServiceContext, connectorId: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const connector = await loadOwned(ctx, connectorId)
  if (!connector.integration_id) throw ServiceError.validation('Connector has no linked integration')
  const definition = requireDefinition(connector.connector_key)
  const count = await replaceReferences(ctx, definition, connector.integration_id, connector.display_name || definition.name)
  await audit(ctx, {
    objectType: 'integration', objectId: connectorId, action: 'update',
    summary: `Regenerated ${count} reference(s) for connector "${connector.display_name ?? definition.name}"`,
    metadata: { kind: 'connector', connector_key: connector.connector_key, reference_count: count },
  })
  return { id: connectorId, count }
}

export interface ConnectorTestResult {
  status: string
  message: string
  hint?: string
  [key: string]: unknown
}

/**
 * Test connector values (saved or not): field validation → preflight →
 * database connection test or connector-specific HTTP probe (egress guarded).
 * With `connectorId` the outcome is recorded on the connector and its
 * backing integration.
 */
export async function testConnector(
  ctx: ServiceContext,
  input: { connector_key: string; config?: Values; credentials?: Values; connector_id?: string },
): Promise<ConnectorTestResult> {
  requirePerm(ctx, 'integrations.test')
  const definition = requireDefinition(input.connector_key)
  const owned = input.connector_id ? await loadOwned(ctx, input.connector_id) : null
  if (owned && owned.connector_key !== input.connector_key) throw ServiceError.validation('connector_key does not match the connector')
  // Edit UIs round-trip stored (encrypted-at-rest) values — decrypt before validating/probing
  const config = decryptSensitiveFields(input.config ?? {})
  const credentials = decryptSensitiveFields(input.credentials ?? {})
  validateValues(definition, config, credentials)

  const record = async (result: ConnectorTestResult) => {
    if (!owned) return
    const row = {
      last_tested_at: new Date().toISOString(),
      last_test_status: result.status,
      last_test_message: result.hint ? `${result.message} Hint: ${result.hint}` : result.message,
    }
    await ctx.supabase.from('tenant_connectors').update(row).eq('id', owned.id).eq('tenant_id', ctx.tenantId)
    if (owned.integration_id) {
      await ctx.supabase.from('integrations').update(row).eq('id', owned.integration_id).eq('tenant_id', ctx.tenantId)
    }
  }

  const preflight = runConnectorPreflight(input.connector_key, config, credentials) as ConnectorTestResult | null
  if (preflight) {
    await record(preflight)
    return preflight
  }

  const integrationConfig = definition.buildIntegrationConfig(config, credentials) as any
  let result: ConnectorTestResult
  try {
    const isDatabase = integrationConfig.headers?._executor === 'database' ||
      DATABASE_CONNECTOR_KEYS.includes(input.connector_key) ||
      /^(postgresql|mssql|mysql|oracle|mongodb|snowflake):\/\//.test(integrationConfig.base_url ?? '')

    if (isDatabase) {
      const { parseDbConfig, testConnection } = await import('@/lib/db-connector')
      const dbConfig = parseDbConfig({
        ...integrationConfig,
        auth_config: {
          ...(integrationConfig.auth_config ?? {}),
          username: credentials.username || integrationConfig.auth_config?.username || '',
          password: credentials.password || integrationConfig.auth_config?.password || '',
        },
      })
      if (!dbConfig) return buildConnectorTestResult(input.connector_key, 'The connector configuration is incomplete for database testing.') as ConnectorTestResult
      const db = await testConnection(dbConfig)
      result = buildConnectorTestResult(input.connector_key, db.message, db.success ? 'success' : 'error') as ConnectorTestResult
    } else {
      const testUrl = integrationConfig.base_url
      if (!testUrl || (!testUrl.startsWith('http://') && !testUrl.startsWith('https://'))) {
        return { status: 'error', message: `Invalid base URL: ${testUrl || '(empty)'}. Expected http:// or https://` }
      }
      const probe = await runConnectorProbe(input.connector_key, config, credentials, integrationConfig)
      result = buildConnectorTestResult(input.connector_key, probe.message, probe.ok ? 'success' : 'error', probe.statusCode) as ConnectorTestResult
    }
  } catch (error: any) {
    result = buildConnectorTestResult(input.connector_key, error?.message || 'Connection failed') as ConnectorTestResult
  }
  await record(result)
  return result
}

/** Test a saved connector with its stored values. */
export async function testSavedConnector(ctx: ServiceContext, connectorId: string) {
  requirePerm(ctx, 'integrations.test')
  const connector = await loadOwned(ctx, connectorId)
  return testConnector(ctx, {
    connector_key: connector.connector_key,
    config: connector.config ?? {},
    credentials: connector.credentials ?? {},
    connector_id: connectorId,
  })
}

// ─── Config as code ─────────────────────────────────────────────────────────
//
// The manifest 'connectors' section (lib/portability/export.ts) carries the
// non-secret part of a tenant connector: credentials are always '__SECRET__'
// and the generated integration/references travel only as ids (for remapping
// workflows that use them), never as assets of their own.

/** A 'connectors' manifest asset. */
export interface ConnectorManifestAsset {
  id?: string
  name: string
  connector_key: string
  config?: Values
  credentials?: Values
  is_enabled?: boolean
  generated_integration_id?: string | null
  generated_references?: Array<{ id: string; name: string }>
}

/** Only the definition's credential keys travel (or are accepted). */
function pickCredentials(definition: ConnectorDefinition, credentials: Values): Values {
  const keys = new Set(definition.credentialFields.map((field) => field.key))
  return Object.fromEntries(Object.entries(credentials ?? {}).filter(([key]) => keys.has(key)))
}

/** Required credential keys that are blank (or still a placeholder) for these values. */
export function connectorMissingCredentials(connectorKey: string, credentials: Values): string[] {
  const definition = getConnectorDefinition(connectorKey)
  if (!definition) return []
  const values = Object.fromEntries(Object.entries(credentials ?? {}).filter(([, value]) => value !== SECRET_PLACEHOLDER))
  return getMissingConnectorFields(definition.credentialFields, values).map((field) => field.key)
}

/** Name of a generated reference without its connector label ("Slack: Send Message" → "Send Message"). */
function templateSuffix(name: string, label: string): string {
  const prefix = `${label}: `
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/**
 * source → local ids of a connector's generated integration and references
 * (matched by template name), so workflows/agents using them remap.
 */
export async function connectorGeneratedIdMap(ctx: ServiceContext, asset: ConnectorManifestAsset, localConnectorId: string) {
  const integration: Record<string, string> = {}
  const reference: Record<string, string> = {}
  const { data: local } = await ctx.supabase.from('tenant_connectors')
    .select('id, display_name, integration_id').eq('id', localConnectorId).eq('tenant_id', ctx.tenantId).maybeSingle()
  const integrationId = (local as any)?.integration_id as string | null | undefined
  if (!integrationId) return { integration, reference }
  if (asset.generated_integration_id) integration[asset.generated_integration_id] = integrationId
  const incoming = Array.isArray(asset.generated_references) ? asset.generated_references : []
  if (incoming.length) {
    const { data: refs } = await ctx.supabase.from('integration_references')
      .select('id, name').eq('integration_id', integrationId).eq('tenant_id', ctx.tenantId)
    const byTemplate = new Map<string, string>()
    for (const ref of (refs ?? []) as Array<{ id: string; name: string }>) {
      byTemplate.set(templateSuffix(String(ref.name), String((local as any).display_name ?? '')), String(ref.id))
    }
    for (const ref of incoming) {
      const localId = ref?.id ? byTemplate.get(templateSuffix(String(ref.name ?? ''), asset.name)) : undefined
      if (localId) reference[ref.id] = localId
    }
  }
  return { integration, reference }
}

/**
 * Create or update a connector from a manifest asset (config apply, GitHub
 * deploy). '__SECRET__' keeps the stored credential on update and is dropped
 * on create; real values (e.g. CLI `${env:}` substitution) are encrypted and
 * stored. A connector whose required credentials end up missing is written
 * DISABLED (connector and integration) with a "needs credentials" warning,
 * whatever the manifest says about is_enabled. Generated references are
 * built from the definition on create and left in place on update (their
 * ids are referenced by workflows). Audit and sync capture are left to the
 * caller (one entry per apply).
 */
export async function applyConnectorManifest(ctx: ServiceContext, asset: ConnectorManifestAsset, existingId: string | null) {
  const definition = requireDefinition(String(asset?.connector_key ?? ''))
  const label = String(asset.name ?? '').trim() || definition.name
  const warnings: string[] = []
  const validateConfig = (config: Values, credentials: Values) => {
    try {
      validateConnectorFields(definition.fields, config, 'configuration fields')
      validateConnectorFieldFormats(definition.credentialFields, credentials, 'credentials')
      validateConnectorFieldFormats(definition.fields, config, 'configuration fields')
    } catch (error: any) {
      throw ServiceError.validation(error?.message ?? 'Connector validation failed')
    }
  }
  const needsCredentials = (credentials: Values, verb: string) => {
    const missing = getMissingConnectorFields(definition.credentialFields, credentials).map((field) => field.key)
    if (missing.length) warnings.push(`Connector "${label}" needs credentials (${missing.join(', ')}); ${verb} disabled — set them and enable it`)
    return missing.length > 0
  }

  let connectorId: string
  let created = false
  if (!existingId) {
    requirePerm(ctx, 'integrations.create')
    const config = decryptSensitiveFields(resolveSecretPlaceholders(asset.config ?? {}))
    const credentials = pickCredentials(definition, decryptSensitiveFields(resolveSecretPlaceholders(asset.credentials ?? {})))
    validateConfig(config, credentials)
    const enabled = !needsCredentials(credentials, 'created') && asset.is_enabled !== false
    const inserted = await insertConnector(ctx, definition, label, config, credentials, enabled)
    connectorId = inserted.connectorId
    created = true
  } else {
    requirePerm(ctx, 'integrations.edit')
    const connector = await loadOwned(ctx, existingId)
    if (connector.connector_key !== definition.key) {
      throw ServiceError.validation(`connector_key cannot change (local connector is ${connector.connector_key})`)
    }
    const storedConfig = decryptSensitiveFields(connector.config ?? {})
    const storedCredentials = decryptSensitiveFields(connector.credentials ?? {})
    // Config is replaced by the manifest's; credentials merge, so a key left
    // out of a file never wipes a stored secret.
    const config = asset.config === undefined ? storedConfig : decryptSensitiveFields(resolveSecretPlaceholders(asset.config, storedConfig))
    const credentials = asset.credentials === undefined ? storedCredentials
      : { ...storedCredentials, ...pickCredentials(definition, decryptSensitiveFields(resolveSecretPlaceholders(asset.credentials, storedCredentials))) }
    validateConfig(config, credentials)
    const enabled = !needsCredentials(credentials, 'kept') && (asset.is_enabled ?? connector.is_enabled) !== false

    const { error } = await ctx.supabase.from('tenant_connectors').update({
      display_name: label,
      config: encryptSensitiveFields(config),
      credentials: encryptSensitiveFields(credentials),
      is_enabled: enabled,
      updated_at: new Date().toISOString(),
    }).eq('id', existingId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
    if (connector.integration_id) {
      const { error: intError } = await ctx.supabase.from('integrations').update({
        name: `${label} (Connector)`,
        config: encryptSensitiveFields(integrationConfigFor(definition, config, credentials)),
        is_active: enabled,
      }).eq('id', connector.integration_id).eq('tenant_id', ctx.tenantId)
      if (intError) throw dbError(intError)
    }
    connectorId = existingId
  }

  const idMap = await connectorGeneratedIdMap(ctx, asset, connectorId)
  return { id: connectorId, created, warnings, idMap }
}
