/**
 * Custom references (lib/custom-references): building them from an
 * integration's operations or a database table, saving them through the
 * normal reference service (so API, MCP, CLI, audit and GitHub sync all
 * apply), previewing drafts through the real executor, and "Duplicate as
 * custom".
 *
 * The source request is MATERIALISED on the server at save: a builder or API
 * caller names the source (an existing reference, a connector catalogue
 * operation, a stored OpenAPI operation, or a method + path on the
 * integration) and the server copies the request from it — a client never
 * supplies hosts or credentials.
 *
 * Write kinds (Create, Update, Upsert, Delete, Execute) need Manage
 * references like every custom reference. Their Test is a dry run: a
 * database write runs in a transaction that is always rolled back; a REST
 * write is rendered and shown, and only sent when the author confirms
 * ("Send for real") — every real send is in the call log.
 */

import { getConnectorDefinition } from '@/lib/connectors/registry'
import { templateHash } from '@/lib/connectors/reference-upgrade'
import { connectorTemplateVars } from '@/lib/connectors/template-vars'
import { CustomReferenceError, publicInputRows } from '@/lib/custom-references/inputs'
import { customOutputModel, sourceItemSchema, sqlTypeToSchemaType } from '@/lib/custom-references/model'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { sourceRequestConfig } from '@/lib/custom-references/run'
import { describeShaping } from '@/lib/custom-references/shaping'
import { CUSTOM_ORIGIN, isCustomReference, isWriteKind, type CustomReferenceConfig, type SourceInputDef } from '@/lib/custom-references/types'
import { executeReference as runReference, settingsFromConfig } from '@/lib/reference-executor'
import { autoPickCollection, collectionItemFields, findCollections, runtimeView, unwrapExecutorResult } from '@/lib/response-collections'
import { captureResponseSample, normalizeResponseSchema, referenceResponseSchema } from '@/lib/response-schema'
import { isSensitiveKey } from '@/lib/secret-keys'
import { EgressBlockedError } from '@/lib/egress-guard'
import { truncateForStorage } from '@/lib/truncate'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are free-form JSON */

const DB_URL = /^(postgresql|postgres|mssql|mysql|oracle|mongodb|snowflake):\/\//i
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.$-]{1,100})\s*\}\}/g

async function loadIntegration(ctx: ServiceContext, integrationId: string) {
  const { data, error } = await ctx.supabase.from('integrations')
    .select('id, name, type, config').eq('id', integrationId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Integration not found')
  return data as { id: string; name: string; type: string; config: any }
}

export function isDatabaseIntegration(integration: { type?: string; config?: any }): boolean {
  const config = integration.config ?? {}
  return integration.type === 'database' || !!config.db_config || config.headers?._executor === 'database' || DB_URL.test(String(config.base_url ?? ''))
}

/** Names of the integration's settings a Fixed input may use (never their values). */
async function settingCatalog(ctx: ServiceContext, integration: { id: string; type: string; config: any }) {
  const names = new Set<string>(Object.keys(settingsFromConfig(integration.config ?? {})))
  const stored = integration.config?.template_vars
  if (stored && typeof stored === 'object') for (const key of Object.keys(stored)) names.add(key)
  else {
    const definition = getConnectorDefinition(String(integration.type))
    if (definition) {
      const { data } = await ctx.supabase.from('tenant_connectors').select('config, credentials')
        .eq('integration_id', integration.id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (data) for (const key of Object.keys(connectorTemplateVars(definition, (data as any).config ?? {}, (data as any).credentials ?? {}))) names.add(key)
    }
  }
  const secret = new Set(Array.from(names).filter((name) => isSensitiveKey(name)))
  return { names, secret, list: Array.from(names).sort().map((name) => ({ name, secret: secret.has(name) })) }
}

function sourceInputsFrom(inputs: any[]): SourceInputDef[] {
  return (inputs ?? []).map((input: any) => ({
    ...(input.id ? { id: String(input.id) } : {}),
    name: String(input.name),
    type: String(input.type ?? 'string'),
    required: Boolean(input.required),
    default_value: input.default_value ?? input.defaultValue ?? '',
    description: String(input.description ?? ''),
    location: String(input.location ?? 'query'),
  }))
}

/** Inputs of a hand-written endpoint: its {{placeholders}} (path ones are path inputs) plus declared query parameters. */
function endpointInputs(path: string, body: string, declared: any[]): SourceInputDef[] {
  const out = new Map<string, SourceInputDef>()
  const pathPart = path.split('?')[0]
  for (const m of path.matchAll(PLACEHOLDER)) out.set(m[1], { name: m[1], type: 'string', required: pathPart.includes(m[0]), location: pathPart.includes(m[0]) ? 'path' : 'query' })
  for (const m of body.matchAll(PLACEHOLDER)) if (!out.has(m[1])) out.set(m[1], { name: m[1], type: 'string', location: 'body' })
  for (const d of declared ?? []) {
    const name = String(d?.name ?? '').trim()
    if (!/^[A-Za-z0-9_.$-]{1,100}$/.test(name) || out.has(name)) continue
    out.set(name, { name, type: String(d?.type ?? 'string'), required: Boolean(d?.required), default_value: d?.default_value ?? '', location: d?.location === 'header' ? 'header' : 'query' })
  }
  return Array.from(out.values())
}

interface MaterializedSource {
  request: Record<string, any>
  inputs: SourceInputDef[]
  from?: 'reference' | 'template' | 'openapi' | 'endpoint'
  label?: string
  key?: string
  /** The source's own response model (types the columns). */
  model?: any
}

async function materializeSource(ctx: ServiceContext, integration: any, rawSource: any, existing: any | null): Promise<MaterializedSource | null> {
  if (rawSource?.type === 'table') {
    if (!isDatabaseIntegration(integration)) throw ServiceError.validation('Table sources need a database integration')
    return { request: { method: 'POST', path_template: '/_internal/db/query', body_template: '' }, inputs: [] }
  }
  const referenceId = String(rawSource?.reference_id ?? '').trim()
  if (referenceId) {
    const { data, error } = await ctx.supabase.from('integration_references')
      .select('id, name, integration_id, inputs, request_config, outputs').eq('id', referenceId).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (error) throw dbError(error)
    if (!data || (data as any).integration_id !== integration.id) throw ServiceError.validation('The source reference must belong to this integration')
    if (isCustomReference(data as any)) throw ServiceError.validation('A custom reference cannot be the source of another — pick the operation it is built on')
    return { request: sourceRequestConfig((data as any).request_config), inputs: sourceInputsFrom((data as any).inputs), from: 'reference', label: (data as any).name, model: referenceResponseSchema(data as any) }
  }
  if (rawSource?.from === 'template' && rawSource?.key) {
    const definition = getConnectorDefinition(String(integration.type))
    const template = definition?.referenceTemplates.find((t) => t.key === rawSource.key)
    if (!template) throw ServiceError.validation(`This integration has no catalogue operation "${String(rawSource.key)}"`)
    return {
      request: {
        method: template.method,
        path_template: template.pathTemplate,
        body_template: template.bodyTemplate ?? '',
        headers: template.headers ?? {},
        typed_placeholders: true,
        connector_template: { key: template.key, hash: templateHash(template) },
        ...(template.baseUrl ? { base_url: template.baseUrl } : {}),
      },
      inputs: sourceInputsFrom(template.inputs.map((i) => ({ ...i, default_value: i.defaultValue ?? '' }))),
      from: 'template',
      label: template.name,
      key: template.key,
    }
  }
  if (rawSource?.from === 'openapi' && rawSource?.key) {
    const ops: any[] = Array.isArray(integration.config?.api_operations) ? integration.config.api_operations : []
    const op = ops.find((o) => o?.key === rawSource.key)
    if (!op) throw ServiceError.validation(`This integration has no stored API operation "${String(rawSource.key)}"`)
    return {
      request: { method: String(op.method ?? 'GET').toUpperCase(), path_template: String(op.path_template ?? ''), body_template: String(op.body_template ?? ''), headers: op.headers ?? {} },
      inputs: sourceInputsFrom(op.inputs ?? []),
      from: 'openapi',
      label: String(op.name ?? op.key),
      key: String(op.key),
      model: normalizeResponseSchema(op.response_schema),
    }
  }
  if (rawSource?.from === 'endpoint' && rawSource?.path_template !== undefined) {
    const method = String(rawSource.method ?? 'GET').toUpperCase()
    if (!METHODS.has(method)) throw ServiceError.validation(`Unsupported method "${method}"`)
    const path = String(rawSource.path_template ?? '').trim()
    if (!path.startsWith('/') || /^\/\/|:\/\//.test(path) || path.length > 2000) throw ServiceError.validation('The endpoint path must start with "/" and stay on the integration\'s base URL')
    const body = String(rawSource.body_template ?? '').slice(0, 20000)
    return { request: { method, path_template: path, body_template: body, headers: {} }, inputs: endpointInputs(path, body, rawSource.inputs), from: 'endpoint', label: `${method} ${path}` }
  }
  // No new source named: keep the stored one (edits that only change the shaping).
  if (existing && isCustomReference(existing)) {
    const stored = existing.request_config.custom.source
    return { request: sourceRequestConfig(existing.request_config), inputs: stored?.inputs ?? [], from: stored?.from, label: stored?.label, key: stored?.key }
  }
  return null
}

export interface CustomReferenceRaw {
  name?: string
  description?: string | null
  /** The shaping config (CustomReferenceConfig, with `source` naming what to build from). */
  custom: any
  /** API callers creating from scratch may pass the source request directly (no hosts: base_url is dropped). */
  request_config?: Record<string, any>
}

/** Build the stored row fields of a custom reference. */
export async function materializeCustomReference(
  ctx: ServiceContext,
  integrationId: string,
  raw: CustomReferenceRaw,
  existing: any | null = null,
  options: { draft?: boolean } = {},
): Promise<{ request_config: Record<string, any>; inputs: any[]; outputs: any[]; config: CustomReferenceConfig }> {
  const integration = await loadIntegration(ctx, integrationId)
  const custom = raw.custom && typeof raw.custom === 'object' ? raw.custom : null
  if (!custom) throw ServiceError.validation('custom (the custom reference config) is required')
  let source = await materializeSource(ctx, integration, custom.source, existing)
  if (!source && custom.source?.type !== 'table') {
    const rc = raw.request_config ?? {}
    if (!rc.path_template) throw ServiceError.validation('Name the source: source.reference_id, a catalogue/OpenAPI operation key, or a method + path_template')
    const { base_url: _dropped, ...request } = sourceRequestConfig(rc)
    void _dropped
    source = { request, inputs: sourceInputsFrom(custom.source?.inputs ?? []), from: 'endpoint' }
  }
  const settings = await settingCatalog(ctx, integration)
  let config: CustomReferenceConfig
  try {
    const sourceRaw = custom.source?.type === 'table'
      ? custom.source
      : { ...custom.source, type: 'operation', inputs: source!.inputs, from: source!.from, label: source!.label, key: source!.key }
    config = normalizeCustomConfig({ ...custom, source: sourceRaw }, { settingNames: settings.names, secretSettings: settings.secret, allowNoColumns: options.draft })
  } catch (error: any) {
    if (error instanceof CustomReferenceError) throw ServiceError.validation(error.message)
    throw error
  }
  if (config.kind === 'execute' && config.source.type === 'table') config.write = { ...config.write, procedure: await verifiedProcedure(integration, config) }
  const sourceModel = normalizeResponseSchema(custom.source_model) ?? source?.model ?? null
  const itemSchema = sourceItemSchema(sourceModel ? runtimeViewModel(sourceModel) : null, config.rows_path)
  const model = customOutputModel(config, itemSchema, existing?.outputs ?? [])
  return {
    request_config: {
      ...(source?.request ?? {}),
      // Table writes run through the write path (shown as such in the Call reference step).
      ...(config.source.type === 'table' && isWriteKind(config.kind) ? { path_template: '/_internal/db/write' } : {}),
      origin: CUSTOM_ORIGIN, custom: config, response_schema: model.response_schema,
    },
    inputs: publicInputRows(config, existing?.inputs ?? []),
    outputs: model.outputs,
    config,
  }
}

/** Database introspection used by the builder and the Execute check (replaceable in tests). */
export const customReferenceDb = {
  routines: async (integration: { config: any }) => {
    const { listStoredProcedures, parseDbConfig } = await import('@/lib/db-connector')
    const conn = parseDbConfig(integration.config ?? {})
    if (!conn) throw ServiceError.validation('The database integration is missing connection details')
    return (await listStoredProcedures(conn)).map((r: any) => ({
      schema: String(r.schema ?? r.SCHEMA ?? ''),
      name: String(r.name ?? r.NAME ?? ''),
      type: /proc/i.test(String(r.type ?? r.TYPE ?? '')) ? 'procedure' as const : 'function' as const,
    }))
  },
  parameters: async (integration: { config: any }, schema: string, name: string) => {
    const { discoverParameters, parseDbConfig } = await import('@/lib/db-connector')
    const conn = parseDbConfig(integration.config ?? {})
    if (!conn) throw ServiceError.validation('The database integration is missing connection details')
    return (await discoverParameters(conn, schema, name)).filter((p) => p.name).map((p) => ({ name: String(p.name).replace(/^@/, ''), type: String(p.type ?? ''), is_output: Boolean(p.isOutput) }))
  },
}

/**
 * Execute on a database: the procedure / function must exist, and its
 * parameters (names, types, OUT) come from introspection — the saved names
 * are only kept when the database knows them.
 */
async function verifiedProcedure(integration: any, config: CustomReferenceConfig) {
  const proc = config.write?.procedure
  if (!proc) throw ServiceError.validation('Pick the stored procedure or function to run')
  let routines: Awaited<ReturnType<typeof customReferenceDb.routines>>
  try {
    routines = await customReferenceDb.routines(integration)
  } catch (error: any) {
    if (error instanceof ServiceError) throw error
    throw ServiceError.validation(`Could not read the database's procedures: ${String(error?.message ?? error).slice(0, 200)}`)
  }
  const same = (a: string | undefined, b: string | undefined) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
  const routine = routines.find((r) => same(r.name, proc.name) && (!proc.schema || same(r.schema, proc.schema)))
  if (!routine) throw ServiceError.validation(`The database has no procedure or function "${proc.schema ? `${proc.schema}.` : ''}${proc.name}"`)
  const declared = await customReferenceDb.parameters(integration, routine.schema, routine.name)
  const byName = new Map(declared.map((p) => [p.name.toLowerCase(), p]))
  for (const p of proc.params) if (!byName.has(p.name.replace(/^@/, '').toLowerCase())) throw ServiceError.validation(`"${routine.name}" has no parameter "${p.name}"`)
  const given = new Map(proc.params.map((p) => [p.name.replace(/^@/, '').toLowerCase(), p]))
  return {
    schema: routine.schema,
    name: routine.name,
    routine_type: routine.type,
    params: declared.map((p) => {
      const value = given.get(p.name.toLowerCase())?.value
      return { name: p.name, ...(p.type ? { type: p.type } : {}), ...(p.is_output ? { is_output: true } : value !== undefined ? { value } : {}) }
    }),
  }
}

/** Builder: the database's procedures and functions (Execute). */
export async function customReferenceRoutines(ctx: ServiceContext, integrationId: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const integration = await loadIntegration(ctx, integrationId)
  if (!isDatabaseIntegration(integration)) throw ServiceError.validation('Procedures need a database integration')
  try {
    return { routines: await customReferenceDb.routines(integration) }
  } catch (error: any) {
    if (error instanceof ServiceError) throw error
    throw ServiceError.validation(`Could not read the database's procedures: ${String(error?.message ?? error).slice(0, 200)}`)
  }
}

/** Builder: the parameters of one procedure / function (Execute). */
export async function customReferenceRoutineParams(ctx: ServiceContext, integrationId: string, schema: string, name: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const integration = await loadIntegration(ctx, integrationId)
  if (!isDatabaseIntegration(integration)) throw ServiceError.validation('Procedures need a database integration')
  try {
    return { params: await customReferenceDb.parameters(integration, String(schema ?? ''), String(name ?? '')) }
  } catch (error: any) {
    if (error instanceof ServiceError) throw error
    throw ServiceError.validation(`Could not read the parameters: ${String(error?.message ?? error).slice(0, 200)}`)
  }
}

/** A model as the runtime sees it (a wrapped `{ status, data }` sample unwrapped). */
function runtimeViewModel(model: any) {
  const view = runtimeView(model)
  return view.root ? { ...model, root: view.root } : model
}

// ─── Builder data ───────────────────────────────────────────────────────

/** What a custom reference on this integration can be built from. */
export async function customReferenceSources(ctx: ServiceContext, integrationId: string) {
  requirePerm(ctx, 'integrations.view')
  const integration = await loadIntegration(ctx, integrationId)
  const { data, error } = await ctx.supabase.from('integration_references')
    .select('id, name, inputs, request_config').eq('integration_id', integrationId).eq('tenant_id', ctx.tenantId).order('name')
  if (error) throw dbError(error)
  const references = ((data ?? []) as any[]).filter((ref) => !isCustomReference(ref)).map((ref) => ({
    id: ref.id,
    name: ref.name,
    method: String(ref.request_config?.method ?? 'GET'),
    path_template: String(ref.request_config?.path_template ?? '').slice(0, 300),
    inputs: sourceInputsFrom(ref.inputs ?? []),
  }))
  const definition = getConnectorDefinition(String(integration.type))
  const templates = (definition?.referenceTemplates ?? []).map((t) => ({
    key: t.key, name: t.name, method: t.method, path_template: t.pathTemplate, description: t.description,
    inputs: sourceInputsFrom(t.inputs.map((i) => ({ ...i, default_value: i.defaultValue ?? '' }))),
  }))
  const operations = (Array.isArray(integration.config?.api_operations) ? integration.config.api_operations : []).map((op: any) => ({
    key: String(op.key), name: String(op.name ?? op.key), method: String(op.method ?? 'GET'), path_template: String(op.path_template ?? ''), inputs: sourceInputsFrom(op.inputs ?? []),
  }))
  const settings = await settingCatalog(ctx, integration)
  return {
    integration: { id: integration.id, name: integration.name, type: integration.type },
    database: isDatabaseIntegration(integration),
    references,
    templates,
    operations,
    settings: settings.list,
  }
}

// ─── Preview (Test / Load sample) ───────────────────────────────────────

export interface CustomPreviewInput {
  reference_id?: string | null
  custom: any
  /** Sample values for the reference's inputs. */
  inputs?: Record<string, unknown>
  /** 'source' = the operation's raw response (Load sample); 'shaped' = the finished result (Test). */
  stage?: 'source' | 'shaped'
  /**
   * Write kinds: REST writes are only SENT with `send: true` and
   * `confirm: 'send'` (the builder's "Send for real" after its warning);
   * otherwise the request is rendered and returned. Database writes are
   * always a dry run (rolled back).
   */
  send?: boolean
  confirm?: string
}

function cleanSampleInputs(inputs: Record<string, unknown> | undefined) {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(inputs ?? {}).slice(0, 60)) {
    if (!/^[A-Za-z0-9_.$-]{1,100}$/.test(name) || value === undefined || value === null) continue
    out[name] = typeof value === 'string' ? value.slice(0, 2000) : value
  }
  return out
}

export async function previewCustomReference(ctx: ServiceContext, integrationId: string, input: CustomPreviewInput) {
  requirePerm(ctx, 'integrations.manage_references')
  if (!hasPerm(ctx, 'integrations.test') && !hasPerm(ctx, 'integrations.edit')) requirePerm(ctx, 'integrations.test')
  const stage = input.stage === 'source' ? 'source' : 'shaped'
  let existing: any = null
  if (input.reference_id) {
    const { data } = await ctx.supabase.from('integration_references').select('id, integration_id, inputs, outputs, request_config')
      .eq('id', input.reference_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (data && (data as any).integration_id === integrationId) existing = data
  }
  const built = await materializeCustomReference(ctx, integrationId, { custom: input.custom }, existing, { draft: stage === 'source' })
  const writes = isWriteKind(built.config.kind)
  // "Load sample" would CALL the write operation: never for write kinds.
  if (writes && stage === 'source') throw ServiceError.validation('A write reference has no sample to load — use the Test (dry run / request preview)')
  // A REST write is sent only on an explicit "Send for real"; a database write is always rolled back.
  const sendForReal = writes && built.config.source.type === 'operation' && input.send === true && input.confirm === 'send'
  if (writes && input.send === true && !sendForReal) throw ServiceError.validation('Confirm "Send for real" to send a write request')
  const writeMode: 'run' | 'dry_run' | undefined = writes && stage === 'shaped' ? (sendForReal ? 'run' : 'dry_run') : undefined
  const started = Date.now()
  try {
    const result = await runReference({
      supabase: ctx.supabase,
      referenceId: existing?.id ?? '',
      inputValues: cleanSampleInputs(input.inputs) as Record<string, any>,
      timeout: 30000,
      caller: { traceId: '', callerType: 'manual_test', callerId: ctx.actorId },
      expectedTenantId: ctx.tenantId,
      draft: { integrationId, inputs: built.inputs, request_config: built.request_config, sourceOnly: stage === 'source' },
      ...(writeMode ? { writeMode } : {}),
    })
    const duration_ms = Date.now() - started
    const status = result.status ?? 200
    if (stage === 'source') {
      const body = unwrapExecutorResult(result.data)
      const ok = status < 400 && body !== undefined && body !== null
      return {
        status,
        duration_ms,
        ...(result.error_message ? { error: String(result.error_message).slice(0, 300) } : {}),
        source_schema: ok ? captureResponseSample(null, body) : null,
      }
    }
    return {
      status,
      duration_ms,
      ...(result.error_message ? { error: String(result.error_message).slice(0, 300) } : {}),
      data: truncateForStorage(result.data, 96 * 1024),
      ...(writes ? { write: { mode: writeMode, sent: writeMode === 'run' } } : {}),
      shaping: result.shaping ?? { stages: describeShaping(built.config) },
      response_schema: built.request_config.response_schema,
      inputs: built.inputs,
      outputs: built.outputs,
    }
  } catch (error: any) {
    if (error instanceof EgressBlockedError || error instanceof CustomReferenceError) throw ServiceError.validation(error.message)
    if (error instanceof ServiceError) throw error
    throw new ServiceError('internal', `The call failed: ${String(error?.message ?? 'unknown error').slice(0, 300)}`, { status: 502 })
  }
}

// ─── Duplicate as custom ────────────────────────────────────────────────

/**
 * The config for "Duplicate as custom": the reference's operation as the
 * source, every input asked of callers and passed through, the rows list
 * picked from its model and its top-level item fields as columns.
 */
export function customConfigFromReference(ref: { id: string; inputs?: any[]; request_config?: any; outputs?: any[] }): any {
  const model = referenceResponseSchema(ref)
  const view = model ? runtimeView(model) : { root: null, sample: undefined }
  const candidates = view.root ? findCollections(view.root, view.sample) : []
  const rowsPath = autoPickCollection(candidates)
  const list = rowsPath !== null
  const itemSchema = list ? candidates.find((c) => c.path === rowsPath)?.itemSchema ?? null : view.root
  const fields = collectionItemFields(itemSchema, 1).filter((f) => !f.container).slice(0, 25)
  const typeOf = (t: string) => (['number', 'integer', 'boolean', 'array', 'object'].includes(t) ? t : 'string')
  const inputs = ((ref.inputs ?? []) as any[]).filter((i) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(i?.name ?? ''))).map((i) => ({
    name: String(i.name),
    type: typeOf(String(i.type ?? 'string')),
    mode: 'ask',
    ...(i.required ? { required: true } : {}),
    ...(i.default_value !== undefined && i.default_value !== '' ? { default_value: i.default_value } : {}),
    ...(i.description ? { description: String(i.description) } : {}),
  }))
  return {
    version: 1,
    kind: list ? 'list' : 'read',
    source: {
      type: 'operation',
      reference_id: ref.id,
      params: inputs.map((i) => ({ name: i.name, value: `{{input.${i.name}}}` })),
    },
    inputs,
    rows_path: rowsPath ?? '',
    columns: fields.map((f) => ({ path: f.path, type: f.type === 'any' ? undefined : f.type })),
    source_model: model ?? undefined,
  }
}

export { sqlTypeToSchemaType }
