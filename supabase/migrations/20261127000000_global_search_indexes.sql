-- ============================================================================
-- 20261127000000_global_search_indexes.sql
--
-- Header search box (lib/services/search): trigram GIN indexes for the
-- ILIKE '%term%' name searches on the tables that grow with use, so a search
-- that matches little (or nothing) in a workspace with many runs,
-- submissions or files doesn't scan them all. The other searched tables
-- (forms, workflows, reports, agents…) stay small per workspace and are
-- read through their (tenant_id, …) indexes. tasks.title already has one
-- (20261027000001_perf_indexes.sql).
--
-- Adds indexes only; re-runnable. On a large production database, build
-- them with CREATE INDEX CONCURRENTLY first (same names) and this migration
-- is then a no-op.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_title_trgm ON public.workflow_runs USING gin (title extensions.gin_trgm_ops) WHERE title IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_name_trgm ON public.form_submissions USING gin (form_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_form_files_name_trgm ON public.form_files USING gin (name extensions.gin_trgm_ops);
