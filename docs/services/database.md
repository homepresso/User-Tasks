# Choosing a database

The database holds everything that matters: workspaces, workflows and runs,
tasks, data tables, the event stream and the audit log. Row-level security
decides what each user sees, and it works the same way with either
provider.

| Option | `DB_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Supabase Postgres, through PostgREST | `supabase` (default) | — | — | — | — | data |
| PostgreSQL 15+, in-process | `postgres` | yes | native: RDS, Aurora, RDS Proxy with IAM auth (`DATABASE_AUTH=aws`) | native: Flexible Server with Entra token auth (`DATABASE_AUTH=azure`) | native: Cloud SQL / AlloyDB with IAM auth (`DATABASE_AUTH=gcp`) | data |

With `postgres` the database can be plain PostgreSQL (VM, bare metal,
Docker), a managed service (RDS, Aurora, Flexible Server, Cloud SQL,
AlloyDB, Neon), an operator on Kubernetes (CloudNativePG, Crunchy PGO,
Zalando), Patroni, or Supabase's own database over `DATABASE_URL`.

## When to pick which

- **Supabase** (recommended) when the rest of the install is on Supabase.
  It is the least to run, and backups and failover are included.
- **PostgreSQL** when the data must sit in your own account or network,
  or when you want to use your cloud's database IAM (Entra ID, Cloud SQL
  IAM). It is required for on-premises installs.

## Rules

- **Moving the database is the last switch.** Its pre-flight refuses while
  auth, realtime or the scheduler still use a Supabase-only provider.
  Supabase Storage can stay.
- **PostgreSQL 15 or later**, with `pg_trgm`. `pgcrypto` is used when
  available. `pg_cron` and `pg_net` are optional.
- **Poolers:** transaction pooling (PgBouncer, RDS Proxy, the Flexible
  Server's PgBouncer, Supavisor, Neon's pooled endpoint) is safe for the
  app. Migrations, the SSE `LISTEN` and the worker's leader lock need
  session connections: `MIGRATION_DATABASE_URL`, `REALTIME_DATABASE_URL`,
  `SCHEDULER_DATABASE_URL`.
- **Downtime:** the copy is a snapshot. Stop writes, run the switch again
  for the final copy, then restart with the new `DATABASE_URL`.
- **Keep the app next to the database.** Every request makes database round
  trips, so this distance sets the latency your users notice.
- **Token auth instead of passwords:** `DATABASE_AUTH=aws` (RDS / Aurora /
  RDS Proxy IAM auth), `azure` (Entra ID) or `gcp` (Cloud SQL / AlloyDB IAM).
  See [AWS setup](../setup-aws.md).

```bash
usertasks-admin switch database --to postgres --target-url 'postgres://usertasks:…@db.internal:5432/usertasks' --dry-run
```

Reference: [Database](../infrastructure.md#database) and
[Switching the database](../switching-providers.md#database).
