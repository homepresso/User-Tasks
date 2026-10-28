-- Unified event stream (log export phase 1).
--
-- * public.event_stream is a per-tenant outbox of normalized events. `id` is a
--   global monotonic cursor used by the pull API, SSE stream and shippers.
-- * AFTER triggers on the observability/audit source tables normalize each
--   write through app_events.* functions. Attributes are strictly allow-listed
--   per source: never request/response bodies or headers, prompts, outputs,
--   tool payloads, credentials or full audit diffs (changed field names only).
-- * Every trigger traps its own errors (EXCEPTION WHEN OTHERS -> WARNING) so
--   a failing emit can never fail the source write.
-- * UPDATE triggers fire only when the status/SLA columns actually change
--   (UPDATE OF ... WHEN (OLD IS DISTINCT FROM NEW)), so ordinary row updates
--   pay nothing.
-- * workflow_logs (the hot table) uses a statement-level trigger with a
--   transition table: one set-based insert per batch, honouring the tenant
--   setting settings.event_stream.include_step_logs (default true).
-- * No client access: RLS on with no policies, privileges revoked from
--   anon/authenticated. Read through service-role API routes only.
-- * Retention: public.purge_event_stream() (service_role only) deletes one
--   id-bounded batch per call; /api/cron/cleanup-logs loops it per tenant.
--
-- Also: (tenant_id, created_at) index on workflow_logs for retention/tenant
-- time-range queries.
--
-- Idempotent: safe to run more than once.

-- ── Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_stream (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  type         text NOT NULL,
  category     text NOT NULL,
  severity     text NOT NULL DEFAULT 'info',
  message      text NOT NULL,
  source_table text NOT NULL,
  source_id    text,
  trace_id     uuid,
  run_id       uuid,
  workflow_id  uuid,
  task_id      uuid,
  actor_id     uuid,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT event_stream_category_check
    CHECK (category IN ('workflow', 'integration', 'agent', 'audit', 'security', 'task', 'system')),
  CONSTRAINT event_stream_severity_check
    CHECK (severity IN ('debug', 'info', 'warn', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_event_stream_tenant_id
  ON public.event_stream (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_event_stream_tenant_occurred
  ON public.event_stream (tenant_id, occurred_at);

ALTER TABLE public.event_stream ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_stream FROM anon, authenticated;
GRANT ALL ON public.event_stream TO service_role;

COMMENT ON TABLE public.event_stream IS
  'Normalized per-tenant event outbox (log export). Written only by app_events triggers; read via service-role API routes. Purged by /api/cron/cleanup-logs (default 72h, tenants.settings.event_stream_retention_hours, max 168h).';

CREATE INDEX IF NOT EXISTS idx_workflow_logs_tenant_created
  ON public.workflow_logs (tenant_id, created_at);

-- ── Schema + helpers ─────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app_events;
REVOKE ALL ON SCHEMA app_events FROM PUBLIC;
REVOKE ALL ON SCHEMA app_events FROM anon, authenticated;
GRANT USAGE ON SCHEMA app_events TO service_role;

/** Lower-case a value into a safe event-type segment ([a-z0-9_]). */
CREATE OR REPLACE FUNCTION app_events.seg(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(trim(both '_' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9_]+', '_', 'g')), ''),
    'unknown')
$$;

/** Map a free-form log level to the event severity enum. */
CREATE OR REPLACE FUNCTION app_events.severity_of(p_level text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE lower(coalesce(p_level, 'info'))
    WHEN 'debug' THEN 'debug'
    WHEN 'trace' THEN 'debug'
    WHEN 'warn' THEN 'warn'
    WHEN 'warning' THEN 'warn'
    WHEN 'error' THEN 'error'
    WHEN 'fatal' THEN 'error'
    ELSE 'info'
  END
$$;

/** Truncate free text (error messages) to a bounded length. */
CREATE OR REPLACE FUNCTION app_events.clip(p_value text, p_max integer DEFAULT 500)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_value IS NULL THEN NULL
              WHEN length(p_value) <= p_max THEN p_value
              ELSE left(p_value, p_max - 1) || '…' END
$$;

/**
 * Host + path of a URL with the query string, fragment and userinfo dropped,
 * and long opaque path segments (tokens embedded in webhook paths) redacted.
 * UUID segments are kept for debuggability.
 */
CREATE OR REPLACE FUNCTION app_events.url_parts(p_url text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rest text;
  v_host text;
  v_path text;
  v_seg text;
  v_out text[] := ARRAY[]::text[];
BEGIN
  IF p_url IS NULL OR p_url = '' THEN RETURN '{}'::jsonb; END IF;
  v_rest := split_part(split_part(p_url, '#', 1), '?', 1);
  v_rest := regexp_replace(v_rest, '^[a-zA-Z][a-zA-Z0-9+.-]*://', '');
  v_host := split_part(v_rest, '/', 1);
  v_host := regexp_replace(v_host, '^.*@', '');  -- strip userinfo
  v_path := substr(v_rest, length(split_part(v_rest, '/', 1)) + 1);
  IF v_path <> '' THEN
    FOREACH v_seg IN ARRAY string_to_array(v_path, '/') LOOP
      IF v_seg ~ '^[A-Za-z0-9_\-]{24,}$'
         AND v_seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_out := v_out || ':redacted'::text;
      ELSE
        v_out := v_out || v_seg;
      END IF;
    END LOOP;
    v_path := left(array_to_string(v_out, '/'), 300);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'host', nullif(lower(v_host), ''),
    'path', nullif(v_path, '')
  ));
END;
$$;

/**
 * Append one event. Silently ignores rows without a tenant. Callers are the
 * trigger functions below; each wraps its call in an exception block.
 */
CREATE OR REPLACE FUNCTION app_events.emit(
  p_tenant_id    uuid,
  p_type         text,
  p_category     text,
  p_severity     text,
  p_message      text,
  p_source_table text,
  p_source_id    text,
  p_trace_id     uuid DEFAULT NULL,
  p_run_id       uuid DEFAULT NULL,
  p_workflow_id  uuid DEFAULT NULL,
  p_task_id      uuid DEFAULT NULL,
  p_actor_id     uuid DEFAULT NULL,
  p_attributes   jsonb DEFAULT '{}'::jsonb,
  p_occurred_at  timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.event_stream (
    tenant_id, occurred_at, type, category, severity, message,
    source_table, source_id, trace_id, run_id, workflow_id, task_id, actor_id, attributes
  ) VALUES (
    p_tenant_id, coalesce(p_occurred_at, now()), p_type, p_category,
    coalesce(p_severity, 'info'), coalesce(app_events.clip(p_message, 1000), p_type),
    p_source_table, p_source_id, p_trace_id, p_run_id, p_workflow_id, p_task_id, p_actor_id,
    coalesce(jsonb_strip_nulls(p_attributes), '{}'::jsonb)
  );
END;
$$;

-- ── workflow_runs: status transitions + SLA warning/breach ───────────────

CREATE OR REPLACE FUNCTION app_events.tg_workflow_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_status text;
  v_old_sla text;
  v_name text;
  v_sev text;
  v_label text;
  v_workflow_name text;
  v_cancelled boolean;
  v_attrs jsonb;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      v_old_status := OLD.status;
      v_old_sla := OLD.sla_status;
    END IF;
    v_workflow_name := (SELECT w.name FROM public.workflows w WHERE w.id = NEW.workflow_id);
    v_label := coalesce(nullif(NEW.title, ''), nullif(v_workflow_name, ''), 'Workflow run');
    v_attrs := jsonb_build_object(
      'status', NEW.status,
      'previous_status', v_old_status,
      'title', app_events.clip(NEW.title, 200),
      'workflow_name', app_events.clip(v_workflow_name, 200),
      'version_id', NEW.version_id,
      'paused_node_id', NEW.paused_node_id
    );

    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM v_old_status THEN
      v_cancelled := NEW.status IN ('cancelled', 'canceled')
        OR (NEW.status = 'failed' AND NEW.error = 'Manually cancelled');
      v_name := CASE
        WHEN v_cancelled THEN 'cancelled'
        WHEN NEW.status = 'running' AND TG_OP = 'INSERT' THEN 'started'
        WHEN NEW.status = 'running' THEN 'resumed'
        WHEN NEW.status = 'waiting_for_event' THEN 'waiting'
        ELSE app_events.seg(NEW.status)
      END;
      v_sev := CASE
        WHEN v_cancelled THEN 'warn'
        WHEN NEW.status = 'failed' THEN 'error'
        ELSE 'info'
      END;
      IF NEW.completed_at IS NOT NULL AND NEW.status IN ('completed', 'failed') THEN
        v_attrs := v_attrs || jsonb_build_object(
          'duration_ms', (extract(epoch FROM (NEW.completed_at - NEW.started_at)) * 1000)::bigint);
      END IF;
      IF NEW.status = 'failed' THEN
        v_attrs := v_attrs || jsonb_build_object('error', app_events.clip(NEW.error));
      END IF;
      PERFORM app_events.emit(
        NEW.tenant_id, 'workflow.run.' || v_name, 'workflow', v_sev,
        CASE v_name
          WHEN 'started' THEN v_label || ' started'
          WHEN 'resumed' THEN v_label || ' resumed'
          WHEN 'completed' THEN v_label || ' completed'
          WHEN 'failed' THEN v_label || ' failed' || coalesce(': ' || app_events.clip(NEW.error, 300), '')
          WHEN 'cancelled' THEN v_label || ' cancelled'
          WHEN 'paused' THEN v_label || ' paused'
          WHEN 'waiting' THEN v_label || ' is waiting for an event'
          ELSE v_label || ' is now ' || coalesce(NEW.status, 'unknown')
        END,
        'workflow_runs', NEW.id::text, NEW.trace_id, NEW.id, NEW.workflow_id, NEW.task_id, NULL,
        v_attrs,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.started_at ELSE coalesce(NEW.completed_at, now()) END
      );
    END IF;

    IF NEW.sla_status IS DISTINCT FROM v_old_sla AND NEW.sla_status IN ('warning', 'breached') THEN
      PERFORM app_events.emit(
        NEW.tenant_id, 'workflow.run.sla_' || NEW.sla_status, 'workflow',
        CASE NEW.sla_status WHEN 'breached' THEN 'error' ELSE 'warn' END,
        v_label || CASE NEW.sla_status WHEN 'breached' THEN ' breached its SLA' ELSE ' is approaching its SLA' END
          || coalesce(' (' || NEW.sla_label || ')', ''),
        'workflow_runs', NEW.id::text, NEW.trace_id, NEW.id, NEW.workflow_id, NEW.task_id, NULL,
        jsonb_build_object(
          'status', NEW.status,
          'sla_status', NEW.sla_status,
          'previous_sla_status', v_old_sla,
          'sla_label', NEW.sla_label,
          'sla_due_at', NEW.sla_due_at,
          'title', app_events.clip(NEW.title, 200)
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_workflow_runs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── workflow_logs: step logs (statement-level, set-based) ────────────────

CREATE OR REPLACE FUNCTION app_events.tg_workflow_logs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_off uuid[];
BEGIN
  BEGIN
    -- Tenants in this batch that opted out of step-level events. Resolved up
    -- front so the insert below is a plain scan of the transition table
    -- (keeps event ids in row order).
    SELECT coalesce(array_agg(t.id), ARRAY[]::uuid[]) INTO v_off
    FROM public.tenants t
    WHERE t.id IN (SELECT DISTINCT tenant_id FROM new_rows)
      AND lower(coalesce(t.settings -> 'event_stream' ->> 'include_step_logs', 'true'))
          IN ('false', '0', 'no', 'off');

    INSERT INTO public.event_stream (
      tenant_id, occurred_at, type, category, severity, message,
      source_table, source_id, trace_id, run_id, workflow_id, task_id, actor_id, attributes
    )
    SELECT
      n.tenant_id,
      n.created_at,
      'workflow.step.log',
      'workflow',
      app_events.severity_of(n.level),
      app_events.clip(coalesce(nullif(n.node_label, '') || ': ', '') || n.message, 1000),
      'workflow_logs',
      n.id::text,
      NULL,
      n.run_id,
      n.workflow_id,
      NULL,
      NULL,
      jsonb_strip_nulls(jsonb_build_object(
        'node_id', n.node_id,
        'node_type', n.node_type,
        'node_label', app_events.clip(n.node_label, 200),
        'level', n.level,
        'duration_ms', n.duration_ms
      ))
    FROM new_rows n
    WHERE NOT (n.tenant_id = ANY (v_off));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_workflow_logs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── workflow_queue: failed (retry scheduled) / dead ──────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_workflow_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.status IN ('failed', 'dead') THEN
      PERFORM app_events.emit(
        NEW.tenant_id, 'workflow.queue.' || NEW.status, 'workflow',
        CASE NEW.status WHEN 'dead' THEN 'error' ELSE 'warn' END,
        CASE NEW.status
          WHEN 'dead' THEN 'Queued workflow job gave up after ' || coalesce(NEW.attempts, 0) || ' attempts'
          ELSE 'Queued workflow job failed (attempt ' || coalesce(NEW.attempts, 0) || ' of ' || coalesce(NEW.max_attempts, 0) || '), retry scheduled'
        END || coalesce(': ' || app_events.clip(NEW.error, 300), ''),
        'workflow_queue', NEW.id::text, NEW.trace_id, NULL, NEW.workflow_id, NEW.task_id, NULL,
        jsonb_build_object(
          'queue_id', NEW.id,
          'trigger_type', NEW.trigger_type,
          'attempts', NEW.attempts,
          'max_attempts', NEW.max_attempts,
          'next_retry_at', CASE WHEN NEW.status = 'failed' THEN NEW.next_retry_at END,
          'error', app_events.clip(NEW.error)
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_workflow_queue failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── dead_letter_events: outbound webhook gave up ─────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_dead_letter_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_host text;
BEGIN
  BEGIN
    -- Host only: webhook URLs often carry secrets in the path.
    v_host := app_events.url_parts(NEW.target_url) ->> 'host';
    PERFORM app_events.emit(
      NEW.tenant_id, 'integration.webhook.dead_letter', 'integration', 'error',
      'Webhook delivery of ' || coalesce(NEW.event_type, 'event') || coalesce(' to ' || v_host, '')
        || ' failed after ' || coalesce(NEW.attempts, 0) || ' attempts'
        || coalesce(': ' || app_events.clip(NEW.error_message, 300), ''),
      'dead_letter_events', NEW.id::text, NULL, NULL, NULL, NEW.task_id, NULL,
      jsonb_build_object(
        'event_type', NEW.event_type,
        'host', v_host,
        'attempts', NEW.attempts,
        'error', app_events.clip(NEW.error_message)
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_dead_letter_events failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── integration_call_logs: outbound integration calls ────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_integration_call_logs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url jsonb;
  v_failed boolean;
BEGIN
  BEGIN
    v_url := app_events.url_parts(NEW.url);
    v_failed := NEW.error IS NOT NULL OR coalesce(NEW.response_status, 0) >= 400;
    PERFORM app_events.emit(
      NEW.tenant_id, 'integration.call', 'integration',
      CASE WHEN NEW.error IS NOT NULL OR coalesce(NEW.response_status, 0) >= 500 THEN 'error'
           WHEN v_failed THEN 'warn' ELSE 'info' END,
      coalesce(upper(NEW.method) || ' ', '') || coalesce(v_url ->> 'host', 'integration')
        || coalesce(v_url ->> 'path', '')
        || coalesce(' → ' || NEW.response_status, '')
        || coalesce(' in ' || NEW.duration_ms || 'ms', '')
        || coalesce(' (error: ' || app_events.clip(NEW.error, 200) || ')', ''),
      'integration_call_logs', NEW.id::text, NEW.trace_id,
      CASE WHEN NEW.caller_type = 'workflow_node' AND NEW.caller_id ~* '^[0-9a-f-]{36}$'
           THEN NEW.caller_id::uuid END,
      NULL, NULL, NULL,
      jsonb_build_object(
        'integration_id', NEW.integration_id,
        'reference_id', NEW.reference_id,
        'method', upper(NEW.method),
        'host', v_url ->> 'host',
        'path', v_url ->> 'path',
        'status', NEW.response_status,
        'duration_ms', NEW.duration_ms,
        'caller_type', NEW.caller_type,
        'caller_node_id', NEW.caller_node_id,
        'error', app_events.clip(NEW.error)
      ),
      coalesce(NEW.completed_at, NEW.started_at)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_integration_call_logs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── agent_runs: status transitions (no prompts, outputs or tool payloads) ─

CREATE OR REPLACE FUNCTION app_events.tg_agent_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  BEGIN
    v_status := app_events.seg(coalesce(NEW.status, 'running'));
    PERFORM app_events.emit(
      NEW.tenant_id, 'agent.run.' || v_status, 'agent',
      CASE WHEN v_status IN ('failed', 'error') THEN 'error' ELSE 'info' END,
      'Agent run ' || CASE v_status
        WHEN 'running' THEN 'started'
        WHEN 'completed' THEN 'completed'
        WHEN 'failed' THEN 'failed'
        ELSE 'is now ' || v_status END
        || coalesce(' using ' || NEW.model, '')
        || coalesce(' (' || NEW.total_tokens || ' tokens', '')
        || CASE WHEN NEW.total_tokens IS NOT NULL THEN coalesce(', ' || NEW.duration_ms || 'ms)', ')')
                ELSE coalesce(' (' || NEW.duration_ms || 'ms)', '') END
        || CASE WHEN v_status IN ('failed', 'error') THEN coalesce(': ' || app_events.clip(NEW.error, 300), '') ELSE '' END,
      'agent_runs', NEW.id::text, NEW.trace_id, NEW.workflow_run_id, NULL, NULL, NEW.actor_id,
      jsonb_build_object(
        'agent_id', NEW.agent_id,
        'status', NEW.status,
        'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
        'model', NEW.model,
        'iterations', NEW.iterations,
        'input_tokens', NEW.input_tokens,
        'output_tokens', NEW.output_tokens,
        'total_tokens', NEW.total_tokens,
        'duration_ms', NEW.duration_ms,
        'caller_type', NEW.caller_type,
        'error', app_events.clip(NEW.error)
      ),
      CASE WHEN TG_OP = 'INSERT' THEN coalesce(NEW.completed_at, NEW.started_at, NEW.created_at)
           ELSE coalesce(NEW.completed_at, now()) END
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_agent_runs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── object_audit_log: audit.* (security.* for OAuth / API keys) ──────────

CREATE OR REPLACE FUNCTION app_events.tg_object_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_security boolean;
  v_kind text;
  v_action text;
  v_type text;
  v_sev text := 'info';
  v_fields jsonb;
  v_meta jsonb;
BEGIN
  BEGIN
    v_security := NEW.object_type IN ('oauth_client', 'api_key');
    v_meta := CASE WHEN jsonb_typeof(NEW.metadata) = 'object' THEN NEW.metadata ELSE '{}'::jsonb END;
    -- Changed field names only — never the before/after values.
    IF jsonb_typeof(NEW.diff) = 'object' THEN
      SELECT jsonb_agg(k ORDER BY k) INTO v_fields FROM jsonb_object_keys(NEW.diff) AS k;
    END IF;

    v_action := app_events.seg(coalesce(v_meta ->> 'event', NEW.action));
    IF v_security THEN
      v_kind := CASE NEW.object_type WHEN 'oauth_client' THEN 'oauth' ELSE 'api_key' END;
      v_type := 'security.' || v_kind || '.' || v_action;
      v_sev := CASE
        WHEN v_action IN ('auth_failed', 'code_replay', 'refresh_reuse') THEN 'warn'
        ELSE 'info'
      END;
    ELSE
      v_type := 'audit.' || app_events.seg(NEW.object_type) || '.' || app_events.seg(NEW.action);
    END IF;

    PERFORM app_events.emit(
      NEW.tenant_id, v_type, CASE WHEN v_security THEN 'security' ELSE 'audit' END, v_sev,
      coalesce(nullif(NEW.summary, ''),
               initcap(replace(NEW.action, '_', ' ')) || ' ' || replace(NEW.object_type, '_', ' ') || ' ' || NEW.object_id),
      'object_audit_log', NEW.id::text, NULL, NULL, NULL, NULL, NEW.actor_id,
      jsonb_build_object(
        'object_type', NEW.object_type,
        'object_id', NEW.object_id,
        'action', NEW.action,
        'changed_fields', v_fields,
        -- Allow-listed metadata keys only (identifiers, never secrets).
        'client_id', CASE WHEN v_security THEN v_meta ->> 'client_id' END,
        'grant_type', CASE WHEN v_security THEN v_meta ->> 'grant_type' END,
        'token_type', CASE WHEN v_security THEN v_meta ->> 'token_type' END,
        'scopes', CASE WHEN v_security AND jsonb_typeof(v_meta -> 'scopes') = 'array' THEN v_meta -> 'scopes' END,
        'key_prefix', CASE WHEN v_security THEN v_meta ->> 'key_prefix' END,
        'reason', CASE WHEN v_security THEN v_meta ->> 'reason' END
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_object_audit_log failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── permission_audit_log: security.permission.* ──────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_permission_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_details jsonb;
  v_role text;
BEGIN
  BEGIN
    v_details := CASE WHEN jsonb_typeof(NEW.details) = 'object' THEN NEW.details ELSE '{}'::jsonb END;
    v_role := coalesce(v_details ->> 'role_name', v_details ->> 'name');
    PERFORM app_events.emit(
      NEW.tenant_id, 'security.permission.' || app_events.seg(NEW.action), 'security', 'info',
      initcap(replace(NEW.action, '_', ' ')) || coalesce(' (' || v_role || ')', ''),
      'permission_audit_log', NEW.id::text, NULL,
      CASE WHEN (v_details ->> 'workflow_run_id') ~* '^[0-9a-f-]{36}$' THEN (v_details ->> 'workflow_run_id')::uuid END,
      NULL, NULL, NEW.actor_id,
      jsonb_build_object(
        'action', NEW.action,
        'target_user_id', NEW.target_user_id,
        'role_id', NEW.role_id,
        'role_name', v_role,
        'count', CASE WHEN jsonb_typeof(v_details -> 'count') = 'number' THEN v_details -> 'count' END,
        'permissions', CASE WHEN jsonb_typeof(v_details -> 'permissions') = 'array' THEN v_details -> 'permissions' END,
        'source', v_details ->> 'source'
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_permission_audit_log failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── retention_execution_events / retention_review_events ─────────────────

CREATE OR REPLACE FUNCTION app_events.tg_retention_execution_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ok boolean;
BEGIN
  BEGIN
    v_ok := NEW.result_status = 'completed';
    PERFORM app_events.emit(
      NEW.tenant_id,
      CASE WHEN v_ok THEN 'system.retention.purged' ELSE 'system.retention.purge_failed' END,
      'system', CASE WHEN v_ok THEN 'info' ELSE 'error' END,
      CASE WHEN v_ok THEN 'Retention policy purged ' ELSE 'Retention policy failed to purge ' END
        || replace(NEW.target_type, '_', ' ') || coalesce(' "' || app_events.clip(NEW.asset_name, 200) || '"', ''),
      'retention_execution_events', NEW.id::text, NULL, NULL, NULL, NULL, NULL,
      jsonb_build_object(
        'retention_policy_id', NEW.retention_policy_id,
        'action_type', NEW.action_type,
        'target_type', NEW.target_type,
        'target_id', NEW.target_id,
        'asset_name', app_events.clip(NEW.asset_name, 200),
        'result_status', NEW.result_status
      ),
      NEW.executed_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_retention_execution_events failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_events.tg_retention_review_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  BEGIN
    v_name := CASE WHEN TG_OP = 'INSERT' THEN 'review_opened' ELSE 'review_' || app_events.seg(NEW.status) END;
    PERFORM app_events.emit(
      NEW.tenant_id, 'system.retention.' || v_name, 'system', 'info',
      'Retention review ' || CASE WHEN TG_OP = 'INSERT' THEN 'opened' ELSE coalesce(NEW.status, 'updated') END
        || ' for ' || replace(NEW.target_type, '_', ' ')
        || coalesce(' "' || app_events.clip(NEW.asset_name, 200) || '"', ''),
      'retention_review_events', NEW.id::text, NULL, NULL, NULL, NULL, NULL,
      jsonb_build_object(
        'retention_policy_id', NEW.retention_policy_id,
        'target_type', NEW.target_type,
        'target_id', NEW.target_id,
        'asset_name', app_events.clip(NEW.asset_name, 200),
        'review_date', NEW.review_date,
        'status', NEW.status,
        'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_retention_review_events failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── deletion_queue: completed / failed ───────────────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_deletion_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.status IN ('completed', 'failed') THEN
      PERFORM app_events.emit(
        NEW.tenant_id, 'system.deletion.' || NEW.status, 'system',
        CASE NEW.status WHEN 'failed' THEN 'error' ELSE 'info' END,
        CASE NEW.status WHEN 'failed' THEN 'Deletion of ' ELSE 'Deleted ' END
          || replace(NEW.target_type, '_', ' ') || ' ' || NEW.target_id
          || CASE NEW.status WHEN 'failed' THEN ' failed' || coalesce(': ' || app_events.clip(NEW.error, 300), '') ELSE '' END,
        'deletion_queue', NEW.id::text, NULL, NULL, NULL, NULL, NEW.created_by,
        jsonb_build_object(
          'target_type', NEW.target_type,
          'target_id', NEW.target_id,
          'attempts', NEW.attempts,
          'error', app_events.clip(NEW.error)
        ),
        coalesce(NEW.completed_at, now())
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_deletion_queue failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── github_sync_runs / directory_sync_runs: terminal statuses ────────────

CREATE OR REPLACE FUNCTION app_events.tg_github_sync_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF NEW.status IN ('completed', 'failed') THEN
      PERFORM app_events.emit(
        NEW.tenant_id, 'system.sync.github.' || NEW.status, 'system',
        CASE NEW.status WHEN 'failed' THEN 'error' ELSE 'info' END,
        'GitHub sync (' || replace(NEW.kind, '_', ' ') || ') ' || NEW.status
          || CASE WHEN NEW.status = 'completed' THEN coalesce(', ' || NEW.files_changed || ' files changed', '')
                  ELSE coalesce(': ' || app_events.clip(NEW.error, 300), '') END,
        'github_sync_runs', NEW.id::text, NULL, NULL, NULL, NULL, NEW.created_by,
        jsonb_build_object(
          'kind', NEW.kind,
          'status', NEW.status,
          'commit_sha', NEW.commit_sha,
          'files_changed', NEW.files_changed,
          'attempts', NEW.attempts,
          'duration_ms', CASE WHEN NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL
            THEN (extract(epoch FROM (NEW.completed_at - NEW.started_at)) * 1000)::bigint END,
          'error', app_events.clip(NEW.error)
        ),
        coalesce(NEW.completed_at, now())
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_github_sync_runs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_events.tg_directory_sync_runs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stats jsonb;
BEGIN
  BEGIN
    IF NEW.status IN ('completed', 'failed') THEN
      -- Numeric counters only.
      IF jsonb_typeof(NEW.stats) = 'object' THEN
        SELECT jsonb_object_agg(key, value) INTO v_stats
        FROM jsonb_each(NEW.stats) WHERE jsonb_typeof(value) = 'number';
      END IF;
      PERFORM app_events.emit(
        NEW.tenant_id, 'system.sync.directory.' || NEW.status, 'system',
        CASE NEW.status WHEN 'failed' THEN 'error' ELSE 'info' END,
        initcap(NEW.provider) || ' directory sync ' || NEW.status
          || CASE WHEN NEW.status = 'failed' THEN coalesce(': ' || app_events.clip(NEW.error, 300), '') ELSE '' END,
        'directory_sync_runs', NEW.id::text, NULL, NULL, NULL, NULL, NEW.created_by,
        jsonb_build_object(
          'provider', NEW.provider,
          'status', NEW.status,
          'stats', v_stats,
          'attempts', NEW.attempts,
          'duration_ms', CASE WHEN NEW.started_at IS NOT NULL AND NEW.completed_at IS NOT NULL
            THEN (extract(epoch FROM (NEW.completed_at - NEW.started_at)) * 1000)::bigint END,
          'error', app_events.clip(NEW.error)
        ),
        coalesce(NEW.completed_at, now())
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_directory_sync_runs failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- ── lifecycle_events: task.* ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_events.tg_lifecycle_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event text;
  v_meta jsonb;
BEGIN
  BEGIN
    v_event := NEW.event_type::text;
    v_meta := CASE WHEN jsonb_typeof(NEW.metadata) = 'object' THEN NEW.metadata ELSE '{}'::jsonb END;
    PERFORM app_events.emit(
      NEW.tenant_id, 'task.' || app_events.seg(v_event), 'task',
      CASE WHEN v_event IN ('escalated', 'task_escalated', 'blocked', 'task_rejected', 'task_unanimous_failed') THEN 'warn' ELSE 'info' END,
      'Task ' || replace(regexp_replace(v_event, '^task_', ''), '_', ' ')
        || CASE WHEN v_meta ? 'old_status' OR v_meta ? 'new_status'
                THEN ' (' || coalesce(v_meta ->> 'old_status', '?') || ' → ' || coalesce(v_meta ->> 'new_status', '?') || ')'
                ELSE '' END,
      'lifecycle_events', NEW.id::text, NULL, NULL, NULL, NEW.task_id, NEW.actor_id,
      jsonb_build_object(
        'event_type', v_event,
        'old_status', v_meta ->> 'old_status',
        'new_status', v_meta ->> 'new_status',
        'old_assignee', v_meta ->> 'old_assignee',
        'new_assignee', v_meta ->> 'new_assignee'
      ),
      NEW.created_at
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_events.tg_lifecycle_events failed: % (%)', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_events FROM PUBLIC, anon, authenticated;

-- ── Triggers ─────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.workflow_runs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_workflow_runs();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.workflow_runs;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status, sla_status ON public.workflow_runs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.sla_status IS DISTINCT FROM NEW.sla_status)
  EXECUTE FUNCTION app_events.tg_workflow_runs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.workflow_logs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.workflow_logs
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app_events.tg_workflow_logs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.workflow_queue;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.workflow_queue
  FOR EACH ROW WHEN (NEW.status IN ('failed', 'dead'))
  EXECUTE FUNCTION app_events.tg_workflow_queue();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.workflow_queue;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.workflow_queue
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('failed', 'dead'))
  EXECUTE FUNCTION app_events.tg_workflow_queue();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.dead_letter_events;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.dead_letter_events
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_dead_letter_events();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.integration_call_logs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.integration_call_logs
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_integration_call_logs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.agent_runs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_agent_runs();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.agent_runs;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.agent_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app_events.tg_agent_runs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.object_audit_log;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.object_audit_log
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_object_audit_log();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.permission_audit_log;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.permission_audit_log
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_permission_audit_log();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.retention_execution_events;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.retention_execution_events
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_retention_execution_events();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.retention_review_events;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.retention_review_events
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_retention_review_events();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.retention_review_events;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.retention_review_events
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app_events.tg_retention_review_events();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.deletion_queue;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.deletion_queue
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_deletion_queue();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.deletion_queue;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.deletion_queue
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_deletion_queue();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.github_sync_runs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.github_sync_runs
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_github_sync_runs();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.github_sync_runs;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.github_sync_runs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_github_sync_runs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.directory_sync_runs;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.directory_sync_runs
  FOR EACH ROW WHEN (NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_directory_sync_runs();
DROP TRIGGER IF EXISTS trg_event_stream_upd ON public.directory_sync_runs;
CREATE TRIGGER trg_event_stream_upd AFTER UPDATE OF status ON public.directory_sync_runs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'failed'))
  EXECUTE FUNCTION app_events.tg_directory_sync_runs();

DROP TRIGGER IF EXISTS trg_event_stream_ins ON public.lifecycle_events;
CREATE TRIGGER trg_event_stream_ins AFTER INSERT ON public.lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION app_events.tg_lifecycle_events();

-- ── Retention ────────────────────────────────────────────────────────────

/**
 * Delete one batch of a tenant's events older than p_before. The batch is
 * bounded by an id range (≤ the p_batch_size-th oldest expired id) so each
 * call is a short transaction; callers loop until it returns < p_batch_size.
 */
CREATE OR REPLACE FUNCTION public.purge_event_stream(
  p_tenant_id uuid,
  p_before timestamptz,
  p_batch_size integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max_id bigint;
  v_deleted integer;
BEGIN
  SELECT max(id) INTO v_max_id FROM (
    SELECT id FROM public.event_stream
    WHERE tenant_id = p_tenant_id AND occurred_at < p_before
    ORDER BY occurred_at
    LIMIT greatest(1, least(coalesce(p_batch_size, 5000), 50000))
  ) batch;
  IF v_max_id IS NULL THEN RETURN 0; END IF;

  DELETE FROM public.event_stream
  WHERE tenant_id = p_tenant_id AND id <= v_max_id AND occurred_at < p_before;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_event_stream(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_event_stream(uuid, timestamptz, integer) TO service_role;
