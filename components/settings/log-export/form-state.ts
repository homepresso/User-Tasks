/**
 * Add/edit form state for a log destination and its mapping to the service
 * inputs (lib/services/log-destinations). Pure, so it is unit-tested
 * without React.
 *
 * Secrets: a stored credential is shown masked and only sent when the user
 * replaces it. Headers are the exception the service imposes — a header map
 * that is sent replaces the stored one, so when any header changes the whole
 * map is sent with '__SECRET__' for each kept value.
 */

export const DESTINATION_TYPES = ['splunk_hec', 'datadog', 'otlp_http', 'webhook', 'syslog', 'azure_monitor', 'azure_event_hubs', 'gcp_logging', 'gcp_pubsub', 'aws_cloudwatch_logs'] as const
export type DestinationType = (typeof DESTINATION_TYPES)[number]

export const TYPE_LABELS: Record<DestinationType, string> = {
  splunk_hec: 'Splunk HEC',
  datadog: 'Datadog',
  otlp_http: 'OpenTelemetry (OTLP/HTTP)',
  webhook: 'Webhook',
  syslog: 'Syslog (RFC 5424)',
  azure_monitor: 'Azure Monitor (Logs Ingestion)',
  azure_event_hubs: 'Azure Event Hubs',
  gcp_logging: 'Google Cloud Logging',
  gcp_pubsub: 'Google Cloud Pub/Sub',
  aws_cloudwatch_logs: 'Amazon CloudWatch Logs',
}

/**
 * Field-driven types (syslog and the cloud destinations): plain inputs from
 * a spec instead of hand-written ones. Map-valued options (labels,
 * attributes) are API / CLI only and left untouched by the form.
 */
export interface FieldSpec {
  key: string
  label: string
  placeholder?: string
  hint?: string
  required?: boolean
  options?: readonly string[]
  number?: boolean
  multiline?: boolean
  /** Shown (and required) only when another field has one of these values. */
  when?: { key: string; values: readonly string[] }
}

const AZURE_APP = { key: 'auth', values: ['client_secret'] } as const
export const FIELD_TYPES: Partial<Record<DestinationType, { config: FieldSpec[]; secrets: FieldSpec[] }>> = {
  syslog: {
    config: [
      { key: 'host', label: 'Host', placeholder: 'syslog.internal', required: true },
      { key: 'transport', label: 'Transport', options: ['tls', 'tcp', 'udp'], hint: 'tcp and udp are unencrypted (allowed only on private networks)' },
      { key: 'port', label: 'Port (optional)', number: true, placeholder: '6514 (tls) / 514' },
      { key: 'framing', label: 'Framing', options: ['octet_counting', 'lf'], hint: 'Stream framing; ignored for udp' },
      { key: 'facility', label: 'Facility (optional)', number: true, placeholder: '16 (local0)' },
      { key: 'app_name', label: 'App name (optional)', placeholder: 'usertasks' },
      { key: 'hostname', label: 'HOSTNAME field (optional)', placeholder: 'usertasks' },
      { key: 'tls_servername', label: 'TLS server name (optional)', when: { key: 'transport', values: ['tls', ''] } },
    ],
    secrets: [
      { key: 'client_cert', label: 'Client certificate (optional, PEM)', multiline: true, hint: 'Mutual TLS' },
      { key: 'client_key', label: 'Client private key (optional, PEM)', multiline: true },
    ],
  },
  azure_monitor: {
    config: [
      { key: 'endpoint', label: 'Logs ingestion endpoint', placeholder: 'https://my-dce-abcd.westeurope-1.ingest.monitor.azure.com', required: true },
      { key: 'dcr_immutable_id', label: 'DCR immutable id', placeholder: 'dcr-…', required: true },
      { key: 'stream_name', label: 'Stream', placeholder: 'Custom-UserTasks_CL', required: true },
      { key: 'auth', label: 'Authentication', options: ['client_secret', 'managed_identity'], hint: 'managed_identity needs the operator to allow it' },
      { key: 'tenant_id', label: 'Tenant id', when: AZURE_APP, required: true },
      { key: 'client_id', label: 'Client id', when: AZURE_APP, required: true },
      { key: 'cloud', label: 'Cloud', options: ['public', 'usgov', 'china'] },
    ],
    secrets: [{ key: 'client_secret', label: 'Client secret', when: AZURE_APP, required: true }],
  },
  azure_event_hubs: {
    config: [
      { key: 'namespace', label: 'Namespace', placeholder: 'my-namespace', required: true },
      { key: 'event_hub', label: 'Event hub', placeholder: 'usertasks-events', required: true },
      { key: 'auth', label: 'Authentication', options: ['sas', 'client_secret', 'managed_identity'] },
      { key: 'sas_key_name', label: 'Shared access policy', placeholder: 'usertasks-send', when: { key: 'auth', values: ['sas', ''] }, required: true },
      { key: 'tenant_id', label: 'Tenant id', when: AZURE_APP, required: true },
      { key: 'client_id', label: 'Client id', when: AZURE_APP, required: true },
      { key: 'cloud', label: 'Cloud', options: ['public', 'usgov', 'china'] },
    ],
    secrets: [
      { key: 'sas_key', label: 'Shared access key', when: { key: 'auth', values: ['sas', ''] }, required: true },
      { key: 'client_secret', label: 'Client secret', when: AZURE_APP, required: true },
    ],
  },
  gcp_logging: {
    config: [
      { key: 'project_id', label: 'Project id', required: true },
      { key: 'log_id', label: 'Log id (optional)', placeholder: 'usertasks' },
      { key: 'resource_type', label: 'Resource type (optional)', placeholder: 'global' },
      { key: 'auth', label: 'Authentication', options: ['service_account', 'workload_identity'] },
    ],
    secrets: [{ key: 'service_account_json', label: 'Service account key (JSON)', multiline: true, when: { key: 'auth', values: ['service_account', ''] }, required: true }],
  },
  aws_cloudwatch_logs: {
    config: [
      { key: 'region', label: 'Region', placeholder: 'eu-west-1', required: true },
      { key: 'log_group_name', label: 'Log group', placeholder: '/usertasks/events', required: true },
      { key: 'log_stream_name', label: 'Log stream (optional)', placeholder: 'usertasks' },
      { key: 'auth', label: 'Authentication', options: ['access_key', 'instance_role'], hint: 'instance_role needs the operator to allow it' },
    ],
    secrets: [
      { key: 'access_key_id', label: 'Access key id', when: { key: 'auth', values: ['access_key', ''] }, required: true, hint: 'Or secret://tenants/<workspace id>/…' },
      { key: 'secret_access_key', label: 'Secret access key', when: { key: 'auth', values: ['access_key', ''] }, required: true },
    ],
  },
  gcp_pubsub: {
    config: [
      { key: 'project_id', label: 'Project id', required: true },
      { key: 'topic', label: 'Topic', required: true },
      { key: 'ordering_key', label: 'Ordering', options: ['none', 'tenant'] },
      { key: 'auth', label: 'Authentication', options: ['service_account', 'workload_identity'] },
    ],
    secrets: [{ key: 'service_account_json', label: 'Service account key (JSON)', multiline: true, when: { key: 'auth', values: ['service_account', ''] }, required: true }],
  },
}

export function fieldVisible(field: FieldSpec, values: Record<string, string>): boolean {
  return !field.when || field.when.values.includes(values[field.when.key] ?? '')
}

export const EVENT_CATEGORIES = ['workflow', 'integration', 'agent', 'audit', 'security', 'task', 'system'] as const
export const SEVERITIES = ['debug', 'info', 'warn', 'error'] as const
export const DATADOG_SITES = ['datadoghq.com', 'us3.datadoghq.com', 'us5.datadoghq.com', 'datadoghq.eu', 'ap1.datadoghq.com', 'ddog-gov.com'] as const

export const SECRET = '__SECRET__'

/** A credential value: masked when stored, typed when new or replaced. */
export interface SecretValue {
  stored: boolean
  replacing: boolean
  value: string
}

export interface HeaderRow {
  name: string
  value: SecretValue
  /** Name as loaded (stored headers only), to detect renames. */
  storedName?: string
}

export interface KeyValueRow {
  key: string
  value: string
}

export interface DestinationForm {
  name: string
  type: DestinationType
  enabled: boolean
  startFrom: 'now' | 'retention_start'
  // Splunk HEC + webhook
  url: string
  // Splunk HEC
  index: string
  sourcetype: string
  source: string
  host: string
  token: SecretValue
  // Datadog
  site: string
  service: string
  tags: string
  apiKey: SecretValue
  // OTLP
  endpoint: string
  resourceAttributes: KeyValueRow[]
  // OTLP + webhook
  headers: HeaderRow[]
  // Webhook
  signingSecret: SecretValue
  // Field-driven types (FIELD_TYPES)
  fields: Record<string, string>
  fieldSecrets: Record<string, SecretValue>
  // Filters
  categories: string[]
  types: string
  minSeverity: string
  workflowIds: string[]
}

export const newSecret = (): SecretValue => ({ stored: false, replacing: false, value: '' })
const storedSecret = (present: boolean): SecretValue => ({ stored: present, replacing: false, value: '' })

export function emptyForm(type: DestinationType = 'webhook'): DestinationForm {
  return {
    name: '', type, enabled: true, startFrom: 'now',
    url: '', index: '', sourcetype: '', source: '', host: '', token: newSecret(),
    site: 'datadoghq.com', service: '', tags: '', apiKey: newSecret(),
    endpoint: '', resourceAttributes: [],
    headers: [],
    signingSecret: newSecret(),
    fields: {}, fieldSecrets: {},
    categories: [], types: '', minSeverity: '', workflowIds: [],
  }
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

/** A destination as returned by the service (credentials masked) → form. */
export function formFromDestination(row: { name: string; type: string; enabled: boolean; config?: unknown; credentials?: unknown; filters?: unknown }): DestinationForm {
  const type = (DESTINATION_TYPES as readonly string[]).includes(row.type) ? row.type as DestinationType : 'webhook'
  const config = obj(row.config)
  const credentials = obj(row.credentials)
  const filters = obj(row.filters)
  return {
    ...emptyForm(type),
    name: row.name,
    enabled: row.enabled,
    url: str(config.url),
    index: str(config.index),
    sourcetype: str(config.sourcetype),
    source: str(config.source),
    host: str(config.host),
    token: storedSecret(credentials.token !== undefined),
    site: str(config.site) || 'datadoghq.com',
    service: str(config.service),
    tags: strings(config.tags).join(', '),
    apiKey: storedSecret(credentials.api_key !== undefined),
    endpoint: str(config.endpoint),
    resourceAttributes: Object.entries(obj(config.resource_attributes)).map(([key, value]) => ({ key, value: str(value) })),
    headers: Object.keys(obj(credentials.headers)).map((name) => ({ name, storedName: name, value: storedSecret(true) })),
    signingSecret: storedSecret(credentials.signing_secret !== undefined),
    fields: Object.fromEntries((FIELD_TYPES[type]?.config ?? []).filter((f) => config[f.key] !== undefined && config[f.key] !== null).map((f) => [f.key, String(config[f.key])])),
    fieldSecrets: Object.fromEntries((FIELD_TYPES[type]?.secrets ?? []).map((f) => [f.key, storedSecret(credentials[f.key] !== undefined)])),
    categories: strings(filters.categories),
    types: strings(filters.types).join(', '),
    minSeverity: str(filters.min_severity),
    workflowIds: strings(filters.workflow_ids),
  }
}

const splitList = (text: string): string[] => text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

/** Non-secret config for the form's type; blank optional fields left out. */
export function configFromForm(form: DestinationForm): Json {
  const put = (out: Json, key: string, value: string) => { if (value.trim()) out[key] = value.trim() }
  const out: Json = {}
  switch (form.type) {
    case 'splunk_hec':
      put(out, 'url', form.url)
      for (const key of ['index', 'sourcetype', 'source', 'host'] as const) put(out, key, form[key])
      break
    case 'datadog': {
      put(out, 'site', form.site)
      put(out, 'service', form.service)
      const tags = splitList(form.tags)
      if (tags.length) out.tags = tags
      break
    }
    case 'otlp_http': {
      put(out, 'endpoint', form.endpoint)
      const attrs = Object.fromEntries(form.resourceAttributes.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))
      if (Object.keys(attrs).length) out.resource_attributes = attrs
      break
    }
    case 'webhook':
      put(out, 'url', form.url)
      break
    default:
      for (const field of FIELD_TYPES[form.type]?.config ?? []) {
        const value = (form.fields[field.key] ?? '').trim()
        if (!value || !fieldVisible(field, form.fields)) continue
        out[field.key] = field.number ? Number(value) : value
      }
  }
  return out
}

function fieldSecretsFor(form: DestinationForm, include: (secret: SecretValue) => boolean): Json {
  const out: Json = {}
  for (const field of FIELD_TYPES[form.type]?.secrets ?? []) {
    const secret = form.fieldSecrets[field.key]
    if (secret && fieldVisible(field, form.fields) && include(secret)) out[field.key] = secret.value
  }
  return out
}

export function filtersFromForm(form: DestinationForm): Json {
  const out: Json = {}
  if (form.categories.length) out.categories = [...form.categories]
  const types = splitList(form.types)
  if (types.length) out.types = types
  if (form.minSeverity) out.min_severity = form.minSeverity
  if (form.workflowIds.length) out.workflow_ids = [...form.workflowIds]
  return out
}

const hasHeaders = (type: DestinationType) => type === 'otlp_http' || type === 'webhook'

function headersForCreate(rows: HeaderRow[]): Json | undefined {
  const named = rows.filter((r) => r.name.trim())
  if (!named.length) return undefined
  return Object.fromEntries(named.map((r) => [r.name.trim(), r.value.value]))
}

/** Create input: every typed secret (nothing is stored yet). */
export function buildCreateInput(form: DestinationForm) {
  const credentials: Json = {}
  if (form.type === 'splunk_hec' && form.token.value) credentials.token = form.token.value
  if (form.type === 'datadog' && form.apiKey.value) credentials.api_key = form.apiKey.value
  if (form.type === 'webhook' && form.signingSecret.value) credentials.signing_secret = form.signingSecret.value
  Object.assign(credentials, fieldSecretsFor(form, (secret) => secret.value !== ''))
  if (hasHeaders(form.type)) {
    const headers = headersForCreate(form.headers)
    if (headers) credentials.headers = headers
  }
  return {
    name: form.name.trim(),
    type: form.type,
    config: configFromForm(form),
    credentials,
    filters: filtersFromForm(form),
    enabled: form.enabled,
    start_from: form.startFrom,
  }
}

const replaced = (secret: SecretValue) => (!secret.stored || secret.replacing) && secret.value !== ''

/**
 * Header map for an update, or undefined when the stored headers are
 * unchanged (same names, no value replaced, none added or removed).
 */
export function headersForUpdate(rows: HeaderRow[], storedNames: string[]): Json | undefined {
  const named = rows.filter((r) => r.name.trim())
  const unchanged = named.length === storedNames.length
    && named.every((r) => r.storedName !== undefined && r.name.trim() === r.storedName && !replaced(r.value))
    && storedNames.every((n) => named.some((r) => r.storedName === n))
  if (unchanged) return undefined
  const out: Json = {}
  for (const row of named) {
    const name = row.name.trim()
    // A renamed stored header has no value under its new name: needs a new one.
    if (row.value.stored && !replaced(row.value) && row.storedName === name) out[name] = SECRET
    else if (replaced(row.value)) out[name] = row.value.value
  }
  return out
}

/**
 * Update input against the destination as loaded. Config keys the form
 * cleared are sent as null (the service merges config); secrets are sent
 * only when replaced; filters are always sent (they replace).
 */
export function buildUpdateInput(form: DestinationForm, original: { config?: unknown; credentials?: unknown }) {
  const config: Json = configFromForm(form)
  for (const key of Object.keys(obj(original.config))) {
    if (!(key in config) && MANAGED_CONFIG_KEYS[form.type].includes(key)) config[key] = null
  }
  const credentials: Json = {}
  if (form.type === 'splunk_hec' && replaced(form.token)) credentials.token = form.token.value
  if (form.type === 'datadog' && replaced(form.apiKey)) credentials.api_key = form.apiKey.value
  if (form.type === 'webhook' && replaced(form.signingSecret)) credentials.signing_secret = form.signingSecret.value
  Object.assign(credentials, fieldSecretsFor(form, replaced))
  if (hasHeaders(form.type)) {
    const headers = headersForUpdate(form.headers, Object.keys(obj(obj(original.credentials).headers)))
    if (headers !== undefined) credentials.headers = headers
  }
  return {
    name: form.name.trim(),
    config,
    ...(Object.keys(credentials).length ? { credentials } : {}),
    filters: filtersFromForm(form),
    enabled: form.enabled,
  }
}

/** Config keys the form edits (others, e.g. Splunk verify_tls, are left alone). */
const MANAGED_CONFIG_KEYS: Record<DestinationType, string[]> = {
  splunk_hec: ['url', 'index', 'sourcetype', 'source', 'host'],
  datadog: ['site', 'service', 'tags'],
  otlp_http: ['endpoint', 'resource_attributes'],
  webhook: ['url'],
  ...Object.fromEntries(Object.entries(FIELD_TYPES).map(([type, spec]) => [type, spec!.config.map((f) => f.key)])) as Record<string, string[]>,
} as Record<DestinationType, string[]>

/** Client-side checks before calling the server (which validates fully). */
export function validateForm(form: DestinationForm, mode: 'create' | 'edit'): string | null {
  if (!form.name.trim()) return 'Name is required'
  if ((form.type === 'splunk_hec' || form.type === 'webhook') && !form.url.trim()) return 'URL is required'
  if (form.type === 'otlp_http' && !form.endpoint.trim()) return 'Endpoint is required'
  if (form.type === 'splunk_hec' && !(form.token.stored && !form.token.replacing) && !form.token.value) {
    return mode === 'create' ? 'HEC token is required' : 'Enter the new HEC token or cancel the replacement'
  }
  if (form.type === 'datadog' && !(form.apiKey.stored && !form.apiKey.replacing) && !form.apiKey.value) {
    return mode === 'create' ? 'API key is required' : 'Enter the new API key or cancel the replacement'
  }
  const spec = FIELD_TYPES[form.type]
  for (const field of spec?.config ?? []) {
    if (field.required && fieldVisible(field, form.fields) && !(form.fields[field.key] ?? '').trim()) return `${field.label} is required`
    if (field.number && (form.fields[field.key] ?? '').trim() && !/^\d+$/.test(form.fields[field.key].trim())) return `${field.label.replace(' (optional)', '')} must be a number`
  }
  for (const field of spec?.secrets ?? []) {
    const secret = form.fieldSecrets[field.key]
    const kept = secret?.stored && !secret.replacing
    if (field.required && fieldVisible(field, form.fields) && !kept && !secret?.value) {
      return mode === 'create' || !secret?.stored ? `${field.label} is required` : `Enter the new ${field.label.toLowerCase()} or cancel the replacement`
    }
  }
  if (form.type === 'webhook' && form.signingSecret.value && form.signingSecret.value.length < 16) {
    return 'Signing secret must be at least 16 characters (leave it blank to generate one)'
  }
  for (const row of form.headers) {
    if (!row.name.trim()) continue
    const kept = row.value.stored && !row.value.replacing && row.storedName === row.name.trim()
    if (!kept && !row.value.value) return `Header ${row.name.trim()} needs a value`
  }
  return null
}

/** Whether the filters let audit or security events through (needs settings.view). */
export function exportsRestricted(categories: string[]): boolean {
  return categories.length === 0 || categories.includes('audit') || categories.includes('security')
}
