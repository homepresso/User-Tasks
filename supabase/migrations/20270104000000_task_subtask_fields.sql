-- ============================================================================
-- 20270104000000_task_subtask_fields.sql
--
-- Rich subtasks (lib/tasks/subtask-input.ts, lib/services/tasks addSubtask /
-- updateSubtask): anyone who can work on a task adds subtasks with a title
-- and optional subtitle, description, estimate, due date, priority and tags.
--
--  1. tasks.subtitle: a short summary shown under the title (nullable, at
--     most 200 characters). Every other field reuses an existing column
--     (description, estimated_effort_assigner in minutes, due_date, priority,
--     tags). Same table, so RLS is unchanged (the policies don't name columns).
--
--  2. fn_auto_complete_parent: a parent whose subtasks are all done is
--     completed automatically — except a workflow task (is_workflow_task with
--     an event_id). Its subtasks are a personal checklist; the workflow task
--     itself completes only through its step (an outcome, the run resumes).
--     Before this, ticking the last subtask closed the task without resuming
--     its run.
--
-- Idempotent; safe to re-run.
-- ============================================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS subtitle text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_subtitle_length' AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_subtitle_length CHECK (subtitle IS NULL OR char_length(subtitle) <= 200);
  END IF;
END
$$;

COMMENT ON COLUMN public.tasks.subtitle IS 'Short summary shown under the title (subtasks and tasks; at most 200 characters).';

CREATE OR REPLACE FUNCTION public.fn_auto_complete_parent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.child_count > 0
     AND NEW.completed_child_count = NEW.child_count
     AND NEW.status != 'completed'
     -- A workflow task completes only through its workflow step.
     AND NOT (COALESCE(NEW.is_workflow_task, false) AND NEW.event_id IS NOT NULL)
  THEN
    NEW.status := 'completed';
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
