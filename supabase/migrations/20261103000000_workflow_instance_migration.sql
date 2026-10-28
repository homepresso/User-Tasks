-- Live instance migration (feature phase 4).
--
-- Moving a live run (waiting_for_event / paused) to another version of its
-- workflow closes the old run and starts a new one on the target version at
-- a chosen node:
--
-- * workflow_runs.status gains the terminal value 'migrated' (status is free
--   text — no CHECK to change). Like completed/failed it is not an active
--   status, so the SLA sweep, queue claims and resume paths ignore it.
-- * workflow_runs.migrated_to_run_id / migrated_from_run_id link the two runs
--   (self FKs, ON DELETE SET NULL, indexed).
-- * public.migrate_workflow_instance(...) does the whole move in one
--   transaction, conditionally: the old run must still be waiting/paused on
--   the expected event and version, otherwise nothing changes and it returns
--   { ok: false, conflict: true }. On success it inserts the new run (status
--   'paused' at the target node, carrying the old run's pause variables over
--   the target version's defaults, same trace/task/title/SLA), marks the old
--   run 'migrated' (pause state cleared), cancels the old run's open user
--   task(s) for its event (the tasks trigger records the lifecycle event) and
--   kills its pending delay_resume / task_resume queue jobs. The caller
--   (lib/services/workflow-runs.ts) then starts the new run at the target
--   node through the engine's go-to resume. Service role only.
-- * public.workflow_live_instance_counts(...) — live runs per version
--   (SECURITY INVOKER: workflow_runs RLS applies to signed-in callers).
-- * Event stream: the run trigger emits workflow.run.migrated for both runs
--   (attributes carry the from/to run ids) and reports the new run's first
--   claim as "started" rather than "resumed".
-- * New permission workflows.manage_runs (migrating live instances): System
--   Owner/Admin/Manager roles get it (new tenants via seed_tenant_roles,
--   which mirrors SYSTEM_ROLES in lib/tenant-provisioning.ts; existing tenants
--   via the UPDATE below). Member/Viewer and custom roles opt in.
--
-- Idempotent: safe to run more than once.

-- ── Columns + indexes ────────────────────────────────────────────────────

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS migrated_to_run_id uuid,
  ADD COLUMN IF NOT EXISTS migrated_from_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_migrated_to_run_id_fkey') THEN
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT workflow_runs_migrated_to_run_id_fkey
      FOREIGN KEY (migrated_to_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_migrated_from_run_id_fkey') THEN
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT workflow_runs_migrated_from_run_id_fkey
      FOREIGN KEY (migrated_from_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_migrated_to
  ON public.workflow_runs (migrated_to_run_id) WHERE migrated_to_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_migrated_from
  ON public.workflow_runs (migrated_from_run_id) WHERE migrated_from_run_id IS NOT NULL;
-- Live instances of a workflow (instances list, per-version counts).
CREATE INDEX IF NOT EXISTS idx_workflow_runs_live
  ON public.workflow_runs (workflow_id, version_id)
  WHERE status IN ('waiting_for_event', 'paused');

COMMENT ON COLUMN public.workflow_runs.migrated_to_run_id IS
  'Set when this run was migrated (status migrated): the run that continues it on the target version.';
COMMENT ON COLUMN public.workflow_runs.migrated_from_run_id IS
  'Set on a run created by a live instance migration: the run it continues.';

-- ── Atomic migrate ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.migrate_workflow_instance(
  p_tenant_id         uuid,
  p_run_id            uuid,
  p_expected_event_id text,
  p_from_version_id   uuid,
  p_to_version_id     uuid,
  p_target_node_id    text,
  p_variable_defaults jsonb DEFAULT '{}'::jsonb,
  p_trace             jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Not '': triggers on workflow_runs / tasks (run counters, task lifecycle)
-- resolve unqualified names and inherit this path. pg_temp last.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.workflow_runs%ROWTYPE;
  v_new_id uuid;
  v_vars jsonb;
  v_task_ids uuid[] := ARRAY[]::uuid[];
  v_job_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_tenant_id IS NULL OR p_run_id IS NULL OR p_to_version_id IS NULL
     OR coalesce(p_target_node_id, '') = '' THEN
    RAISE EXCEPTION 'tenant, run, target version and target node are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.workflow_runs
  WHERE id = p_run_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'reason', 'Run not found');
  END IF;

  -- The run must still be exactly as planned: live, waiting on the same
  -- event, on the same version. Anything else (resumed, running, completed,
  -- cancelled, paused again elsewhere) is a conflict and nothing changes.
  IF v_old.status NOT IN ('waiting_for_event', 'paused')
     OR v_old.event_id IS DISTINCT FROM p_expected_event_id
     OR v_old.version_id IS DISTINCT FROM p_from_version_id THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true, 'status', v_old.status,
      'reason', CASE
        WHEN v_old.status NOT IN ('waiting_for_event', 'paused') THEN 'Run is ' || v_old.status || ', no longer waiting or paused'
        WHEN v_old.version_id IS DISTINCT FROM p_from_version_id THEN 'Run is on a different version than planned'
        ELSE 'Run moved on (it waits on a different event than planned)'
      END);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_versions v
    WHERE v.id = p_to_version_id AND v.workflow_id = v_old.workflow_id AND v.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Target version does not belong to this workflow' USING ERRCODE = '22023';
  END IF;

  -- Saved variables win over the target version's defaults for new variables.
  v_vars := coalesce(p_variable_defaults, '{}'::jsonb) || coalesce(v_old.pause_variables, '{}'::jsonb);

  INSERT INTO public.workflow_runs (
    workflow_id, tenant_id, task_id, status, version_id, trace_id, title,
    paused_at, paused_node_id, pause_variables, node_results, execution_trace,
    migrated_from_run_id,
    sla_label, sla_due_at, sla_warning_at, sla_status, sla_warning_triggered_at,
    sla_breached_triggered_at, sla_last_evaluated_at, sla_metadata
  ) VALUES (
    v_old.workflow_id, p_tenant_id, v_old.task_id, 'paused', p_to_version_id,
    coalesce(v_old.trace_id, v_old.id), v_old.title,
    now(), p_target_node_id, v_vars, '{}'::jsonb,
    jsonb_build_array(coalesce(p_trace, '{}'::jsonb) || jsonb_build_object(
      'type', 'migrated',
      'from_run_id', v_old.id,
      'from_version_id', v_old.version_id,
      'from_node_id', v_old.paused_node_id,
      'node_id', p_target_node_id,
      'to_version_id', p_to_version_id,
      'at', now()
    )),
    v_old.id,
    v_old.sla_label, v_old.sla_due_at, v_old.sla_warning_at, v_old.sla_status, v_old.sla_warning_triggered_at,
    v_old.sla_breached_triggered_at, v_old.sla_last_evaluated_at, v_old.sla_metadata
  )
  RETURNING id INTO v_new_id;

  UPDATE public.workflow_runs SET
    status = 'migrated',
    migrated_to_run_id = v_new_id,
    completed_at = now(),
    event_id = NULL,
    paused_at = NULL,
    paused_node_id = NULL,
    pause_variables = NULL
  WHERE id = v_old.id;

  -- Its open user task(s) can never resume it now.
  IF v_old.event_id IS NOT NULL THEN
    WITH closed AS (
      UPDATE public.tasks SET status = 'cancelled'
      WHERE tenant_id = p_tenant_id
        AND event_id = v_old.event_id
        AND status IN ('draft', 'todo', 'in_progress', 'blocked')
      RETURNING id
    )
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_task_ids FROM closed;
  END IF;

  -- Pending timed resumes and queued task resumes of the old run.
  WITH killed AS (
    UPDATE public.workflow_queue SET
      status = 'dead',
      completed_at = now(),
      error = 'Run migrated to ' || v_new_id::text
    WHERE tenant_id = p_tenant_id
      AND workflow_id = v_old.workflow_id
      AND status = 'pending'
      AND (
        (trigger_type = 'delay_resume' AND trigger_data->>'_resume_run_id' = v_old.id::text)
        OR (trigger_type = 'task_resume' AND trigger_data->'_task_resume'->>'run_id' = v_old.id::text)
      )
    RETURNING id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_job_ids FROM killed;

  RETURN jsonb_build_object(
    'ok', true,
    'new_run_id', v_new_id,
    'previous_status', v_old.status,
    'closed_task_ids', to_jsonb(v_task_ids),
    'cancelled_job_ids', to_jsonb(v_job_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_workflow_instance(uuid, uuid, text, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_workflow_instance(uuid, uuid, text, uuid, uuid, text, jsonb, jsonb) TO service_role;

-- ── Live instance counts per version ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.workflow_live_instance_counts(p_tenant_id uuid, p_workflow_id uuid)
RETURNS TABLE (version_id uuid, instances integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT r.version_id, count(*)::integer
  FROM public.workflow_runs r
  WHERE r.tenant_id = p_tenant_id
    AND r.workflow_id = p_workflow_id
    AND r.status IN ('waiting_for_event', 'paused')
  GROUP BY r.version_id
$$;

REVOKE ALL ON FUNCTION public.workflow_live_instance_counts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_live_instance_counts(uuid, uuid) TO authenticated, service_role;

-- ── Event stream: migrated runs ──────────────────────────────────────────

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
  v_migrated_in boolean;
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
    IF NEW.migrated_from_run_id IS NOT NULL THEN
      v_attrs := v_attrs || jsonb_build_object('migrated_from_run_id', NEW.migrated_from_run_id);
    END IF;
    IF NEW.migrated_to_run_id IS NOT NULL THEN
      v_attrs := v_attrs || jsonb_build_object('migrated_to_run_id', NEW.migrated_to_run_id);
    END IF;

    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM v_old_status THEN
      v_cancelled := NEW.status IN ('cancelled', 'canceled')
        OR (NEW.status = 'failed' AND NEW.error = 'Manually cancelled');
      -- A run created by a migration: its insert is the "migrated in" event.
      v_migrated_in := TG_OP = 'INSERT' AND NEW.migrated_from_run_id IS NOT NULL;
      v_name := CASE
        WHEN v_cancelled THEN 'cancelled'
        WHEN v_migrated_in OR NEW.status = 'migrated' THEN 'migrated'
        WHEN NEW.status = 'running' AND TG_OP = 'INSERT' THEN 'started'
        -- First claim of a migrated-in run (it has never executed a node).
        WHEN NEW.status = 'running' AND v_old_status = 'paused'
          AND NEW.migrated_from_run_id IS NOT NULL
          AND coalesce(OLD.node_results, '{}'::jsonb) = '{}'::jsonb THEN 'started'
        WHEN NEW.status = 'running' THEN 'resumed'
        WHEN NEW.status = 'waiting_for_event' THEN 'waiting'
        ELSE app_events.seg(NEW.status)
      END;
      v_sev := CASE
        WHEN v_cancelled THEN 'warn'
        WHEN NEW.status = 'failed' THEN 'error'
        ELSE 'info'
      END;
      IF v_name = 'migrated' THEN
        v_attrs := v_attrs || jsonb_build_object('direction', CASE WHEN v_migrated_in THEN 'in' ELSE 'out' END);
      END IF;
      IF NEW.completed_at IS NOT NULL AND NEW.status IN ('completed', 'failed') THEN
        v_attrs := v_attrs || jsonb_build_object(
          'duration_ms', (extract(epoch FROM (NEW.completed_at - NEW.started_at)) * 1000)::bigint);
      END IF;
      IF NEW.status = 'failed' THEN
        v_attrs := v_attrs || jsonb_build_object('error', app_events.clip(NEW.error));
      END IF;
      PERFORM app_events.emit(
        NEW.tenant_id, 'workflow.run.' || v_name, 'workflow', v_sev,
        CASE
          WHEN v_name = 'migrated' AND v_migrated_in THEN v_label || ' continues migrated run ' || NEW.migrated_from_run_id::text
          WHEN v_name = 'migrated' THEN v_label || ' migrated to run ' || coalesce(NEW.migrated_to_run_id::text, 'unknown')
          WHEN v_name = 'started' THEN v_label || ' started'
          WHEN v_name = 'resumed' THEN v_label || ' resumed'
          WHEN v_name = 'completed' THEN v_label || ' completed'
          WHEN v_name = 'failed' THEN v_label || ' failed' || coalesce(': ' || app_events.clip(NEW.error, 300), '')
          WHEN v_name = 'cancelled' THEN v_label || ' cancelled'
          WHEN v_name = 'paused' THEN v_label || ' paused'
          WHEN v_name = 'waiting' THEN v_label || ' is waiting for an event'
          ELSE v_label || ' is now ' || coalesce(NEW.status, 'unknown')
        END,
        'workflow_runs', NEW.id::text, NEW.trace_id, NEW.id, NEW.workflow_id, NEW.task_id, NULL,
        v_attrs,
        CASE WHEN TG_OP = 'INSERT' THEN NEW.started_at ELSE coalesce(NEW.completed_at, now()) END
      );
    END IF;

    IF NEW.sla_status IS DISTINCT FROM v_old_sla AND NEW.sla_status IN ('warning', 'breached')
       -- A migrated-in run copies its predecessor's SLA state: not a new transition.
       AND NOT (TG_OP = 'INSERT' AND NEW.migrated_from_run_id IS NOT NULL) THEN
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

REVOKE ALL ON FUNCTION app_events.tg_workflow_runs() FROM PUBLIC, anon, authenticated;

-- ── Permission: workflows.manage_runs ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view'
  ];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- observability.view
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.manage_runs', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy'
  ];
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'workflows.view', 'data.view',
    'reports.view', 'team.view_members'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_all,     true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_all,     true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
SET permissions = array_append(permissions, 'workflows.manage_runs')
WHERE is_system
  AND slug IN ('owner', 'admin', 'manager')
  AND NOT ('workflows.manage_runs' = ANY (permissions));
