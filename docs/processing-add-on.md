# Processing add-on

> **Paid add-on.** Separate processing workers are the **Processing add-on**, a
> paid extension (SKU `processing-tier`) licensed at **$2,500 USD per
> deployment per year**. It comes in UserTasks Enterprise, the one image with
> every paid extension: installing the licence unlocks it, with no reinstall.

Out of the box the web app runs workflow, agent and media processing itself.
That is right for most installs and needs nothing configured. The add-on moves
that work onto **separate worker processes** that scale on their own, so a
heavy document, OCR or media step never competes with the people using the
app.

## What is free

These are part of the open-source core and work without the add-on:

- processing in the web app (the default), with the scheduler's minute tick
  as the safety net;
- **leases and stuck-job recovery**: a job whose worker stops (crash, out of
  memory, timeout) is recovered automatically;
- **checkpoints**: a recovered run continues after its last completed step,
  and steps that can't be repeated safely fail as *outcome unknown*;
- Settings → Infrastructure → **Processing**: queue health, processing and
  stuck jobs with Retry / Cancel / Force-cancel, and
  `GET /api/v1/admin/processing`.

See [Infrastructure and providers](infrastructure.md#processing-tier) for how
these work.

## What the add-on adds

- **Processing mode**: *In the web app* or *Separate workers*. With separate
  workers the web app only queues work; any number of processors claim and
  run it. Requests that need a result (synchronous API starts,
  request/response webhooks) wait for the queued job, up to
  `PROCESSING_WAIT_TIMEOUT_MS` (default 55 s).
- **The processor**: `node worker.cjs --processor`, the same image as the web
  app. It claims continuously from the PostgreSQL queue (several processors
  are safe), wakes up on `LISTEN/NOTIFY` (and polls as a fallback behind
  transaction poolers), and stops claiming when memory gets high
  (`WORKER_MAX_RSS_MB`). On SIGTERM it drains: it claims nothing new and
  finishes running jobs. Each processor sends a heartbeat and serves
  `/metrics` (Prometheus), `/health` and `/ready`.
- **Designer test runs on workers** (a setting, off by default). Off: test
  runs stay in the web app for the quickest feedback. On: they run on the
  workers like production does.
- **Worker health**: workers, their state, memory, jobs per minute and
  version, next to the queue depth and the oldest waiting job.
- **Deployment files**: a Docker Compose `processor` service and a Helm chart
  (processor Deployment, metrics Service or ServiceMonitor, HPA on CPU and
  memory, or a KEDA ScaledObject on queue depth).

## Turning it on

1. Run UserTasks Enterprise and install the Processing licence (Settings →
   Licence, or `usertasks-admin licence install <file>`).
2. Start at least one processor:
   - Docker Compose: the add-on's `docker-compose.processing.yml` with
     `--profile processing` (scale with `--scale processor=N`);
   - Kubernetes: the add-on's `usertasks-processing` chart next to the
     `usertasks` release;
   - anywhere else: `node worker.cjs --processor` with the web app's
     environment.
3. Open Settings → Infrastructure → **Processing**. The workers appear within
   a few seconds. Choose **Separate workers**. The switch is refused while no
   worker has reported in the last minute, so queued work never waits with
   nobody to run it.

At install time, an install profile with `processing: { mode: workers }`
does step 3 for you (with `--licence <file>`; see
[Install profiles](install-profile.md)). The setup wizard's **Services** step
has the same switch under *Processing (optional)*.

### Workers on other machines

Processors don't have to run next to the web app. Any machine on your own
network that can reach the database can run one: the same image (or
`node worker.cjs --processor` from the same release) with the web app's
environment (`DATABASE_URL`, `ENCRYPTION_KEY`, the secrets provider settings).
Give it `PROCESSING_LISTEN_DATABASE_URL` (a direct, session-level PostgreSQL
URL) for instant wake-ups, else it polls. Use `WORKER_QUEUES=media` to keep
heavy media and OCR work on bigger machines.

`PROCESSING_MODE=workers` (or `web`) and `PROCESSING_TEST_RUNS_ON_WORKERS` in
the server environment fix those settings; the page then shows them as set
by the environment. The instance admin API does the same:
`PATCH /api/v1/admin/processing` (`usertasks admin-processing configure
--mode workers`).

## Licence and expiry

The licence is checked on every hand-off decision (cached a few seconds) and
by every processor once a minute.

- An expired licence keeps working for **24 hours**. Settings shows when it
  stops.
- After that, **changes stop**: the mode and test-run setting can no longer
  be changed. Nothing is cut off. Processors stop *claiming* new work, finish
  the jobs they are running and report themselves paused. At the same moment
  the web app starts processing queued work again, so nothing waits.
- Installing a renewed licence resumes the processors without a restart (within about a minute) and
  puts the saved mode back.
- Without the add-on, or with no licence, Settings → Infrastructure →
  Processing shows what the add-on does and how to get it.
