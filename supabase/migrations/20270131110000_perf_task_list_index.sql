-- Task list (tasks.list: top-level tasks of a workspace by due date) at scale
-- (QA perf pass 2026-11-24).
--
-- The list filters parent_task_id IS NULL AND deleted_at IS NULL and orders
-- by due_date. No index matched, so every top-level task of the workspace was
-- read and top-N sorted on each request: 27–54 ms warm on 45k tasks (and
-- linear in the workspace), up to ~1 s cold. With this partial index the
-- first 50 come straight off the index: 6–17 ms, flat in workspace size.
--
-- On a large live table build it without blocking writes instead:
--   create index concurrently if not exists idx_tasks_tenant_toplevel_due ...
-- (the QA stack got it that way). Additive and idempotent.

create index if not exists idx_tasks_tenant_toplevel_due
  on public.tasks (tenant_id, due_date asc nulls last)
  where parent_task_id is null and deleted_at is null;
