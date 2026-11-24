# Release notes: Processing reliability and the processing tier

Jobs whose worker stops no longer stay stuck, runs continue after the last
completed step instead of repeating side effects, and the processing
add-on can move all processing to separate workers.

## New

- **Stuck-job recovery.** Every claimed workflow job holds a lease renewed
  while it runs; when a worker dies (crash, out of memory, timeout) the job
  is recovered automatically — retried with back-off and a *Worker lost*
  error, or dead after its last attempt. Workflow queue: *Stuck (worker
  lost)* status with **Retry** / **Cancel**, **Force-cancel** for a live job
  (confirmation; audited). API: `POST /workflows/queue/{id}/action` takes
  `force`.
- **Run checkpoints.** A recovered run continues after its last completed
  step; steps that can't be repeated safely fail as *outcome unknown* (On
  error decides) unless the trigger's *If a step is interrupted* says *Run
  it again*. HTTP Request: **Send an Idempotency-Key header**. Emails and
  data-table writes are not repeated after a recovery.
- **Settings → Infrastructure → Processing** (instance admins): where work
  runs, queue health, stuck jobs; `GET / PATCH /api/v1/admin/processing`,
  `POST /api/v1/admin/processing/jobs/{id}/recover` (CLI
  `usertasks admin-processing …`).
- **Processing add-on (paid, per deployment).** Separate scalable
  processor processes (`node worker.cjs --processor`), designer test runs on
  workers optionally; core gains the extension points it plugs into
  (extension SDK 1.1: `ServerExtension.processing`, `ProcessorHost`,
  `ctx.instance`).

## Upgrade

- Apply `20270124090000_queue_leases.sql` and `20270125100000_run_checkpoints.sql`
  (plain SQL, additive; either order with the code).
- `WORKFLOW_LEASE_SECONDS` (default 120): raise it only if a single step
  blocks the Node event loop for longer than a quarter of it.
- `WORKFLOW_CHECKPOINTS=off` turns checkpoints off (one small write per
  side-effecting step otherwise).
- `claim_next_job` / `fail_job` are service role only now (they were
  executable by signed-in users).
