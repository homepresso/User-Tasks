-- Task analytics (/reports/tasks) summarised in the database (QA perf pass 2026-11-24).
--
-- The report read every top-level task, every completion of the last 12
-- weeks and every overdue task and counted them in the browser. PostgREST
-- max_rows (1,000) silently cut each list, so totals, rates, status and
-- priority splits, the leaderboard, the trend and the overdue buckets were
-- all wrong past 1,000 tasks, and the payload grew with the workspace. The
-- effort scatter read every effort record (cut at 1,000 too): it is now
-- aggregated per task here (at most 5,000 points).
-- report_task_summary returns the same numbers (lib/reports/task-summary.ts
-- summarizeTasks is the in-memory twin) as one small jsonb.
--
-- SECURITY INVOKER: the caller's RLS on tasks applies exactly as to the old
-- selects (the current workspace, or every member workspace in the unified
-- view). anon has no EXECUTE. Additive and idempotent.

create or replace function public.report_task_summary(
  p_since timestamptz default null,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with top_level as (
    select t.status::text as status, coalesce(t.priority::text, 'none') as priority, t.assignee_id, t.created_at, t.completed_at
    from public.tasks t
    where t.deleted_at is null
      and t.parent_task_id is null
      and (p_since is null or t.created_at >= p_since)
  ),
  overdue as (
    select floor(extract(epoch from (p_now - t.due_date)) / 86400)::int as days_late
    from public.tasks t
    where t.deleted_at is null
      and t.status in ('todo', 'in_progress', 'blocked')
      and t.due_date < p_now
  ),
  recent as (
    select ceil(extract(epoch from (p_now - t.completed_at)) / 604800)::int - 1 as back
    from public.tasks t
    where t.deleted_at is null
      and t.status = 'completed'
      and t.completed_at >= p_now - interval '84 days'
      and t.completed_at < p_now
  ),
  -- Effort scatter: per task, estimated vs actual minutes (both > 0), at most 5,000 points.
  effort as (
    select e.task_id,
      sum(e.minutes) filter (where e.record_type::text = 'assigner_estimate') as est,
      sum(e.minutes) filter (where e.record_type::text in ('actual', 'timer_entry')) as act
    from public.effort_records e
    group by e.task_id
  ),
  effort_points as (
    select task_id, est, act from effort where est > 0 and act > 0 order by task_id limit 5000
  ),
  leaders as (
    select assignee_id, count(*) as n
    from top_level
    where status = 'completed' and assignee_id is not null
    group by assignee_id
    order by count(*) desc, assignee_id::text
    limit 10
  )
  select jsonb_build_object(
    'total', (select count(*) from top_level),
    'completed', (select count(*) from top_level where status = 'completed'),
    'avg_completion_ms', (
      select avg(extract(epoch from (completed_at - created_at)) * 1000)
      from top_level where status = 'completed' and completed_at is not null and created_at is not null
    ),
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from top_level group by status) s), '{}'::jsonb),
    'priority', coalesce((select jsonb_object_agg(priority, n) from (select priority, count(*) as n from top_level group by priority) p), '{}'::jsonb),
    'leaderboard', coalesce((select jsonb_agg(jsonb_build_object('assignee_id', assignee_id, 'count', n) order by n desc, assignee_id::text) from leaders), '[]'::jsonb),
    'overdue', jsonb_build_object(
      'count', (select count(*) from overdue),
      'buckets', jsonb_build_array(
        (select count(*) from overdue where days_late between 1 and 3),
        (select count(*) from overdue where days_late between 4 and 7),
        (select count(*) from overdue where days_late between 8 and 14),
        (select count(*) from overdue where days_late between 15 and 9999)
      )
    ),
    'effort', coalesce((select jsonb_agg(jsonb_build_array(task_id, est, act) order by task_id) from effort_points), '[]'::jsonb),
    'weekly', (
      select jsonb_agg(coalesce(c.n, 0) order by w.i)
      from generate_series(0, 11) as w(i)
      left join (select back, count(*) as n from recent where back between 0 and 11 group by back) c on c.back = 11 - w.i
    )
  )
$$;

revoke all on function public.report_task_summary(timestamptz, timestamptz) from public;
grant execute on function public.report_task_summary(timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.report_task_summary(timestamptz, timestamptz) from anon;

notify pgrst, 'reload schema';
