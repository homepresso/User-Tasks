-- ============================================================================
-- 20270116000000_extension_run_indexes.sql
--
-- Indexes for run lists that pages from extensions open often over large
-- histories (ctx.workflows.history / runs: one record set's runs, filtered,
-- searched and paged — e.g. a SharePoint list with hundreds of thousands of
-- runs).
--
-- workflow_runs
--   (workflow_id, status, started_at DESC, id)  status filter + newest first (keyset on started_at, id)
--   (workflow_id, started_at DESC, id)          newest first across a few workflows (keyset)
--   (workflow_id, started_by, started_at DESC)  "started by" filter
--
-- workflow_queue (the trigger data of each run; joined by result->>run_id)
--   (workflow_id, created_at DESC)                              per-workflow job lookups
--   (workflow_id, created_at DESC) WHERE pending / processing   queued starts (not started yet)
--   (tenant_id, (trigger_data->>'item_id'), created_at DESC)  extension triggers  one record's runs, newest first
--   gin ((trigger_data->>'title') trgm)        extension triggers  search by the record's title
--
-- Measured on 500k runs / 500k jobs in one workspace (local PostgreSQL 16; docs in the
-- SharePoint extension's lab results): one item's runs 700 ms → 0.07 ms, title search
-- 229 ms → 7 ms, newest page 1.5 ms → 0.1 ms; deep pages use keyset (0.08 ms) instead of OFFSET.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_status_started
  ON public.workflow_runs (workflow_id, status, started_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started_id
  ON public.workflow_runs (workflow_id, started_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_starter
  ON public.workflow_runs (workflow_id, started_by, started_at DESC) WHERE started_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_queue_workflow_created
  ON public.workflow_queue (workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_queue_workflow_open
  ON public.workflow_queue (workflow_id, created_at DESC) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_workflow_queue_ext_item
  ON public.workflow_queue (tenant_id, (trigger_data->>'item_id'), created_at DESC) WHERE trigger_type LIKE 'ext.%';
CREATE INDEX IF NOT EXISTS idx_workflow_queue_ext_title_trgm
  ON public.workflow_queue USING gin ((trigger_data->>'title') extensions.gin_trgm_ops) WHERE trigger_type LIKE 'ext.%';
