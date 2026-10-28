# Release notes: database portability

UserTasks' schema now installs on any PostgreSQL 15+ — plain Docker
`postgres`, Amazon RDS / Aurora, Azure Database for PostgreSQL, Google Cloud
SQL / AlloyDB, Neon, CloudNativePG or Patroni clusters — not only on
Supabase. With `DB_PROVIDER=postgres` and the other non-Supabase providers,
an install no longer needs Supabase at all. Supabase installs are unchanged.

## Added

- **`usertasks-admin db migrate | status | repair`** (new package
  `packages/admin`; `npm run admin -- …` in a checkout, `node admin.cjs …`
  in the Docker image, which now ships `supabase/migrations/`). Applies the
  same migration files as `supabase db push`, one transaction per migration,
  serialised by an advisory lock, with dry-run, out-of-order protection and
  checksum warnings. History is kept in Supabase's
  `supabase_migrations.schema_migrations` format. See
  [Infrastructure: Database](infrastructure.md#database).
- **`20261014000000_compat_bootstrap.sql`**: on non-Supabase PostgreSQL it
  creates the API roles, the `auth.uid()` / `role()` / `jwt()` / `email()`
  helpers over `request.jwt.claims`, a minimal `auth.users` and the
  `extensions` schema. A no-op on Supabase.
- **`DATABASE_AUTH=azure|gcp`**: Microsoft Entra ID tokens for Azure
  Database for PostgreSQL and IAM access tokens for Cloud SQL / AlloyDB as
  the connection password, for the app's pools, the realtime `LISTEN`
  connection, the scheduler worker and `usertasks-admin`.
- **Managed PostgreSQL without `BYPASSRLS`**: when `service_role` can't be
  given `BYPASSRLS`, the postgres db provider runs service-role requests as
  the schema owner (which bypasses RLS on its tables) with the same claims.
- A CI job runs the migrations and the full test suite on plain PostgreSQL
  16 and 17, as a superuser and as a managed-style owner, with every
  Supabase-free provider. Tests of Supabase services skip there by
  capability detection.

## Changed

- Storage bucket / policy statements and the original pg_cron jobs in the
  migrations are skipped where Supabase Storage or pg_cron is not installed.
- Workspace theme and logo saves no longer construct the storage provider
  just to decide how a reference is stored (a misconfigured local root no
  longer fails a save that uploads nothing).

## Upgrade

- **Supabase projects (production):** once, before the next push,
  `npx supabase migration repair --status applied 20261014000000 --linked`
  (see [Database migrations](migrations.md)). Nothing else changes.
- **Plain PostgreSQL:** create a database, then `usertasks-admin db
  migrate`. See the privileges table in
  [Infrastructure: Database](infrastructure.md#database).
