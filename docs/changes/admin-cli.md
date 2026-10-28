# Release notes: admin CLI and Infrastructure page

Operators can now move a running install between providers with one command
per area, and see the instance's infrastructure in the app. Nothing changes
for installs that don't use it: the Supabase providers stay the defaults.

## Added

- **`usertasks-admin status`, `providers list`, `doctor`**: the provider per
  area with its source and health; the provider catalogue with on-prem /
  Azure / Google Cloud flags (`--on-prem`, `--azure`, `--gcp`); and
  connectivity / configuration checks per area — database roles, privileges,
  extensions and migrations, a storage write probe, Supabase Auth health or
  the built-in store, OIDC discovery, email configuration and an optional
  test send, pg_cron jobs / worker leader / last tick, a LISTEN/NOTIFY round
  trip, `secret://` resolution. See [Switching providers](switching-providers.md).
- **`usertasks-admin switch <area> --to <provider>`** for the database (copy
  into any PostgreSQL 15+, row-count and RLS verification), auth (Supabase
  accounts with their passwords into the built-in store), storage (checksum-
  verified copy and stored-URL rewrite), the scheduler (pg_cron jobs in or
  out), and realtime / email / secrets (validated config changes). Every
  switch has pre-flight checks, a dry run, a refusal without `--yes`, an
  automatic backup (config snapshot, row snapshots, `pg_dump`), a per-step
  log, idempotent re-runs and **`usertasks-admin rollback <switch-id>`**.
  `history` lists the switch log; `instance-admins` manages who sees the
  Infrastructure page.
- **Settings → Infrastructure** (read-only, instance admins only —
  `INSTANCE_ADMIN_EMAILS` or the `instance.admin_emails` setting, matched on
  the account's verified email; workspace roles don't grant it): provider
  per area with badges, cached health checks, the recent switch log, links
  to the docs.

## Migration

- `20261107000000_instance_admin.sql`: allows `instance.<option>` keys in
  `instance_settings` and adds `instance_provider_switches` (the switch log;
  service role only, like `instance_settings`). Safe on any install.

## Notes

- Backups (`BACKUP_DIR`, default `./backups/switches`) hold config snapshots
  and, for auth switches, password hashes: they are created private (0700)
  and belong with your other database backups.
- The Docker image's `admin.cjs` now also loads the optional storage / email
  / secrets SDKs from the app's `node_modules`.
