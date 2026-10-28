# Release notes: background jobs

Exports, imports and bulk actions no longer keep the page waiting. Clicking
**Export**, **Import**, **Delete {n}**, **Build & download** and the other
slow actions starts a background job and returns at once: *“Preparing your
export… we'll let you know when it's ready.”* Keep working — when the job
finishes, a popup offers **Download** (or shows the result, or the error with
**Retry**), wherever you are in the app, and the bell keeps a notification
with a link to it. See [Background jobs](/docs/background-jobs).

Migration: **`20261114000000_user_jobs.sql`** (apply before deploying).

## Added

- **Jobs indicator** in the top bar: a spinner and count while jobs run, and
  a panel of recent jobs with progress, Cancel, Retry and Download.
  Workspace admins (`settings.edit`) can switch to every job of the
  workspace.
- **Completion popup** with Download / Retry, and a bell notification for
  each finished job (marked read once the popup was seen).
- **`user_jobs`** table and runner (`lib/user-jobs`): the job starts right
  after the response (`after()`), the scheduler tick (`user-jobs`, every
  minute) picks up anything whose start was lost, retries that are due and
  the next chunk of long jobs. Leases with heartbeats, retries with backoff,
  cooperative cancel, resumable chunks, and permissions re-checked as the
  user (or API key) when the job runs. Results live in a private
  `job-results` bucket of the configured storage provider for 7 days
  (`USER_JOB_RESULT_TTL_HOURS`); `user-jobs-cleanup` (every 15 minutes)
  deletes them.
- **REST**: `?async=true` or `Prefer: respond-async` on the slow endpoints
  (`GET /config/export`, `POST /config/apply`, `POST /packages/{id}/versions`,
  `POST /package-installs`, `POST /package-installs/{id}/upgrade`,
  `POST /package-installs/{id}/uninstall`,
  `POST /data-tables/{id}/rows/bulk-delete`, `POST /references/bulk-delete`,
  `POST /workflows/{id}/instances/migrate`) → `202` with the job;
  `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel`,
  `POST /jobs/{id}/retry`, `GET /jobs/{id}/result`, `GET /jobs/{id}/download`.
  Without the flag every endpoint answers as before.
- **SDK**: `startJob`, `getJob`, `waitForJob`, `jobResult`,
  `requestAndWait`, `downloadJob`, `cancelJob`; `UsertasksJobError`.
- **CLI**: commands with an async variant run as a job and wait for it
  (progress on stderr; `--no-wait` prints the job); `usertasks jobs list |
  get | cancel | retry | result | wait | download`. `config export`,
  `config apply`, `packages build | install | upgrade | uninstall` use jobs
  when the server supports them.

## Changed (UI actions that are now jobs)

| Where | Action | Job kind |
|---|---|---|
| Every artifact | Export (single item or selection) | `config.export` |
| Import button | Import (the dry-run plan stays instant) | `config.apply` |
| Reports | Export ▸ Download Excel | `report.export` |
| Packages | Build & download, version download, Install / Upgrade, Complete setup, Uninstall, History ▸ Export CSV | `package.*` |
| Workflows, data tables, rows, business rules, agents, reports, workflow activities, retention policies, references, API keys | Delete selected | `bulk.delete` |
| Workflows | Activate / Deactivate selected | `workflows.set_active` |
| Workflows, data tables | Bulk permissions | `object_permissions.bulk_set` |
| References | Add tag to selected | `references.add_tag` |
| Roles | Bulk assign / remove | `roles.bulk` |
| Connectors | Regenerate references | `connectors.regenerate_references` |
| Workflow queue | Pause All / Resume All / Delete (was one request per item from the browser) | `workflow_queue.bulk` |
| Live instances | Migrate *n* instances (resumable chunks) | `workflow_instances.migrate` |
| GitHub sync, directory sync | Push / commit / template / selection sync, Deploy, Sync now | `sync.watch` (follows the existing run) |

Small jobs still finish within the click (the action waits up to 1.5 s), so
quick actions behave as before.

## Faster

Measured on the local stack (3 tables × 10,000 rows, 300 workflows):

| Action | Before | After |
|---|---|---|
| Import with table rows, merge (30,000 rows) | 190.8 s (one UPDATE per row) | 3.7 s (upserts of 500) |
| Bulk delete 300 items (queue inserts) | 0.8–2.9 s (one insert + one processor request per item for rows / activities) | 9 ms (one insert per 100) |
| Export 3 tables + 30,000 rows | 0.8 s in the request | returns in 6 ms; file ready in 0.6 s |

## Fixed

- Queue bulk Delete removed runs through `/api/workflows/cleanup-test`,
  which checked no permission; the job requires `workflows.activate` like
  the queue-job delete.
- Bulk Activate / Deactivate updated workflows without a tenant filter
  (relying on RLS); the job pins the workspace.

## Notes

- Job results are private: only the user who started a job can download it
  (admins see the job, not its file); every download is authorised.
- An instance migration (`usertasks-admin migrate`) does not copy job results.
