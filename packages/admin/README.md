# usertasks-admin

Server-side administration for UserTasks installs. It runs where the app
runs, with the app's environment (`DATABASE_URL`, the `<AREA>_PROVIDER`
variables and provider options, `ENCRYPTION_KEY`), and talks to the database
directly — never through the app.

```bash
npm run admin -- <command>          # from a checkout
node admin.cjs <command>            # in the Docker image (/app/admin.cjs)
```

| Command | What it does |
|---|---|
| `status [--json]` | Provider per area and where it is set (env / settings / default), PostgreSQL and migration versions, health summary |
| `providers list [--area <a>] [--on-prem] [--aws] [--azure] [--gcp] [--json]` | The provider catalogue with capability flags |
| `doctor [--area <a,b>] [--read-only] [--email-to <addr>] [--json]` | Connectivity and configuration checks per area (exit 1 on a failure; secrets never printed) |
| `switch <area> --to <provider> [--dry-run] [--yes] …` | Switch one area: pre-flight, backup, steps, config, switch log |
| `rollback <switch-id> [--dry-run] [--yes]` | Undo a switch (config and, where possible, data) |
| `history [--limit <n>] [--json]` | The switch log |
| `instance-admins list \| add <email>… \| remove <email>…` | Who may open Settings → Infrastructure (with `INSTANCE_ADMIN_EMAILS`) |
| `ui-switching status \| on \| off` | Cloud edition: allow provider changes from Settings → Infrastructure (`instance.allow_ui_switching`) |
| `bootstrap --email … --org … [--password …] [--api-key <name>] [--if-missing]` | First workspace and owner through the configured providers (password also from `BOOTSTRAP_PASSWORD`); `--api-key` prints a tenant key once |
| `storage init` | Create the app's buckets on the configured storage provider |
| `db migrate [--dry-run] [--include-all] [--owner <role>]` | Apply `supabase/migrations` to any PostgreSQL 15+ |
| `db status` / `db repair --status applied\|reverted <version>…` | Migration history |

Areas: `database`, `auth`, `storage`, `realtime`, `scheduler`, `email`,
`secrets`. Global options: `--db-url` (default `MIGRATION_DATABASE_URL`, then
`DATABASE_URL`), `--actor` (recorded in the switch log; default
`user@host`), `--backup-dir` (default `BACKUP_DIR`, else
`./backups/switches`).

`switch` options: `--set <option>=<value>` and `--secret <option>=<value>`
(encrypted) write `<area>.<option>` settings; `--no-dump` skips the
`pg_dump` backup; `--force` re-runs an area's steps even when it already uses
the target. Per area: `database --target-url <url> [--dir <migrations>]`,
`auth [--map google=oidc:google]`, `storage [--bucket <b>]… [--prefix <p>]
[--overwrite]`, `scheduler [--base-url <url>] [--no-secrets]`,
`email [--test-to <addr>]`.

Exit codes: 0 success (or nothing to do / dry run), 1 failure (a check or a
step failed), 2 usage error or refused (pre-flight failed, `--yes` missing).

The step-by-step guide, with downtime expectations and rollback per area, is
[Switching providers](../../docs/switching-providers.md); provider options are
in [Infrastructure and providers](../../docs/infrastructure.md).

Build the single-file bundle with `npm run build -w @usertasks/admin`
(`dist/admin.cjs`; `pg` and the optional cloud SDKs are loaded from the
app's `node_modules`).
