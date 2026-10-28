# Choosing a log destination

Workflow runs and step logs, integration calls, agent runs, task changes,
audit, security and system events form one event stream per workspace.
Log destinations ship it, at least once and usually within seconds of the
next tick. They are set per workspace (Settings → Log Export, the API, the
CLI, MCP or config as code), not per instance, so every workspace can
choose its own. Events never carry request bodies, prompts or credentials.

| Destination | `type` | On-prem | AWS | Azure | Google Cloud |
|---|---|---|---|---|---|
| Splunk HTTP Event Collector | `splunk_hec` | yes (Splunk Enterprise) | compatible | compatible | compatible |
| Datadog Logs, every site | `datadog` | — | compatible | compatible | compatible |
| OpenTelemetry (OTLP/HTTP) | `otlp_http` | yes (a Collector) | compatible: an ADOT Collector | compatible | compatible |
| Signed HTTPS webhook | `webhook` | yes (Fluent Bit, Vector) | compatible | compatible | compatible |
| Syslog (RFC 5424 over TLS, TCP or UDP) | `syslog` | yes (rsyslog, syslog-ng, a SIEM) | compatible | compatible | compatible |
| Azure Monitor Logs Ingestion (Log Analytics, Sentinel) | `azure_monitor` | — | — | native | — |
| Azure Event Hubs | `azure_event_hubs` | — | — | native | — |
| Google Cloud Logging | `gcp_logging` | — | — | — | native |
| Google Cloud Pub/Sub | `gcp_pubsub` | — | — | — | native |
| Amazon CloudWatch Logs | `aws_cloudwatch_logs` | — | native | — | — |

## When to pick which

- **The platform your security team already watches.** Every destination
  carries the same events.
- **Syslog or Splunk** on premises, **CloudWatch Logs**, **Azure Monitor**
  or **Cloud Logging** in those clouds.
- **Pub/Sub or Event Hubs** when another system consumes the events.
- **No destination:** pull with `GET /api/v1/events`, stream with Server-Sent
  Events, or `usertasks logs tail`.

## Rules

- Destinations on private addresses need `ALLOW_PRIVATE_EGRESS=true`.
- Cloud destinations authenticate with credentials stored per destination.
  Using the app's own managed identity or service account needs
  `LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true`, which is only for single-tenant
  installs: otherwise any workspace admin could write as the instance.
- Events are kept for 72 hours by default. A destination that falls
  further behind is marked `lagging_data_lost`.

Reference: [Log destinations](/docs/observability/destinations).
