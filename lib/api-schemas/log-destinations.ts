import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, paginationQuery } from './common'

/**
 * Log export destinations: REST bodies plus the per-type config / credential
 * / filter schemas lib/services/log-destinations validates with (kept here,
 * zod-only, so the OpenAPI generator can load them).
 */

export const LOG_DESTINATION_TYPES = ['splunk_hec', 'datadog', 'otlp_http', 'webhook', 'syslog', 'azure_monitor', 'azure_event_hubs', 'gcp_logging', 'gcp_pubsub', 'aws_cloudwatch_logs'] as const
export type LogDestinationType = (typeof LOG_DESTINATION_TYPES)[number]

/** Datadog sites (intake host `http-intake.logs.<site>`). */
export const DATADOG_SITES = ['datadoghq.com', 'us3.datadoghq.com', 'us5.datadoghq.com', 'datadoghq.eu', 'ap1.datadoghq.com', 'ddog-gov.com'] as const
/** Short names accepted for `site`. */
export const DATADOG_SITE_ALIASES: Record<string, (typeof DATADOG_SITES)[number]> = {
  us1: 'datadoghq.com', us: 'datadoghq.com', us3: 'us3.datadoghq.com', us5: 'us5.datadoghq.com',
  eu: 'datadoghq.eu', eu1: 'datadoghq.eu', ap1: 'ap1.datadoghq.com', 'ddog-gov': 'ddog-gov.com', gov: 'ddog-gov.com',
}

const EVENT_CATEGORIES = ['workflow', 'integration', 'agent', 'audit', 'security', 'task', 'system'] as const
const SEVERITIES = ['debug', 'info', 'warn', 'error'] as const

const httpUrl = z.string().trim().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL')
const label = (max: number) => z.string().trim().min(1).max(max)
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/
const headerMap = z.record(z.string().regex(HEADER_NAME, 'invalid header name'), z.string().max(8192))
  .refine((headers) => Object.keys(headers).length <= 20, 'at most 20 headers')

// ─── Per-type config (non-secret) ───

export const splunkHecConfig = z.strictObject({
  url: httpUrl.describe('HEC base URL, e.g. https://splunk.example.com:8088 (events go to /services/collector/event)'),
  index: label(200).optional(),
  sourcetype: label(200).optional().describe('Default usertasks:event'),
  source: label(200).optional().describe('Default usertasks'),
  host: label(255).optional(),
  verify_tls: z.boolean().default(true).describe('Verify the server certificate (default true)'),
})

export const datadogConfig = z.strictObject({
  site: z.preprocess(
    (value) => (typeof value === 'string' ? DATADOG_SITE_ALIASES[value.trim().toLowerCase()] ?? value.trim().toLowerCase() : value),
    z.enum(DATADOG_SITES),
  ).default('datadoghq.com').describe(`Datadog site: ${DATADOG_SITES.join(', ')} (or us1, us3, us5, eu, ap1, ddog-gov)`),
  service: label(100).optional().describe('Default usertasks'),
  tags: z.array(z.string().trim().min(1).max(200)).max(50).optional().describe('Extra ddtags, e.g. env:prod'),
})

export const otlpHttpConfig = z.strictObject({
  endpoint: httpUrl.describe('OTLP/HTTP base endpoint, e.g. https://otel.example.com:4318 (logs go to /v1/logs)'),
  resource_attributes: z.record(z.string().min(1).max(200), z.string().max(1000)).optional()
    .refine((attrs) => !attrs || Object.keys(attrs).length <= 50, 'at most 50 resource attributes')
    .describe('Extra resource attributes (service.name defaults to usertasks)'),
})

export const webhookConfig = z.strictObject({
  url: httpUrl.describe('HTTPS endpoint receiving POST { events: [...] } batches'),
})

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9a-fA-F:.]+\]?$/
const PRINTUSASCII = (max: number) => z.string().trim().min(1).max(max).regex(/^[!-~]+$/, 'printable ASCII without spaces')
const uuid = z.string().trim().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'a GUID')
const labelMap = z.record(z.string().min(1).max(63).regex(/^[a-z][a-z0-9_-]*$/, 'lower-case label key'), z.string().max(255))
  .refine((m) => Object.keys(m).length <= 32, 'at most 32 labels')
export const AZURE_CLOUDS = ['public', 'usgov', 'china'] as const

export const syslogConfig = z.strictObject({
  host: z.string().trim().regex(HOSTNAME, 'hostname or IP address').describe('Syslog receiver (rsyslog, syslog-ng, Splunk / Graylog / Logstash syslog inputs, a SIEM)'),
  port: z.number().int().min(1).max(65535).optional().describe('Default 6514 for tls, 514 for tcp and udp'),
  transport: z.enum(['tls', 'tcp', 'udp']).default('tls').describe('tls (RFC 5425, default), tcp (RFC 6587) or udp (RFC 5426); plain tcp / udp need ALLOW_PRIVATE_EGRESS=true'),
  framing: z.enum(['octet_counting', 'lf']).default('octet_counting').describe('Stream framing: octet counting (RFC 6587 §3.4.1, default) or newline-terminated'),
  facility: z.number().int().min(0).max(23).default(16).describe('Syslog facility number (default 16 = local0)'),
  app_name: PRINTUSASCII(48).default('usertasks'),
  hostname: PRINTUSASCII(255).optional().describe('HOSTNAME field (default usertasks)'),
  tls_servername: z.string().trim().regex(HOSTNAME).optional().describe('TLS server name, when it differs from host'),
})

export const azureMonitorConfig = z.strictObject({
  endpoint: httpUrl.describe('Logs ingestion endpoint of the data collection endpoint (DCE) or rule, e.g. https://my-dce-abcd.westeurope-1.ingest.monitor.azure.com'),
  dcr_immutable_id: z.string().trim().regex(/^dcr-[0-9a-f]{32}$/, 'dcr-<32 hex digits>').describe('Immutable id of the data collection rule'),
  stream_name: z.string().trim().regex(/^(Custom|Microsoft)-[A-Za-z0-9_]{1,100}$/, 'Custom-<table> or Microsoft-<table>').describe('DCR stream, e.g. Custom-UserTasks_CL'),
  auth: z.enum(['client_secret', 'managed_identity']).default('client_secret').describe('client_secret: an Entra app registration; managed_identity: the instance\'s identity (needs LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true)'),
  tenant_id: uuid.optional().describe('Entra tenant id (client_secret auth)'),
  client_id: uuid.optional().describe('Application (client) id, or the user-assigned managed identity'),
  cloud: z.enum(AZURE_CLOUDS).default('public'),
})

export const azureEventHubsConfig = z.strictObject({
  namespace: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9-]{4,48}[A-Za-z0-9](\.servicebus\.(windows\.net|usgovcloudapi\.net|chinacloudapi\.cn))?$/, 'namespace name or <name>.servicebus.windows.net').describe('Event Hubs namespace'),
  event_hub: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/, 'event hub name'),
  auth: z.enum(['sas', 'client_secret', 'managed_identity']).default('sas').describe('sas: a shared access policy key; client_secret: an Entra app; managed_identity: the instance\'s identity (needs LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true)'),
  sas_key_name: z.string().trim().min(1).max(256).optional().describe('Shared access policy name (sas auth), e.g. usertasks-send'),
  tenant_id: uuid.optional(),
  client_id: uuid.optional(),
  cloud: z.enum(AZURE_CLOUDS).default('public'),
})

const gcpProject = z.string().trim().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'Google Cloud project id')
const gcpAuth = z.enum(['service_account', 'workload_identity']).default('service_account')
  .describe('service_account: a key JSON in credentials; workload_identity: the instance\'s Application Default Credentials (needs LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true)')

export const gcpLoggingConfig = z.strictObject({
  project_id: gcpProject,
  log_id: z.string().trim().regex(/^[A-Za-z0-9_./-]{1,100}$/, 'log id').default('usertasks').describe('Log name: projects/<project>/logs/<log_id>'),
  resource_type: z.string().trim().regex(/^[a-z_]{1,64}$/).default('global').describe('Monitored resource type (default global)'),
  labels: labelMap.optional().describe('Labels on every entry'),
  auth: gcpAuth,
})

export const gcpPubsubConfig = z.strictObject({
  project_id: gcpProject,
  topic: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9._~%+-]{2,254}$/, 'topic id'),
  attributes: labelMap.optional().describe('Attributes on every message (event type, category and severity are always set)'),
  ordering_key: z.enum(['none', 'tenant']).default('none').describe('tenant: per-workspace ordering (the subscription must enable message ordering)'),
  auth: gcpAuth,
})

export const awsCloudWatchLogsConfig = z.strictObject({
  region: z.string().trim().regex(/^[a-z]{2}(-gov|-iso[a-z]*)?-[a-z]+-\d$/, 'an AWS region, e.g. eu-west-1').describe('AWS region of the log group, e.g. eu-west-1'),
  log_group_name: z.string().trim().regex(/^[.\-_/#A-Za-z0-9]{1,512}$/, 'log group name (letters, digits, . - _ / #)').describe('Log group, e.g. /usertasks/events'),
  log_stream_name: z.string().trim().regex(/^[^:*]{1,512}$/, 'log stream name (no : or *)').default('usertasks').describe('Log stream (default usertasks)'),
  auto_create: z.boolean().default(false).describe('Create the log group and stream when missing (needs logs:CreateLogGroup and logs:CreateLogStream)'),
  auth: z.enum(['access_key', 'instance_role']).default('access_key').describe('access_key: an IAM access key in credentials; instance_role: the instance\'s own role (needs LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true)'),
})

// ─── Per-type credentials (secret; masked as __SECRET__ on read) ───

export const splunkHecCredentials = z.strictObject({
  token: z.string().trim().min(1).max(512).describe('HEC token (sent as Authorization: Splunk <token>)'),
})

export const datadogCredentials = z.strictObject({
  api_key: z.string().trim().min(1).max(512).describe('Datadog API key (DD-API-KEY)'),
})

export const otlpHttpCredentials = z.strictObject({
  headers: headerMap.optional().describe('Headers sent with every export (e.g. API keys for Grafana Cloud, Honeycomb, New Relic); values are secret'),
})

export const webhookCredentials = z.strictObject({
  signing_secret: z.string().min(16).max(512).optional().describe('HMAC-SHA256 key for X-UserTasks-Signature; generated (and shown once) when omitted'),
  headers: headerMap.optional().describe('Extra headers sent with every batch; values are secret'),
})

const pem = (what: string) => z.string().min(1).max(16_384).describe(`${what} (PEM)`)

export const syslogCredentials = z.strictObject({
  client_cert: pem('Client certificate for mutual TLS').optional(),
  client_key: pem('Client private key for mutual TLS').optional(),
})

export const azureMonitorCredentials = z.strictObject({
  client_secret: z.string().min(1).max(1024).optional().describe('Client secret of the app registration (client_secret auth)'),
})

export const azureEventHubsCredentials = z.strictObject({
  sas_key: z.string().min(1).max(1024).optional().describe('Shared access policy key (sas auth)'),
  client_secret: z.string().min(1).max(1024).optional().describe('Client secret (client_secret auth)'),
})

export const gcpCredentials = z.strictObject({
  service_account_json: z.string().min(1).max(16_384).optional().describe('Service account key JSON (service_account auth)'),
})

export const awsCloudWatchLogsCredentials = z.strictObject({
  access_key_id: z.string().trim().min(16).max(256).optional().describe('IAM access key id (access_key auth), or a secret://tenants/<workspace id>/… reference'),
  secret_access_key: z.string().trim().min(16).max(1024).optional().describe('IAM secret access key (access_key auth), or a secret://tenants/<workspace id>/… reference'),
})

export const LOG_DESTINATION_SCHEMAS = {
  splunk_hec: { config: splunkHecConfig, credentials: splunkHecCredentials, required: ['token'] },
  datadog: { config: datadogConfig, credentials: datadogCredentials, required: ['api_key'] },
  otlp_http: { config: otlpHttpConfig, credentials: otlpHttpCredentials, required: [] },
  webhook: { config: webhookConfig, credentials: webhookCredentials, required: [] },
  syslog: { config: syslogConfig, credentials: syslogCredentials, required: [] },
  azure_monitor: { config: azureMonitorConfig, credentials: azureMonitorCredentials, required: [] },
  azure_event_hubs: { config: azureEventHubsConfig, credentials: azureEventHubsCredentials, required: [] },
  gcp_logging: { config: gcpLoggingConfig, credentials: gcpCredentials, required: [] },
  gcp_pubsub: { config: gcpPubsubConfig, credentials: gcpCredentials, required: [] },
  aws_cloudwatch_logs: { config: awsCloudWatchLogsConfig, credentials: awsCloudWatchLogsCredentials, required: [] },
} as const satisfies Record<LogDestinationType, { config: z.ZodType; credentials: z.ZodType; required: readonly string[] }>

// ─── Filters ───

export const EVENT_TYPE_GLOB = /^[a-z0-9_*]+(\.[a-z0-9_*]+)*$/

export const logDestinationFilters = z.strictObject({
  categories: z.array(z.enum(EVENT_CATEGORIES)).max(EVENT_CATEGORIES.length).optional().describe('Only these categories (default all; audit and security also need settings.view)'),
  types: z.array(z.string().regex(EVENT_TYPE_GLOB, 'lower-case dotted event type, * as a wildcard').max(200)).max(50).optional().describe('Event types or globs, e.g. workflow.* or *.failed'),
  min_severity: z.enum(SEVERITIES).optional().describe('Minimum severity'),
  workflow_ids: z.array(z.string().uuid()).max(200).optional().describe('Only events of these workflows'),
})

// ─── REST bodies ───

export const START_FROM = ['now', 'retention_start'] as const

const typeField = z.enum(LOG_DESTINATION_TYPES).describe(`Destination type: ${LOG_DESTINATION_TYPES.join(', ')}`)
const CONFIG_NOTE = 'splunk_hec { url, index?, sourcetype?, source?, host?, verify_tls? }; datadog { site?, service?, tags? }; otlp_http { endpoint, resource_attributes? }; webhook { url }; syslog { host, port?, transport? (tls|tcp|udp), framing?, facility?, app_name?, hostname?, tls_servername? }; azure_monitor { endpoint, dcr_immutable_id, stream_name, auth?, tenant_id?, client_id?, cloud? }; azure_event_hubs { namespace, event_hub, auth? (sas|client_secret|managed_identity), sas_key_name?, tenant_id?, client_id?, cloud? }; gcp_logging { project_id, log_id?, resource_type?, labels?, auth? }; gcp_pubsub { project_id, topic, attributes?, ordering_key?, auth? }; aws_cloudwatch_logs { region, log_group_name, log_stream_name?, auto_create?, auth? (access_key|instance_role) }'
const CREDENTIALS_NOTE = 'splunk_hec { token }; datadog { api_key }; otlp_http { headers? }; webhook { signing_secret?, headers? }; syslog { client_cert?, client_key? }; azure_monitor { client_secret? }; azure_event_hubs { sas_key? | client_secret? }; gcp_logging / gcp_pubsub { service_account_json? }; aws_cloudwatch_logs { access_key_id?, secret_access_key? }. Never returned: reads show __SECRET__, and __SECRET__ on update keeps the stored value'

export const logDestinationCreateBody = z.object({
  name: label(200).describe('Unique name within the workspace'),
  type: typeField,
  config: z.record(z.string(), z.unknown()).describe(`Type-specific settings: ${CONFIG_NOTE}`),
  credentials: z.record(z.string(), z.unknown()).optional().describe(`Secrets: ${CREDENTIALS_NOTE}`),
  filters: z.record(z.string(), z.unknown()).optional().describe('{ categories?, types? (globs), min_severity?, workflow_ids? }; default every event'),
  enabled: z.boolean().optional().describe('Default true'),
  start_from: z.enum(START_FROM).optional().describe('now (default): only events from now on; retention_start: everything still retained'),
})

export const logDestinationUpdateBody = z.object({
  name: label(200).optional(),
  type: typeField.optional().describe('Cannot change; accepted so a fetched destination can be sent back'),
  config: z.record(z.string(), z.unknown()).optional().describe('Merged over the stored config (null removes a key)'),
  credentials: z.record(z.string(), z.unknown()).optional().describe('Merged over the stored credentials; __SECRET__ keeps a value, null removes it'),
  filters: z.record(z.string(), z.unknown()).optional().describe('Replaces the filters'),
  enabled: z.boolean().optional(),
})

export const logDestinationResetBody = z.object({
  from: z.enum(START_FROM).describe('now: skip everything not yet shipped; retention_start: re-send everything still retained'),
})

const destination = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(LOG_DESTINATION_TYPES),
  config: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()).describe('Masked: every value is __SECRET__'),
  filters: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  status: z.string(),
  cursor: z.string().describe('Last shipped event id'),
})

const statusResponse = z.looseObject({
  id: z.string(),
  status: z.string(),
  enabled: z.boolean(),
  cursor: z.string(),
  latest_event_id: z.string().describe('Newest event id in this workspace'),
  lag_events: z.number().int().describe('Retained events after the cursor (before filters)'),
  lag_seconds: z.number().nullable().describe('Age of the oldest unsent event; null when caught up'),
  events_sent: z.number().int(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  consecutive_failures: z.number().int(),
})

const tags = ['Log export']
const SECRET_NOTE = 'Credentials are write-only (masked as __SECRET__). For webhook destinations without a signing_secret one is generated and returned once as `signing_secret`.'

export const listLogDestinationsEndpoint = defineEndpoint({
  method: 'GET', path: '/log-destinations', operationId: 'listLogDestinations', tags,
  summary: 'List log export destinations (credentials masked)', permission: 'observability.view',
  query: paginationQuery, response: listResponse('log_destinations', destination), listKey: 'log_destinations',
  cli: { resource: 'log-destinations', verb: 'list' },
})

export const createLogDestinationEndpoint = defineEndpoint({
  method: 'POST', path: '/log-destinations', operationId: 'createLogDestination', tags,
  summary: 'Create a log export destination (Splunk HEC, Datadog, OTLP/HTTP, webhook, syslog, Azure Monitor, Event Hubs, Cloud Logging, Pub/Sub, CloudWatch Logs)',
  description: `Needs settings.edit and observability.view (and settings.view when audit/security events can be exported). URLs are checked against the egress policy. ${SECRET_NOTE}`,
  permission: 'settings.edit',
  body: logDestinationCreateBody, successStatus: 201,
  response: z.looseObject({ log_destination: destination, signing_secret: z.string().optional().describe('Generated webhook signing secret (shown once)') }),
  cli: { resource: 'log-destinations', verb: 'create' },
})

export const getLogDestinationEndpoint = defineEndpoint({
  method: 'GET', path: '/log-destinations/{id}', operationId: 'getLogDestination', tags,
  summary: 'Get a log export destination (credentials masked)', permission: 'observability.view',
  params: idParams, response: itemResponse('log_destination', destination),
  cli: { resource: 'log-destinations', verb: 'get', positional: ['id'] },
})

export const updateLogDestinationEndpoint = defineEndpoint({
  method: 'PATCH', path: '/log-destinations/{id}', operationId: 'updateLogDestination', tags,
  summary: 'Update a log export destination', description: SECRET_NOTE, permission: 'settings.edit',
  params: idParams, body: logDestinationUpdateBody,
  response: z.looseObject({ log_destination: destination, changed: z.boolean() }),
  roundTrip: { unwrap: 'log_destination' },
  cli: { resource: 'log-destinations', verb: 'update', positional: ['id'] },
})

export const deleteLogDestinationEndpoint = defineEndpoint({
  method: 'DELETE', path: '/log-destinations/{id}', operationId: 'deleteLogDestination', tags,
  summary: 'Delete a log export destination', permission: 'settings.edit',
  params: idParams, response: deletedResponse,
  cli: { resource: 'log-destinations', verb: 'delete', positional: ['id'] },
})

export const resetLogDestinationCursorEndpoint = defineEndpoint({
  method: 'POST', path: '/log-destinations/{id}/reset-cursor', operationId: 'resetLogDestinationCursor', tags,
  summary: 'Move a destination\'s cursor to now or to the start of retention', permission: 'settings.edit',
  params: idParams, body: logDestinationResetBody, response: itemResponse('log_destination', destination),
  cli: { resource: 'log-destinations', verb: 'reset-cursor', positional: ['id'] },
})

export const getLogDestinationStatusEndpoint = defineEndpoint({
  method: 'GET', path: '/log-destinations/{id}/status', operationId: 'getLogDestinationStatus', tags,
  summary: 'Delivery status of a destination: lag, last success and last error', permission: 'observability.view',
  params: idParams, response: statusResponse,
  cli: { resource: 'log-destinations', verb: 'status', positional: ['id'] },
})

const testResponse = z.looseObject({
  ok: z.boolean().describe('True when the destination answered 2xx'),
  status_code: z.number().int().nullable().describe('HTTP status (null when no response: egress blocked, network error, timeout, and for syslog)'),
  latency_ms: z.number().describe('Round trip in milliseconds'),
  error: z.string().nullable().describe('Error detail (credentials redacted)'),
  retryable: z.boolean().describe('Whether the shipper would retry this failure (408/429/5xx/network)'),
})

export const testLogDestinationEndpoint = defineEndpoint({
  method: 'POST', path: '/log-destinations/{id}/test', operationId: 'testLogDestination', tags,
  summary: 'Send one synthetic system.test event through the destination\'s formatter and connection',
  description: 'Uses the same formatting, egress checks and 10 s timeout as the shipper. The cursor, status and delivery stats are not changed.',
  permission: 'settings.edit',
  params: idParams, response: testResponse,
  cli: { resource: 'log-destinations', verb: 'test', positional: ['id'] },
})

export const logDestinationEndpoints = [
  listLogDestinationsEndpoint, createLogDestinationEndpoint, getLogDestinationEndpoint, updateLogDestinationEndpoint,
  deleteLogDestinationEndpoint, resetLogDestinationCursorEndpoint, getLogDestinationStatusEndpoint, testLogDestinationEndpoint,
]
