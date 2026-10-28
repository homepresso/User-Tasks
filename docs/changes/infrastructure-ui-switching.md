# Release notes: change providers from Settings → Infrastructure

Instance administrators can now switch providers and edit provider settings
on **Settings → Infrastructure**, not only with `usertasks-admin`. The page
uses the same engine as the CLI — the same pre-flight checks, backups,
switch log and rollback — so a switch made in the browser and one made on
the server are the same thing. See
[Switching providers: from the UI](../switching-providers.md#from-the-ui).

## Added

- **Change…** per area: pick a provider from the catalogue (badges, and the
  reason a provider can't run on this deployment), fill in a form generated
  from its options, **Test connection** (the pre-flight checks, nothing
  saved), **Review plan** (the dry run, line for line what `switch
  --dry-run` prints) and apply. Data-moving switches ask for the target
  provider's id as confirmation.
- **Background switches.** Storage, auth and database switches run in the
  background on a long-running app process — queued in the switch log, run
  by the app at once, resumed by the new `provider-switches` tick job after
  a restart (steps already done are skipped) — with live progress (steps,
  percentage, output), **Cancel** (before the next step; the provider is
  never half-changed) and **Retry**. On serverless deployments the page
  shows the exact `usertasks-admin` command instead (secret values come
  from environment variables, never in the command) and follows that
  switch in the log.
- **Automated database moves.** `switch database` (CLI and page) takes the
  target as a URL or host / port / database / user / password (or a
  `secret://` reference), TLS mode and CA, or token auth (`--target-auth
  azure|gcp|aws`). The pre-flight checks reachability, version, the role's
  privileges, extensions, size and an empty target, and prints the exact
  one-time SQL a DBA runs when privileges are missing. Then it does
  everything itself, in-process (no `pg_dump` / `psql`): compat bootstrap and
  all migrations with the built-in runner, the data copy in foreign-key order
  with per-table progress (owner mode for managed services: foreign keys
  dropped and re-created, user triggers off), sequences, row counts and
  checksums, the RLS smoke test, and the cut-over instructions. Resumable per
  table; on serverless it runs as a chunked job driven by the tick.
  `--prepare-only` prepares an empty database for a fresh install.
- **Settings** per area: edit the current provider's options (from-address,
  SMTP relay, bucket mapping, cache TTLs, pg_cron base URL, session limits,
  …) with the area's checks run first; each save is a `settings` entry in
  the switch log and can be rolled back.
- **Rollback** button on finished switches and settings changes (dry run
  first, typed confirmation), and a rollback-window note after a provider
  switch.
- **Secrets** typed into the page are stored encrypted (like `--secret`) or
  as `secret://` references (with a lookup check, and the `db` store's names
  offered); stored secrets are never sent to the browser.
- **`usertasks-admin ui-switching status | on | off`** for the cloud lock below.
- The switch log keeps each run's output (also for CLI runs, so the page
  can follow them live), and the CLI and the page share one-switch-at-a-time
  locking: `switch` and `rollback` refuse while another one runs.

## Guardrails

- Instance admins only, re-checked on every action; workspace owners are
  refused. Server actions (POST, same-origin), rate limited per user.
- `INFRA_UI_SWITCHING=false` keeps the page read-only. In the cloud edition
  changes from the page are locked unless `instance.allow_ui_switching` is
  true (`usertasks-admin ui-switching on`), so a hosted production instance stays locked.

## Upgrade

- Apply migration `20261110000000_infrastructure_ui_switching.sql`
  (additive: switch log columns `log`, `job`, `cancel_requested_at`, the
  `settings` kind and `queued` / `cancelled` statuses). Without it the CLI
  works as before and the page's background switches are unavailable.
- Background switches write backups under `BACKUP_DIR` (default
  `./backups/switches`): mount a volume there in containers.

## Changed

- `switch database` no longer needs a superuser target (owner mode), copies
  in primary-key batches instead of one snapshot cursor per table, and
  verifies checksums as well as row counts. New flags `--target-host`,
  `--target-port`, `--target-database`, `--target-user`, `--target-password`
  (or `TARGET_DATABASE_PASSWORD`), `--target-sslmode`, `--target-ca`,
  `--target-auth`, `--prepare-only`.
- The switch engine moved from `packages/admin/src` to `lib/admin/switch`
  and `lib/admin/ops` (the CLI re-exports it; its commands and output are
  unchanged). `switch` / `rollback` now refuse with exit code 2 while
  another switch or rollback holds the switch lock.
