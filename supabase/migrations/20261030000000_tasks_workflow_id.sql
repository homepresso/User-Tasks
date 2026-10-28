-- Fix: User Task steps failed on every real run.
--
-- tasks.workflow_source_id references workflow_sources(id) — the registry of
-- EXTERNAL engines that push tasks in through POST /api/v1/tasks/ingest. The
-- workflow engine's user_task handler wrote the native workflow's id into it,
-- so the insert violated fk_tasks_workflow_source as soon as the run context
-- carried workflow_id. Native workflow tasks get their own link instead;
-- workflow_source_id stays for ingested tasks only. No backfill: no native
-- task could ever have been inserted with a workflow id there.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS workflow_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_workflow_id_fkey') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_workflow_id_fkey FOREIGN KEY (workflow_id)
      REFERENCES public.workflows(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id
  ON public.tasks (workflow_id) WHERE workflow_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.workflow_id IS
  'Native workflow whose User Task step created this task. workflow_source_id is only for tasks ingested from external engines (workflow_sources).';

NOTIFY pgrst, 'reload schema';
