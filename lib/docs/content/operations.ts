import type { DocPageDef } from '../types'

export const OBSERVABILITY_PAGES: DocPageDef[] = [
  {
    slug: 'observability',
    title: 'Observability and log export',
    description: 'One event stream for workflow, integration, agent, task, audit and security events — shipped to Splunk, Datadog, OpenTelemetry or a webhook, or pulled and tailed yourself.',
    body: `
Workflow runs and step logs, integration calls, agent runs, task lifecycle, audit, security and system events are normalised into **one event stream per workspace**, with a common envelope and stable, increasing ids. You can use it three ways:

| | How | Best for |
|---|---|---|
| **Push** | [Log destinations](/docs/observability/destinations): Splunk HEC, Datadog Logs, OpenTelemetry (OTLP/HTTP), signed HTTPS webhooks | Your existing log platform, SIEM and alerting |
| **Pull** | \`GET /api/v1/events\` (cursor) and \`GET /api/v1/events/stream\` (Server-Sent Events) | Your own consumers |
| **Tail** | \`usertasks logs tail\` / \`usertasks logs export\`, MCP \`events_list\` | Developers and operators |

::image log-export | Settings → Log Export with a Splunk HEC and a webhook destination | Settings → Log Export: each destination's status, delivery counts and lag.

## Guarantees

- **At least once.** A destination's cursor only advances after a 2xx, so retries can repeat events — dedupe on the event \`id\`. Failed deliveries back off exponentially (capped at 5 minutes).
- **Seconds, not minutes.** The shipper runs every minute and drains in batches; most events arrive within seconds of the next run.
- **Retention.** Events are kept for 72 hours by default (\`tenants.settings.event_stream_retention_hours\`, at most 168). A destination that falls further behind is marked \`lagging_data_lost\` and a \`system.log_export.data_lost\` event is recorded.
- **Health.** After 5 consecutive client errors a destination becomes \`failing\`; owners and admins are notified once per transition.

## Safe by construction

Events carry allow-listed fields only. They **never** contain request or response bodies or headers, prompts, model outputs, credentials or full audit diffs. Destination credentials are encrypted and never shown again.

## Permissions

| To… | You need |
|---|---|
| Read events, tail logs, see destinations | \`observability.view\` (OAuth scope \`events:read\`) |
| Include audit and security events | \`settings.view\` as well |
| Create, change, test or reset destinations | \`settings.edit\` as well |

Owner and Admin have \`observability.view\` by default; add it to custom roles that need it.

## Tail from a terminal

\`\`\`bash
usertasks logs tail --category workflow --severity warn
usertasks logs tail --type 'workflow.run.*,*.failed' --workflow <id>
usertasks logs export --since 1h > events.ndjson
\`\`\`

::image cli-logs-tail | Terminal: live tail of workflow events | Live tail: runs starting, waiting on tasks, completing and failing.

Next: [destinations](/docs/observability/destinations) and the [event reference](/docs/observability/events).
`,
  },
  {
    slug: 'observability/destinations',
    title: 'Log destinations',
    description: 'Set up Splunk HEC, Datadog Logs, OpenTelemetry, webhook, syslog, Azure Monitor, Event Hubs, Cloud Logging, Pub/Sub and CloudWatch Logs destinations with filters, tests, status and cursor control.',
    body: `
Add destinations in **Settings → Log Export**, with \`/api/v1/log-destinations\`, the MCP \`log_destinations_*\` tools, \`usertasks log-destinations …\` or [config as code](/docs/config-as-code) (credentials are never exported).

| Type | \`config\` | \`credentials\` |
|---|---|---|
| \`splunk_hec\` | \`url\`, \`index\`, \`sourcetype\` (default \`usertasks:event\`), \`source\`, \`host\`, \`verify_tls\` | \`token\` |
| \`datadog\` | \`site\` (\`datadoghq.com\`, \`us3\`, \`us5\`, \`datadoghq.eu\`, \`ap1\`, \`ddog-gov\`), \`service\`, \`tags\` | \`api_key\` |
| \`otlp_http\` | \`endpoint\` (logs go to \`/v1/logs\`), \`resource_attributes\` | \`headers\` (e.g. vendor API keys) |
| \`webhook\` | \`url\` | \`signing_secret\` (generated when omitted), \`headers\` |
| \`syslog\` | \`host\`, \`port\`, \`transport\` (\`tls\` default, \`tcp\`, \`udp\`), \`framing\` (\`octet_counting\`, \`lf\`), \`facility\` (default 16), \`app_name\`, \`hostname\`, \`tls_servername\` | \`client_cert\`, \`client_key\` (mutual TLS, optional) |
| \`azure_monitor\` | \`endpoint\` (DCE logs-ingestion URL), \`dcr_immutable_id\`, \`stream_name\`, \`auth\` (\`client_secret\`, \`managed_identity\`), \`tenant_id\`, \`client_id\`, \`cloud\` | \`client_secret\` |
| \`azure_event_hubs\` | \`namespace\`, \`event_hub\`, \`auth\` (\`sas\`, \`client_secret\`, \`managed_identity\`), \`sas_key_name\`, \`tenant_id\`, \`client_id\`, \`cloud\` | \`sas_key\` or \`client_secret\` |
| \`gcp_logging\` | \`project_id\`, \`log_id\` (default \`usertasks\`), \`resource_type\` (default \`global\`), \`labels\`, \`auth\` (\`service_account\`, \`workload_identity\`) | \`service_account_json\` |
| \`gcp_pubsub\` | \`project_id\`, \`topic\`, \`attributes\`, \`ordering_key\` (\`none\`, \`tenant\`), \`auth\` | \`service_account_json\` |
| \`aws_cloudwatch_logs\` | \`region\`, \`log_group_name\`, \`log_stream_name\` (default \`usertasks\`), \`auto_create\`, \`auth\` (\`access_key\`, \`instance_role\`) | \`access_key_id\`, \`secret_access_key\` |

**Filters** (all optional): \`categories\`, \`types\` (globs such as \`workflow.*\` or \`*.failed\`), \`min_severity\` and \`workflow_ids\`. **\`start_from\`**: \`now\` (default) or \`retention_start\` to backfill everything still retained.

\`\`\`bash
usertasks log-destinations create -f splunk.json
usertasks log-destinations test <id>                       # one system.test event through the real path
usertasks log-destinations status <id>                     # status, lag, last success / error
usertasks log-destinations update <id> --set enabled:=false
usertasks log-destinations reset-cursor <id> --set from=now
\`\`\`

::image cli-log-destinations | Terminal: create a Splunk HEC destination and check its status | A destination created from a file and its delivery status.

## Splunk HTTP Event Collector

In Splunk: **Settings → Data inputs → HTTP Event Collector → New token**. Allow the index you want, then add a destination with the HEC base URL (\`https://splunk.example.com:8088\`) and the token. Events go to \`/services/collector/event\`, newline-delimited, at most 1 MB per request.

\`\`\`spl title="Example search"
index=usertasks sourcetype="usertasks:event" category=workflow severity=error
| stats count by type, workflow_id
| sort -count
\`\`\`

Splunk with a private CA: set \`NODE_EXTRA_CA_CERTS\` on the UserTasks server (certificate verification cannot be turned off per destination).

## Datadog Logs

Create an API key (Organization settings → API keys) and pick your site. Logs arrive with \`ddsource:usertasks\`, service \`usertasks\` (configurable) and tags \`tenant_id\`, \`category\` and \`event_type\`, plus any you add (\`env:prod\`). Create facets on \`@type\`, \`@category\`, \`@workflow_id\` and \`@trace_id\`; no pipeline is required. Self-hosted servers can send every Datadog destination through a proxy or Observability Pipelines worker with \`LOG_EXPORT_DATADOG_URL\`.

## OpenTelemetry (OTLP/HTTP)

Point a destination at any collector or vendor endpoint that accepts OTLP logs (JSON encoding): Grafana Cloud, Honeycomb, New Relic, Elastic or your own collector. Header values (API keys) are stored encrypted. Resources carry \`service.name=usertasks\` and \`tenant.id\`; event fields become \`usertasks.*\` attributes and \`traceId\` is the event's trace id.

\`\`\`yaml title="otel-collector.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318      # UserTasks endpoint: https://collector.example.com:4318
processors:
  batch: {}
exporters:
  debug:
    verbosity: basic
service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
\`\`\`

## Webhook signatures

Webhook destinations receive \`POST { "events": [...] }\` with \`X-UserTasks-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>\` and \`X-UserTasks-Event-Count\`. Verify against the raw body, compare in constant time, reject old timestamps, and dedupe on \`events[i].id\`. Several \`v1=\` values can be present while a secret is rotated.

\`\`\`javascript title="Node.js"
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyUserTasksSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2))
  const signatures = header.split(',').map((p) => p.trim()).filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false
  const expected = createHmac('sha256', secret).update(\`\${parts.t}.\${rawBody}\`).digest('hex')
  return signatures.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
}
\`\`\`

\`\`\`python title="Python"
import hashlib, hmac, time

def verify_usertasks_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    items = [p.strip().split("=", 1) for p in header.split(",") if "=" in p]
    t = next((v for k, v in items if k == "t"), None)
    signatures = [v for k, v in items if k == "v1"]
    if t is None or not t.isdigit() or abs(time.time() - int(t)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(sig, expected) for sig in signatures)
\`\`\`

## Syslog (RFC 5424)

For rsyslog, syslog-ng, the syslog inputs of Splunk, Graylog, Logstash / Elastic Agent and SIEMs such as QRadar or ArcSight. Each event is one RFC 5424 message:

\`\`\`text
<134>1 2026-10-24T11:59:58.250Z usertasks usertasks - workflow.run.completed [usertasks@32473 tenant_id="…" event_id="42" category="workflow" severity="info"] {"id":42,…}
\`\`\`

PRI is \`facility × 8 + severity\` (debug 7, info 6, warn 4, error 3); MSGID is the event type; the message is the event JSON. \`tls\` (RFC 5425, port 6514, the default) verifies the receiver's certificate (\`NODE_EXTRA_CA_CERTS\` for a private CA) and can present a client certificate; \`tcp\` (RFC 6587) and \`udp\` (RFC 5426, one datagram per event, at most 8 KB) are unencrypted and need \`ALLOW_PRIVATE_EGRESS=true\`. Streams use octet-counting framing unless \`framing\` is \`lf\`.

\`\`\`text title="rsyslog (/etc/rsyslog.d/usertasks.conf)"
module(load="imtcp" StreamDriver.Name="gtls" StreamDriver.Mode="1" StreamDriver.AuthMode="anon")
input(type="imtcp" port="6514")
if $app-name == "usertasks" then /var/log/usertasks.log
\`\`\`

## Azure Monitor (Log Analytics, Sentinel)

Uses the Logs Ingestion API. Create a custom table (e.g. \`UserTasks_CL\`), a data collection endpoint and a data collection rule whose stream \`Custom-UserTasks_CL\` declares \`TimeGenerated\` (datetime), \`EventId\` (long), \`Attributes\` (dynamic) and the string columns \`TenantId\`, \`EventType\`, \`Category\`, \`Severity\`, \`Message\`, \`SourceTable\`, \`SourceId\`, \`TraceId\`, \`RunId\`, \`WorkflowId\`, \`TaskId\`, \`ActorId\`. Grant an app registration **Monitoring Metrics Publisher** on the rule and add a destination with the DCE's logs-ingestion URL, the rule's immutable id, the stream, \`tenant_id\`, \`client_id\` and the client secret. At most 1 MB per call.

## Azure Event Hubs

Batched REST sends to \`https://<namespace>.servicebus.windows.net/<hub>/messages\`; each message body is the event JSON, with \`tenant_id\`, \`event_type\`, \`category\` and \`severity\` as properties. Authenticate with a shared access policy that has **Send** (\`auth: sas\`, \`sas_key_name\`, credential \`sas_key\`) or an app registration with **Azure Event Hubs Data Sender**.

## Google Cloud Logging and Pub/Sub

Cloud Logging receives \`entries.write\` batches in \`projects/<project>/logs/<log_id>\` with the event as \`jsonPayload\`, its severity, labels \`tenant_id\` / \`category\` / \`event_type\` and \`insertId\` \`<tenant>-<event id>\` (a re-sent batch is deduplicated); grant the service account \`roles/logging.logWriter\`. Pub/Sub publishes one message per event (data = event JSON) with the same attributes; \`ordering_key: tenant\` keeps each workspace's events in order (enable ordering on the subscription); grant \`roles/pubsub.publisher\`. Paste the service-account key JSON as the credential.

## Amazon CloudWatch Logs

\`PutLogEvents\` batches (SigV4-signed) to \`log_group_name\` / \`log_stream_name\`; each log event's message is the event JSON and its timestamp the event time. Batches stay within CloudWatch's limits (1 MB including 26 bytes per event, 10,000 events, 24 hours between the oldest and newest event) and are sorted by time. Throttling (\`ThrottlingException\`, sent as HTTP 400) is retried with backoff. CloudWatch drops events older than 14 days, so a \`retention_start\` backfill only lands the last two weeks. With \`auto_create: true\` the group and stream are created on first use. The IAM key (or role) needs \`logs:PutLogEvents\` on the stream (and \`logs:CreateLogGroup\` / \`logs:CreateLogStream\` for \`auto_create\`). Either credential may be a \`secret://tenants/<workspace id>/…\` reference to the instance's secret store.

**Cloud identities.** The Azure, Google and AWS destinations authenticate with credentials the workspace supplies. The server's own managed / workload identity or AWS role (\`auth: managed_identity\` / \`workload_identity\` / \`instance_role\`) can reach whatever the operator's identity can, so it is refused unless the operator sets \`LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true\` (single-tenant installs). Token endpoints are fixed (Microsoft Entra ID per cloud, \`oauth2.googleapis.com\`) — a \`token_uri\` inside a key file is ignored — and tokens are cached until shortly before they expire.

## Self-hosted notes

| Setting | Purpose |
|---|---|
| \`ALLOW_PRIVATE_EGRESS=true\` | Allow destinations on private networks and plain http (Splunk on 10.x, a local collector) |
| \`NODE_EXTRA_CA_CERTS=/path/ca.pem\` | Trust a private CA |
| \`LOG_EXPORT_DATADOG_URL\` | Replace the Datadog intake URL for every Datadog destination |
| \`LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true\` | Let Azure / Google / AWS destinations use the server's managed or workload identity, or its AWS role |
| \`LOG_EXPORT_EVENT_HUBS_URL\`, \`LOG_EXPORT_GCP_LOGGING_URL\`, \`LOG_EXPORT_GCP_PUBSUB_URL\`, \`LOG_EXPORT_AWS_ENDPOINT_URL\` | Replace the Event Hubs / Cloud Logging / Pub/Sub / CloudWatch Logs origin (private endpoints, LocalStack) |
| \`LOG_EXPORT_AZURE_AUTHORITY_URL\`, \`LOG_EXPORT_GCP_TOKEN_URL\` | Replace the Entra ID authority / Google token endpoint |
| Vault \`app_base_url\` + \`cron_secret\` | Used by the pg_cron job \`usertasks-tick\` (every minute), which runs the shipper. Without them nothing is shipped; pull and tail still work |
| \`ENCRYPTION_KEY\` | Encrypts destination credentials at rest |
`,
  },
  {
    slug: 'observability/events',
    title: 'Event reference',
    description: 'The event envelope, every event type, severity mapping per destination, and the pull and streaming APIs.',
    body: `
## Envelope

Every event — in the pull API, the stream, the CLI and every destination — has the same shape. Destinations wrap it in their own format (Splunk \`event\`, Datadog log attributes, OTLP log record attributes, webhook \`{ events: [...] }\`).

| Field | Type | Description |
|---|---|---|
| \`id\` | integer (string in cursors) | Stable, increasing id. Dedupe and resume with it. |
| \`tenant_id\` | UUID | Workspace |
| \`occurred_at\` | ISO 8601 | When the change happened |
| \`type\` | string | Dotted type, e.g. \`workflow.run.failed\` |
| \`category\` | \`workflow\` · \`integration\` · \`agent\` · \`audit\` · \`security\` · \`task\` · \`system\` | Grouping used by filters and permissions |
| \`severity\` | \`debug\` · \`info\` · \`warn\` · \`error\` | Normalised severity |
| \`message\` | string (≤ 1000 chars) | One-line summary |
| \`source_table\`, \`source_id\` | string | Where the event came from |
| \`trace_id\`, \`run_id\`, \`workflow_id\`, \`task_id\`, \`actor_id\` | UUID or null | Correlation. \`trace_id\` links a run with its integration calls and agent runs. |
| \`attributes\` | object | Allow-listed details: status, duration_ms, host, path, model, token counts, changed field names… |

\`\`\`json title="Example"
{
  "id": 48213,
  "tenant_id": "6f1c…",
  "occurred_at": "2026-10-24T09:14:03.512Z",
  "type": "integration.call",
  "category": "integration",
  "severity": "warn",
  "message": "POST api.example.com/v1/orders → 429 in 812ms",
  "source_table": "integration_call_logs",
  "source_id": "b0a4…",
  "trace_id": "9d2e…", "run_id": "1c7f…", "workflow_id": "a83b…", "task_id": null, "actor_id": null,
  "attributes": { "method": "POST", "host": "api.example.com", "path": "/v1/orders", "status": 429, "duration_ms": 812 }
}
\`\`\`

## Event types

Filter with exact types or globs (\`*\` matches within a segment): \`workflow.run.*\`, \`*.failed\`, \`security.*\`.

| Type | Category | Severity | When |
|---|---|---|---|
| \`workflow.run.started\` / \`resumed\` / \`waiting\` / \`paused\` / \`completed\` | workflow | info | A run changes status (\`duration_ms\` on completion) |
| \`workflow.run.failed\` | workflow | error | A run failed |
| \`workflow.run.cancelled\` | workflow | warn | A run was cancelled |
| \`workflow.run.sla_warning\` / \`sla_breached\` | workflow | warn / error | A run approaches or breaches its SLA |
| \`workflow.step.log\` | workflow | from the log level | One per step log line (turn off with \`settings.event_stream.include_step_logs = false\`) |
| \`workflow.queue.failed\` / \`dead\` | workflow | warn / error | A queued job failed and will retry / gave up |
| \`integration.call\` | integration | info; warn on 4xx; error on 5xx | Every outbound call: method, host, path, status, duration |
| \`integration.webhook.dead_letter\` | integration | error | An outbound webhook was dead-lettered |
| \`agent.run.<status>\` | agent | error when failed, else info | Agent runs: model, token counts, duration |
| \`audit.<object_type>.<action>\` | audit | info | Any audited change, with changed field names |
| \`security.oauth.token_issued\` / \`token_revoked\` / \`code_replay\` / \`refresh_reuse\` | security | info; warn for replay and reuse | OAuth token lifecycle |
| \`security.api_key.<action>\` / \`security.api_key.auth_failed\` | security | info; warn for failures | API key lifecycle and sampled failures |
| \`security.permission.<action>\` | security | info | Role and permission changes |
| \`system.retention.purged\` / \`purge_failed\` / \`review_*\` | system | info / error | Retention executions and reviews |
| \`system.deletion.completed\` / \`failed\` | system | info / error | Queued deletions |
| \`system.sync.github.*\` / \`system.sync.directory.*\` | system | info / error | Sync runs |
| \`system.log_export.data_lost\` | system | warn | A destination fell behind retention |
| \`system.test\` | system | info | "Send test event" (never stored) |
| \`task.<event_type>\` | task | warn for escalated / blocked / rejected, else info | Task lifecycle |

## Severity mapping

| UserTasks | Splunk \`severity\` | Datadog \`status\` | OTLP severityNumber / Text |
|---|---|---|---|
| debug | debug | debug | 5 / DEBUG |
| info | info | info | 9 / INFO |
| warn | warn | warning | 13 / WARN |
| error | error | error | 17 / ERROR |

Workflow step log levels map \`trace\` → debug, \`warning\` → warn and \`fatal\` → error.

## Pull API

\`\`\`bash
curl -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/events?since=1h&category=workflow&limit=500"
# → { "events": [...], "next_cursor": "48213", "has_more": true }
curl -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/events?after=48213&limit=500"
\`\`\`

Filters: \`category\`, \`type\` (globs), \`severity\` (minimum), \`workflow_id\`, \`run_id\`, \`task_id\`, \`trace_id\`, \`since\`.

## Live stream (Server-Sent Events)

\`\`\`bash
curl -N -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Last-Event-ID: 48213" \\
  "$USERTASKS_URL/api/v1/events/stream?severity=warn"
# id: 48214
# event: workflow.run.failed
# data: {"id":48214,"type":"workflow.run.failed",...}
# : heartbeat            (every 15 s when idle)
# event: reconnect       (before the server's time limit; resume with the last id)
\`\`\`

- Each message is named after its event type, so browser \`EventSource\` clients add a listener per type; curl, the SDK and the CLI see every message.
- The stream resumes from \`Last-Event-ID\` (or \`?after=\`); without either it starts at the newest event, or at \`since=\`.
- On serverless hosts the response ends at the function limit with an \`event: reconnect\` hint; the SDK and \`usertasks logs tail\` reconnect without gaps.
- The stream accepts API keys and OAuth tokens, not browser sessions.
`,
  },
  {
    slug: 'background-jobs',
    title: 'Background jobs',
    description: 'Exports, imports and bulk actions run in the background: the Jobs panel, completion popups, async API requests, CLI waiting, limits and retention.',
    body: `
Slow actions — exports, imports, package builds and installs, bulk deletes and other actions on many items, sync runs — run as **background jobs**. Clicking the button returns at once with *“Preparing your export… we'll let you know when it's ready”*; you can keep working. Quick jobs still finish within the click.

## In the app

- **Jobs indicator** (top bar): a spinner and the number of running jobs. Click it for the **Jobs panel**: recent jobs with their progress, **Cancel**, **Retry** and **Download**. Workspace admins (*Edit settings*) can switch to every job of the workspace.
- **Completion popup**: when a job finishes — on whatever page you are by then — a popup offers **Download** (exports), shows the result (imports, bulk actions) or the error with **Retry**.
- **Bell**: every finished job also leaves a notification, so a result is not lost when you navigate away or reload. Clicking it opens the Jobs panel.

Results (files) are kept for **7 days**, then deleted with the job. Only the person who started a job can download its file.

| Action | Job kind |
|---|---|
| Export (any artifact or selection) | \`config.export\` |
| Import (apply; the dry-run plan is instant) | \`config.apply\` |
| Report → Download Excel | \`report.export\` |
| Packages: build & download, download a version, install / upgrade, complete setup, uninstall, history CSV | \`package.*\` |
| Delete selected (workflows, data tables, rows, business rules, agents, reports, workflow activities, retention policies, references, API keys) | \`bulk.delete\` |
| Activate / deactivate selected workflows | \`workflows.set_active\` |
| Bulk permissions | \`object_permissions.bulk_set\` |
| Add tag to selected references | \`references.add_tag\` |
| Bulk assign / remove a role | \`roles.bulk\` |
| Regenerate connector references | \`connectors.regenerate_references\` |
| Queue: Pause all / Resume all / Delete | \`workflow_queue.bulk\` |
| Migrate live instances | \`workflow_instances.migrate\` |
| GitHub sync pushes and deployments, directory syncs | \`sync.watch\` |

Permissions are the same as for the action itself, and are checked again — as you, with your roles at that moment — when the job runs.

## API

Slow endpoints have an async variant. Add \`?async=true\` or the header \`Prefer: respond-async\`; the response is \`202 Accepted\` with the job (and \`Location: /api/v1/jobs/{id}\`):

\`\`\`bash
curl -X POST "$URL/api/v1/config/apply" -H "Authorization: Bearer $KEY" \\
  -H "Prefer: respond-async" -H "Content-Type: application/json" -d @files.json
# 202 { "success": true, "data": { "job": { "id": "…", "status": "queued", … } } }

curl "$URL/api/v1/jobs/$JOB" -H "Authorization: Bearer $KEY"          # status, progress
curl "$URL/api/v1/jobs/$JOB/result" -H "Authorization: Bearer $KEY"   # what the synchronous call returns
curl -OJ "$URL/api/v1/jobs/$JOB/download" -H "Authorization: Bearer $KEY"   # file results
\`\`\`

Async endpoints: \`GET /config/export\`, \`POST /config/apply\`, \`POST /packages/{id}/versions\`, \`POST /package-installs\`, \`POST /package-installs/{id}/upgrade\`, \`POST /package-installs/{id}/uninstall\`, \`POST /data-tables/{id}/rows/bulk-delete\`, \`POST /references/bulk-delete\`, \`POST /workflows/{id}/instances/migrate\` (marked \`x-usertasks-async\` in the OpenAPI document). An \`Idempotency-Key\` header returns the same job for a repeated request. Without the flag every endpoint answers synchronously, as before.

| Endpoint | |
|---|---|
| \`GET /jobs\` | Your jobs (tenant API keys: the jobs the key started); \`scope=tenant\` for admins, \`active=true\`, \`status=…\` |
| \`GET /jobs/{id}\` | Status (\`queued\`, \`running\`, \`succeeded\`, \`failed\`, \`cancelled\`), \`progress\` 0–100, \`message\`, \`result\` summary and counts, \`error\` |
| \`POST /jobs/{id}/cancel\` | Queued jobs stop at once; running jobs at their next progress report |
| \`POST /jobs/{id}/retry\` | A new job with the same input |
| \`GET /jobs/{id}/result\` | The JSON result (\`409\` until finished, \`410\` once expired) |
| \`GET /jobs/{id}/download\` | The result file |

A job started with an API key keeps that key's permissions as a ceiling and stops if the key is revoked or expires.

## SDK and CLI

\`\`\`ts
const result = await client.requestAndWait('POST', '/config/apply', { body, onProgress: (job) => console.log(job.progress) })
const { job } = await client.startJob('GET', '/config/export', { query: { format: 'manifest' } })
const file = await client.downloadJob(job.id)
\`\`\`

CLI commands with an async variant start a job and wait for it, printing progress on stderr and the same output as before; \`--no-wait\` prints the job instead. \`usertasks jobs list | get | cancel | retry | result | wait | download\` work with any job.

## How it runs (self-hosting)

- The job starts in the same request, right after the response (\`after()\`), so it needs no extra infrastructure.
- The scheduler tick runs \`user-jobs\` every minute (every scheduler: pg_cron, the worker, Vercel / external cron): jobs whose start was lost, retries that are due, the next chunk of long jobs, and jobs whose invocation died (their lease expired). \`/api/cron/user-jobs\` does the same on demand (processor secret).
- Each invocation spends at most \`USER_JOB_BUDGET_MS\` (default 50 s) on a job; long jobs hand over in chunks and continue in a fresh invocation, so serverless time limits are respected.
- Failures from unexpected errors are retried with backoff (15 s, 1 min, 4 min…) up to the job kind's limit; permission and validation errors fail at once.
- Results are stored in the private \`job-results\` bucket of the configured storage provider and served only through the authorised download routes. \`user-jobs-cleanup\` (every 15 minutes) deletes expired jobs and their files; \`USER_JOB_RESULT_TTL_HOURS\` (default 168) sets how long they are kept.
- Live updates use the realtime provider (Supabase Realtime or SSE) with polling as the fallback.
`,
  },
]

export const SELF_HOSTING_PAGES: DocPageDef[] = [
  {
    slug: 'self-hosting',
    title: 'Self-hosting',
    description: 'Run UserTasks on your own infrastructure: Supabase, environment, pg_cron and Vault, first tenant, Node or Docker, optional drivers and a security checklist.',
    body: `
This guide is maintained with the code (\`docs/self-hosting.md\` in the repository). For a quick local install, see the [self-host quickstart](/docs/quickstart/self-host).

## Deployment modes

\`DEPLOYMENT_MODE\` selects the edition. Set it at build time **and** at runtime: some affected routes are statically rendered.

| | \`self_hosted\` (default) | \`cloud\` |
|---|---|---|
| \`/\` | Redirects to \`/tasks\` or \`/login\` | Product site |
| Marketing pages, \`/contact\` | 404 | Served |
| Self-signup | Disabled; use \`npm run bootstrap\` and invitations | Enabled |
| \`robots.txt\` / sitemap | Disallow all / empty | Normal |
| \`/docs\` | Served | Served |

::include docs/self-hosting.md
`,
  },
  {
    slug: 'self-hosting/environment',
    title: 'Environment variables',
    description: 'Every environment variable the server reads, grouped as in .env.example — generated from that file.',
    body: `
Copy \`.env.example\` to \`.env.local\` (for \`npm run dev\` / \`npm start\`) or \`.env\` (for Docker Compose). The Supabase URL/keys and SSO flags are read at runtime (restart after changing them); \`DEPLOYMENT_MODE\` and the app URL also shape statically rendered routes, so set them at build time too. This list is generated from \`.env.example\`.

::env-vars

## Queue and runtime tuning

| Variable | Default | Effect |
|---|---|---|
| \`WORKFLOW_CONCURRENCY\` | 5 | Jobs one processor invocation runs at once |
| \`WORKFLOW_PROCESSOR_BUDGET_MS\` | 50000 | How long one invocation keeps starting jobs |
| \`QUEUE_RETENTION_DAYS\` | 7 | Finished queue rows kept by the daily cleanup |
| \`CRON_TICK_CONCURRENCY\` | 4 | Scheduled jobs one scheduler tick (\`/api/cron/tick\`) runs at once |
| \`USER_JOB_BUDGET_MS\` | 50000 | Time one invocation spends on a [background job](/docs/background-jobs) before it hands over the next chunk |
| \`USER_JOB_RESULT_TTL_HOURS\` | 168 | How long finished background jobs and their files are kept |
| \`USER_JOB_INLINE_WAIT_MS\` | 1500 | How long a click waits for a quick background job before handing it to the background (0 = always in the background) |
| \`NODE_EXTRA_CA_CERTS\` | — | Trust a private CA for integrations, connectors and log destinations |
`,
  },
  {
    slug: 'self-hosting/optional-drivers',
    title: 'Optional drivers',
    description: 'Install the Snowflake, Oracle and MongoDB drivers and the optional storage, email, secrets, KMS and SAML packages: what each is for, what is installed by default from source, in the Docker image and on Vercel, Kubernetes and air-gapped installs, and the connector specifics.',
    body: `
::include docs/optional-drivers.md
`,
  },
  {
    slug: 'self-hosting/infrastructure',
    title: 'Infrastructure and providers',
    description: 'Choose the provider for each infrastructure area: file storage on Supabase, local disk, S3 / MinIO, Azure Blob or Google Cloud Storage; realtime over Supabase Realtime or built-in Server-Sent Events; background jobs on pg_cron, the built-in worker or an external scheduler; email over Resend, SMTP, SES, Azure, Microsoft 365 or Gmail; secrets in Vault, Key Vault, Secret Manager or AWS; switching and migration.',
    body: `
::include docs/infrastructure.md
`,
  },
  {
    slug: 'self-hosting/switching-providers',
    title: 'Switching providers',
    description: 'Move a running install between providers with usertasks-admin or from Settings → Infrastructure: status, doctor, switch per area (database, auth, storage, scheduler, realtime, email, secrets, cache, KMS) with backups and rollback, provider settings, background switches with live progress, downtime expectations.',
    body: `
::include docs/switching-providers.md

### Screenshots: changing providers from the page

::image infrastructure-change-provider | Change… on an area card: the provider catalogue with on-prem, Azure and Google Cloud badges | Providers that can't run on this deployment are shown but disabled, with the reason.

::image infrastructure-switch-plan | Review plan: the pre-flight checks and the switch's dry run | The plan is the engine's own dry run — the same lines \`usertasks-admin switch --dry-run\` prints.

::image infrastructure-database-test | Test connection for a database switch: the target role's privileges, the one-time SQL a DBA runs, and the ordering rule | The pre-flight connects from the app, checks the role, extensions and size, and refuses while auth, realtime or the scheduler still need Supabase.

::image infrastructure-switch-progress | A storage switch running in the background, with steps, percentage and output | The switch log follows the run live; Cancel stops it before the next step, Rollback undoes a finished switch.
`,
  },
  {
    slug: 'self-hosting/deployment-profiles',
    title: 'Deployment profiles',
    description: 'Docker Compose profiles (supabase, standalone with PostgreSQL, MinIO, worker, built-in auth, SSE and Mailpit), the on-premises, Azure and Google Cloud reference profiles with their smoke tests, the full instance migration test, release gates and the Bicep / Terraform templates.',
    body: `
::include docs/deployment-profiles.md
`,
  },
  {
    slug: 'self-hosting/on-premises',
    title: 'On-premises setup',
    description: 'Run UserTasks fully on your own infrastructure with no SaaS and no outbound internet: PostgreSQL and PgBouncer, built-in auth or Keycloak, MinIO, SSE, the worker, an SMTP relay and environment secrets.',
    body: `
::include docs/setup-on-prem.md
`,
  },
  {
    slug: 'self-hosting/azure',
    title: 'Azure setup',
    description: 'The Azure reference deployment: Container Apps, PostgreSQL Flexible Server with Entra auth, Blob Storage, Key Vault, Communication Services Email and a Container Apps Job tick, from the Bicep or Terraform templates.',
    body: `
::include docs/setup-azure.md
`,
  },
  {
    slug: 'self-hosting/google-cloud',
    title: 'Google Cloud setup',
    description: 'The Google Cloud reference deployment: Cloud Run, Cloud SQL with IAM database auth, Cloud Storage, Secret Manager, an SMTP relay and a Cloud Scheduler OIDC tick, from the Terraform template.',
    body: `
::include docs/setup-gcp.md
`,
  },
  {
    slug: 'self-hosting/kubernetes',
    title: 'Kubernetes setup',
    description: 'The Helm chart: web app, worker or tick CronJob, migrations as a hook or a Job, every provider from values, Secrets / External Secrets / CSI driver, EKS, AKS and GKE workload identity, Ingress or Gateway API, HPA, PDB, NetworkPolicy egress allowlist, bundled PostgreSQL, MinIO and Valkey for evaluation, and the kind release gate.',
    body: `
::include docs/setup-kubernetes.md
`,
  },
  {
    slug: 'self-hosting/air-gapped',
    title: 'Air-gapped installs',
    description: 'Install with no internet access: a signed bundle of OCI images, the Helm chart, Compose files, CLI and SDK packages, docs and SBOMs; verify the checksums and ed25519 signature, load the images or push them to a private registry, run on Docker Compose or Kubernetes.',
    body: `
::include docs/setup-air-gapped.md
`,
  },
  {
    slug: 'self-hosting/aws',
    title: 'AWS setup',
    description: 'The AWS reference deployment: ECS on Fargate, RDS PostgreSQL with IAM database auth, ElastiCache Valkey with IAM auth, S3, SES, Secrets Manager, KMS, CloudWatch Logs and an EventBridge Scheduler tick, from the Terraform template.',
    body: `
::include docs/setup-aws.md
`,
  },
  {
    slug: 'self-hosting/database',
    title: 'Database and migrations',
    description: 'How the schema is built, which migrations exist, and how to apply and check them.',
    body: `
::include docs/migrations.md
`,
  },
]

export const PROJECT_PAGES: DocPageDef[] = [
  {
    slug: 'performance',
    title: 'Performance',
    description: 'Measured results of the performance work: API latency, queue throughput, RLS queries, engine and bundle size — on a local benchmark.',
    body: `
> [!NOTE]
> These numbers were measured on **one laptop with everything local** (app, Postgres and Supabase services in Docker, loopback network, warm caches). Read them as before/after ratios, not as production latencies. The harness is \`scripts/bench/\` in the repository (local stack only).

::include docs/perf/results.md
`,
  },
  {
    slug: 'changelog',
    title: 'Changelog',
    description: 'Release notes: packages, performance, log export and live event streaming, and the CLI and API surface.',
    tocDepth: 2,
    body: `
Release notes are kept in \`docs/changes/\` in the repository and rendered here. Apply the listed migrations before deploying a release.

::changelog
`,
  },
]
