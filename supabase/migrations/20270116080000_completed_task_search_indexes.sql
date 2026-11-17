-- Completed tasks, searched and paged on the server (lib/services/task-search.ts:
-- the app's My tasks / Following "Completed" and "All" views and the
-- embeddable task list). Additive only.
--
-- "My completed tasks" = assigned to me OR completed by me (actioned_by), newest
-- completed first, one keyset page at a time:
--   * actioned_by had no index: the OR fell back to scanning the workspace's
--     tasks. idx_tasks_actioned_completed serves that branch, already ordered;
--   * idx_tasks_assignee_completed serves the assignee branch in completed_at
--     order (idx_tasks_assignee_status finds the rows but must sort them all).
-- Both partial (only rows these queries can reach), so they stay small.
--
-- Large production tables: create them with CREATE INDEX CONCURRENTLY first
-- (same names) and this migration is then a no-op (docs/migrations.md).

CREATE INDEX IF NOT EXISTS idx_tasks_actioned_completed
  ON public.tasks (actioned_by, completed_at DESC, id)
  WHERE actioned_by IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_completed
  ON public.tasks (assignee_id, completed_at DESC, id)
  WHERE status = 'completed' AND deleted_at IS NULL AND assignee_id IS NOT NULL;
