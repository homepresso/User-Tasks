import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { resolvePage } from '@/lib/services/_shared'
import * as destinations from '@/lib/services/log-destinations'
import { LOG_DESTINATION_TYPES } from '@/lib/api-schemas/log-destinations'
import { messageOf } from './_util'

/*
 * Log export destination tools: thin wrappers over lib/services/log-destinations
 * (reads need observability.view; writes settings.edit too; audited in the
 * service). Credentials are write-only: reads show '__SECRET__', and
 * '__SECRET__' on update keeps the stored value.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const CONFIG_HELP = 'Type-specific settings. splunk_hec: { url, index?, sourcetype?, source?, host?, verify_tls? }; datadog: { site? (datadoghq.com, us3, us5, eu, ap1, ddog-gov), service?, tags? }; otlp_http: { endpoint, resource_attributes? }; webhook: { url }; syslog: { host, port?, transport? (tls|tcp|udp), framing?, facility?, app_name?, hostname? }; azure_monitor: { endpoint, dcr_immutable_id, stream_name, auth?, tenant_id?, client_id?, cloud? }; azure_event_hubs: { namespace, event_hub, auth? (sas|client_secret|managed_identity), sas_key_name?, tenant_id?, client_id? }; gcp_logging: { project_id, log_id?, resource_type?, labels?, auth? }; gcp_pubsub: { project_id, topic, attributes?, ordering_key?, auth? }; aws_cloudwatch_logs: { region, log_group_name, log_stream_name?, auto_create?, auth? (access_key|instance_role) }'
const CREDENTIALS_HELP = 'Secrets. splunk_hec: { token }; datadog: { api_key }; otlp_http: { headers? }; webhook: { signing_secret?, headers? } (a signing secret is generated and returned once when omitted); syslog: { client_cert?, client_key? }; azure_monitor: { client_secret? }; azure_event_hubs: { sas_key? | client_secret? }; gcp_logging / gcp_pubsub: { service_account_json? }; aws_cloudwatch_logs: { access_key_id?, secret_access_key? }'
const FILTERS_HELP = '{ categories?: [workflow|integration|agent|task|system|audit|security], types?: ["workflow.*", ...], min_severity?: debug|info|warn|error, workflow_ids?: [...] }; default every event'

const jsonObject = z.record(z.string(), z.any())

export function registerLogDestinationTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('log_destinations_list', 'List log export destinations (Splunk HEC, Datadog, OTLP/HTTP, webhook, syslog, Azure Monitor, Event Hubs, Cloud Logging, Pub/Sub) with status and cursor. Credentials are masked.', {
    limit: z.number().optional().describe('Page size (1-100, default 50; 0 = no limit)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => run(() => destinations.listLogDestinations(svc(), resolvePage(args))))

  server.tool('log_destinations_get', 'Get one log export destination (credentials masked as __SECRET__).', {
    destination_id: z.string().describe('Log destination ID'),
  }, async (args) => run(() => destinations.getLogDestination(svc(), args.destination_id)))

  server.tool('log_destinations_status', 'Delivery status of a log export destination: cursor, lag (events and seconds), events sent, last success and last error.', {
    destination_id: z.string().describe('Log destination ID'),
  }, async (args) => run(() => destinations.getLogDestinationStatus(svc(), args.destination_id)))

  server.tool('log_destinations_create', 'Create a log export destination that ships the event stream to Splunk HEC, Datadog Logs, an OpenTelemetry collector (OTLP/HTTP), an HTTPS webhook, a syslog receiver (RFC 5424 over TLS), Azure Monitor (Logs Ingestion API), Azure Event Hubs, Google Cloud Logging or Pub/Sub. URLs must be https and pass the egress policy. Exporting audit/security events (no category filter, or one naming them) also needs settings.view.', {
    name: z.string().describe('Unique name'),
    type: z.enum(LOG_DESTINATION_TYPES).describe('Destination type'),
    config: jsonObject.describe(CONFIG_HELP),
    credentials: jsonObject.optional().describe(CREDENTIALS_HELP),
    filters: jsonObject.optional().describe(FILTERS_HELP),
    enabled: z.boolean().optional().describe('Default true'),
    start_from: z.enum(['now', 'retention_start']).optional().describe('now (default) or retention_start (also send what is still retained)'),
  }, async (args) => run(async () => ({ created: true, ...(await destinations.createLogDestination(svc(), args)) })))

  server.tool('log_destinations_update', 'Update a log export destination. config and credentials merge over the stored values (null removes a key; __SECRET__ keeps a secret); filters are replaced. The type cannot change.', {
    destination_id: z.string().describe('Log destination ID'),
    name: z.string().optional(),
    config: jsonObject.optional().describe(CONFIG_HELP),
    credentials: jsonObject.optional().describe(CREDENTIALS_HELP),
    filters: jsonObject.optional().describe(FILTERS_HELP),
    enabled: z.boolean().optional().describe('Pause (false) or resume (true) shipping'),
  }, async (args) => run(async () => {
    const { destination_id: id, ...input } = args
    return { updated: true, ...(await destinations.updateLogDestination(svc(), id, input)) }
  }))

  server.tool('log_destinations_delete', 'Delete a log export destination (shipping stops; already delivered events are unaffected).', {
    destination_id: z.string().describe('Log destination ID'),
  }, async (args) => run(() => destinations.deleteLogDestination(svc(), args.destination_id)))

  server.tool('log_destinations_reset_cursor', 'Move a destination\'s cursor: "now" skips the unsent backlog, "retention_start" re-sends every event still retained.', {
    destination_id: z.string().describe('Log destination ID'),
    from: z.enum(['now', 'retention_start']),
  }, async (args) => run(() => destinations.resetLogDestinationCursor(svc(), args.destination_id, args.from)))

  server.tool('log_destinations_test', 'Send one synthetic system.test event to a log export destination through the real formatter and connection; returns ok, HTTP status code, latency and the (redacted) error. Does not move the cursor.', {
    destination_id: z.string().describe('Log destination ID'),
  }, async (args) => run(() => destinations.testLogDestination(svc(), args.destination_id)))
}
