# Release notes: log export and live event streaming

This release adds one normalized event stream per workspace and three ways to
use it:

- **Push** to Splunk HEC, Datadog Logs, OpenTelemetry (OTLP/HTTP) or a signed
  HTTPS webhook (log destinations).
- **Pull** with `GET /api/v1/events` (cursor) or stream with
  `GET /api/v1/events/stream` (Server-Sent Events).
- **Tail** with `usertasks logs tail` / `usertasks logs export`, or query with
  the MCP `events_list` tool.

It also fixes several database privilege problems (see **Security fixes**).
Apply the migrations before deploying the app.

## Migrations

Apply in order (all idempotent):

| Migration | What it does |
|---|---|
| `20261024000000_event_stream.sql` | `event_stream` outbox (service role only), normalization triggers on 14 source tables, `purge_event_stream`, `(tenant_id, created_at)` index on `workflow_logs` |
| `20261024000001_observability_permission.sql` | `observability.view` for the system Owner and Admin roles (new and existing workspaces); `events:read` for the first-party CLI client |
| `20261024000002_log_destinations.sql` | `log_destinations` table (service role only) |
| `20261024000003_log_shipper.sql` | `claim_next_log_destination`, purge marks, pg_cron job `usertasks-ship-events`, queue worker RPC revokes |
| `20261024000004_enqueue_workflow_tenant_check.sql` | Tenant checks in `enqueue_workflow` and other exposed `SECURITY DEFINER` functions |

The pg_cron job uses the existing Vault secrets `app_base_url` and
`cron_secret`. Without pg_cron nothing is shipped; the pull API and CLI still
work.

## What's new

- **Event stream.** Workflow run transitions and SLA warnings/breaches, step
  logs (`workflow.step.log`, can be turned off per workspace with
  `settings.event_stream.include_step_logs = false`), queue failures,
  integration calls and dead-lettered webhooks, agent runs, task lifecycle,
  audited changes, OAuth/API key/permission security events, retention,
  deletion and sync runs. Attributes are allow-listed per source: no
  request/response bodies or headers, prompts, outputs, credentials or full
  audit diffs. Retention: 72 hours by default
  (`tenants.settings.event_stream_retention_hours`, max 168).
- **New security audit events.** OAuth consent granted/denied, tokens issued
  (every grant) and revoked, authorization-code replay and refresh-token
  reuse, and sampled API key authentication failures (at most one per key
  prefix per 5 minutes).
- **Log destinations.** Settings → Log Export, `/api/v1/log-destinations`,
  MCP `log_destinations_*`, `usertasks log-destinations …` and config as code
  (`log_destinations` section; credentials are never exported). Credentials
  are encrypted and always masked. Delivery is at least once (dedupe on the
  event `id`) with exponential backoff capped at 5 minutes. A destination
  becomes `failing` after 5 consecutive client errors and
  `lagging_data_lost` if it falls further behind than retention; owners and
  admins are notified once per transition. "Send test event" delivers one
  `system.test` event through the real send path.
- **Pull API and SSE.** `GET /api/v1/events` and `GET /api/v1/events/stream`
  (filters: `category`, `type` globs, `severity`, `workflow_id`, `run_id`,
  `task_id`, `trace_id`, `since`; resume with `after` or `Last-Event-ID`). On
  serverless hosts the stream ends at the function limit with an
  `event: reconnect` hint; the SDK and CLI reconnect without gaps. The SSE
  endpoint takes API keys and OAuth tokens, not browser sessions.
- **SDK / CLI.** `client.events.list/iterate/stream`; `usertasks events
  list`, `usertasks logs tail` (text or NDJSON, auto-reconnect),
  `usertasks logs export`.
- **Docs.** `/docs/observability`: event envelope, type catalogue, severity
  mapping, per-destination setup, webhook signature verification (Node.js
  and Python), SSE usage and self-hosting notes.

## Permissions

- New permission **`observability.view`** reads events and log destinations.
  The system **Owner** and **Admin** roles get it by default (existing
  workspaces are updated by migration `20261024000001`). Manager, Member and
  Viewer do not; add it to custom roles that need it.
- Audit and security events also need `settings.view`, both for reading and
  for a destination that exports them (no category filter, or one naming
  `audit` / `security`).
- Changing destinations needs `settings.edit` as well.
- OAuth scope **`events:read`** maps to `observability.view`.

## Security fixes

- **Queue worker RPCs** (`claim_next_job`, `complete_job`, `fail_job`, the
  agent and deletion job equivalents, and the GitHub/directory sync claim
  functions) were executable by `anon` and `authenticated`. Several are
  `SECURITY DEFINER`, so anyone with the public anon key could claim,
  complete or fail other workspaces' jobs. They are now `service_role` only
  (migration `20261024000003`). Every app caller already used a service-role
  client.
- **`/api/agents/process`** now accepts the `Authorization: Bearer
  <CRON_SECRET>` header that pg_cron sends, so the agent queue job
  authenticates the same way as the other cron endpoints.
- **`enqueue_workflow`** (`SECURITY DEFINER`) accepted any `p_tenant_id` from
  `anon` and `authenticated` callers, so the public anon key could queue any
  workspace's workflow — which the service-role queue processor then ran —
  or attach another workspace's task to a run. Now (migration
  `20261024000004`): the workflow and task must belong to `p_tenant_id` for
  every caller; signed-in users must be members of that workspace; `anon`
  can no longer execute it. Triggers, `service_role` and direct database
  sessions are unchanged.
- In the same migration: `reassign_task` and `escalate_task` (no tenant check,
  executable by `anon`) now require membership of the task's workspace;
  `get_task_tree` only returns tasks the caller is a member, assignee or
  assigner of; `check_object_permission` no longer interpolates an arbitrary
  permission name into dynamic SQL.

## Behaviour changes

- Calling `enqueue_workflow` directly with a workflow from another workspace,
  or a `p_task_id` from another workspace, now fails with
  `workflow_not_found` / `task_not_found` — including through
  `POST /api/v1/workflows/start` and MCP `workflows_start` with `async: true`
  and a foreign `task_id`.
- `cleanup-logs` now ages `integration_call_logs` by `started_at` (the old
  `created_at` filter never matched) and purges `event_stream`.
- `workflow_runs.trace_id` is set when a run is created, so a run's
  integration calls and agent runs share its trace id.

## Self-hosting

- `ALLOW_PRIVATE_EGRESS=true` allows destinations on private networks and
  plain http.
- `NODE_EXTRA_CA_CERTS` trusts a private CA (Splunk `verify_tls=false` is not
  supported).
- `LOG_EXPORT_DATADOG_URL` replaces the Datadog intake URL for every Datadog
  destination (proxy, Observability Pipelines worker or test intake).
