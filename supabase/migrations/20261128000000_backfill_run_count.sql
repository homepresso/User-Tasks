-- workflows.run_count used to grow only when a run completed successfully, so
-- runs waiting on a task or failed never counted. The engine now counts every
-- non-test run when it starts. Bring stored counts up to the real run history
-- (runs of a published version), never lowering a count: deleted runs may
-- already be included in it.
UPDATE public.workflows w
   SET run_count = greatest(coalesce(w.run_count, 0), r.runs),
       last_run_at = greatest(w.last_run_at, r.last_started)
  FROM (
    SELECT workflow_id, count(*) AS runs, max(started_at) AS last_started
      FROM public.workflow_runs
     WHERE version_id IS NOT NULL
     GROUP BY workflow_id
  ) r
 WHERE r.workflow_id = w.id
   AND (coalesce(w.run_count, 0) < r.runs OR w.last_run_at IS DISTINCT FROM greatest(w.last_run_at, r.last_started));
