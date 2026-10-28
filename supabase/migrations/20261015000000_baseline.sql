-- ============================================================================
-- 20261015000000_baseline.sql
--
-- Baseline schema for UserTasks: a `supabase db dump -s public,app_cron` of
-- the production project taken 2026-10-15, before the strip-back. It replaces
-- the 92 incremental migrations now in supabase/migrations_archive/ (several
-- base tables were only ever created from the dashboard, so the old files
-- could not build a database from scratch).
--
-- This file intentionally still contains the retired feature tables (cases,
-- channels, forms, pages, kanban, documents, apps, metering, …) exactly as
-- they existed in production; 20261015000004_strip_back.sql drops them. That
-- keeps the baseline byte-for-byte comparable with the live schema so the
-- live project can adopt it with `migration repair` (see docs/migrations.md).
--
-- Objects outside public/app_cron live in the follow-up migrations:
--   0001 auth.users trigger, 0002 pg_cron jobs, 0003 storage + realtime.
--
-- Environment review: no project refs, URLs, or secrets are embedded; grants
-- only target the standard Supabase roles (postgres, anon, authenticated,
-- service_role); extensions used (pgcrypto in schema `extensions`, pg_net,
-- vault) ship with every Supabase stack — pg_cron/pg_net are created in 0002.
-- app_cron.invoke_endpoint reads its base URL and bearer secret from Vault
-- at call time (see docs/self-hosting.md).
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app_cron";


ALTER SCHEMA "app_cron" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."auth_provider" AS ENUM (
    'email',
    'google',
    'azure_ad',
    'saml'
);


ALTER TYPE "public"."auth_provider" OWNER TO "postgres";


CREATE TYPE "public"."effort_record_type" AS ENUM (
    'assigner_estimate',
    'assignee_estimate',
    'actual',
    'timer_entry'
);


ALTER TYPE "public"."effort_record_type" OWNER TO "postgres";


CREATE TYPE "public"."lifecycle_event_type" AS ENUM (
    'created',
    'assigned',
    'started',
    'reassigned',
    'escalated',
    'redirected',
    'delegated',
    'snoozed',
    'blocked',
    'unblocked',
    'completed',
    'cancelled',
    'reopened',
    'comment_added',
    'task_accepted',
    'task_held',
    'task_rejected',
    'task_redirected',
    'task_escalated',
    'task_response',
    'task_unanimous_failed'
);


ALTER TYPE "public"."lifecycle_event_type" OWNER TO "postgres";


CREATE TYPE "public"."page_kind" AS ENUM (
    'page',
    'form',
    'task',
    'case'
);


ALTER TYPE "public"."page_kind" OWNER TO "postgres";


CREATE TYPE "public"."task_priority" AS ENUM (
    'critical',
    'high',
    'medium',
    'low',
    'none'
);


ALTER TYPE "public"."task_priority" OWNER TO "postgres";


CREATE TYPE "public"."task_status" AS ENUM (
    'draft',
    'todo',
    'in_progress',
    'blocked',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."task_status" OWNER TO "postgres";


CREATE TYPE "public"."tenant_plan" AS ENUM (
    'personal_free',
    'personal_pro',
    'business_team',
    'business_enterprise'
);


ALTER TYPE "public"."tenant_plan" OWNER TO "postgres";


CREATE TYPE "public"."token_action_type" AS ENUM (
    'task_created',
    'subtask_created',
    'task_reassigned',
    'task_escalated',
    'external_data_fetch',
    'webhook_fired',
    'template_render',
    'task_updated',
    'task_completed',
    'workflow_run',
    'workflow_node_exec',
    'webhook_received',
    'agent_run',
    'ai_tokens_1k',
    'agent_tool_call',
    'form_submission',
    'template_publish',
    'data_row_write',
    'data_row_read',
    'file_upload_mb',
    'file_download_mb',
    'external_api_call',
    'notification_sent',
    'email_sent',
    'report_query',
    'report_export',
    'role_change',
    'mcp_tool_call'
);


ALTER TYPE "public"."token_action_type" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'owner',
    'admin',
    'manager',
    'member',
    'viewer'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_cron"."invoke_endpoint"("p_path" "text", "p_method" "text" DEFAULT 'POST'::"text", "p_body" "jsonb" DEFAULT '{}'::"jsonb", "p_timeout_ms" integer DEFAULT 90000) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_base_url   text;
  v_secret     text;
  v_request_id bigint;
begin
  select decrypted_secret into v_base_url
    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  if v_base_url is null or v_secret is null then
    raise exception 'app_cron.invoke_endpoint: vault secrets app_base_url / cron_secret are not configured (see migration header)';
  end if;

  if upper(p_method) = 'GET' then
    select net.http_get(
      url                  := rtrim(v_base_url, '/') || p_path,
      headers              := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := p_timeout_ms
    ) into v_request_id;
  else
    select net.http_post(
      url                  := rtrim(v_base_url, '/') || p_path,
      body                 := p_body,
      headers              := jsonb_build_object(
                                'Content-Type', 'application/json',
                                'Authorization', 'Bearer ' || v_secret),
      timeout_milliseconds := p_timeout_ms
    ) into v_request_id;
  end if;

  return v_request_id;
end;
$$;


ALTER FUNCTION "app_cron"."invoke_endpoint"("p_path" "text", "p_method" "text", "p_body" "jsonb", "p_timeout_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_task_dependency"("p_task" "uuid", "p_depends_on" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
  v_cycle boolean;
  v_id uuid;
BEGIN
  IF p_task = p_depends_on THEN
    RAISE EXCEPTION 'dependency_cycle';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.tasks WHERE id = p_task;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;
  IF v_tenant <> public.get_current_tenant_id() THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks WHERE id = p_depends_on AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;

  -- Serialize concurrent edge inserts per tenant so two simultaneous adds
  -- can't each pass the cycle check and jointly create a loop.
  PERFORM pg_advisory_xact_lock(hashtext('task_deps:' || v_tenant::text));

  WITH RECURSIVE walk(task_id, depth) AS (
    SELECT p_depends_on, 0
    UNION ALL
    SELECT d.depends_on_task_id, w.depth + 1
    FROM public.task_dependencies d
    JOIN walk w ON d.task_id = w.task_id
    WHERE w.depth < 100
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE task_id = p_task) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'dependency_cycle';
  END IF;

  INSERT INTO public.task_dependencies (tenant_id, task_id, depends_on_task_id, created_by)
  VALUES (v_tenant, p_task, p_depends_on, auth.uid())
  ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET task_id = EXCLUDED.task_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


ALTER FUNCTION "public"."add_task_dependency"("p_task" "uuid", "p_depends_on" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_case_number"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prefix text;
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    SELECT COALESCE(NULLIF(number_prefix, ''), 'CS') INTO v_prefix
    FROM public.case_types WHERE id = NEW.case_type_id;
    NEW.number := public.next_case_number(NEW.tenant_id, COALESCE(v_prefix, 'CS'));
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_case_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_user_capacity"("p_user_id" "uuid", "p_week_start" "date" DEFAULT ("date_trunc"('week'::"text", (CURRENT_DATE)::timestamp with time zone))::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_available numeric;
  v_committed numeric;
  v_unscheduled numeric;
  v_week_start_ts timestamptz;
  v_week_end_ts timestamptz;
  v_result jsonb;
BEGIN
  SELECT COALESCE(available_hours_week, 40)
  INTO v_available
  FROM users
  WHERE id = p_user_id;

  v_week_start_ts := p_week_start::timestamp AT TIME ZONE 'UTC';
  v_week_end_ts := v_week_start_ts + interval '7 days';

  SELECT COALESCE(
    SUM(COALESCE(estimated_effort_assignee, estimated_effort_assigner, 0))::numeric / 60,
    0
  )
  INTO v_committed
  FROM tasks
  WHERE assignee_id = p_user_id
    AND status IN ('todo', 'in_progress', 'blocked', 'escalated')
    AND deleted_at IS NULL
    AND due_date IS NOT NULL
    AND due_date < v_week_end_ts;

  SELECT COALESCE(
    SUM(COALESCE(estimated_effort_assignee, estimated_effort_assigner, 0))::numeric / 60,
    0
  )
  INTO v_unscheduled
  FROM tasks
  WHERE assignee_id = p_user_id
    AND status IN ('todo', 'in_progress', 'blocked', 'escalated')
    AND deleted_at IS NULL
    AND due_date IS NULL;

  v_result := jsonb_build_object(
    'user_id', p_user_id,
    'week_start', p_week_start,
    'available_hours', v_available,
    'committed_hours', ROUND(v_committed, 1),
    'unscheduled_backlog_hours', ROUND(v_unscheduled, 1),
    'utilization_pct', CASE
      WHEN v_available = 0 THEN 0
      ELSE ROUND((v_committed / v_available) * 100, 1)
    END,
    'status', CASE
      WHEN v_available = 0 THEN 'available'
      WHEN v_committed / NULLIF(v_available, 0) > 1.0 THEN 'overloaded'
      WHEN v_committed / NULLIF(v_available, 0) > 0.8 THEN 'high'
      ELSE 'available'
    END
  );

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."calculate_user_capacity"("p_user_id" "uuid", "p_week_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_object_permission"("p_object_type" "text", "p_object_id" "uuid", "p_permission" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $_$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_has_any_grants boolean;
  v_has_permission boolean;
BEGIN
  v_user_id := auth.uid();
  SELECT COALESCE(current_tenant_id, tenant_id) INTO v_tenant_id FROM users WHERE id = v_user_id;

  SELECT EXISTS(
    SELECT 1 FROM object_permissions
    WHERE tenant_id = v_tenant_id AND object_type = p_object_type AND object_id = p_object_id
  ) INTO v_has_any_grants;

  IF NOT v_has_any_grants THEN
    RETURN true;
  END IF;

  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM object_permissions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3 AND user_id = $4 AND can_%s = true)',
    p_permission
  ) INTO v_has_permission USING v_tenant_id, p_object_type, p_object_id, v_user_id;

  IF v_has_permission THEN RETURN true; END IF;

  EXECUTE format(
    'SELECT EXISTS(
      SELECT 1 FROM object_permissions op
      JOIN user_roles ur ON ur.role_id = op.role_id AND ur.tenant_id = op.tenant_id
      WHERE op.tenant_id = $1 AND op.object_type = $2 AND op.object_id = $3 AND ur.user_id = $4 AND op.can_%s = true
    )',
    p_permission
  ) INTO v_has_permission USING v_tenant_id, p_object_type, p_object_id, v_user_id;

  RETURN v_has_permission;
END;
$_$;


ALTER FUNCTION "public"."check_object_permission"("p_object_type" "text", "p_object_id" "uuid", "p_permission" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."agent_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "input_message" "text" NOT NULL,
    "shared_context" "jsonb",
    "priority" integer DEFAULT 0,
    "scheduled_for" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "next_retry_at" timestamp with time zone,
    "error" "text",
    "result" "jsonb",
    "run_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agent_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_agent_job"("p_worker_id" "text") RETURNS "public"."agent_queue"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  job agent_queue;
BEGIN
  SELECT * INTO job
  FROM agent_queue
  WHERE status = 'pending'
    AND scheduled_for <= now()
    AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF job.id IS NOT NULL THEN
    UPDATE agent_queue
    SET status = 'processing', locked_at = now(), locked_by = p_worker_id, started_at = now(), attempts = attempts + 1
    WHERE id = job.id;
    
    -- Re-fetch to get updated values
    SELECT * INTO job FROM agent_queue WHERE id = job.id;
  END IF;

  RETURN job;
END;
$$;


ALTER FUNCTION "public"."claim_next_agent_job"("p_worker_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deletion_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "worker_id" "text",
    "error" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deletion_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "deletion_queue_target_type_check" CHECK (("target_type" = ANY (ARRAY['document'::"text", 'document_folder'::"text", 'app_assets_cleanup'::"text", 'form'::"text", 'workflow'::"text", 'page'::"text", 'report'::"text", 'data_table'::"text", 'data_row'::"text", 'integration'::"text", 'decision_table'::"text", 'agent'::"text", 'web_component'::"text", 'workflow_activity'::"text", 'retention_policy'::"text", 'theme'::"text", 'dashboard'::"text", 'kanban_board'::"text", 'case'::"text", 'channel'::"text"])))
);


ALTER TABLE "public"."deletion_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_deletion_job"("p_worker_id" "text") RETURNS "public"."deletion_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_job deletion_queue;
begin
  with next_job as (
    select id
    from deletion_queue
    where status = 'pending'
    order by created_at asc
    for update skip locked
    limit 1
  )
  update deletion_queue q
  set
    status = 'processing',
    worker_id = p_worker_id,
    started_at = now(),
    attempts = q.attempts + 1,
    updated_at = now()
  from next_job
  where q.id = next_job.id
  returning q.* into v_job;

  return v_job;
end;
$$;


ALTER FUNCTION "public"."claim_next_deletion_job"("p_worker_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."directory_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "progress" "jsonb",
    "stats" "jsonb",
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "worker_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "directory_sync_runs_provider_check" CHECK (("provider" = ANY (ARRAY['entra'::"text", 'okta'::"text"]))),
    CONSTRAINT "directory_sync_runs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."directory_sync_runs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_directory_sync_run"("p_worker_id" "text") RETURNS SETOF "public"."directory_sync_runs"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Stale-run recovery: a timed-out worker must not wedge the tenant forever.
  UPDATE directory_sync_runs
     SET status = CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
         error = CASE WHEN attempts < 3 THEN error ELSE 'Worker timed out repeatedly' END,
         completed_at = CASE WHEN attempts < 3 THEN NULL ELSE now() END
   WHERE status = 'running'
     AND started_at < now() - interval '5 minutes';

  RETURN QUERY
  UPDATE directory_sync_runs r
     SET status = 'running',
         worker_id = p_worker_id,
         attempts = r.attempts + 1,
         started_at = now()
   WHERE r.id = (
     SELECT id FROM directory_sync_runs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_next_directory_sync_run"("p_worker_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_deployments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "source" "jsonb" NOT NULL,
    "dry_run" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "stats" "jsonb",
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "worker_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "github_deployments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."github_deployments" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_github_deployment"("p_worker_id" "text") RETURNS SETOF "public"."github_deployments"
    LANGUAGE "plpgsql"
    AS $$
    BEGIN
      UPDATE github_deployments
         SET status = CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
             error = CASE WHEN attempts < 3 THEN error ELSE 'Worker timed out repeatedly' END,
             completed_at = CASE WHEN attempts < 3 THEN NULL ELSE now() END
       WHERE status = 'running'
         AND started_at < now() - interval '5 minutes';

      RETURN QUERY
      UPDATE github_deployments d
         SET status = 'running',
             worker_id = p_worker_id,
             attempts = d.attempts + 1,
             started_at = now()
       WHERE d.id = (
         SELECT id FROM github_deployments
          WHERE status = 'pending'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
      RETURNING *;
    END;
    $$;


ALTER FUNCTION "public"."claim_next_github_deployment"("p_worker_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'full_resync'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "progress" "jsonb",
    "message" "text",
    "commit_sha" "text",
    "files_changed" integer,
    "error" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "worker_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "scope" "jsonb",
    "template_id" "uuid",
    CONSTRAINT "github_sync_runs_kind_check" CHECK (("kind" = ANY (ARRAY['full_resync'::"text", 'commit'::"text", 'scheduled'::"text", 'template'::"text"]))),
    CONSTRAINT "github_sync_runs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."github_sync_runs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_github_sync_run"("p_worker_id" "text") RETURNS SETOF "public"."github_sync_runs"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Stale-run recovery: a worker killed by the platform timeout leaves its
  -- row 'running' forever, which would block the tenant's syncs permanently.
  -- Rows stuck >5 minutes are retried (up to 3 attempts) or failed.
  UPDATE github_sync_runs
     SET status = CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
         error = CASE WHEN attempts < 3 THEN error ELSE 'Worker timed out repeatedly' END,
         completed_at = CASE WHEN attempts < 3 THEN NULL ELSE now() END
   WHERE status = 'running'
     AND started_at < now() - interval '5 minutes';

  RETURN QUERY
  UPDATE github_sync_runs r
     SET status = 'running',
         worker_id = p_worker_id,
         attempts = r.attempts + 1,
         started_at = now()
   WHERE r.id = (
     SELECT id FROM github_sync_runs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_next_github_sync_run"("p_worker_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "trigger_type" "text" NOT NULL,
    "trigger_data" "jsonb" DEFAULT '{}'::"jsonb",
    "priority" integer DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "scheduled_for" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "next_retry_at" timestamp with time zone,
    "result" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trace_id" "uuid"
);


ALTER TABLE "public"."workflow_queue" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_job"("p_worker_id" "text" DEFAULT 'default'::"text") RETURNS "public"."workflow_queue"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_job workflow_queue;
BEGIN
  -- Claim a pending job or a failed job ready for retry
  SELECT * INTO v_job FROM workflow_queue
  WHERE (
    (status = 'pending' AND scheduled_for <= now())
    OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now())
  )
  ORDER BY priority DESC, scheduled_for ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  
  IF v_job.id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Mark as processing
  UPDATE workflow_queue SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    started_at = COALESCE(started_at, now()),
    attempts = attempts + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  
  RETURN v_job;
END;
$$;


ALTER FUNCTION "public"."claim_next_job"("p_worker_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_scheduled_sync"("p_tenant_id" "uuid", "p_connector_key" "text", "p_expected" "text", "p_fired_at" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  updated int;
BEGIN
  UPDATE tenant_connectors
     SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('schedule_last_fired_at', p_fired_at)
   WHERE tenant_id = p_tenant_id
     AND connector_key = p_connector_key
     AND (config->>'schedule_last_fired_at') IS NOT DISTINCT FROM p_expected;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;


ALTER FUNCTION "public"."claim_scheduled_sync"("p_tenant_id" "uuid", "p_connector_key" "text", "p_expected" "text", "p_fired_at" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_agent_job"("p_job_id" "uuid", "p_result" "jsonb", "p_run_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE agent_queue
  SET status = 'completed', result = p_result, completed_at = now(), run_id = p_run_id
  WHERE id = p_job_id;
END;
$$;


ALTER FUNCTION "public"."complete_agent_job"("p_job_id" "uuid", "p_result" "jsonb", "p_run_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_deletion_job"("p_job_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update deletion_queue
  set
    status = 'completed',
    completed_at = now(),
    error = null,
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."complete_deletion_job"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_result" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE workflow_queue SET
    status = 'completed',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    result = p_result
  WHERE id = p_job_id;
END;
$$;


ALTER FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_result" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_default_email_template_for_tenant"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO email_templates (
    tenant_id, name, description, subject, html_body, text_body, is_default
  ) VALUES (
    NEW.id,
    'UserTasks Default',
    'A polished UserTasks-branded email for workflow messages and task assignments.',
    'Action needed: {{user_task_title}}',
    '<div style="background:#f4f7f8;padding:32px 16px;font-family:Inter,Arial,sans-serif"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden"><div style="padding:24px 30px;background:#0f766e;color:#fff;font-size:22px;font-weight:800">user<span style="color:#ccfbf1">tasks</span></div><div style="padding:34px 30px"><h1 style="color:#17212b">{{user_task_title}}</h1><p style="color:#52606d;line-height:1.7">{{user_task_description}}</p><a href="{{app_url}}/tasks/{{user_task_id}}" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700">Open task</a></div></div></div>',
    E'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.',
    true
  );
  RETURN NEW;
END $$;


ALTER FUNCTION "public"."create_default_email_template_for_tenant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_task_with_subtasks"("p_title" "text", "p_description" "text" DEFAULT NULL::"text", "p_priority" "public"."task_priority" DEFAULT 'medium'::"public"."task_priority", "p_due_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_assignee_id" "uuid" DEFAULT NULL::"uuid", "p_estimated_effort" integer DEFAULT NULL::integer, "p_subtasks" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tenant_id uuid;
  v_task_id uuid;
  v_subtask jsonb;
  v_subtask_id uuid;
  v_result jsonb;
BEGIN
  v_tenant_id := get_current_tenant_id();

  INSERT INTO tasks (
    tenant_id, title, description, priority, due_date,
    assignee_id, assigner_id, estimated_effort_assigner
  ) VALUES (
    v_tenant_id, p_title, p_description, p_priority, p_due_date,
    COALESCE(p_assignee_id, auth.uid()), auth.uid(), p_estimated_effort
  ) RETURNING id INTO v_task_id;

  FOR v_subtask IN SELECT * FROM jsonb_array_elements(p_subtasks)
  LOOP
    INSERT INTO tasks (
      tenant_id, parent_task_id, title, description,
      assignee_id, assigner_id, estimated_effort_assigner,
      sequence, priority
    ) VALUES (
      v_tenant_id, v_task_id,
      v_subtask->>'title',
      v_subtask->>'description',
      COALESCE((v_subtask->>'assignee_id')::uuid, p_assignee_id, auth.uid()),
      auth.uid(),
      (v_subtask->>'estimated_effort')::integer,
      COALESCE((v_subtask->>'sequence')::integer, 0),
      p_priority
    );
  END LOOP;

  INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id)
  VALUES (v_tenant_id, v_task_id, 'created', auth.uid());

  SELECT get_task_tree(v_task_id) INTO v_result;
  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."create_task_with_subtasks"("p_title" "text", "p_description" "text", "p_priority" "public"."task_priority", "p_due_date" timestamp with time zone, "p_assignee_id" "uuid", "p_estimated_effort" integer, "p_subtasks" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_empty_conversation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM message_participants WHERE conversation_id = OLD.conversation_id
  ) THEN
    DELETE FROM message_conversations WHERE id = OLD.conversation_id;
  END IF;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."delete_empty_conversation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_workflow"("p_workflow_id" "uuid", "p_tenant_id" "uuid", "p_task_id" "uuid" DEFAULT NULL::"uuid", "p_trigger_type" "text" DEFAULT 'manual'::"text", "p_trigger_data" "jsonb" DEFAULT '{}'::"jsonb", "p_priority" integer DEFAULT 0, "p_delay_seconds" integer DEFAULT 0) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_job_id uuid;
BEGIN
  INSERT INTO workflow_queue (
    workflow_id, tenant_id, task_id, trigger_type, trigger_data, priority, scheduled_for
  ) VALUES (
    p_workflow_id, p_tenant_id, p_task_id, p_trigger_type, p_trigger_data, p_priority,
    now() + (p_delay_seconds || ' seconds')::interval
  ) RETURNING id INTO v_job_id;
  
  -- Notify listeners that a new job is available
  PERFORM pg_notify('workflow_queue', json_build_object(
    'job_id', v_job_id,
    'workflow_id', p_workflow_id,
    'trigger_type', p_trigger_type
  )::text);
  
  RETURN v_job_id;
END;
$$;


ALTER FUNCTION "public"."enqueue_workflow"("p_workflow_id" "uuid", "p_tenant_id" "uuid", "p_task_id" "uuid", "p_trigger_type" "text", "p_trigger_data" "jsonb", "p_priority" integer, "p_delay_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."escalate_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM tasks WHERE id = p_task_id;

  INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
  VALUES (
    v_tenant_id, p_task_id, 'escalated', auth.uid(),
    jsonb_build_object('target_user', p_target_user_id, 'notes', p_notes)
  );

  INSERT INTO token_ledger (tenant_id, action_type, tokens_consumed, task_id, actor_id)
  VALUES (v_tenant_id, 'task_escalated', 0.25, p_task_id, auth.uid());

  UPDATE token_balances SET consumed = consumed + 0.25
  WHERE tenant_id = v_tenant_id
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."escalate_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_agent_job"("p_job_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  job agent_queue;
BEGIN
  SELECT * INTO job FROM agent_queue WHERE id = p_job_id;
  
  IF job.attempts >= job.max_attempts THEN
    UPDATE agent_queue SET status = 'dead', error = p_error, completed_at = now() WHERE id = p_job_id;
  ELSE
    UPDATE agent_queue
    SET status = 'pending', error = p_error, locked_at = NULL, locked_by = NULL,
        next_retry_at = now() + (power(2, job.attempts) * interval '1 second')
    WHERE id = p_job_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."fail_agent_job"("p_job_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_deletion_job"("p_job_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update deletion_queue
  set
    status = 'failed',
    error = left(coalesce(p_error, 'Unknown deletion error'), 4000),
    completed_at = now(),
    updated_at = now()
  where id = p_job_id;
end;
$$;


ALTER FUNCTION "public"."fail_deletion_job"("p_job_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_job"("p_job_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_attempts integer;
  v_max_attempts integer;
  v_delay interval;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM workflow_queue WHERE id = p_job_id;
  
  -- Exponential backoff: 30s, 120s, 480s
  v_delay := (30 * power(4, v_attempts - 1)) * interval '1 second';
  
  IF v_attempts >= v_max_attempts THEN
    -- Move to dead status
    UPDATE workflow_queue SET
      status = 'dead',
      error = p_error,
      locked_at = NULL,
      locked_by = NULL
    WHERE id = p_job_id;
  ELSE
    -- Schedule retry
    UPDATE workflow_queue SET
      status = 'failed',
      error = p_error,
      locked_at = NULL,
      locked_by = NULL,
      next_retry_at = now() + v_delay
    WHERE id = p_job_id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."fail_job"("p_job_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_auto_complete_parent"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.child_count > 0
     AND NEW.completed_child_count = NEW.child_count
     AND NEW.status != 'completed'
  THEN
    NEW.status := 'completed';
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_auto_complete_parent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_debit_tokens_on_task"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_cost numeric(10,4);
  v_action token_action_type;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    v_cost := 1.0;
    v_action := 'task_created';
  ELSE
    v_cost := 0.5;
    v_action := 'subtask_created';
  END IF;

  INSERT INTO token_ledger (tenant_id, action_type, tokens_consumed, task_id, actor_id)
  VALUES (NEW.tenant_id, v_action, v_cost, NEW.id, NEW.assigner_id);

  UPDATE token_balances SET consumed = consumed + v_cost
  WHERE tenant_id = NEW.tenant_id
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_debit_tokens_on_task"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_enqueue_task_workflows"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_workflow RECORD;
  v_trigger_type text;
BEGIN
  -- Determine trigger type
  IF TG_OP = 'INSERT' THEN
    v_trigger_type := 'task_created';
  ELSIF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status != 'completed') THEN
    v_trigger_type := 'task_completed';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'rejected' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'rejected') THEN
    v_trigger_type := 'task_rejected';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'pending' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'pending') THEN
    v_trigger_type := 'task_received';
  ELSIF TG_OP = 'UPDATE' AND NEW.acceptance_status = 'accepted' AND (OLD.acceptance_status IS NULL OR OLD.acceptance_status != 'accepted') THEN
    v_trigger_type := 'task_submitted';
  ELSIF TG_OP = 'UPDATE' THEN
    v_trigger_type := 'task_updated';
  ELSE
    RETURN NEW;
  END IF;
  
  -- Find active workflows matching this trigger
  FOR v_workflow IN
    SELECT id FROM workflows
    WHERE tenant_id = NEW.tenant_id
      AND is_active = true
      AND trigger_type = v_trigger_type
  LOOP
    PERFORM enqueue_workflow(
      v_workflow.id,
      NEW.tenant_id,
      NEW.id,
      v_trigger_type,
      jsonb_build_object(
        'task_id', NEW.id,
        'status', NEW.status,
        'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
        'priority', NEW.priority,
        'assignee_id', NEW.assignee_id,
        'acceptance_status', NEW.acceptance_status,
        'acceptance_comment', NEW.acceptance_comment,
        'template_id', NEW.template_id
      ),
      0, 0
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_enqueue_task_workflows"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_log_lifecycle_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
    VALUES (
      NEW.tenant_id, NEW.id,
      CASE NEW.status
        WHEN 'in_progress' THEN 'started'::lifecycle_event_type
        WHEN 'completed'   THEN 'completed'::lifecycle_event_type
        WHEN 'cancelled'   THEN 'cancelled'::lifecycle_event_type
        WHEN 'blocked'     THEN 'blocked'::lifecycle_event_type
        ELSE 'created'::lifecycle_event_type
      END,
      auth.uid(),
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status)
    );
  END IF;

  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
     AND OLD.assignee_id IS NOT NULL
  THEN
    INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
    VALUES (
      NEW.tenant_id, NEW.id, 'reassigned', auth.uid(),
      jsonb_build_object('old_assignee', OLD.assignee_id, 'new_assignee', NEW.assignee_id)
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_log_lifecycle_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_notify_on_task_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Notify on assignment (new assignee)
  IF OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
    AND NEW.assignee_id IS NOT NULL
    AND NEW.assignee_id != auth.uid()
  THEN
    INSERT INTO notifications (user_id, tenant_id, type, title, body, task_id)
    VALUES (
      NEW.assignee_id, NEW.tenant_id, 'task_assigned',
      'Task assigned to you',
      'You''ve been assigned: ' || NEW.title,
      NEW.id
    );
  END IF;

  -- Notify assigner on completion
  IF NEW.status = 'completed' AND OLD.status != 'completed'
    AND NEW.assigner_id IS NOT NULL
    AND NEW.assigner_id != auth.uid()
  THEN
    INSERT INTO notifications (user_id, tenant_id, type, title, body, task_id)
    VALUES (
      NEW.assigner_id, NEW.tenant_id, 'task_completed',
      'Task completed',
      NEW.title || ' has been completed',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_notify_on_task_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_task_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;

  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at := now();
  END IF;

  IF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_task_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_update_parent_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_parent_id uuid;
  v_total     integer;
  v_completed integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_parent_id := OLD.parent_task_id;
  ELSE
    v_parent_id := NEW.parent_task_id;
  END IF;

  IF v_parent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM tasks
  WHERE parent_task_id = v_parent_id AND deleted_at IS NULL;

  UPDATE tasks SET
    child_count = v_total,
    completed_child_count = v_completed,
    progress_pct = CASE
      WHEN v_total = 0 THEN 0
      ELSE ROUND((v_completed::numeric / v_total) * 100, 2)
    END
  WHERE id = v_parent_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."fn_update_parent_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_current_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
      SELECT COALESCE(u.current_tenant_id, u.tenant_id)::uuid
        FROM public.users u WHERE u.id = auth.uid()
    $$;


ALTER FUNCTION "public"."get_current_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_task_tree"("p_task_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  WITH RECURSIVE task_tree AS (
    SELECT t.*, 0 as depth
    FROM tasks t
    WHERE t.id = p_task_id AND t.deleted_at IS NULL
    UNION ALL
    SELECT t.*, tt.depth + 1
    FROM tasks t
    JOIN task_tree tt ON t.parent_task_id = tt.id
    WHERE t.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'task', (SELECT row_to_json(t)::jsonb FROM task_tree t WHERE depth = 0),
    'subtasks', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sequence, t.created_at), '[]'::jsonb)
      FROM task_tree t WHERE depth > 0
    ),
    'total_count', (SELECT COUNT(*) FROM task_tree),
    'completed_count', (SELECT COUNT(*) FROM task_tree WHERE status = 'completed')
  );
$$;


ALTER FUNCTION "public"."get_task_tree"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("p_tenant_id" "uuid" DEFAULT NULL::"uuid") RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
declare
  v_tenant_id uuid;
  v_perms text[];
begin
  select coalesce(p_tenant_id, coalesce(current_tenant_id, tenant_id))
  into v_tenant_id
  from users where id = auth.uid();

  select array_agg(distinct perm)
  into v_perms
  from user_roles ur
  join roles r on r.id = ur.role_id and r.tenant_id = ur.tenant_id
  cross join lateral unnest(r.permissions) as perm
  where ur.user_id = auth.uid()
    and ur.tenant_id = v_tenant_id;

  return coalesce(v_perms, '{}'::text[]);
end;
$$;


ALTER FUNCTION "public"."get_user_permissions"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role_in_tenant"("p_tenant_id" "uuid" DEFAULT NULL::"uuid") RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM user_memberships
  WHERE user_id = auth.uid()
    AND tenant_id = COALESCE(p_tenant_id, (SELECT current_tenant_id FROM users WHERE id = auth.uid()))
    AND is_active = true
  LIMIT 1
$$;


ALTER FUNCTION "public"."get_user_role_in_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_tenant_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
      SELECT tenant_id FROM public.user_memberships
        WHERE user_id = auth.uid() AND is_active
      UNION
      SELECT tenant_id FROM public.users WHERE id = auth.uid() AND tenant_id IS NOT NULL
      UNION
      SELECT current_tenant_id FROM public.users WHERE id = auth.uid() AND current_tenant_id IS NOT NULL
    $$;


ALTER FUNCTION "public"."get_user_tenant_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant_id uuid;
  v_display_name text;
BEGIN
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  INSERT INTO public.tenants (name, slug, plan, auth_provider)
  VALUES (
    v_display_name || '''s Workspace',
    'personal-' || substr(NEW.id::text, 1, 8),
    'personal_free',
    CASE
      WHEN NEW.raw_app_meta_data->>'provider' = 'google'
      THEN 'google'::public.auth_provider
      ELSE 'email'::public.auth_provider
    END
  ) RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (id, tenant_id, email, display_name, role, current_tenant_id)
  VALUES (NEW.id, v_tenant_id, NEW.email, v_display_name, 'owner', v_tenant_id);

  -- Create membership for home tenant
  INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home)
  VALUES (NEW.id, v_tenant_id, 'owner', true);

  INSERT INTO public.token_balances (tenant_id, period_start, period_end, included_allowance)
  VALUES (
    v_tenant_id,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
    100
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM message_participants
    WHERE conversation_id = conv_id
      AND user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kanban_move_item"("p_tenant_id" "uuid", "p_board_id" "uuid", "p_item_id" "uuid", "p_to_column_id" "uuid", "p_to_index" integer DEFAULT NULL::integer, "p_acting_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("item_id" "uuid", "column_id" "uuid", "position" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_source_column uuid;
begin
  -- Serialize concurrent moves on the same board (lock released at tx end).
  perform pg_advisory_xact_lock(hashtextextended(p_board_id::text, 42));

  select ki.column_id into v_source_column
    from public.kanban_items ki
   where ki.tenant_id = p_tenant_id
     and ki.board_id = p_board_id
     and ki.id = p_item_id
   for update;
  if not found then
    raise exception 'KANBAN_ITEM_NOT_FOUND';
  end if;

  perform 1
    from public.kanban_columns c
   where c.id = p_to_column_id
     and c.board_id = p_board_id
     and c.tenant_id = p_tenant_id;
  if not found then
    raise exception 'KANBAN_COLUMN_NOT_ON_BOARD';
  end if;

  -- Re-sequence the target column with the moved item spliced in at a
  -- bounded index (null/oversized index appends to the end).
  with target as (
    select ki.id, row_number() over (order by ki.position, ki.created_at) - 1 as rn
      from public.kanban_items ki
     where ki.tenant_id = p_tenant_id
       and ki.column_id = p_to_column_id
       and ki.id <> p_item_id
  ), bounded as (
    select least(
             greatest(coalesce(p_to_index, (select count(*) from target)::int), 0),
             (select count(*) from target)::int
           ) as idx
  ), reseq as (
    select t.id,
           t.rn + case when t.rn >= (select idx from bounded) then 1 else 0 end as new_pos
      from target t
    union all
    select p_item_id, (select idx from bounded)
  )
  update public.kanban_items ki
     set column_id = p_to_column_id,
         position  = r.new_pos
    from reseq r
   where ki.id = r.id
     and ki.tenant_id = p_tenant_id;

  -- Close the gap left in the source column on cross-column moves.
  if v_source_column is distinct from p_to_column_id then
    with src as (
      select ki.id, row_number() over (order by ki.position, ki.created_at) - 1 as rn
        from public.kanban_items ki
       where ki.tenant_id = p_tenant_id
         and ki.column_id = v_source_column
    )
    update public.kanban_items ki
       set position = s.rn
      from src s
     where ki.id = s.id
       and ki.tenant_id = p_tenant_id
       and ki.position <> s.rn;
  end if;

  return query
    select ki.id, ki.column_id, ki.position
      from public.kanban_items ki
     where ki.tenant_id = p_tenant_id
       and ki.id = p_item_id;
end;
$$;


ALTER FUNCTION "public"."kanban_move_item"("p_tenant_id" "uuid", "p_board_id" "uuid", "p_item_id" "uuid", "p_to_column_id" "uuid", "p_to_index" integer, "p_acting_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_all_notifications_read"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE notifications SET is_read = true
  WHERE user_id = auth.uid() AND is_read = false;
END;
$$;


ALTER FUNCTION "public"."mark_all_notifications_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_notifications_read"("p_notification_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE notifications SET is_read = true
  WHERE id = ANY(p_notification_ids) AND user_id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."mark_notifications_read"("p_notification_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_tenant_connector_config"("p_tenant_id" "uuid", "p_connector_key" "text", "p_patch" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE tenant_connectors
     SET config = COALESCE(config, '{}'::jsonb) || p_patch
   WHERE tenant_id = p_tenant_id
     AND connector_key = p_connector_key;
$$;


ALTER FUNCTION "public"."merge_tenant_connector_config"("p_tenant_id" "uuid", "p_connector_key" "text", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_tenant_connector_credentials"("p_connector_id" "uuid", "p_patch" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE tenant_connectors
     SET credentials = COALESCE(credentials, '{}'::jsonb) || p_patch
   WHERE id = p_connector_id;
$$;


ALTER FUNCTION "public"."merge_tenant_connector_credentials"("p_connector_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_case_number"("p_tenant" "uuid", "p_prefix" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  n bigint;
BEGIN
  -- next_value stores the NEXT unconsumed number; RETURNING gives the stored
  -- value, so the number consumed by this call is always n - 1. The row-level
  -- lock taken by ON CONFLICT UPDATE serializes concurrent inserts.
  INSERT INTO public.case_counters (tenant_id, prefix, next_value)
  VALUES (p_tenant, p_prefix, 2)
  ON CONFLICT (tenant_id, prefix)
  DO UPDATE SET next_value = case_counters.next_value + 1
  RETURNING next_value INTO n;
  RETURN p_prefix || '-' || lpad((n - 1)::text, 4, '0');
END;
$$;


ALTER FUNCTION "public"."next_case_number"("p_tenant" "uuid", "p_prefix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_task"("p_task_id" "uuid", "p_new_assignee_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_old_assignee uuid;
  v_tenant_id uuid;
BEGIN
  SELECT assignee_id, tenant_id INTO v_old_assignee, v_tenant_id
  FROM tasks WHERE id = p_task_id;

  UPDATE tasks SET assignee_id = p_new_assignee_id WHERE id = p_task_id;

  INSERT INTO token_ledger (tenant_id, action_type, tokens_consumed, task_id, actor_id)
  VALUES (v_tenant_id, 'task_reassigned', 0.25, p_task_id, auth.uid());

  UPDATE token_balances SET consumed = consumed + 0.25
  WHERE tenant_id = v_tenant_id
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE;
END;
$$;


ALTER FUNCTION "public"."reassign_task"("p_task_id" "uuid", "p_new_assignee_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer DEFAULT 6) RETURNS TABLE("id" "uuid", "table_id" "uuid", "data" "jsonb", "table_name" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    r.id,
    r.table_id,
    r.data,
    t.name AS table_name
  FROM custom_table_rows r
  JOIN custom_tables t ON t.id = r.table_id
  WHERE r.data::text ILIKE '%' || q || '%'
  ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
  LIMIT lim;
$$;


ALTER FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_tenant_roles"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Owner
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
  (p_tenant_id, 'Owner', 'owner', 'Full access to everything', array[
    'tasks.create','tasks.view_own','tasks.view_all','tasks.assign','tasks.complete','tasks.redirect','tasks.escalate','tasks.delete','tasks.manage_queue',
    'templates.view','templates.create','templates.edit','templates.publish','templates.delete','templates.view_submissions',
    'workflows.view','workflows.create','workflows.edit','workflows.activate','workflows.delete','workflows.view_runs',
    'agents.view','agents.create','agents.edit','agents.test','agents.delete',
    'integrations.view','integrations.create','integrations.edit','integrations.test','integrations.delete','integrations.manage_references',
    'data.view','data.create','data.edit_schema','data.manage_rows','data.delete',
    'reports.view','reports.create','reports.edit_own','reports.share','reports.delete',
    'team.view_members','team.invite','team.remove','team.change_roles',
    'settings.view','settings.edit','settings.manage_api_keys','settings.manage_webhooks','settings.manage_tokens',
    'capacity.view_own','capacity.view_all'
  ], true, 'owner');

  -- Admin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
  (p_tenant_id, 'Admin', 'admin', 'Full access except token billing', array[
    'tasks.create','tasks.view_own','tasks.view_all','tasks.assign','tasks.complete','tasks.redirect','tasks.escalate','tasks.delete','tasks.manage_queue',
    'templates.view','templates.create','templates.edit','templates.publish','templates.delete','templates.view_submissions',
    'workflows.view','workflows.create','workflows.edit','workflows.activate','workflows.delete','workflows.view_runs',
    'agents.view','agents.create','agents.edit','agents.test','agents.delete',
    'integrations.view','integrations.create','integrations.edit','integrations.test','integrations.delete','integrations.manage_references',
    'data.view','data.create','data.edit_schema','data.manage_rows','data.delete',
    'reports.view','reports.create','reports.edit_own','reports.share','reports.delete',
    'team.view_members','team.invite','team.remove','team.change_roles',
    'settings.view','settings.edit','settings.manage_api_keys','settings.manage_webhooks',
    'capacity.view_own','capacity.view_all'
  ], true, 'admin');

  -- Manager
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
  (p_tenant_id, 'Manager', 'manager', 'Manage team tasks, workflows, and forms', array[
    'tasks.create','tasks.view_own','tasks.view_all','tasks.assign','tasks.complete','tasks.redirect','tasks.escalate','tasks.manage_queue',
    'templates.view','templates.create','templates.edit','templates.publish','templates.view_submissions',
    'workflows.view','workflows.create','workflows.edit','workflows.activate','workflows.view_runs',
    'agents.view','agents.test',
    'integrations.view','integrations.manage_references',
    'data.view','data.create','data.manage_rows',
    'reports.view','reports.create','reports.edit_own','reports.share',
    'team.view_members',
    'capacity.view_own','capacity.view_all'
  ], true, 'manager');

  -- Member
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
  (p_tenant_id, 'Member', 'member', 'Work on tasks, use forms, view reports', array[
    'tasks.create','tasks.view_own','tasks.complete','tasks.escalate',
    'templates.view',
    'data.view','data.manage_rows',
    'reports.view','reports.edit_own',
    'team.view_members',
    'capacity.view_own'
  ], true, 'member');

  -- Viewer
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
  (p_tenant_id, 'Viewer', 'viewer', 'Read-only access', array[
    'tasks.view_own','tasks.view_all',
    'templates.view','templates.view_submissions',
    'workflows.view','workflows.view_runs',
    'agents.view',
    'integrations.view',
    'data.view',
    'reports.view',
    'team.view_members',
    'capacity.view_own'
  ], true, 'viewer');
end;
$$;


ALTER FUNCTION "public"."seed_tenant_roles"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_app_pages_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_app_pages_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cases_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cases_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_channels_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_channels_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_deletion_queue_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_deletion_queue_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_kanban_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_kanban_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_tag_tenant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT COALESCE(current_tenant_id, tenant_id) INTO NEW.tenant_id 
    FROM users WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_tag_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."switch_tenant"("p_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Verify membership (unless switching to unified)
  IF p_tenant_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_memberships
      WHERE user_id = auth.uid()
        AND tenant_id = p_tenant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Not a member of this tenant';
    END IF;
  END IF;

  UPDATE users SET current_tenant_id = p_tenant_id
  WHERE id = auth.uid();
END;
$$;


ALTER FUNCTION "public"."switch_tenant"("p_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_seed_tenant_roles"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  perform seed_tenant_roles(NEW.id);
  return NEW;
end;
$$;


ALTER FUNCTION "public"."trigger_seed_tenant_roles"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid",
    "workflow_run_id" "uuid",
    "tenant_id" "uuid",
    "input_message" "text",
    "output_response" "text",
    "context" "jsonb",
    "iterations" integer DEFAULT 0,
    "tool_calls" "jsonb" DEFAULT '[]'::"jsonb",
    "usage" "jsonb",
    "duration_ms" integer,
    "status" "text" DEFAULT 'running'::"text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "queue_job_id" "uuid",
    "paused_at" timestamp with time zone,
    "paused_context" "jsonb",
    "actor_id" "uuid",
    "model" "text",
    "total_tokens" integer,
    "input_tokens" integer,
    "output_tokens" integer,
    "caller_type" "text",
    "caller_id" "text",
    "trace_id" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."agent_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "integration_id" "uuid",
    "model" "text" DEFAULT 'gpt-4o'::"text" NOT NULL,
    "system_prompt" "text" DEFAULT ''::"text" NOT NULL,
    "temperature" numeric DEFAULT 0.7,
    "max_tokens" integer DEFAULT 4096,
    "max_iterations" integer DEFAULT 10,
    "tools" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT true,
    "tags" "text"[],
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role" "text" DEFAULT ''::"text",
    "task" "text" DEFAULT ''::"text",
    "boundaries" "text" DEFAULT ''::"text",
    "output_config" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "workflow_source_id" "uuid",
    "name" "text" NOT NULL,
    "key_prefix" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "is_revoked" boolean DEFAULT false,
    "last_used_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "key_type" "text" DEFAULT 'tenant'::"text" NOT NULL,
    "user_id" "uuid",
    "scopes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "permissions" "jsonb",
    CONSTRAINT "api_keys_key_type_check" CHECK (("key_type" = ANY (ARRAY['tenant'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


COMMENT ON COLUMN "public"."api_keys"."permissions" IS 'Optional array of permission keys this API key may exercise. NULL = legacy full/role-derived permissions. Set to issue least-privilege keys.';



CREATE TABLE IF NOT EXISTS "public"."app_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "added_by" "uuid",
    "is_dependency" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_assets_asset_type_check" CHECK (("asset_type" = ANY (ARRAY['workflow'::"text", 'workflow_activity'::"text", 'form'::"text", 'page'::"text", 'data_table'::"text", 'document_folder'::"text", 'document'::"text", 'retention_policy'::"text", 'integration'::"text", 'theme'::"text", 'agent'::"text", 'decision_table'::"text", 'web_component'::"text", 'report'::"text", 'kanban_board'::"text", 'component_template'::"text", 'email_template'::"text", 'document_metadata_template'::"text", 'integration_reference'::"text", 'workflow_webhook'::"text", 'case_type'::"text"])))
);


ALTER TABLE "public"."app_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_page_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_page_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "schema" "jsonb" DEFAULT '{"sections": []}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "publish_notes" "text",
    "published_by" "uuid",
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_page_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "slug" "text",
    "schema" "jsonb" DEFAULT '{"sections": []}'::"jsonb" NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp with time zone,
    "published_version_id" "uuid",
    "has_unpublished_changes" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allow_public_access" boolean DEFAULT false NOT NULL,
    "public_share_token" "text",
    "public_title" "text",
    "public_description" "text",
    "redirect_url" "text",
    "page_kind" "public"."page_kind" DEFAULT 'page'::"public"."page_kind" NOT NULL,
    "allow_public_submission" boolean DEFAULT false NOT NULL,
    "submission_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."app_pages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "linked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."apps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "archived_at" timestamp with time zone,
    "default_channel_id" "uuid"
);


ALTER TABLE "public"."apps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_counters" (
    "tenant_id" "uuid" NOT NULL,
    "prefix" "text" NOT NULL,
    "next_value" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."case_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'collaborator'::"text" NOT NULL,
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_participants_role_check" CHECK (("role" = ANY (ARRAY['collaborator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."case_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "case_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "relationship" "text" DEFAULT 'related'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_tasks_relationship_check" CHECK (("relationship" = ANY (ARRAY['related'::"text", 'implements'::"text", 'blocks_close'::"text"])))
);


ALTER TABLE "public"."case_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."case_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "key" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "color" "text",
    "number_prefix" "text" DEFAULT 'CS'::"text" NOT NULL,
    "stages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "form_page_id" "uuid",
    "sla" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_assignment_group_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_id" "uuid",
    "case_template_id" "uuid",
    "automation" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."case_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "number" "text" NOT NULL,
    "case_type_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "stage" "text",
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "assigned_to" "uuid",
    "assignment_group_id" "uuid",
    "app_id" "uuid",
    "channel_id" "uuid",
    "requester_id" "uuid",
    "custom_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sla_respond_by" timestamp with time zone,
    "sla_due_at" timestamp with time zone,
    "first_responded_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cases_priority_check" CHECK (("priority" = ANY (ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'low'::"text", 'none'::"text"]))),
    CONSTRAINT "cases_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'on_hold'::"text", 'resolved'::"text", 'closed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channel_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "principal_type" "text" NOT NULL,
    "user_id" "uuid",
    "role_id" "uuid",
    "team_id" "uuid",
    "can_view" boolean DEFAULT true NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_manage" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channel_members_check" CHECK (((("principal_type" = 'user'::"text") AND ("user_id" IS NOT NULL) AND ("role_id" IS NULL) AND ("team_id" IS NULL)) OR (("principal_type" = 'role'::"text") AND ("role_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("team_id" IS NULL)) OR (("principal_type" = 'team'::"text") AND ("team_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("role_id" IS NULL)))),
    CONSTRAINT "channel_members_principal_type_check" CHECK (("principal_type" = ANY (ARRAY['user'::"text", 'role'::"text", 'team'::"text"])))
);


ALTER TABLE "public"."channel_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channel_screens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "channel_id" "uuid" NOT NULL,
    "page_id" "uuid",
    "screen_kind" "text" DEFAULT 'custom'::"text" NOT NULL,
    "title" "text",
    "icon" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_home" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "channel_screens_screen_kind_check" CHECK (("screen_kind" = ANY (ARRAY['list'::"text", 'record'::"text", 'case'::"text", 'dashboard'::"text", 'form'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."channel_screens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."channels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "color" "text",
    "navigation" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "app_id" "uuid",
    "default_screen_id" "uuid",
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."channels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."component_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "component_type" "text" NOT NULL,
    "component" "jsonb" NOT NULL,
    "rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."component_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_table_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."custom_table_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "columns" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retention_policy_id" "uuid",
    "retention_applied_at" timestamp with time zone
);


ALTER TABLE "public"."custom_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_web_components" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "tag_name" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source_kind" "text" DEFAULT 'upload'::"text" NOT NULL,
    "version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "script_code" "text" DEFAULT ''::"text" NOT NULL,
    "style_code" "text",
    "manifest" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "demo_props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_filename" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "custom_web_components_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['upload'::"text", 'inline'::"text"]))),
    CONSTRAINT "custom_web_components_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."custom_web_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_workflow_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "key" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source_kind" "text" DEFAULT 'inline'::"text" NOT NULL,
    "version" "text" DEFAULT '1.0.0'::"text" NOT NULL,
    "icon_name" "text" DEFAULT 'Puzzle'::"text" NOT NULL,
    "color" "text" DEFAULT '#0EA5E9'::"text" NOT NULL,
    "source_code" "text" NOT NULL,
    "manifest" "jsonb" DEFAULT '{"inputs": [], "outputs": []}'::"jsonb" NOT NULL,
    "demo_inputs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_filename" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "custom_workflow_activities_source_kind_check" CHECK (("source_kind" = ANY (ARRAY['upload'::"text", 'inline'::"text"]))),
    CONSTRAINT "custom_workflow_activities_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."custom_workflow_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "widgets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dashboard_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dead_letter_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "event_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "target_url" "text" NOT NULL,
    "error_message" "text",
    "attempts" integer DEFAULT 0,
    "last_attempt_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dead_letter_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decision_tables" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "inputs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "outputs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."decision_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."directory_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "object_type" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "local_id" "uuid" NOT NULL,
    "display_name" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "directory_links_object_type_check" CHECK (("object_type" = ANY (ARRAY['user'::"text", 'group'::"text"]))),
    CONSTRAINT "directory_links_provider_check" CHECK (("provider" = ANY (ARRAY['entra'::"text", 'okta'::"text"])))
);


ALTER TABLE "public"."directory_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "parent_folder_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "metadata_schema" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "retention_policy_id" "uuid",
    "retention_applied_at" timestamp with time zone,
    "metadata_template_id" "uuid"
);


ALTER TABLE "public"."document_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_metadata_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_metadata_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "storage_bucket" "text" DEFAULT 'task-files'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "file_name" "text" NOT NULL,
    "file_extension" "text",
    "mime_type" "text" DEFAULT 'application/octet-stream'::"text" NOT NULL,
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    "file_hash" "text",
    "version_comment" "text",
    "metadata_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "browser_file_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."document_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "folder_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "file_name" "text" NOT NULL,
    "file_extension" "text",
    "mime_type" "text" DEFAULT 'application/octet-stream'::"text" NOT NULL,
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    "storage_bucket" "text" DEFAULT 'task-files'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "current_version_number" integer DEFAULT 1 NOT NULL,
    "current_version_id" "uuid",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "retention_mode" "text" DEFAULT 'none'::"text" NOT NULL,
    "retention_until" timestamp with time zone,
    "retention_label" "text",
    "retention_policy_id" "uuid",
    "retention_applied_at" timestamp with time zone,
    "metadata_template_id" "uuid",
    CONSTRAINT "documents_retention_mode_check" CHECK (("retention_mode" = ANY (ARRAY['none'::"text", 'review'::"text", 'purge_on'::"text", 'keep_forever'::"text"])))
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."effort_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "record_type" "public"."effort_record_type" NOT NULL,
    "minutes" integer NOT NULL,
    "notes" "text",
    "timer_start" timestamp with time zone,
    "timer_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "effort_records_minutes_check" CHECK (("minutes" >= 0))
);


ALTER TABLE "public"."effort_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "html_body" "text" DEFAULT ''::"text" NOT NULL,
    "text_body" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    CONSTRAINT "email_templates_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120)))
);


ALTER TABLE "public"."email_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "session_id" "text" NOT NULL,
    "submission_id" "uuid",
    "ip_address" "text",
    "user_agent" "text",
    "duration_ms" integer,
    "first_field_id" "text",
    "last_field_id" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."form_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "trace_id" "uuid",
    "page_id" "uuid"
);


ALTER TABLE "public"."form_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_template_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_template_id" "uuid" NOT NULL,
    "tenant_id" "uuid",
    "version_number" integer DEFAULT 1 NOT NULL,
    "schema" "jsonb" NOT NULL,
    "is_active" boolean DEFAULT false,
    "publish_notes" "text",
    "published_at" timestamp with time zone DEFAULT "now"(),
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."form_template_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false,
    "is_published" boolean DEFAULT false,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allow_public_submission" boolean DEFAULT false NOT NULL,
    "public_share_token" "text",
    "public_title" "text",
    "public_description" "text",
    "redirect_url" "text",
    "submission_count" integer DEFAULT 0 NOT NULL,
    "published_version_id" "uuid",
    "has_unpublished_changes" boolean DEFAULT true
);


ALTER TABLE "public"."form_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_themes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "theme" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."form_themes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_sync_asset_map" (
    "tenant_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "local_id" "uuid" NOT NULL,
    "source_repo" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."github_sync_asset_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_sync_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "asset_type" "text" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "asset_name" "text",
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "commit_sha" "text",
    "queued_by" "uuid",
    "queued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "github_sync_queue_action_check" CHECK (("action" = ANY (ARRAY['save'::"text", 'delete'::"text"]))),
    CONSTRAINT "github_sync_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'committed'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."github_sync_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."github_sync_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "asset_types" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "assets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "schedule" "jsonb",
    "schedule_last_fired_at" timestamp with time zone,
    "last_run_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."github_sync_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_call_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "integration_id" "uuid",
    "reference_id" "uuid",
    "caller_type" "text",
    "caller_id" "text",
    "caller_node_id" "text",
    "trace_id" "uuid",
    "method" "text",
    "url" "text",
    "request_headers" "jsonb",
    "request_body" "jsonb",
    "response_status" integer,
    "response_headers" "jsonb",
    "response_body" "jsonb",
    "duration_ms" integer,
    "error" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."integration_call_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_endpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "method" "text" DEFAULT 'GET'::"text" NOT NULL,
    "path" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integration_endpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_object_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "object_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "table_id" "uuid",
    "reference_id" "uuid",
    "alias" "text" NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "join_type" "text",
    "join_on_local" "text",
    "join_on_foreign" "text",
    "join_to_alias" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "integration_object_sources_join_type_check" CHECK (("join_type" = ANY (ARRAY['inner'::"text", 'left'::"text", 'right'::"text", 'full'::"text", 'cross'::"text"]))),
    CONSTRAINT "integration_object_sources_source_type_check" CHECK (("source_type" = ANY (ARRAY['table'::"text", 'reference'::"text"]))),
    CONSTRAINT "source_type_check" CHECK (((("source_type" = 'table'::"text") AND ("table_id" IS NOT NULL)) OR (("source_type" = 'reference'::"text") AND ("reference_id" IS NOT NULL))))
);


ALTER TABLE "public"."integration_object_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."integration_objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integration_references" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "endpoint_id" "uuid",
    "inputs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "outputs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "request_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."integration_references" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true,
    "last_tested_at" timestamp with time zone,
    "last_test_status" "text",
    "last_test_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."user_role" DEFAULT 'member'::"public"."user_role" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_boards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_id" "uuid",
    "image_url" "text",
    "image_storage_bucket" "text",
    "image_storage_path" "text"
);


ALTER TABLE "public"."kanban_boards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_columns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "board_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "position" integer DEFAULT 0 NOT NULL,
    "wip_limit" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_done_column" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."kanban_columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_item_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "linked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kanban_item_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "board_id" "uuid" NOT NULL,
    "column_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "position" integer DEFAULT 0 NOT NULL,
    "due_date" timestamp with time zone,
    "linked_task_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kanban_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kanban_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "board_id" "uuid",
    "item_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kanban_subscriptions_scope_check" CHECK (((("board_id" IS NOT NULL) AND ("item_id" IS NULL)) OR (("board_id" IS NULL) AND ("item_id" IS NOT NULL))))
);


ALTER TABLE "public"."kanban_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lifecycle_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "event_type" "public"."lifecycle_event_type" NOT NULL,
    "actor_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "case_id" "uuid",
    CONSTRAINT "lifecycle_events_target_check" CHECK ((("task_id" IS NOT NULL) OR ("case_id" IS NOT NULL)))
);


ALTER TABLE "public"."lifecycle_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mcp_servers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "url" "text" NOT NULL,
    "auth_type" "text" DEFAULT 'none'::"text",
    "auth_config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "tools_cache" "jsonb" DEFAULT '[]'::"jsonb",
    "tools_cached_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."mcp_servers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "subject" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message_preview" "text"
);


ALTER TABLE "public"."message_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_participants" (
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone
);


ALTER TABLE "public"."message_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "messages_body_length_check" CHECK (("length"("body") <= 50000))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."node_favorites" (
    "tenant_id" "uuid" NOT NULL,
    "node_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."node_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "task_id" "uuid",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "conversation_id" "uuid",
    "case_id" "uuid"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_authorization_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "code_challenge" "text" NOT NULL,
    "code_challenge_method" "text" DEFAULT 'S256'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "oauth_authorization_codes_code_challenge_method_check" CHECK (("code_challenge_method" = 'S256'::"text"))
);


ALTER TABLE "public"."oauth_authorization_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "client_id" "text" NOT NULL,
    "client_secret_hash" "text",
    "name" "text" NOT NULL,
    "client_type" "text" NOT NULL,
    "grant_types" "text"[] DEFAULT '{authorization_code,refresh_token}'::"text"[] NOT NULL,
    "redirect_uris" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "allowed_scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_dynamic" boolean DEFAULT false NOT NULL,
    "created_ip" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "oauth_clients_client_type_check" CHECK (("client_type" = ANY (ARRAY['confidential'::"text", 'public'::"text"]))),
    CONSTRAINT "oauth_clients_tenant_bound" CHECK (("is_dynamic" OR ("tenant_id" IS NOT NULL)))
);


ALTER TABLE "public"."oauth_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_connect_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "state_hash" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "user_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "oauth_connect_states_kind_check" CHECK (("kind" = ANY (ARRAY['connector_authorize'::"text", 'provider_consent'::"text"])))
);


ALTER TABLE "public"."oauth_connect_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "token_type" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_prefix" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "user_id" "uuid",
    "grant_type" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "refresh_parent" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "oauth_tokens_token_type_check" CHECK (("token_type" = ANY (ARRAY['access'::"text", 'refresh'::"text"])))
);


ALTER TABLE "public"."oauth_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "object_type" "text" NOT NULL,
    "object_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "summary" "text",
    "diff" "jsonb",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "app_id" "uuid"
);


ALTER TABLE "public"."object_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "object_type" "text" NOT NULL,
    "object_id" "uuid" NOT NULL,
    "role_id" "uuid",
    "user_id" "uuid",
    "can_view" boolean DEFAULT true NOT NULL,
    "can_edit" boolean DEFAULT true NOT NULL,
    "can_delete" boolean DEFAULT false NOT NULL,
    "can_execute" boolean DEFAULT true NOT NULL,
    "granted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "team_id" "uuid",
    CONSTRAINT "object_permissions_object_type_check" CHECK (("object_type" = ANY (ARRAY['workflow'::"text", 'form'::"text", 'data_table'::"text", 'document'::"text", 'document_folder'::"text", 'agent'::"text", 'integration'::"text", 'web_component'::"text", 'api_key'::"text", 'report'::"text", 'app'::"text", 'kanban_board'::"text", 'case'::"text", 'case_type'::"text", 'channel'::"text"]))),
    CONSTRAINT "role_or_user_or_team" CHECK (((("role_id" IS NOT NULL) AND ("user_id" IS NULL) AND ("team_id" IS NULL)) OR (("role_id" IS NULL) AND ("user_id" IS NOT NULL) AND ("team_id" IS NULL)) OR (("role_id" IS NULL) AND ("user_id" IS NULL) AND ("team_id" IS NOT NULL))))
);


ALTER TABLE "public"."object_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target_user_id" "uuid",
    "role_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."permission_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_shared" boolean DEFAULT false,
    "is_favorite" boolean DEFAULT false,
    "category" "text",
    "last_run_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retention_execution_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "retention_policy_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "executed_at" timestamp with time zone NOT NULL,
    "asset_name" "text",
    "result_status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "workflow_triggered_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "retention_execution_events_action_type_check" CHECK (("action_type" = 'purge'::"text")),
    CONSTRAINT "retention_execution_events_result_status_check" CHECK (("result_status" = ANY (ARRAY['completed'::"text", 'failed'::"text"]))),
    CONSTRAINT "retention_execution_events_target_type_check" CHECK (("target_type" = ANY (ARRAY['document'::"text", 'document_folder'::"text", 'data_table'::"text", 'data_row'::"text"])))
);


ALTER TABLE "public"."retention_execution_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retention_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "policy_mode" "text" NOT NULL,
    "duration_days" integer,
    "applies_to" "text"[] DEFAULT ARRAY['documents'::"text", 'folders'::"text", 'data_tables'::"text"] NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration_value" integer,
    "duration_unit" "text",
    "exact_date" timestamp with time zone,
    CONSTRAINT "retention_policies_applies_to_check" CHECK (("applies_to" <@ ARRAY['documents'::"text", 'folders'::"text", 'data_tables'::"text", 'data_rows'::"text", 'roles'::"text"])),
    CONSTRAINT "retention_policies_duration_config_check" CHECK (((("policy_mode" = 'keep_forever'::"text") AND ("duration_value" IS NULL) AND ("duration_unit" IS NULL) AND ("exact_date" IS NULL)) OR (("policy_mode" = ANY (ARRAY['review'::"text", 'purge_on'::"text"])) AND ("duration_value" IS NOT NULL) AND ("duration_value" > 0) AND ("duration_unit" = ANY (ARRAY['days'::"text", 'months'::"text", 'years'::"text"])) AND ("exact_date" IS NULL)) OR (("policy_mode" = ANY (ARRAY['review_on_exact_date'::"text", 'purge_on_exact_date'::"text"])) AND ("duration_value" IS NULL) AND ("duration_unit" IS NULL) AND ("exact_date" IS NOT NULL)))),
    CONSTRAINT "retention_policies_mode_check" CHECK (("policy_mode" = ANY (ARRAY['review'::"text", 'review_on_exact_date'::"text", 'purge_on'::"text", 'purge_on_exact_date'::"text", 'keep_forever'::"text"])))
);


ALTER TABLE "public"."retention_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retention_review_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "retention_policy_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "review_date" "date" NOT NULL,
    "asset_name" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "admin_tasks_created_at" timestamp with time zone,
    "workflow_triggered_at" timestamp with time zone,
    "task_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "retention_review_events_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'completed'::"text", 'dismissed'::"text"]))),
    CONSTRAINT "retention_review_events_target_type_check" CHECK (("target_type" = ANY (ARRAY['document'::"text", 'document_folder'::"text", 'data_table'::"text", 'data_row'::"text"])))
);


ALTER TABLE "public"."retention_review_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "permissions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "base_role" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "retention_policy_id" "uuid",
    "retention_applied_at" timestamp with time zone
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tag_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#6B7280'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tag_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_assignees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'collaborator'::"text" NOT NULL,
    "acceptance_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "acceptance_comment" "text",
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_dependencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "depends_on_task_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_dependencies_check" CHECK (("task_id" <> "depends_on_task_id"))
);


ALTER TABLE "public"."task_dependencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_escalations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "escalation_type" "text" DEFAULT 'individual'::"text" NOT NULL,
    "user_id" "uuid",
    "team_id" "uuid",
    "escalate_after_minutes" integer DEFAULT 0 NOT NULL,
    "is_escalated" boolean DEFAULT false NOT NULL,
    "escalated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_escalations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "offset_minutes" integer NOT NULL,
    "is_sent" boolean DEFAULT false NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "outcome" "text" NOT NULL,
    "outcome_notes" "text",
    "responded_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "parent_task_id" "uuid",
    "template_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "public"."task_status" DEFAULT 'todo'::"public"."task_status" NOT NULL,
    "priority" "public"."task_priority" DEFAULT 'medium'::"public"."task_priority" NOT NULL,
    "sequence" integer DEFAULT 0,
    "is_sequential" boolean DEFAULT false,
    "assignee_id" "uuid",
    "assigner_id" "uuid",
    "due_date" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "estimated_effort_assigner" integer,
    "estimated_effort_assignee" integer,
    "actual_effort" integer DEFAULT 0,
    "progress_pct" numeric(5,2) DEFAULT 0.00,
    "child_count" integer DEFAULT 0,
    "completed_child_count" integer DEFAULT 0,
    "allow_reassign" boolean DEFAULT true,
    "allow_escalate" boolean DEFAULT true,
    "allow_delegate" boolean DEFAULT true,
    "workflow_source_id" "uuid",
    "workflow_step_id" "text",
    "workflow_position" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "outcome" "text",
    "outcome_notes" "text",
    "available_outcomes" "jsonb" DEFAULT '["completed"]'::"jsonb",
    "estimated_completion" timestamp with time zone,
    "acceptance_status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "accepted_at" timestamp with time zone,
    "acceptance_comment" "text",
    "assignment_mode" "text" DEFAULT 'single'::"text" NOT NULL,
    "assignment_group_id" "uuid",
    "assigned_team_id" "uuid",
    "is_workflow_task" boolean DEFAULT false NOT NULL,
    "event_id" "text",
    "assignment_type" "text" DEFAULT 'individual'::"text" NOT NULL,
    "aad_group_id" "text",
    "due_date_mode" "text" DEFAULT 'absolute'::"text" NOT NULL,
    "due_date_offset" "jsonb",
    "actioned_by" "uuid",
    "actioned_at" timestamp with time zone,
    "app_id" "uuid"
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "parent_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_connectors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "connector_key" "text" NOT NULL,
    "display_name" "text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "credentials" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "integration_id" "uuid",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "last_tested_at" timestamp with time zone,
    "last_test_status" "text",
    "last_test_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tenant_connectors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_fonts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "family" "text" NOT NULL,
    "source" "text" DEFAULT 'google'::"text" NOT NULL,
    "url" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_fonts_source_check" CHECK (("source" = ANY (ARRAY['google'::"text", 'url'::"text"])))
);


ALTER TABLE "public"."tenant_fonts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "public"."tenant_plan" DEFAULT 'personal_free'::"public"."tenant_plan" NOT NULL,
    "auth_provider" "public"."auth_provider" DEFAULT 'email'::"public"."auth_provider" NOT NULL,
    "domain" "text",
    "branding" "jsonb" DEFAULT '{}'::"jsonb",
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "custom_domain" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "log_retention_days" integer DEFAULT 365 NOT NULL,
    "industry" "text",
    "company_size" "text",
    "contact_name" "text",
    "contact_email" "text",
    "onboarding_completed" boolean DEFAULT false
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_balances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "included_allowance" numeric(10,2) DEFAULT 100 NOT NULL,
    "consumed" numeric(10,4) DEFAULT 0 NOT NULL,
    "prepaid_remaining" numeric(10,2) DEFAULT 0,
    "billing_rate" numeric(8,4) DEFAULT 0.0100,
    "alert_sent_80" boolean DEFAULT false,
    "alert_sent_100" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."token_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "action_type" "public"."token_action_type" NOT NULL,
    "tokens_consumed" numeric(10,4) NOT NULL,
    "task_id" "uuid",
    "actor_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."token_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role" "public"."user_role" DEFAULT 'member'::"public"."user_role" NOT NULL,
    "display_name_override" "text",
    "is_home" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "team_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'member'::"public"."user_role" NOT NULL,
    "team_id" "uuid",
    "manager_id" "uuid",
    "available_hours_week" numeric(5,2) DEFAULT 40.00,
    "timezone" "text" DEFAULT 'America/Denver'::"text",
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "current_tenant_id" "uuid",
    "description" "text",
    "skills" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid",
    "workflow_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "node_id" "text",
    "node_type" "text",
    "node_label" "text",
    "level" "text" DEFAULT 'info'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "task_id" "uuid",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "node_results" "jsonb" DEFAULT '{}'::"jsonb",
    "error" "text",
    "event_id" "text",
    "paused_at" timestamp with time zone,
    "paused_node_id" "text",
    "pause_variables" "jsonb",
    "version_id" "uuid",
    "title" "text",
    "trace_id" "uuid",
    "execution_trace" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sla_label" "text",
    "sla_due_at" timestamp with time zone,
    "sla_warning_at" timestamp with time zone,
    "sla_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "sla_warning_triggered_at" timestamp with time zone,
    "sla_breached_triggered_at" timestamp with time zone,
    "sla_last_evaluated_at" timestamp with time zone,
    "sla_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "workflow_runs_sla_status_check" CHECK (("sla_status" = ANY (ARRAY['none'::"text", 'on_track'::"text", 'warning'::"text", 'breached'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."workflow_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "engine_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "instance_id" "text",
    "callback_url" "text",
    "api_key_hash" "text",
    "auth_config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "edges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "user_variables" "jsonb" DEFAULT '[]'::"jsonb",
    "swimlanes" "jsonb" DEFAULT '[]'::"jsonb",
    "trigger_type" "text" NOT NULL,
    "publish_notes" "text",
    "published_by" "uuid",
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "trigger_config" "jsonb" DEFAULT '{}'::"jsonb",
    "sections" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."workflow_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_webhooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "api_key_hash" "text" NOT NULL,
    "api_key_prefix" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "payload_mapping" "jsonb" DEFAULT '{}'::"jsonb",
    "last_received_at" timestamp with time zone,
    "receive_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_webhooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "trigger_type" "text" DEFAULT 'task_created'::"text" NOT NULL,
    "trigger_config" "jsonb" DEFAULT '{}'::"jsonb",
    "nodes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "edges" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT false,
    "last_run_at" timestamp with time zone,
    "run_count" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_variables" "jsonb" DEFAULT '[]'::"jsonb",
    "swimlanes" "jsonb" DEFAULT '[]'::"jsonb",
    "published_version_id" "uuid",
    "has_unpublished_changes" boolean DEFAULT true,
    "sections" "jsonb" DEFAULT '[]'::"jsonb",
    "tags" "text"[],
    "schedule_last_fired_at" timestamp with time zone
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agent_queue"
    ADD CONSTRAINT "agent_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_assets"
    ADD CONSTRAINT "app_assets_app_id_asset_type_asset_id_key" UNIQUE ("app_id", "asset_type", "asset_id");



ALTER TABLE ONLY "public"."app_assets"
    ADD CONSTRAINT "app_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_page_versions"
    ADD CONSTRAINT "app_page_versions_app_page_id_version_number_key" UNIQUE ("app_page_id", "version_number");



ALTER TABLE ONLY "public"."app_page_versions"
    ADD CONSTRAINT "app_page_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."app_teams"
    ADD CONSTRAINT "app_teams_app_id_team_id_key" UNIQUE ("app_id", "team_id");



ALTER TABLE ONLY "public"."app_teams"
    ADD CONSTRAINT "app_teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_counters"
    ADD CONSTRAINT "case_counters_pkey" PRIMARY KEY ("tenant_id", "prefix");



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_case_id_user_id_key" UNIQUE ("case_id", "user_id");



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_case_id_task_id_key" UNIQUE ("case_id", "task_id");



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_tenant_id_key_key" UNIQUE ("tenant_id", "key");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_tenant_id_number_key" UNIQUE ("tenant_id", "number");



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channel_screens"
    ADD CONSTRAINT "channel_screens_channel_id_page_id_key" UNIQUE ("channel_id", "page_id");



ALTER TABLE ONLY "public"."channel_screens"
    ADD CONSTRAINT "channel_screens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."component_templates"
    ADD CONSTRAINT "component_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_table_rows"
    ADD CONSTRAINT "custom_table_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_tables"
    ADD CONSTRAINT "custom_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_web_components"
    ADD CONSTRAINT "custom_web_components_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_web_components"
    ADD CONSTRAINT "custom_web_components_tenant_id_tag_name_key" UNIQUE ("tenant_id", "tag_name");



ALTER TABLE ONLY "public"."custom_workflow_activities"
    ADD CONSTRAINT "custom_workflow_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_workflow_activities"
    ADD CONSTRAINT "custom_workflow_activities_tenant_id_key_key" UNIQUE ("tenant_id", "key");



ALTER TABLE ONLY "public"."dashboard_configs"
    ADD CONSTRAINT "dashboard_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dead_letter_events"
    ADD CONSTRAINT "dead_letter_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decision_tables"
    ADD CONSTRAINT "decision_tables_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deletion_queue"
    ADD CONSTRAINT "deletion_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."directory_links"
    ADD CONSTRAINT "directory_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."directory_links"
    ADD CONSTRAINT "directory_links_tenant_id_provider_object_type_external_id_key" UNIQUE ("tenant_id", "provider", "object_type", "external_id");



ALTER TABLE ONLY "public"."directory_sync_runs"
    ADD CONSTRAINT "directory_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_metadata_templates"
    ADD CONSTRAINT "document_metadata_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_version_number_key" UNIQUE ("document_id", "version_number");



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."effort_records"
    ADD CONSTRAINT "effort_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_events"
    ADD CONSTRAINT "form_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_submissions"
    ADD CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_versions"
    ADD CONSTRAINT "form_template_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_public_share_token_key" UNIQUE ("public_share_token");



ALTER TABLE ONLY "public"."form_themes"
    ADD CONSTRAINT "form_themes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."github_deployments"
    ADD CONSTRAINT "github_deployments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."github_sync_asset_map"
    ADD CONSTRAINT "github_sync_asset_map_pkey" PRIMARY KEY ("tenant_id", "asset_type", "source_id");



ALTER TABLE ONLY "public"."github_sync_queue"
    ADD CONSTRAINT "github_sync_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."github_sync_runs"
    ADD CONSTRAINT "github_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."github_sync_templates"
    ADD CONSTRAINT "github_sync_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_call_logs"
    ADD CONSTRAINT "integration_call_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_endpoints"
    ADD CONSTRAINT "integration_endpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_object_sources"
    ADD CONSTRAINT "integration_object_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_objects"
    ADD CONSTRAINT "integration_objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integration_references"
    ADD CONSTRAINT "integration_references_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_boards"
    ADD CONSTRAINT "kanban_boards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_tenant_id_item_id_task_id_key" UNIQUE ("tenant_id", "item_id", "task_id");



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kanban_subscriptions"
    ADD CONSTRAINT "kanban_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lifecycle_events"
    ADD CONSTRAINT "lifecycle_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_servers"
    ADD CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_conversations"
    ADD CONSTRAINT "message_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_participants"
    ADD CONSTRAINT "message_participants_pkey" PRIMARY KEY ("conversation_id", "user_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."node_favorites"
    ADD CONSTRAINT "node_favorites_pkey" PRIMARY KEY ("tenant_id", "node_type");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_code_hash_key" UNIQUE ("code_hash");



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_connect_states"
    ADD CONSTRAINT "oauth_connect_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_connect_states"
    ADD CONSTRAINT "oauth_connect_states_state_hash_key" UNIQUE ("state_hash");



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."object_audit_log"
    ADD CONSTRAINT "object_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_audit_log"
    ADD CONSTRAINT "permission_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_execution_events"
    ADD CONSTRAINT "retention_execution_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_execution_events"
    ADD CONSTRAINT "retention_execution_events_tenant_id_retention_policy_id_ac_key" UNIQUE ("tenant_id", "retention_policy_id", "action_type", "target_type", "target_id", "executed_at");



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_review_events"
    ADD CONSTRAINT "retention_review_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_review_events"
    ADD CONSTRAINT "retention_review_events_tenant_id_retention_policy_id_targe_key" UNIQUE ("tenant_id", "retention_policy_id", "target_type", "target_id", "review_date");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."tag_definitions"
    ADD CONSTRAINT "tag_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tag_definitions"
    ADD CONSTRAINT "tag_definitions_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_task_id_user_id_key" UNIQUE ("task_id", "user_id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_task_id_depends_on_task_id_key" UNIQUE ("task_id", "depends_on_task_id");



ALTER TABLE ONLY "public"."task_escalations"
    ADD CONSTRAINT "task_escalations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_responses"
    ADD CONSTRAINT "task_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_responses"
    ADD CONSTRAINT "task_responses_task_id_user_id_key" UNIQUE ("task_id", "user_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_connectors"
    ADD CONSTRAINT "tenant_connectors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_fonts"
    ADD CONSTRAINT "tenant_fonts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."token_balances"
    ADD CONSTRAINT "token_balances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."token_ledger"
    ADD CONSTRAINT "token_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "unique_role_object" UNIQUE NULLS NOT DISTINCT ("tenant_id", "object_type", "object_id", "role_id");



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "unique_team_object" UNIQUE NULLS NOT DISTINCT ("tenant_id", "object_type", "object_id", "team_id");



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "unique_user_object" UNIQUE NULLS NOT DISTINCT ("tenant_id", "object_type", "object_id", "user_id");



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_user_id_role_id_key" UNIQUE ("tenant_id", "user_id", "role_id");



ALTER TABLE ONLY "public"."user_teams"
    ADD CONSTRAINT "user_teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_logs"
    ADD CONSTRAINT "workflow_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_queue"
    ADD CONSTRAINT "workflow_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_sources"
    ADD CONSTRAINT "workflow_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_versions"
    ADD CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_versions"
    ADD CONSTRAINT "workflow_versions_workflow_id_version_number_key" UNIQUE ("workflow_id", "version_number");



ALTER TABLE ONLY "public"."workflow_webhooks"
    ADD CONSTRAINT "workflow_webhooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");



CREATE INDEX "component_templates_tenant_idx" ON "public"."component_templates" USING "btree" ("tenant_id", "component_type");



CREATE INDEX "deletion_queue_status_created_idx" ON "public"."deletion_queue" USING "btree" ("status", "created_at");



CREATE INDEX "deletion_queue_tenant_status_idx" ON "public"."deletion_queue" USING "btree" ("tenant_id", "status", "created_at");



CREATE INDEX "directory_links_tenant_type_idx" ON "public"."directory_links" USING "btree" ("tenant_id", "object_type");



CREATE UNIQUE INDEX "directory_sync_runs_one_active_idx" ON "public"."directory_sync_runs" USING "btree" ("tenant_id", "provider") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "directory_sync_runs_pending_idx" ON "public"."directory_sync_runs" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "directory_sync_runs_tenant_created_idx" ON "public"."directory_sync_runs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "github_deployments_status_idx" ON "public"."github_deployments" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "github_deployments_tenant_created_idx" ON "public"."github_deployments" USING "btree" ("tenant_id", "created_at" DESC);



CREATE UNIQUE INDEX "github_sync_queue_pending_uniq" ON "public"."github_sync_queue" USING "btree" ("tenant_id", "asset_type", "asset_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "github_sync_queue_tenant_status_idx" ON "public"."github_sync_queue" USING "btree" ("tenant_id", "status", "queued_at");



CREATE UNIQUE INDEX "github_sync_runs_one_active_idx" ON "public"."github_sync_runs" USING "btree" ("tenant_id") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "github_sync_runs_pending_idx" ON "public"."github_sync_runs" USING "btree" ("status", "created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "github_sync_runs_tenant_created_idx" ON "public"."github_sync_runs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "github_sync_templates_tenant_idx" ON "public"."github_sync_templates" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_agent_queue_pending" ON "public"."agent_queue" USING "btree" ("status", "scheduled_for") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_agent_queue_tenant" ON "public"."agent_queue" USING "btree" ("tenant_id");



CREATE INDEX "idx_agent_runs_agent" ON "public"."agent_runs" USING "btree" ("agent_id");



CREATE INDEX "idx_agent_runs_caller" ON "public"."agent_runs" USING "btree" ("caller_type", "caller_id");



CREATE INDEX "idx_agent_runs_tenant_started" ON "public"."agent_runs" USING "btree" ("tenant_id", "started_at" DESC);



CREATE INDEX "idx_agent_runs_trace" ON "public"."agent_runs" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_agent_runs_workflow" ON "public"."agent_runs" USING "btree" ("workflow_run_id");



CREATE INDEX "idx_agents_tenant" ON "public"."agents" USING "btree" ("tenant_id");



CREATE INDEX "idx_api_keys_prefix" ON "public"."api_keys" USING "btree" ("key_prefix");



CREATE INDEX "idx_api_keys_scopes_gin" ON "public"."api_keys" USING "gin" ("scopes");



CREATE INDEX "idx_api_keys_tenant" ON "public"."api_keys" USING "btree" ("tenant_id");



CREATE INDEX "idx_api_keys_tenant_user_id" ON "public"."api_keys" USING "btree" ("tenant_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_app_assets_app" ON "public"."app_assets" USING "btree" ("app_id");



CREATE INDEX "idx_app_assets_asset" ON "public"."app_assets" USING "btree" ("asset_type", "asset_id");



CREATE INDEX "idx_app_page_versions_page_id" ON "public"."app_page_versions" USING "btree" ("app_page_id", "version_number" DESC);



CREATE UNIQUE INDEX "idx_app_pages_public_share_token" ON "public"."app_pages" USING "btree" ("public_share_token") WHERE ("public_share_token" IS NOT NULL);



CREATE INDEX "idx_app_pages_tenant_kind_updated_at" ON "public"."app_pages" USING "btree" ("tenant_id", "page_kind", "updated_at" DESC);



CREATE INDEX "idx_app_pages_tenant_updated_at" ON "public"."app_pages" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_app_teams_app" ON "public"."app_teams" USING "btree" ("app_id");



CREATE INDEX "idx_app_teams_team" ON "public"."app_teams" USING "btree" ("team_id");



CREATE INDEX "idx_apps_tenant" ON "public"."apps" USING "btree" ("tenant_id");



CREATE INDEX "idx_audit_log_tenant" ON "public"."permission_audit_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_case_participants_case" ON "public"."case_participants" USING "btree" ("case_id");



CREATE INDEX "idx_case_participants_user" ON "public"."case_participants" USING "btree" ("user_id");



CREATE INDEX "idx_case_tasks_case" ON "public"."case_tasks" USING "btree" ("case_id");



CREATE INDEX "idx_case_tasks_task" ON "public"."case_tasks" USING "btree" ("task_id");



CREATE INDEX "idx_case_types_tenant" ON "public"."case_types" USING "btree" ("tenant_id");



CREATE INDEX "idx_case_types_tenant_app" ON "public"."case_types" USING "btree" ("tenant_id", "app_id") WHERE ("app_id" IS NOT NULL);



CREATE INDEX "idx_cases_app" ON "public"."cases" USING "btree" ("app_id") WHERE ("app_id" IS NOT NULL);



CREATE INDEX "idx_cases_assigned" ON "public"."cases" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "idx_cases_channel" ON "public"."cases" USING "btree" ("channel_id") WHERE ("channel_id" IS NOT NULL);



CREATE INDEX "idx_cases_tenant_status" ON "public"."cases" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_cases_tenant_type" ON "public"."cases" USING "btree" ("tenant_id", "case_type_id");



CREATE INDEX "idx_channel_members_channel" ON "public"."channel_members" USING "btree" ("channel_id");



CREATE UNIQUE INDEX "idx_channel_members_role_unique" ON "public"."channel_members" USING "btree" ("channel_id", "role_id") WHERE (("principal_type" = 'role'::"text") AND ("role_id" IS NOT NULL));



CREATE UNIQUE INDEX "idx_channel_members_team_unique" ON "public"."channel_members" USING "btree" ("channel_id", "team_id") WHERE (("principal_type" = 'team'::"text") AND ("team_id" IS NOT NULL));



CREATE INDEX "idx_channel_members_tenant" ON "public"."channel_members" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_channel_members_user_unique" ON "public"."channel_members" USING "btree" ("channel_id", "user_id") WHERE (("principal_type" = 'user'::"text") AND ("user_id" IS NOT NULL));



CREATE INDEX "idx_channel_screens_channel" ON "public"."channel_screens" USING "btree" ("channel_id", "sort_order", "created_at");



CREATE INDEX "idx_channels_tenant" ON "public"."channels" USING "btree" ("tenant_id", "is_active", "name");



CREATE INDEX "idx_custom_rows_table" ON "public"."custom_table_rows" USING "btree" ("table_id");



CREATE INDEX "idx_custom_rows_tenant" ON "public"."custom_table_rows" USING "btree" ("tenant_id");



CREATE INDEX "idx_custom_table_rows_updated_by" ON "public"."custom_table_rows" USING "btree" ("updated_by") WHERE ("updated_by" IS NOT NULL);



CREATE INDEX "idx_custom_tables_retention_policy" ON "public"."custom_tables" USING "btree" ("tenant_id", "retention_policy_id");



CREATE UNIQUE INDEX "idx_custom_tables_slug" ON "public"."custom_tables" USING "btree" ("tenant_id", "slug");



CREATE INDEX "idx_custom_tables_tenant" ON "public"."custom_tables" USING "btree" ("tenant_id");



CREATE INDEX "idx_custom_web_components_tenant_tag" ON "public"."custom_web_components" USING "btree" ("tenant_id", "tag_name");



CREATE INDEX "idx_custom_web_components_tenant_updated" ON "public"."custom_web_components" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_custom_workflow_activities_tenant_key" ON "public"."custom_workflow_activities" USING "btree" ("tenant_id", "key");



CREATE INDEX "idx_custom_workflow_activities_tenant_updated" ON "public"."custom_workflow_activities" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE UNIQUE INDEX "idx_dashboard_config_user" ON "public"."dashboard_configs" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_dead_letter_tenant" ON "public"."dead_letter_events" USING "btree" ("tenant_id");



CREATE INDEX "idx_decision_tables_tenant_updated" ON "public"."decision_tables" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_doc_meta_templates_tenant_updated" ON "public"."document_metadata_templates" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_document_folders_meta_template" ON "public"."document_folders" USING "btree" ("metadata_template_id") WHERE ("metadata_template_id" IS NOT NULL);



CREATE INDEX "idx_document_folders_retention_policy" ON "public"."document_folders" USING "btree" ("tenant_id", "retention_policy_id");



CREATE INDEX "idx_document_folders_tenant_archived" ON "public"."document_folders" USING "btree" ("tenant_id", "archived_at", "updated_at" DESC);



CREATE INDEX "idx_document_folders_tenant_parent" ON "public"."document_folders" USING "btree" ("tenant_id", "parent_folder_id", "updated_at" DESC);



CREATE INDEX "idx_document_versions_document" ON "public"."document_versions" USING "btree" ("document_id", "version_number" DESC);



CREATE INDEX "idx_documents_meta_template" ON "public"."documents" USING "btree" ("metadata_template_id") WHERE ("metadata_template_id" IS NOT NULL);



CREATE INDEX "idx_documents_retention_policy" ON "public"."documents" USING "btree" ("tenant_id", "retention_policy_id");



CREATE INDEX "idx_documents_tenant_archived" ON "public"."documents" USING "btree" ("tenant_id", "archived_at", "updated_at" DESC);



CREATE INDEX "idx_documents_tenant_folder" ON "public"."documents" USING "btree" ("tenant_id", "folder_id", "updated_at" DESC);



CREATE INDEX "idx_effort_task" ON "public"."effort_records" USING "btree" ("task_id");



CREATE INDEX "idx_effort_tenant" ON "public"."effort_records" USING "btree" ("tenant_id");



CREATE INDEX "idx_effort_user" ON "public"."effort_records" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_email_templates_one_default" ON "public"."email_templates" USING "btree" ("tenant_id") WHERE "is_default";



CREATE INDEX "idx_email_templates_tenant_updated" ON "public"."email_templates" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "idx_endpoints_integration" ON "public"."integration_endpoints" USING "btree" ("integration_id");



CREATE INDEX "idx_form_events_session" ON "public"."form_events" USING "btree" ("session_id");



CREATE INDEX "idx_form_events_template_created" ON "public"."form_events" USING "btree" ("template_id", "created_at" DESC);



CREATE INDEX "idx_form_events_type" ON "public"."form_events" USING "btree" ("template_id", "event_type", "created_at" DESC);



CREATE INDEX "idx_form_submissions_page_id_submitted_at" ON "public"."form_submissions" USING "btree" ("page_id", "submitted_at" DESC);



CREATE INDEX "idx_form_submissions_trace" ON "public"."form_submissions" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_form_themes_tenant" ON "public"."form_themes" USING "btree" ("tenant_id");



CREATE INDEX "idx_ftv_active" ON "public"."form_template_versions" USING "btree" ("form_template_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_ftv_template_id" ON "public"."form_template_versions" USING "btree" ("form_template_id");



CREATE INDEX "idx_int_object_sources_object" ON "public"."integration_object_sources" USING "btree" ("object_id");



CREATE INDEX "idx_int_objects_tenant" ON "public"."integration_objects" USING "btree" ("tenant_id");



CREATE INDEX "idx_integration_call_logs_caller" ON "public"."integration_call_logs" USING "btree" ("caller_type", "caller_id");



CREATE INDEX "idx_integration_call_logs_integration" ON "public"."integration_call_logs" USING "btree" ("integration_id", "started_at" DESC);



CREATE INDEX "idx_integration_call_logs_reference" ON "public"."integration_call_logs" USING "btree" ("reference_id", "started_at" DESC);



CREATE INDEX "idx_integration_call_logs_tenant_started" ON "public"."integration_call_logs" USING "btree" ("tenant_id", "started_at" DESC);



CREATE INDEX "idx_integration_call_logs_trace" ON "public"."integration_call_logs" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_integration_refs_integration" ON "public"."integration_references" USING "btree" ("integration_id");



CREATE INDEX "idx_integration_refs_tenant" ON "public"."integration_references" USING "btree" ("tenant_id");



CREATE INDEX "idx_integrations_tenant" ON "public"."integrations" USING "btree" ("tenant_id");



CREATE INDEX "idx_invitations_tenant" ON "public"."invitations" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_invitations_tenant_email" ON "public"."invitations" USING "btree" ("tenant_id", "email") WHERE ("accepted_at" IS NULL);



CREATE INDEX "idx_invitations_token" ON "public"."invitations" USING "btree" ("token");



CREATE INDEX "idx_lifecycle_events_case" ON "public"."lifecycle_events" USING "btree" ("case_id", "created_at" DESC) WHERE ("case_id" IS NOT NULL);



CREATE INDEX "idx_lifecycle_events_task" ON "public"."lifecycle_events" USING "btree" ("task_id", "created_at" DESC);



CREATE INDEX "idx_lifecycle_task" ON "public"."lifecycle_events" USING "btree" ("task_id");



CREATE INDEX "idx_lifecycle_tenant_time" ON "public"."lifecycle_events" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_mcp_servers_tenant" ON "public"."mcp_servers" USING "btree" ("tenant_id");



CREATE INDEX "idx_membership_tenant" ON "public"."user_memberships" USING "btree" ("tenant_id");



CREATE INDEX "idx_membership_user" ON "public"."user_memberships" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_membership_user_tenant" ON "public"."user_memberships" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_message_conversations_tenant_last" ON "public"."message_conversations" USING "btree" ("tenant_id", "last_message_at" DESC);



CREATE INDEX "idx_message_participants_conversation" ON "public"."message_participants" USING "btree" ("conversation_id");



CREATE INDEX "idx_message_participants_user" ON "public"."message_participants" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_tenant_created" ON "public"."messages" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_notifications_conversation" ON "public"."notifications" USING "btree" ("conversation_id") WHERE ("conversation_id" IS NOT NULL);



CREATE INDEX "idx_notifications_tenant" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_obj_perm_object" ON "public"."object_permissions" USING "btree" ("tenant_id", "object_type", "object_id");



CREATE INDEX "idx_obj_perm_role" ON "public"."object_permissions" USING "btree" ("tenant_id", "role_id") WHERE ("role_id" IS NOT NULL);



CREATE INDEX "idx_obj_perm_team" ON "public"."object_permissions" USING "btree" ("tenant_id", "team_id") WHERE ("team_id" IS NOT NULL);



CREATE INDEX "idx_obj_perm_user" ON "public"."object_permissions" USING "btree" ("tenant_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_object_audit_log_actor" ON "public"."object_audit_log" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_object_audit_log_app" ON "public"."object_audit_log" USING "btree" ("tenant_id", "app_id", "created_at" DESC) WHERE ("app_id" IS NOT NULL);



CREATE INDEX "idx_object_audit_log_object" ON "public"."object_audit_log" USING "btree" ("object_type", "object_id", "created_at" DESC);



CREATE INDEX "idx_object_audit_log_tenant_created" ON "public"."object_audit_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_queue_pending" ON "public"."workflow_queue" USING "btree" ("scheduled_for", "priority" DESC) WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_queue_processing" ON "public"."workflow_queue" USING "btree" ("locked_at") WHERE ("status" = 'processing'::"text");



CREATE INDEX "idx_queue_retry" ON "public"."workflow_queue" USING "btree" ("next_retry_at") WHERE (("status" = 'failed'::"text") AND ("attempts" < "max_attempts"));



CREATE INDEX "idx_queue_tenant" ON "public"."workflow_queue" USING "btree" ("tenant_id");



CREATE INDEX "idx_queue_workflow" ON "public"."workflow_queue" USING "btree" ("workflow_id");



CREATE INDEX "idx_reports_created_by" ON "public"."reports" USING "btree" ("created_by");



CREATE INDEX "idx_reports_tenant" ON "public"."reports" USING "btree" ("tenant_id");



CREATE INDEX "idx_retention_execution_events_policy" ON "public"."retention_execution_events" USING "btree" ("tenant_id", "retention_policy_id", "executed_at" DESC);



CREATE INDEX "idx_retention_execution_events_tenant_executed" ON "public"."retention_execution_events" USING "btree" ("tenant_id", "executed_at" DESC);



CREATE INDEX "idx_retention_policies_tenant_name" ON "public"."retention_policies" USING "btree" ("tenant_id", "name");



CREATE INDEX "idx_retention_review_events_policy" ON "public"."retention_review_events" USING "btree" ("tenant_id", "retention_policy_id", "review_date" DESC);



CREATE INDEX "idx_retention_review_events_tenant_status" ON "public"."retention_review_events" USING "btree" ("tenant_id", "status", "review_date" DESC);



CREATE INDEX "idx_roles_retention_policy" ON "public"."roles" USING "btree" ("tenant_id", "retention_policy_id") WHERE ("retention_policy_id" IS NOT NULL);



CREATE INDEX "idx_roles_tenant" ON "public"."roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_tag_definitions_tenant" ON "public"."tag_definitions" USING "btree" ("tenant_id");



CREATE INDEX "idx_task_dependencies_blocker" ON "public"."task_dependencies" USING "btree" ("depends_on_task_id");



CREATE INDEX "idx_task_dependencies_task" ON "public"."task_dependencies" USING "btree" ("task_id");



CREATE INDEX "idx_task_escalations_pending" ON "public"."task_escalations" USING "btree" ("is_escalated") WHERE ("is_escalated" = false);



CREATE INDEX "idx_task_escalations_task" ON "public"."task_escalations" USING "btree" ("task_id");



CREATE INDEX "idx_task_reminders_pending" ON "public"."task_reminders" USING "btree" ("is_sent", "sent_at") WHERE ("is_sent" = false);



CREATE INDEX "idx_task_reminders_task" ON "public"."task_reminders" USING "btree" ("task_id");



CREATE INDEX "idx_task_responses_task" ON "public"."task_responses" USING "btree" ("task_id");



CREATE INDEX "idx_tasks_assigned_team" ON "public"."tasks" USING "btree" ("assigned_team_id") WHERE ("assigned_team_id" IS NOT NULL);



CREATE INDEX "idx_tasks_assignee" ON "public"."tasks" USING "btree" ("assignee_id") WHERE ("assignee_id" IS NOT NULL);



CREATE INDEX "idx_tasks_assignee_status" ON "public"."tasks" USING "btree" ("assignee_id", "status", "deleted_at");



CREATE INDEX "idx_tasks_assignment_group" ON "public"."tasks" USING "btree" ("assignment_group_id") WHERE ("assignment_group_id" IS NOT NULL);



CREATE INDEX "idx_tasks_due" ON "public"."tasks" USING "btree" ("tenant_id", "due_date") WHERE (("due_date" IS NOT NULL) AND ("status" <> ALL (ARRAY['completed'::"public"."task_status", 'cancelled'::"public"."task_status"])));



CREATE INDEX "idx_tasks_event" ON "public"."tasks" USING "btree" ("event_id");



CREATE INDEX "idx_tasks_event_id" ON "public"."tasks" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "idx_tasks_parent" ON "public"."tasks" USING "btree" ("parent_task_id") WHERE ("parent_task_id" IS NOT NULL);



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_tasks_tags" ON "public"."tasks" USING "gin" ("tags");



CREATE INDEX "idx_tasks_tenant" ON "public"."tasks" USING "btree" ("tenant_id");



CREATE INDEX "idx_tasks_tenant_app" ON "public"."tasks" USING "btree" ("tenant_id", "app_id") WHERE ("app_id" IS NOT NULL);



CREATE INDEX "idx_tasks_tenant_status" ON "public"."tasks" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_tasks_workflow" ON "public"."tasks" USING "btree" ("workflow_source_id") WHERE ("workflow_source_id" IS NOT NULL);



CREATE INDEX "idx_teams_tenant" ON "public"."teams" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_templates_default" ON "public"."form_templates" USING "btree" ("tenant_id") WHERE ("is_default" = true);



CREATE INDEX "idx_templates_tenant" ON "public"."form_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenants_domain" ON "public"."tenants" USING "btree" ("domain") WHERE ("domain" IS NOT NULL);



CREATE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug");



CREATE UNIQUE INDEX "idx_tenants_slug_unique" ON "public"."tenants" USING "btree" ("slug") WHERE (("slug" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "idx_token_balance_tenant_period" ON "public"."token_balances" USING "btree" ("tenant_id", "period_start");



CREATE INDEX "idx_token_ledger_tenant_action" ON "public"."token_ledger" USING "btree" ("tenant_id", "action_type");



CREATE INDEX "idx_token_ledger_tenant_time" ON "public"."token_ledger" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_user_roles_tenant" ON "public"."user_roles" USING "btree" ("tenant_id");



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_user_teams_team" ON "public"."user_teams" USING "btree" ("team_id");



CREATE UNIQUE INDEX "idx_user_teams_unique" ON "public"."user_teams" USING "btree" ("user_id", "team_id");



CREATE INDEX "idx_user_teams_user" ON "public"."user_teams" USING "btree" ("user_id");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE UNIQUE INDEX "idx_users_email_tenant" ON "public"."users" USING "btree" ("email", "tenant_id");



CREATE INDEX "idx_users_team" ON "public"."users" USING "btree" ("team_id") WHERE ("team_id" IS NOT NULL);



CREATE INDEX "idx_users_tenant" ON "public"."users" USING "btree" ("tenant_id");



CREATE INDEX "idx_wf_sources_tenant" ON "public"."workflow_sources" USING "btree" ("tenant_id");



CREATE INDEX "idx_workflow_logs_created" ON "public"."workflow_logs" USING "btree" ("created_at");



CREATE INDEX "idx_workflow_logs_run" ON "public"."workflow_logs" USING "btree" ("run_id");



CREATE INDEX "idx_workflow_logs_workflow" ON "public"."workflow_logs" USING "btree" ("workflow_id");



CREATE INDEX "idx_workflow_runs_event_id" ON "public"."workflow_runs" USING "btree" ("event_id") WHERE ("event_id" IS NOT NULL);



CREATE INDEX "idx_workflow_runs_sla_due_at" ON "public"."workflow_runs" USING "btree" ("sla_due_at") WHERE ("sla_due_at" IS NOT NULL);



CREATE INDEX "idx_workflow_runs_sla_status" ON "public"."workflow_runs" USING "btree" ("tenant_id", "sla_status", "sla_due_at" DESC);



CREATE INDEX "idx_workflow_runs_tenant" ON "public"."workflow_runs" USING "btree" ("tenant_id");



CREATE INDEX "idx_workflow_runs_trace" ON "public"."workflow_runs" USING "btree" ("trace_id") WHERE ("trace_id" IS NOT NULL);



CREATE INDEX "idx_workflow_runs_workflow" ON "public"."workflow_runs" USING "btree" ("workflow_id");



CREATE INDEX "idx_workflow_versions_workflow" ON "public"."workflow_versions" USING "btree" ("workflow_id", "version_number" DESC);



CREATE UNIQUE INDEX "idx_workflow_webhooks_slug" ON "public"."workflow_webhooks" USING "btree" ("slug");



CREATE INDEX "idx_workflow_webhooks_workflow" ON "public"."workflow_webhooks" USING "btree" ("workflow_id");



CREATE INDEX "idx_workflows_schedule_sweep" ON "public"."workflows" USING "btree" ("trigger_type", "is_active") WHERE ("trigger_type" = 'schedule'::"text");



CREATE INDEX "idx_workflows_tenant" ON "public"."workflows" USING "btree" ("tenant_id");



CREATE INDEX "idx_workflows_trigger" ON "public"."workflows" USING "btree" ("tenant_id", "trigger_type") WHERE ("is_active" = true);



CREATE INDEX "kanban_boards_app_idx" ON "public"."kanban_boards" USING "btree" ("app_id") WHERE ("app_id" IS NOT NULL);



CREATE UNIQUE INDEX "kanban_boards_tenant_name_idx" ON "public"."kanban_boards" USING "btree" ("tenant_id", "lower"("name"));



CREATE INDEX "kanban_columns_board_position_idx" ON "public"."kanban_columns" USING "btree" ("board_id", "position", "created_at");



CREATE INDEX "kanban_items_board_column_position_idx" ON "public"."kanban_items" USING "btree" ("board_id", "column_id", "position", "created_at");



CREATE INDEX "kanban_items_linked_task_idx" ON "public"."kanban_items" USING "btree" ("linked_task_id") WHERE ("linked_task_id" IS NOT NULL);



CREATE UNIQUE INDEX "kanban_subscriptions_board_unique_idx" ON "public"."kanban_subscriptions" USING "btree" ("tenant_id", "user_id", "board_id") WHERE ("board_id" IS NOT NULL);



CREATE UNIQUE INDEX "kanban_subscriptions_item_unique_idx" ON "public"."kanban_subscriptions" USING "btree" ("tenant_id", "user_id", "item_id") WHERE ("item_id" IS NOT NULL);



CREATE INDEX "oauth_auth_codes_tenant_idx" ON "public"."oauth_authorization_codes" USING "btree" ("tenant_id");



CREATE INDEX "oauth_clients_dcr_ip_idx" ON "public"."oauth_clients" USING "btree" ("created_ip", "created_at") WHERE "is_dynamic";



CREATE INDEX "oauth_clients_tenant_idx" ON "public"."oauth_clients" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "oauth_connect_states_tenant_idx" ON "public"."oauth_connect_states" USING "btree" ("tenant_id");



CREATE INDEX "oauth_tokens_client_active_idx" ON "public"."oauth_tokens" USING "btree" ("client_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "oauth_tokens_tenant_idx" ON "public"."oauth_tokens" USING "btree" ("tenant_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "set_tag_tenant_id_trigger" BEFORE INSERT ON "public"."tag_definitions" FOR EACH ROW EXECUTE FUNCTION "public"."set_tag_tenant_id"();



CREATE OR REPLACE TRIGGER "tenants_create_default_email_template" AFTER INSERT ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."create_default_email_template_for_tenant"();



CREATE OR REPLACE TRIGGER "trg_app_pages_updated_at" BEFORE UPDATE ON "public"."app_pages" FOR EACH ROW EXECUTE FUNCTION "public"."set_app_pages_updated_at"();



CREATE OR REPLACE TRIGGER "trg_assign_case_number" BEFORE INSERT ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."assign_case_number"();



CREATE OR REPLACE TRIGGER "trg_auto_complete_parent" BEFORE UPDATE OF "completed_child_count" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_auto_complete_parent"();



CREATE OR REPLACE TRIGGER "trg_cases_updated_at" BEFORE UPDATE ON "public"."cases" FOR EACH ROW EXECUTE FUNCTION "public"."set_cases_updated_at"();



CREATE OR REPLACE TRIGGER "trg_channels_updated_at" BEFORE UPDATE ON "public"."channels" FOR EACH ROW EXECUTE FUNCTION "public"."set_channels_updated_at"();



CREATE OR REPLACE TRIGGER "trg_custom_rows_updated" BEFORE UPDATE ON "public"."custom_table_rows" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_custom_tables_updated" BEFORE UPDATE ON "public"."custom_tables" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_dashboard_config_updated" BEFORE UPDATE ON "public"."dashboard_configs" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_debit_tokens" AFTER INSERT ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_debit_tokens_on_task"();



CREATE OR REPLACE TRIGGER "trg_delete_empty_conversation" AFTER DELETE ON "public"."message_participants" FOR EACH ROW EXECUTE FUNCTION "public"."delete_empty_conversation"();



CREATE OR REPLACE TRIGGER "trg_deletion_queue_updated_at" BEFORE UPDATE ON "public"."deletion_queue" FOR EACH ROW EXECUTE FUNCTION "public"."set_deletion_queue_updated_at"();



CREATE OR REPLACE TRIGGER "trg_endpoints_updated" BEFORE UPDATE ON "public"."integration_endpoints" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_enqueue_task_workflows" AFTER INSERT OR UPDATE OF "status", "assignee_id", "priority" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_enqueue_task_workflows"();



CREATE OR REPLACE TRIGGER "trg_integrations_updated" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kanban_boards_updated_at" BEFORE UPDATE ON "public"."kanban_boards" FOR EACH ROW EXECUTE FUNCTION "public"."set_kanban_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kanban_columns_updated_at" BEFORE UPDATE ON "public"."kanban_columns" FOR EACH ROW EXECUTE FUNCTION "public"."set_kanban_updated_at"();



CREATE OR REPLACE TRIGGER "trg_kanban_items_updated_at" BEFORE UPDATE ON "public"."kanban_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_kanban_updated_at"();



CREATE OR REPLACE TRIGGER "trg_lifecycle_events" AFTER UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_log_lifecycle_event"();



CREATE OR REPLACE TRIGGER "trg_memberships_updated" BEFORE UPDATE ON "public"."user_memberships" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_notify_task_changes" AFTER UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_notify_on_task_change"();



CREATE OR REPLACE TRIGGER "trg_refs_updated" BEFORE UPDATE ON "public"."integration_references" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_seed_tenant_roles" AFTER INSERT ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."trigger_seed_tenant_roles"();



CREATE OR REPLACE TRIGGER "trg_task_progress" AFTER INSERT OR DELETE OR UPDATE OF "status" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_update_parent_progress"();



CREATE OR REPLACE TRIGGER "trg_task_timestamps" BEFORE UPDATE OF "status" ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_task_timestamps"();



CREATE OR REPLACE TRIGGER "trg_tasks_updated" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_teams_updated" BEFORE UPDATE ON "public"."teams" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_templates_updated" BEFORE UPDATE ON "public"."form_templates" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_tenants_updated" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_token_bal_updated" BEFORE UPDATE ON "public"."token_balances" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_wf_sources_updated" BEFORE UPDATE ON "public"."workflow_sources" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_workflows_updated" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."fn_set_updated_at"();



ALTER TABLE ONLY "public"."agent_queue"
    ADD CONSTRAINT "agent_queue_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_queue"
    ADD CONSTRAINT "agent_queue_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id");



ALTER TABLE ONLY "public"."agent_queue"
    ADD CONSTRAINT "agent_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_queue_job_id_fkey" FOREIGN KEY ("queue_job_id") REFERENCES "public"."agent_queue"("id");



ALTER TABLE ONLY "public"."agent_runs"
    ADD CONSTRAINT "agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_workflow_source_id_fkey" FOREIGN KEY ("workflow_source_id") REFERENCES "public"."workflow_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_assets"
    ADD CONSTRAINT "app_assets_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_assets"
    ADD CONSTRAINT "app_assets_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_page_versions"
    ADD CONSTRAINT "app_page_versions_app_page_id_fkey" FOREIGN KEY ("app_page_id") REFERENCES "public"."app_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_page_versions"
    ADD CONSTRAINT "app_page_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_page_versions"
    ADD CONSTRAINT "app_page_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "public"."app_page_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_pages"
    ADD CONSTRAINT "app_pages_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."app_teams"
    ADD CONSTRAINT "app_teams_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_teams"
    ADD CONSTRAINT "app_teams_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_teams"
    ADD CONSTRAINT "app_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_default_channel_id_fkey" FOREIGN KEY ("default_channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_counters"
    ADD CONSTRAINT "case_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_participants"
    ADD CONSTRAINT "case_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_tasks"
    ADD CONSTRAINT "case_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_case_template_id_fkey" FOREIGN KEY ("case_template_id") REFERENCES "public"."app_pages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_form_page_id_fkey" FOREIGN KEY ("form_page_id") REFERENCES "public"."app_pages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."case_types"
    ADD CONSTRAINT "case_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_case_type_id_fkey" FOREIGN KEY ("case_type_id") REFERENCES "public"."case_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cases"
    ADD CONSTRAINT "cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_members"
    ADD CONSTRAINT "channel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_screens"
    ADD CONSTRAINT "channel_screens_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_screens"
    ADD CONSTRAINT "channel_screens_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."app_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channel_screens"
    ADD CONSTRAINT "channel_screens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."channels"
    ADD CONSTRAINT "channels_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."component_templates"
    ADD CONSTRAINT "component_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."component_templates"
    ADD CONSTRAINT "component_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_table_rows"
    ADD CONSTRAINT "custom_table_rows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."custom_table_rows"
    ADD CONSTRAINT "custom_table_rows_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."custom_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_table_rows"
    ADD CONSTRAINT "custom_table_rows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_table_rows"
    ADD CONSTRAINT "custom_table_rows_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_tables"
    ADD CONSTRAINT "custom_tables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."custom_tables"
    ADD CONSTRAINT "custom_tables_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_tables"
    ADD CONSTRAINT "custom_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_web_components"
    ADD CONSTRAINT "custom_web_components_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_web_components"
    ADD CONSTRAINT "custom_web_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_web_components"
    ADD CONSTRAINT "custom_web_components_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_workflow_activities"
    ADD CONSTRAINT "custom_workflow_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."custom_workflow_activities"
    ADD CONSTRAINT "custom_workflow_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_workflow_activities"
    ADD CONSTRAINT "custom_workflow_activities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dashboard_configs"
    ADD CONSTRAINT "dashboard_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dashboard_configs"
    ADD CONSTRAINT "dashboard_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dead_letter_events"
    ADD CONSTRAINT "dead_letter_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dead_letter_events"
    ADD CONSTRAINT "dead_letter_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."decision_tables"
    ADD CONSTRAINT "decision_tables_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."decision_tables"
    ADD CONSTRAINT "decision_tables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deletion_queue"
    ADD CONSTRAINT "deletion_queue_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deletion_queue"
    ADD CONSTRAINT "deletion_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."directory_links"
    ADD CONSTRAINT "directory_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."directory_sync_runs"
    ADD CONSTRAINT "directory_sync_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."directory_sync_runs"
    ADD CONSTRAINT "directory_sync_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_metadata_template_id_fkey" FOREIGN KEY ("metadata_template_id") REFERENCES "public"."document_metadata_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."document_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_folders"
    ADD CONSTRAINT "document_folders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_templates"
    ADD CONSTRAINT "document_metadata_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_metadata_templates"
    ADD CONSTRAINT "document_metadata_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_versions"
    ADD CONSTRAINT "document_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "public"."document_versions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_metadata_template_id_fkey" FOREIGN KEY ("metadata_template_id") REFERENCES "public"."document_metadata_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."effort_records"
    ADD CONSTRAINT "effort_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."effort_records"
    ADD CONSTRAINT "effort_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."effort_records"
    ADD CONSTRAINT "effort_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_templates"
    ADD CONSTRAINT "email_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "fk_tasks_template" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "fk_tasks_workflow_source" FOREIGN KEY ("workflow_source_id") REFERENCES "public"."workflow_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "fk_users_team" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_events"
    ADD CONSTRAINT "form_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_events"
    ADD CONSTRAINT "form_events_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_events"
    ADD CONSTRAINT "form_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_submissions"
    ADD CONSTRAINT "form_submissions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."app_pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_submissions"
    ADD CONSTRAINT "form_submissions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_submissions"
    ADD CONSTRAINT "form_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."form_template_versions"
    ADD CONSTRAINT "form_template_versions_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_template_versions"
    ADD CONSTRAINT "form_template_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."form_template_versions"
    ADD CONSTRAINT "form_template_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_themes"
    ADD CONSTRAINT "form_themes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_deployments"
    ADD CONSTRAINT "github_deployments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_deployments"
    ADD CONSTRAINT "github_deployments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_sync_asset_map"
    ADD CONSTRAINT "github_sync_asset_map_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_sync_queue"
    ADD CONSTRAINT "github_sync_queue_queued_by_fkey" FOREIGN KEY ("queued_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_sync_queue"
    ADD CONSTRAINT "github_sync_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_sync_runs"
    ADD CONSTRAINT "github_sync_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_sync_runs"
    ADD CONSTRAINT "github_sync_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."github_sync_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_sync_runs"
    ADD CONSTRAINT "github_sync_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."github_sync_templates"
    ADD CONSTRAINT "github_sync_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."github_sync_templates"
    ADD CONSTRAINT "github_sync_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_call_logs"
    ADD CONSTRAINT "integration_call_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."integration_call_logs"
    ADD CONSTRAINT "integration_call_logs_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "public"."integration_references"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."integration_call_logs"
    ADD CONSTRAINT "integration_call_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_endpoints"
    ADD CONSTRAINT "integration_endpoints_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_endpoints"
    ADD CONSTRAINT "integration_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_object_sources"
    ADD CONSTRAINT "integration_object_sources_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "public"."integration_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_object_sources"
    ADD CONSTRAINT "integration_object_sources_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "public"."integration_references"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_object_sources"
    ADD CONSTRAINT "integration_object_sources_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "public"."custom_tables"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_objects"
    ADD CONSTRAINT "integration_objects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_references"
    ADD CONSTRAINT "integration_references_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "public"."integration_endpoints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."integration_references"
    ADD CONSTRAINT "integration_references_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integration_references"
    ADD CONSTRAINT "integration_references_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_boards"
    ADD CONSTRAINT "kanban_boards_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_boards"
    ADD CONSTRAINT "kanban_boards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_boards"
    ADD CONSTRAINT "kanban_boards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_boards"
    ADD CONSTRAINT "kanban_boards_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."kanban_boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_columns"
    ADD CONSTRAINT "kanban_columns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."kanban_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_linked_by_fkey" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_item_tasks"
    ADD CONSTRAINT "kanban_item_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."kanban_boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "public"."kanban_columns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_items"
    ADD CONSTRAINT "kanban_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kanban_subscriptions"
    ADD CONSTRAINT "kanban_subscriptions_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."kanban_boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_subscriptions"
    ADD CONSTRAINT "kanban_subscriptions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."kanban_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_subscriptions"
    ADD CONSTRAINT "kanban_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kanban_subscriptions"
    ADD CONSTRAINT "kanban_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lifecycle_events"
    ADD CONSTRAINT "lifecycle_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lifecycle_events"
    ADD CONSTRAINT "lifecycle_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lifecycle_events"
    ADD CONSTRAINT "lifecycle_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lifecycle_events"
    ADD CONSTRAINT "lifecycle_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_servers"
    ADD CONSTRAINT "mcp_servers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_conversations"
    ADD CONSTRAINT "message_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_conversations"
    ADD CONSTRAINT "message_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_participants"
    ADD CONSTRAINT "message_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."message_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_participants"
    ADD CONSTRAINT "message_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_participants"
    ADD CONSTRAINT "message_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."message_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."node_favorites"
    ADD CONSTRAINT "node_favorites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."message_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_connect_states"
    ADD CONSTRAINT "oauth_connect_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_connect_states"
    ADD CONSTRAINT "oauth_connect_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_refresh_parent_fkey" FOREIGN KEY ("refresh_parent") REFERENCES "public"."oauth_tokens"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."oauth_tokens"
    ADD CONSTRAINT "oauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_audit_log"
    ADD CONSTRAINT "object_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."object_audit_log"
    ADD CONSTRAINT "object_audit_log_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."object_audit_log"
    ADD CONSTRAINT "object_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_permissions"
    ADD CONSTRAINT "object_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_audit_log"
    ADD CONSTRAINT "permission_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_execution_events"
    ADD CONSTRAINT "retention_execution_events_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_policies"
    ADD CONSTRAINT "retention_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."retention_review_events"
    ADD CONSTRAINT "retention_review_events_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_retention_policy_id_fkey" FOREIGN KEY ("retention_policy_id") REFERENCES "public"."retention_policies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tag_definitions"
    ADD CONSTRAINT "tag_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_dependencies"
    ADD CONSTRAINT "task_dependencies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_escalations"
    ADD CONSTRAINT "task_escalations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_escalations"
    ADD CONSTRAINT "task_escalations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."task_escalations"
    ADD CONSTRAINT "task_escalations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."task_escalations"
    ADD CONSTRAINT "task_escalations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_reminders"
    ADD CONSTRAINT "task_reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."task_responses"
    ADD CONSTRAINT "task_responses_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_responses"
    ADD CONSTRAINT "task_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."task_responses"
    ADD CONSTRAINT "task_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_actioned_by_fkey" FOREIGN KEY ("actioned_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigned_team_id_fkey" FOREIGN KEY ("assigned_team_id") REFERENCES "public"."teams"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assigner_id_fkey" FOREIGN KEY ("assigner_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."teams"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_connectors"
    ADD CONSTRAINT "tenant_connectors_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_fonts"
    ADD CONSTRAINT "tenant_fonts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_fonts"
    ADD CONSTRAINT "tenant_fonts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_balances"
    ADD CONSTRAINT "token_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."token_ledger"
    ADD CONSTRAINT "token_ledger_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."token_ledger"
    ADD CONSTRAINT "token_ledger_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."token_ledger"
    ADD CONSTRAINT "token_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_memberships"
    ADD CONSTRAINT "user_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_teams"
    ADD CONSTRAINT "user_teams_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_teams"
    ADD CONSTRAINT "user_teams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_current_tenant_id_fkey" FOREIGN KEY ("current_tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_logs"
    ADD CONSTRAINT "workflow_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_logs"
    ADD CONSTRAINT "workflow_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."workflow_logs"
    ADD CONSTRAINT "workflow_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_queue"
    ADD CONSTRAINT "workflow_queue_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_queue"
    ADD CONSTRAINT "workflow_queue_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_queue"
    ADD CONSTRAINT "workflow_queue_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id");



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_sources"
    ADD CONSTRAINT "workflow_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_versions"
    ADD CONSTRAINT "workflow_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."workflow_versions"
    ADD CONSTRAINT "workflow_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."workflow_versions"
    ADD CONSTRAINT "workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_webhooks"
    ADD CONSTRAINT "workflow_webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_webhooks"
    ADD CONSTRAINT "workflow_webhooks_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "public"."workflow_versions"("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



CREATE POLICY "Tenant isolation for task_escalations" ON "public"."task_escalations" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant isolation for task_reminders" ON "public"."task_reminders" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant isolation for task_responses" ON "public"."task_responses" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant isolation for workflow_versions" ON "public"."workflow_versions" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "Tenant members can delete form themes" ON "public"."form_themes" FOR DELETE USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Tenant members can insert form themes" ON "public"."form_themes" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Tenant members can update form themes" ON "public"."form_themes" FOR UPDATE USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Tenant members can view form themes" ON "public"."form_themes" FOR SELECT USING (("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can create tags" ON "public"."tag_definitions" FOR INSERT WITH CHECK ((("tenant_id" IS NULL) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can delete own tenant tags" ON "public"."tag_definitions" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can delete tenant agents" ON "public"."agents" FOR DELETE USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can insert into agent queue" ON "public"."agent_queue" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can insert tenant agent runs" ON "public"."agent_runs" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can insert tenant agents" ON "public"."agents" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can insert versions for their tenant" ON "public"."form_template_versions" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can read own tenant tags" ON "public"."tag_definitions" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can update own tenant tags" ON "public"."tag_definitions" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "Users can update tenant agent runs" ON "public"."agent_runs" FOR UPDATE USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can update tenant agents" ON "public"."agents" FOR UPDATE USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can update versions for their tenant" ON "public"."form_template_versions" FOR UPDATE USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can view tenant agent queue" ON "public"."agent_queue" FOR SELECT USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can view tenant agent runs" ON "public"."agent_runs" FOR SELECT USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can view tenant agents" ON "public"."agents" FOR SELECT USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "Users can view their tenant versions" ON "public"."form_template_versions" FOR SELECT USING ((("tenant_id" IN ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



ALTER TABLE "public"."agent_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_keys_delete" ON "public"."api_keys" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "api_keys_insert" ON "public"."api_keys" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "api_keys_select" ON "public"."api_keys" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "api_keys_update" ON "public"."api_keys" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."app_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_page_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."apps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_insert" ON "public"."permission_audit_log" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "audit_log_select" ON "public"."permission_audit_log" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."case_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."case_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channel_screens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."channels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."component_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "component_templates_delete" ON "public"."component_templates" FOR DELETE USING (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "component_templates_insert" ON "public"."component_templates" FOR INSERT WITH CHECK (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "component_templates_select" ON "public"."component_templates" FOR SELECT USING (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "component_templates_update" ON "public"."component_templates" FOR UPDATE USING (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "custom_rows_delete" ON "public"."custom_table_rows" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_rows_insert" ON "public"."custom_table_rows" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_rows_select" ON "public"."custom_table_rows" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_rows_update" ON "public"."custom_table_rows" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."custom_table_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_tables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_tables_delete" ON "public"."custom_tables" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_tables_insert" ON "public"."custom_tables" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_tables_select" ON "public"."custom_tables" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "custom_tables_update" ON "public"."custom_tables" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."custom_web_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_workflow_activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dashboard_config_insert" ON "public"."dashboard_configs" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "dashboard_config_select" ON "public"."dashboard_configs" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dashboard_config_update" ON "public"."dashboard_configs" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."dashboard_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dead_letter_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dead_letter_select" ON "public"."dead_letter_events" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."decision_tables" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletion_queue" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deletion_queue_tenant_isolation" ON "public"."deletion_queue" TO "authenticated" USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))) WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."directory_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."directory_sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_metadata_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "effort_insert" ON "public"."effort_records" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."effort_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "effort_select" ON "public"."effort_records" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



ALTER TABLE "public"."email_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "endpoints_delete" ON "public"."integration_endpoints" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "endpoints_insert" ON "public"."integration_endpoints" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "endpoints_select" ON "public"."integration_endpoints" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "endpoints_update" ON "public"."integration_endpoints" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."form_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_submissions_insert" ON "public"."form_submissions" FOR INSERT WITH CHECK (true);



CREATE POLICY "form_submissions_select" ON "public"."form_submissions" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



ALTER TABLE "public"."form_template_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_templates_public_read" ON "public"."form_templates" FOR SELECT TO "anon" USING ((("allow_public_submission" = true) AND ("public_share_token" IS NOT NULL)));



ALTER TABLE "public"."form_themes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_deployments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_sync_asset_map" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_sync_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."github_sync_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_call_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_endpoints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_object_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integration_references" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "integrations_delete" ON "public"."integrations" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "integrations_insert" ON "public"."integrations" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "integrations_select" ON "public"."integrations" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "integrations_update" ON "public"."integrations" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_delete" ON "public"."invitations" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "invitations_insert" ON "public"."invitations" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "invitations_select" ON "public"."invitations" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "invitations_update" ON "public"."invitations" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."kanban_boards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kanban_boards_tenant_delete" ON "public"."kanban_boards" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_boards_tenant_insert" ON "public"."kanban_boards" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "kanban_boards_tenant_select" ON "public"."kanban_boards" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_boards_tenant_update" ON "public"."kanban_boards" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."kanban_columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kanban_columns_tenant_delete" ON "public"."kanban_columns" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_columns_tenant_insert" ON "public"."kanban_columns" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "kanban_columns_tenant_select" ON "public"."kanban_columns" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_columns_tenant_update" ON "public"."kanban_columns" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."kanban_item_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kanban_item_tasks_tenant_delete" ON "public"."kanban_item_tasks" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_item_tasks_tenant_insert" ON "public"."kanban_item_tasks" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "kanban_item_tasks_tenant_select" ON "public"."kanban_item_tasks" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_item_tasks_tenant_update" ON "public"."kanban_item_tasks" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."kanban_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kanban_items_tenant_delete" ON "public"."kanban_items" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_items_tenant_insert" ON "public"."kanban_items" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "kanban_items_tenant_select" ON "public"."kanban_items" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_items_tenant_update" ON "public"."kanban_items" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."kanban_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kanban_subscriptions_tenant_delete" ON "public"."kanban_subscriptions" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_subscriptions_tenant_insert" ON "public"."kanban_subscriptions" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "kanban_subscriptions_tenant_select" ON "public"."kanban_subscriptions" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "kanban_subscriptions_tenant_update" ON "public"."kanban_subscriptions" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."lifecycle_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lifecycle_insert" ON "public"."lifecycle_events" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "lifecycle_select" ON "public"."lifecycle_events" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



ALTER TABLE "public"."mcp_servers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mcp_servers_manage" ON "public"."mcp_servers" USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "mcp_servers_select" ON "public"."mcp_servers" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "membership_select_org" ON "public"."user_memberships" FOR SELECT USING (("tenant_id" IN ( SELECT "user_memberships_1"."tenant_id"
   FROM "public"."user_memberships" "user_memberships_1"
  WHERE ("user_memberships_1"."user_id" = "auth"."uid"()))));



CREATE POLICY "membership_select_own" ON "public"."user_memberships" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."message_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."node_favorites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "node_favorites_delete" ON "public"."node_favorites" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "node_favorites_insert" ON "public"."node_favorites" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "node_favorites_select" ON "public"."node_favorites" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_insert" ON "public"."notifications" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "notifications_select" ON "public"."notifications" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "notifications_update" ON "public"."notifications" FOR UPDATE USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_connect_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."object_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."object_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participant_access_delete" ON "public"."message_conversations" FOR DELETE USING ("public"."is_conversation_participant"("id"));



CREATE POLICY "participant_access_read" ON "public"."message_conversations" FOR SELECT USING (("public"."is_conversation_participant"("id") OR ("created_by" = "auth"."uid"())));



CREATE POLICY "participant_access_update" ON "public"."message_conversations" FOR UPDATE USING ("public"."is_conversation_participant"("id"));



CREATE POLICY "participant_insert" ON "public"."message_participants" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "participant_insert_conversation" ON "public"."message_conversations" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "participant_message_access" ON "public"."messages" USING ("public"."is_conversation_participant"("conversation_id")) WITH CHECK ("public"."is_conversation_participant"("conversation_id"));



CREATE POLICY "participant_self_delete" ON "public"."message_participants" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "participant_self_update" ON "public"."message_participants" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "participant_self_view" ON "public"."message_participants" FOR SELECT USING ("public"."is_conversation_participant"("conversation_id"));



ALTER TABLE "public"."permission_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "queue_select" ON "public"."workflow_queue" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "refs_delete" ON "public"."integration_references" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "refs_insert" ON "public"."integration_references" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "refs_select" ON "public"."integration_references" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "refs_update" ON "public"."integration_references" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reports_delete" ON "public"."reports" FOR DELETE USING ((("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "reports_insert" ON "public"."reports" FOR INSERT WITH CHECK ((("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "reports_select" ON "public"."reports" FOR SELECT USING ((("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND (("created_by" = "auth"."uid"()) OR ("is_shared" = true))));



CREATE POLICY "reports_update" ON "public"."reports" FOR UPDATE USING ((("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) AND ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."retention_execution_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."retention_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."retention_review_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_manage" ON "public"."roles" USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "roles_select" ON "public"."roles" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "ta_delete" ON "public"."task_assignees" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "ta_insert" ON "public"."task_assignees" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "ta_select" ON "public"."task_assignees" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "ta_update" ON "public"."task_assignees" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."tag_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_assignees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_escalations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_delete" ON "public"."tasks" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tasks_insert" ON "public"."tasks" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tasks_select" ON "public"."tasks" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "tasks_update" ON "public"."tasks" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_delete" ON "public"."teams" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "teams_insert" ON "public"."teams" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "teams_select" ON "public"."teams" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "teams_update" ON "public"."teams" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."tenant_connectors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_connectors_delete" ON "public"."tenant_connectors" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())
UNION
 SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_connectors_insert" ON "public"."tenant_connectors" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())
UNION
 SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_connectors_select" ON "public"."tenant_connectors" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())
UNION
 SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_connectors_update" ON "public"."tenant_connectors" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())
UNION
 SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."tenant_fonts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_fonts_select" ON "public"."tenant_fonts" FOR SELECT USING (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_fonts_write" ON "public"."tenant_fonts" USING (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" = ( SELECT COALESCE("u"."current_tenant_id", "u"."tenant_id") AS "coalesce"
   FROM "public"."users" "u"
  WHERE ("u"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation" ON "public"."agent_queue" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."agent_runs" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."agents" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."api_keys" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."app_assets" USING (("app_id" IN ( SELECT "apps"."id"
   FROM "public"."apps"
  WHERE ("apps"."tenant_id" = "public"."get_current_tenant_id"())))) WITH CHECK (("app_id" IN ( SELECT "apps"."id"
   FROM "public"."apps"
  WHERE ("apps"."tenant_id" = "public"."get_current_tenant_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."app_teams" USING (("app_id" IN ( SELECT "apps"."id"
   FROM "public"."apps"
  WHERE ("apps"."tenant_id" = "public"."get_current_tenant_id"())))) WITH CHECK (("app_id" IN ( SELECT "apps"."id"
   FROM "public"."apps"
  WHERE ("apps"."tenant_id" = "public"."get_current_tenant_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."apps" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."case_counters" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."case_participants" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."case_tasks" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."case_types" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."cases" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."channel_members" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."channel_screens" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."channels" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."custom_table_rows" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."custom_web_components" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."custom_workflow_activities" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."decision_tables" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."directory_links" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."directory_sync_runs" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."document_folders" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."document_metadata_templates" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."document_versions" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."documents" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."email_templates" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."form_events" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."form_submissions" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."github_deployments" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."github_sync_asset_map" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."github_sync_queue" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."github_sync_runs" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."github_sync_templates" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."integration_call_logs" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."integration_object_sources" USING (("object_id" IN ( SELECT "integration_objects"."id"
   FROM "public"."integration_objects"
  WHERE ("integration_objects"."tenant_id" = "public"."get_current_tenant_id"())))) WITH CHECK (("object_id" IN ( SELECT "integration_objects"."id"
   FROM "public"."integration_objects"
  WHERE ("integration_objects"."tenant_id" = "public"."get_current_tenant_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."integration_objects" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."integrations" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."oauth_authorization_codes" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."oauth_clients" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."oauth_connect_states" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."oauth_tokens" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."object_audit_log" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."object_permissions" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."retention_policies" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."task_dependencies" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation" ON "public"."tenant_connectors" USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "tenant_isolation_delete" ON "public"."app_page_versions" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation_delete" ON "public"."app_pages" FOR DELETE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation_insert" ON "public"."app_page_versions" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "tenant_isolation_insert" ON "public"."app_pages" FOR INSERT WITH CHECK ((("auth"."uid"() IS NOT NULL) AND ("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))));



CREATE POLICY "tenant_isolation_select" ON "public"."app_page_versions" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation_select" ON "public"."app_pages" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation_update" ON "public"."app_page_versions" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_isolation_update" ON "public"."app_pages" FOR UPDATE USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())))) WITH CHECK (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "tenant_select" ON "public"."tenants" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("id" = "public"."get_current_tenant_id"())
    ELSE ("id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "tenant_update" ON "public"."tenants" FOR UPDATE USING (("id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "token_bal_select" ON "public"."token_balances" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



ALTER TABLE "public"."token_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."token_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "token_ledger_select" ON "public"."token_ledger" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "tpl_delete" ON "public"."form_templates" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tpl_insert" ON "public"."form_templates" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "tpl_select" ON "public"."form_templates" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "tpl_update" ON "public"."form_templates" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."user_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_roles_manage" ON "public"."user_roles" USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "user_roles_select" ON "public"."user_roles" FOR SELECT USING (("tenant_id" IN ( SELECT COALESCE("users"."current_tenant_id", "users"."tenant_id") AS "coalesce"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."user_teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_teams_delete" ON "public"."user_teams" FOR DELETE USING (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))));



CREATE POLICY "user_teams_insert" ON "public"."user_teams" FOR INSERT WITH CHECK (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))));



CREATE POLICY "user_teams_select" ON "public"."user_teams" FOR SELECT USING (("team_id" IN ( SELECT "teams"."id"
   FROM "public"."teams"
  WHERE ("teams"."tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")))));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING ((("id" = "auth"."uid"()) OR
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END));



CREATE POLICY "users_update" ON "public"."users" FOR UPDATE USING (("id" = "auth"."uid"()));



CREATE POLICY "wf_insert" ON "public"."workflow_sources" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wf_select" ON "public"."workflow_sources" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



CREATE POLICY "wf_update" ON "public"."workflow_sources" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wh_delete" ON "public"."workflow_webhooks" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wh_insert" ON "public"."workflow_webhooks" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wh_select" ON "public"."workflow_webhooks" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wh_update" ON "public"."workflow_webhooks" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wl_delete" ON "public"."workflow_logs" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "wl_insert" ON "public"."workflow_logs" FOR INSERT WITH CHECK (true);



CREATE POLICY "wl_select" ON "public"."workflow_logs" FOR SELECT USING (
CASE
    WHEN ("public"."get_current_tenant_id"() IS NOT NULL) THEN ("tenant_id" = "public"."get_current_tenant_id"())
    ELSE ("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids"))
END);



ALTER TABLE "public"."workflow_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_runs_select" ON "public"."workflow_runs" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



ALTER TABLE "public"."workflow_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_webhooks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflows_delete" ON "public"."workflows" FOR DELETE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "workflows_insert" ON "public"."workflows" FOR INSERT WITH CHECK (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "workflows_select" ON "public"."workflows" FOR SELECT USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



CREATE POLICY "workflows_update" ON "public"."workflows" FOR UPDATE USING (("tenant_id" IN ( SELECT "public"."get_user_tenant_ids"() AS "get_user_tenant_ids")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app_cron"."invoke_endpoint"("p_path" "text", "p_method" "text", "p_body" "jsonb", "p_timeout_ms" integer) FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."add_task_dependency"("p_task" "uuid", "p_depends_on" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_task_dependency"("p_task" "uuid", "p_depends_on" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_task_dependency"("p_task" "uuid", "p_depends_on" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_case_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_case_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_case_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_user_capacity"("p_user_id" "uuid", "p_week_start" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_user_capacity"("p_user_id" "uuid", "p_week_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_user_capacity"("p_user_id" "uuid", "p_week_start" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_object_permission"("p_object_type" "text", "p_object_id" "uuid", "p_permission" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_object_permission"("p_object_type" "text", "p_object_id" "uuid", "p_permission" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_object_permission"("p_object_type" "text", "p_object_id" "uuid", "p_permission" "text") TO "service_role";



GRANT ALL ON TABLE "public"."agent_queue" TO "anon";
GRANT ALL ON TABLE "public"."agent_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_agent_job"("p_worker_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_agent_job"("p_worker_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_agent_job"("p_worker_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."deletion_queue" TO "anon";
GRANT ALL ON TABLE "public"."deletion_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."deletion_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_deletion_job"("p_worker_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_deletion_job"("p_worker_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_deletion_job"("p_worker_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."directory_sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."directory_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."directory_sync_runs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_directory_sync_run"("p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_directory_sync_run"("p_worker_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."github_deployments" TO "anon";
GRANT ALL ON TABLE "public"."github_deployments" TO "authenticated";
GRANT ALL ON TABLE "public"."github_deployments" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_github_deployment"("p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_github_deployment"("p_worker_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."github_sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."github_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."github_sync_runs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_github_sync_run"("p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_github_sync_run"("p_worker_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."workflow_queue" TO "anon";
GRANT ALL ON TABLE "public"."workflow_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_queue" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_worker_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_scheduled_sync"("p_tenant_id" "uuid", "p_connector_key" "text", "p_expected" "text", "p_fired_at" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_scheduled_sync"("p_tenant_id" "uuid", "p_connector_key" "text", "p_expected" "text", "p_fired_at" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_agent_job"("p_job_id" "uuid", "p_result" "jsonb", "p_run_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_agent_job"("p_job_id" "uuid", "p_result" "jsonb", "p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_agent_job"("p_job_id" "uuid", "p_result" "jsonb", "p_run_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_deletion_job"("p_job_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_deletion_job"("p_job_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_deletion_job"("p_job_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_result" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_result" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_result" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_default_email_template_for_tenant"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_default_email_template_for_tenant"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_default_email_template_for_tenant"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_task_with_subtasks"("p_title" "text", "p_description" "text", "p_priority" "public"."task_priority", "p_due_date" timestamp with time zone, "p_assignee_id" "uuid", "p_estimated_effort" integer, "p_subtasks" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_task_with_subtasks"("p_title" "text", "p_description" "text", "p_priority" "public"."task_priority", "p_due_date" timestamp with time zone, "p_assignee_id" "uuid", "p_estimated_effort" integer, "p_subtasks" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_task_with_subtasks"("p_title" "text", "p_description" "text", "p_priority" "public"."task_priority", "p_due_date" timestamp with time zone, "p_assignee_id" "uuid", "p_estimated_effort" integer, "p_subtasks" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_empty_conversation"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_empty_conversation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_empty_conversation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_workflow"("p_workflow_id" "uuid", "p_tenant_id" "uuid", "p_task_id" "uuid", "p_trigger_type" "text", "p_trigger_data" "jsonb", "p_priority" integer, "p_delay_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_workflow"("p_workflow_id" "uuid", "p_tenant_id" "uuid", "p_task_id" "uuid", "p_trigger_type" "text", "p_trigger_data" "jsonb", "p_priority" integer, "p_delay_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_workflow"("p_workflow_id" "uuid", "p_tenant_id" "uuid", "p_task_id" "uuid", "p_trigger_type" "text", "p_trigger_data" "jsonb", "p_priority" integer, "p_delay_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."escalate_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."escalate_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."escalate_task"("p_task_id" "uuid", "p_target_user_id" "uuid", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_agent_job"("p_job_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail_agent_job"("p_job_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_agent_job"("p_job_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_deletion_job"("p_job_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail_deletion_job"("p_job_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_deletion_job"("p_job_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_job"("p_job_id" "uuid", "p_error" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail_job"("p_job_id" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_job"("p_job_id" "uuid", "p_error" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_auto_complete_parent"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_auto_complete_parent"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_auto_complete_parent"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_debit_tokens_on_task"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_debit_tokens_on_task"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_debit_tokens_on_task"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_enqueue_task_workflows"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_enqueue_task_workflows"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_enqueue_task_workflows"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_log_lifecycle_event"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_log_lifecycle_event"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_log_lifecycle_event"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_notify_on_task_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_notify_on_task_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_notify_on_task_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_task_timestamps"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_task_timestamps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_task_timestamps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_update_parent_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_update_parent_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_update_parent_progress"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_current_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_task_tree"("p_task_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_task_tree"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_task_tree"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role_in_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role_in_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role_in_tenant"("p_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_tenant_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_tenant_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_conversation_participant"("conv_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."kanban_move_item"("p_tenant_id" "uuid", "p_board_id" "uuid", "p_item_id" "uuid", "p_to_column_id" "uuid", "p_to_index" integer, "p_acting_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."kanban_move_item"("p_tenant_id" "uuid", "p_board_id" "uuid", "p_item_id" "uuid", "p_to_column_id" "uuid", "p_to_index" integer, "p_acting_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."kanban_move_item"("p_tenant_id" "uuid", "p_board_id" "uuid", "p_item_id" "uuid", "p_to_column_id" "uuid", "p_to_index" integer, "p_acting_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_all_notifications_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_notification_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_notification_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_notifications_read"("p_notification_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_tenant_connector_config"("p_tenant_id" "uuid", "p_connector_key" "text", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_tenant_connector_config"("p_tenant_id" "uuid", "p_connector_key" "text", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_tenant_connector_config"("p_tenant_id" "uuid", "p_connector_key" "text", "p_patch" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_tenant_connector_credentials"("p_connector_id" "uuid", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_tenant_connector_credentials"("p_connector_id" "uuid", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_tenant_connector_credentials"("p_connector_id" "uuid", "p_patch" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_case_number"("p_tenant" "uuid", "p_prefix" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_case_number"("p_tenant" "uuid", "p_prefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reassign_task"("p_task_id" "uuid", "p_new_assignee_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reassign_task"("p_task_id" "uuid", "p_new_assignee_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reassign_task"("p_task_id" "uuid", "p_new_assignee_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_custom_table_rows"("q" "text", "lim" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_tenant_roles"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."seed_tenant_roles"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_tenant_roles"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_app_pages_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_app_pages_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_app_pages_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cases_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cases_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cases_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_channels_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_channels_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_channels_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_deletion_queue_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_deletion_queue_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_deletion_queue_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_kanban_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_kanban_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_kanban_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_tag_tenant_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_tag_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_tag_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."switch_tenant"("p_tenant_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."switch_tenant"("p_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."switch_tenant"("p_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_seed_tenant_roles"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_seed_tenant_roles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_seed_tenant_roles"() TO "service_role";



GRANT ALL ON TABLE "public"."agent_runs" TO "anon";
GRANT ALL ON TABLE "public"."agent_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_runs" TO "service_role";



GRANT ALL ON TABLE "public"."agents" TO "anon";
GRANT ALL ON TABLE "public"."agents" TO "authenticated";
GRANT ALL ON TABLE "public"."agents" TO "service_role";



GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT ALL ON TABLE "public"."app_assets" TO "anon";
GRANT ALL ON TABLE "public"."app_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."app_assets" TO "service_role";



GRANT ALL ON TABLE "public"."app_page_versions" TO "anon";
GRANT ALL ON TABLE "public"."app_page_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."app_page_versions" TO "service_role";



GRANT ALL ON TABLE "public"."app_pages" TO "anon";
GRANT ALL ON TABLE "public"."app_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."app_pages" TO "service_role";



GRANT ALL ON TABLE "public"."app_teams" TO "anon";
GRANT ALL ON TABLE "public"."app_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."app_teams" TO "service_role";



GRANT ALL ON TABLE "public"."apps" TO "anon";
GRANT ALL ON TABLE "public"."apps" TO "authenticated";
GRANT ALL ON TABLE "public"."apps" TO "service_role";



GRANT ALL ON TABLE "public"."case_counters" TO "anon";
GRANT ALL ON TABLE "public"."case_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."case_counters" TO "service_role";



GRANT ALL ON TABLE "public"."case_participants" TO "anon";
GRANT ALL ON TABLE "public"."case_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."case_participants" TO "service_role";



GRANT ALL ON TABLE "public"."case_tasks" TO "anon";
GRANT ALL ON TABLE "public"."case_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."case_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."case_types" TO "anon";
GRANT ALL ON TABLE "public"."case_types" TO "authenticated";
GRANT ALL ON TABLE "public"."case_types" TO "service_role";



GRANT ALL ON TABLE "public"."cases" TO "anon";
GRANT ALL ON TABLE "public"."cases" TO "authenticated";
GRANT ALL ON TABLE "public"."cases" TO "service_role";



GRANT ALL ON TABLE "public"."channel_members" TO "anon";
GRANT ALL ON TABLE "public"."channel_members" TO "authenticated";
GRANT ALL ON TABLE "public"."channel_members" TO "service_role";



GRANT ALL ON TABLE "public"."channel_screens" TO "anon";
GRANT ALL ON TABLE "public"."channel_screens" TO "authenticated";
GRANT ALL ON TABLE "public"."channel_screens" TO "service_role";



GRANT ALL ON TABLE "public"."channels" TO "anon";
GRANT ALL ON TABLE "public"."channels" TO "authenticated";
GRANT ALL ON TABLE "public"."channels" TO "service_role";



GRANT ALL ON TABLE "public"."component_templates" TO "anon";
GRANT ALL ON TABLE "public"."component_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."component_templates" TO "service_role";



GRANT ALL ON TABLE "public"."custom_table_rows" TO "anon";
GRANT ALL ON TABLE "public"."custom_table_rows" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_table_rows" TO "service_role";



GRANT ALL ON TABLE "public"."custom_tables" TO "anon";
GRANT ALL ON TABLE "public"."custom_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_tables" TO "service_role";



GRANT ALL ON TABLE "public"."custom_web_components" TO "anon";
GRANT ALL ON TABLE "public"."custom_web_components" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_web_components" TO "service_role";



GRANT ALL ON TABLE "public"."custom_workflow_activities" TO "anon";
GRANT ALL ON TABLE "public"."custom_workflow_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_workflow_activities" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_configs" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_configs" TO "service_role";



GRANT ALL ON TABLE "public"."dead_letter_events" TO "anon";
GRANT ALL ON TABLE "public"."dead_letter_events" TO "authenticated";
GRANT ALL ON TABLE "public"."dead_letter_events" TO "service_role";



GRANT ALL ON TABLE "public"."decision_tables" TO "anon";
GRANT ALL ON TABLE "public"."decision_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."decision_tables" TO "service_role";



GRANT ALL ON TABLE "public"."directory_links" TO "anon";
GRANT ALL ON TABLE "public"."directory_links" TO "authenticated";
GRANT ALL ON TABLE "public"."directory_links" TO "service_role";



GRANT ALL ON TABLE "public"."document_folders" TO "anon";
GRANT ALL ON TABLE "public"."document_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."document_folders" TO "service_role";



GRANT ALL ON TABLE "public"."document_metadata_templates" TO "anon";
GRANT ALL ON TABLE "public"."document_metadata_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."document_metadata_templates" TO "service_role";



GRANT ALL ON TABLE "public"."document_versions" TO "anon";
GRANT ALL ON TABLE "public"."document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."document_versions" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."effort_records" TO "anon";
GRANT ALL ON TABLE "public"."effort_records" TO "authenticated";
GRANT ALL ON TABLE "public"."effort_records" TO "service_role";



GRANT ALL ON TABLE "public"."email_templates" TO "anon";
GRANT ALL ON TABLE "public"."email_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."email_templates" TO "service_role";



GRANT ALL ON TABLE "public"."form_events" TO "anon";
GRANT ALL ON TABLE "public"."form_events" TO "authenticated";
GRANT ALL ON TABLE "public"."form_events" TO "service_role";



GRANT ALL ON TABLE "public"."form_submissions" TO "anon";
GRANT ALL ON TABLE "public"."form_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."form_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."form_template_versions" TO "anon";
GRANT ALL ON TABLE "public"."form_template_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."form_template_versions" TO "service_role";



GRANT ALL ON TABLE "public"."form_templates" TO "anon";
GRANT ALL ON TABLE "public"."form_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."form_templates" TO "service_role";



GRANT ALL ON TABLE "public"."form_themes" TO "anon";
GRANT ALL ON TABLE "public"."form_themes" TO "authenticated";
GRANT ALL ON TABLE "public"."form_themes" TO "service_role";



GRANT ALL ON TABLE "public"."github_sync_asset_map" TO "anon";
GRANT ALL ON TABLE "public"."github_sync_asset_map" TO "authenticated";
GRANT ALL ON TABLE "public"."github_sync_asset_map" TO "service_role";



GRANT ALL ON TABLE "public"."github_sync_queue" TO "anon";
GRANT ALL ON TABLE "public"."github_sync_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."github_sync_queue" TO "service_role";



GRANT ALL ON TABLE "public"."github_sync_templates" TO "anon";
GRANT ALL ON TABLE "public"."github_sync_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."github_sync_templates" TO "service_role";



GRANT ALL ON TABLE "public"."integration_call_logs" TO "anon";
GRANT ALL ON TABLE "public"."integration_call_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_call_logs" TO "service_role";



GRANT ALL ON TABLE "public"."integration_endpoints" TO "anon";
GRANT ALL ON TABLE "public"."integration_endpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_endpoints" TO "service_role";



GRANT ALL ON TABLE "public"."integration_object_sources" TO "anon";
GRANT ALL ON TABLE "public"."integration_object_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_object_sources" TO "service_role";



GRANT ALL ON TABLE "public"."integration_objects" TO "anon";
GRANT ALL ON TABLE "public"."integration_objects" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_objects" TO "service_role";



GRANT ALL ON TABLE "public"."integration_references" TO "anon";
GRANT ALL ON TABLE "public"."integration_references" TO "authenticated";
GRANT ALL ON TABLE "public"."integration_references" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_boards" TO "anon";
GRANT ALL ON TABLE "public"."kanban_boards" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_boards" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_columns" TO "anon";
GRANT ALL ON TABLE "public"."kanban_columns" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_columns" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_item_tasks" TO "anon";
GRANT ALL ON TABLE "public"."kanban_item_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_item_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_items" TO "anon";
GRANT ALL ON TABLE "public"."kanban_items" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_items" TO "service_role";



GRANT ALL ON TABLE "public"."kanban_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."kanban_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."kanban_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."lifecycle_events" TO "anon";
GRANT ALL ON TABLE "public"."lifecycle_events" TO "authenticated";
GRANT ALL ON TABLE "public"."lifecycle_events" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_servers" TO "anon";
GRANT ALL ON TABLE "public"."mcp_servers" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_servers" TO "service_role";



GRANT ALL ON TABLE "public"."message_conversations" TO "anon";
GRANT ALL ON TABLE "public"."message_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."message_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."message_participants" TO "anon";
GRANT ALL ON TABLE "public"."message_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."message_participants" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."node_favorites" TO "anon";
GRANT ALL ON TABLE "public"."node_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."node_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "anon";
GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_clients" TO "anon";
GRANT ALL ON TABLE "public"."oauth_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_clients" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_connect_states" TO "anon";
GRANT ALL ON TABLE "public"."oauth_connect_states" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_connect_states" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_tokens" TO "anon";
GRANT ALL ON TABLE "public"."oauth_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."object_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."object_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."object_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."object_permissions" TO "anon";
GRANT ALL ON TABLE "public"."object_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."object_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."permission_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."permission_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."retention_execution_events" TO "anon";
GRANT ALL ON TABLE "public"."retention_execution_events" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_execution_events" TO "service_role";



GRANT ALL ON TABLE "public"."retention_policies" TO "anon";
GRANT ALL ON TABLE "public"."retention_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_policies" TO "service_role";



GRANT ALL ON TABLE "public"."retention_review_events" TO "anon";
GRANT ALL ON TABLE "public"."retention_review_events" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_review_events" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."tag_definitions" TO "anon";
GRANT ALL ON TABLE "public"."tag_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."tag_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."task_assignees" TO "anon";
GRANT ALL ON TABLE "public"."task_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."task_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."task_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."task_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."task_dependencies" TO "service_role";



GRANT ALL ON TABLE "public"."task_escalations" TO "anon";
GRANT ALL ON TABLE "public"."task_escalations" TO "authenticated";
GRANT ALL ON TABLE "public"."task_escalations" TO "service_role";



GRANT ALL ON TABLE "public"."task_reminders" TO "anon";
GRANT ALL ON TABLE "public"."task_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."task_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."task_responses" TO "anon";
GRANT ALL ON TABLE "public"."task_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."task_responses" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_connectors" TO "anon";
GRANT ALL ON TABLE "public"."tenant_connectors" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_connectors" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_fonts" TO "anon";
GRANT ALL ON TABLE "public"."tenant_fonts" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_fonts" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON TABLE "public"."token_balances" TO "anon";
GRANT ALL ON TABLE "public"."token_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."token_balances" TO "service_role";



GRANT ALL ON TABLE "public"."token_ledger" TO "anon";
GRANT ALL ON TABLE "public"."token_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."token_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."user_memberships" TO "anon";
GRANT ALL ON TABLE "public"."user_memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."user_memberships" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_teams" TO "anon";
GRANT ALL ON TABLE "public"."user_teams" TO "authenticated";
GRANT ALL ON TABLE "public"."user_teams" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_logs" TO "anon";
GRANT ALL ON TABLE "public"."workflow_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_logs" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_runs" TO "anon";
GRANT ALL ON TABLE "public"."workflow_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_runs" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_sources" TO "anon";
GRANT ALL ON TABLE "public"."workflow_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_sources" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_versions" TO "anon";
GRANT ALL ON TABLE "public"."workflow_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_versions" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_webhooks" TO "anon";
GRANT ALL ON TABLE "public"."workflow_webhooks" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_webhooks" TO "service_role";



GRANT ALL ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."workflows" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







