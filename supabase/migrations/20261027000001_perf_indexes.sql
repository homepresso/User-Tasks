-- Perf phase 3: indexes for the hot queries, duplicate indexes dropped.
--
-- Added (each matches queries in the app/API/MCP/engine):
-- * workflow_runs (workflow_id, started_at DESC) — runs of a workflow, newest
--   first (builder, /api/v1/workflows/{id}, automations pages).
-- * workflow_runs (tenant_id, started_at DESC) — /api/v1/workflows/runs,
--   queue page, reports.
-- * workflow_runs (task_id) WHERE task_id IS NOT NULL — the FK's ON DELETE
--   SET NULL (deleting a task scanned every run) and runs-of-a-task lookups.
-- * workflow_logs (run_id, created_at) — a run's logs in order.
-- * task_assignees (user_id, acceptance_status) — a user's collaborative
--   tasks (getAccessibleTaskIdsForUser: /api/v1/tasks, MCP tasks_list) and
--   pending ones (task queue hook).
-- * tasks (tenant_id, created_at DESC) WHERE deleted_at IS NULL — every task
--   list (API, MCP, hooks) is tenant + not deleted, newest first.
-- * tasks.title trigram GIN (pg_trgm, schema extensions) — ILIKE '%term%'
--   search on task titles (report filters, search).
--
-- Dropped (another index already serves every lookup they serve):
-- * idx_tasks_status = idx_tasks_tenant_status (identical columns).
-- * idx_tasks_tenant — leading column of idx_tasks_tenant_status.
-- * idx_tasks_event (event_id) — idx_tasks_event_id (event_id) WHERE event_id
--   IS NOT NULL serves every equality lookup.
-- * idx_lifecycle_task — prefix of idx_lifecycle_events_task (task_id, created_at DESC).
-- * idx_membership_user — prefix of idx_membership_user_tenant (user_id, tenant_id).
-- * idx_workflow_runs_workflow / idx_workflow_runs_tenant — prefixes of the new
--   (…, started_at DESC) indexes.
-- * idx_workflow_logs_run — prefix of the new (run_id, created_at).
-- * idx_tenants_slug = tenants_slug_key (unique constraint).
-- * idx_workflow_versions_workflow = workflow_versions_workflow_id_version_number_key.
-- * idx_custom_workflow_activities_tenant_key = custom_workflow_activities_tenant_id_key_key.
--
-- The Supabase CLI runs each migration file in a transaction, so this file
-- uses plain CREATE INDEX (it blocks writes to each table while that index
-- builds). On a busy production database build them first with
-- CREATE INDEX CONCURRENTLY — see docs/migrations.md — and this file then
-- only drops the duplicates. Idempotent: safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started ON public.workflow_runs (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_started ON public.workflow_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_task ON public.workflow_runs (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_logs_run_created ON public.workflow_logs (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user_status ON public.task_assignees (user_id, acceptance_status);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_created ON public.tasks (tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON public.tasks USING gin (title extensions.gin_trgm_ops);

DROP INDEX IF EXISTS public.idx_tasks_status;
DROP INDEX IF EXISTS public.idx_tasks_tenant;
DROP INDEX IF EXISTS public.idx_tasks_event;
DROP INDEX IF EXISTS public.idx_lifecycle_task;
DROP INDEX IF EXISTS public.idx_membership_user;
DROP INDEX IF EXISTS public.idx_workflow_runs_workflow;
DROP INDEX IF EXISTS public.idx_workflow_runs_tenant;
DROP INDEX IF EXISTS public.idx_workflow_logs_run;
DROP INDEX IF EXISTS public.idx_tenants_slug;
DROP INDEX IF EXISTS public.idx_workflow_versions_workflow;
DROP INDEX IF EXISTS public.idx_custom_workflow_activities_tenant_key;
