# Install profile (contract for installers and the setup wizard)

The install profile is one JSON document that describes the services a
customer chose: the database, sign-in, files, email, background jobs, live
updates, cache, secret store and key management. One module turns it into
configuration, so the one-line installer, the Windows installer and the
in-browser setup wizard don't each invent their own mapping.

- Code: `lib/install/profile.ts` (schema, presets, validation, mapping; no
  node imports), `lib/install/checks.ts` (connectivity checks, server only),
  `lib/install/apply.ts` (stores instance settings).
- Command line: `usertasks-admin install …` (`packages/admin/src/install-cli.ts`).
- Tests: `__tests__/install-profile.test.ts`,
  `packages/admin/test/install-cli.test.ts`,
  `packages/admin/test/install-apply-db.test.ts` (real PostgreSQL).

Provider ids and option names are exactly the ones `lib/config` uses
(`PROVIDER_IDS`, `<area>.<option>` instance settings, `usertasks-admin switch
--set <option>=…`). Each option is checked with the field schemas that
Settings → Infrastructure uses (`lib/config/provider-forms.ts`), so new
provider options work in profiles without changes here.

## Commands

| Command | What it does | Exit codes |
|---|---|---|
| `install presets [--format json]` | Lists the presets, what each still needs, and its starting profile | 0 |
| `install profile validate` | Checks the profile; prints a summary, or with `--format json` the profile, env and settings with every credential masked | 0 valid, 1 invalid, 2 usage |
| `install profile check` | Connectivity checks per area (see below). `--area database,email`, `--email-to <address>` sends a real test message, `--read-only` skips the storage write probe | 0 all passed, 1 a check failed |
| `install profile write` | Writes the configuration: `--format env` (default) or `json`, to stdout or `--out <file>` (mode 0600). `--generate-secrets` fills in missing instance secrets | 0, 1, 2 |
| `install profile apply` | Stores the instance settings (placement `settings`) in the database. Run it after `db migrate`. `--merge <env file>` supplies `ENCRYPTION_KEY`; `--overwrite` replaces settings that already exist | 0, 1 failed, 2 usage |

Every `profile` command takes the same input, in layers. Later layers win:

1. `--preset supabase|server|existing|windows` (or a `"preset"` field in the file)
2. `--from <profile.json>`, or `--from -` to read standard input
3. `--provider <area>=<id>` and `--set <path>=<value>`, which can repeat

A value written `@env:NAME` is read from the environment variable `NAME`, so
passwords never appear on the command line, where `ps` would show them.

Paths for `--set`:

- `app.url`, `app.port`, `app.adminEmails` (comma separated), `app.setupCode`, `app.encryptionKey`, …
- `supabase.url`, `supabase.anonKey`, `supabase.serviceRoleKey`, `supabase.jwtSecret`
- `database.url`, `database.host`, `database.port`, `database.database`, `database.user`, `database.password`, `database.sslmode`, `database.hosting`, `database.auth`, `database.caFile`, `database.sessionUrl`, `database.awsRegion`
- `auth.sso` and `auth.ldap` (JSON)
- `email.smtpPreset`
- Any provider option: `email.options.smtp_host` or the short form `email.smtp_host`.
  The aliases are `files` for `storage` and `db` for `database`.
- `placement` (`env` or `settings`)

## Presets

| Id | Label | Starts with | Still needs |
|---|---|---|---|
| `supabase` | Recommended (Supabase) | Supabase database, sign-in, files and live updates; pg_cron; Resend | `app.url`, `supabase.*`, `email.options.resend_api_key` |
| `server` | Everything on this server (no Supabase) | Bundled PostgreSQL on localhost, built-in sign-in, local folder `/var/lib/usertasks/files`, built-in worker, live updates over the database, PostgreSQL cache, console email | `app.url` |
| `existing` | Use our existing services | Your PostgreSQL (TLS required), built-in sign-in, S3-compatible files, SMTP, worker | `app.url`, `database.url`, S3 endpoint and keys, `email.options.smtp_host` and `from` |
| `windows` | Windows / Microsoft shop | Bundled PostgreSQL, built-in sign-in, `C:\ProgramData\UserTasks\files`, Microsoft 365 SMTP, worker | `app.url`, an Entra ID or AD FS entry in `auth.sso`, the mailbox user, password and `from` |

`--local-root <folder>` changes the default files folder of `server` and
`windows`.

## Separated profiles need an Infrastructure licence

`supabase`, `server` and `windows` are standard stacks: everything on a
Supabase project, or everything installed with UserTasks on this machine.
Email (SMTP, Microsoft 365, Exchange, Resend, log-only) and identity
providers on built-in sign-in are settings of those stacks. These profiles
need no licence.

A profile that moves a service off the standard stack is separated, and
needs the [Infrastructure add-on](infrastructure-add-on.md)
(`lib/install/standard-stack.ts`). That covers `existing`, and any profile
with:

- your own or a managed PostgreSQL;
- an external S3, Azure Blob or GCS bucket;
- SSO-only sign-in (`oidc` / `saml`);
- an external scheduler or Redis;
- a cloud secret store or KMS;
- an email API (SES, Azure Communication Services, Microsoft Graph, Gmail).

`validate`, `write` and `apply` refuse a separated profile (exit 1) unless
`--licence <file>`, `USERTASKS_LICENCE_FILE` or `USERTASKS_LICENCE` holds a
licence for the `infrastructure` extension with the
`infrastructure-separation` feature. The licence is checked offline:

- the signature against the built-in keys;
- the dates (it stops 24 hours after expiry);
- the binding to `app.url`.

`apply --licence` also installs the licence in the instance (Settings →
Licence). Areas that the running configuration already has need no licence,
so re-runs and upgrades of installs separated with v0.2.0 / v0.3.0 keep
working:

- `write` and `validate` compare with the `--merge` env file;
- `apply` compares with the instance settings.

With `--format json`, a refusal is
`{ "ok": false, "code": "licence_required", "separated": [...] }`.

## Separate processing workers need a Processing licence

`processing: { mode: workers }` (optional `testRunsOnWorkers: true`) writes
`PROCESSING_MODE=workers`: the web app only queues and processors
(`node worker.cjs --processor`) run the work. That is the
[Processing add-on](processing-add-on.md), a paid extension: `validate`,
`write` and `apply` refuse it unless `--licence <file>` (or
`USERTASKS_LICENCE_FILE` / `USERTASKS_LICENCE`) holds a Processing licence
(checked offline, like the Infrastructure licence; it stops 24 hours after
expiry). A re-run whose merged env file already has `PROCESSING_MODE=workers`
keeps it. Leaving `processing` out (or `mode: web`) is free: the web app
processes. `apply` installs the licence into the instance.

## The profile

```json
{
  "version": 1,
  "preset": "server",
  "placement": "settings",
  "app": { "url": "https://tasks.example.com", "port": 3000, "adminEmails": ["ops@example.com"] },
  "database": { "provider": "postgres", "hosting": "bundled", "host": "localhost", "database": "usertasks", "user": "usertasks", "password": "…", "sslmode": "disable" },
  "auth": {
    "provider": "builtin",
    "sso": [{ "id": "entra", "type": "oidc", "preset": "entra", "tenantId": "…", "clientId": "…", "clientSecret": "…" }]
  },
  "storage": { "provider": "local", "options": { "local_root": "/var/lib/usertasks/files" } },
  "email": { "provider": "smtp", "smtpPreset": "m365", "options": { "smtp_user": "tasks@example.com", "smtp_password": "…", "from": "tasks@example.com" } },
  "scheduler": { "provider": "worker", "options": { "in_process": "true" } },
  "realtime": { "provider": "sse", "options": {} },
  "cache": { "provider": "postgres", "options": {} }
}
```

- `database.provider` is `supabase` or `postgres`. `hosting` is `bundled`,
  `own`, `rds`, `azure` or `cloudsql`. `auth` is `password`, `azure` (Entra
  ID token), `gcp` (Cloud SQL IAM) or `aws` (RDS IAM). Managed hosting
  defaults to `sslmode=require` and refuses `disable`.
- `auth.provider` is `supabase`, `builtin`, `oidc` or `saml`. `auth.sso`
  takes the same entries as `AUTH_SSO_PROVIDERS`, with the presets for Entra
  ID, AD FS, Okta, Keycloak, generic OIDC and SAML. `auth.ldap`
  (`url`, `bindDn`, `bindPassword`, `baseDn`, `startTls`, `passwordLogin`)
  is checked for reachability. The connection itself is added per workspace in
  Settings → Directory sync after setup.
- `email.smtpPreset`: `m365` (smtp.office365.com:587, STARTTLS required),
  `exchange` (587, opportunistic), `gmail` or `mailpit`. Values you give win.
- `cache`, `secrets` and `kms` default to `memory`, `env` and `env`.
- Credentials can be `secret://name` references to the configured secret store.

## Where values go: `placement`

- `env` puts everything in the environment. The setup wizard can show these
  services but can't change them, because environment values win.
- `settings` is what the presets use. The database, live updates, secret
  store, key management and the instance secrets go in the environment,
  because they're needed before settings can be read. Sign-in, files, email,
  background jobs and cache become `instance_settings` rows, with
  credentials encrypted. The setup wizard and Settings → Infrastructure can
  then change them in place.

Environment variables written: `DEPLOYMENT_MODE=self_hosted`, `APP_URL`,
`NEXT_PUBLIC_APP_URL`, `APP_PORT`, `ENCRYPTION_KEY`, `CRON_SECRET`,
`WORKFLOW_SIGNING_SECRET`, `USERTASKS_SETUP_CODE`, `INSTANCE_ADMIN_EMAILS`,
the Supabase variables, `DB_PROVIDER`, `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `REALTIME_DATABASE_URL`, `SCHEDULER_DATABASE_URL`
(the session URL, which defaults to `DATABASE_URL`), `DATABASE_AUTH`,
`DATABASE_SSL_CA_FILE`, `<AREA>_PROVIDER`, and each provider option's own
variable (for example `SMTP_HOST`).

## Secrets are never replaced

`write --generate-secrets` fills in `ENCRYPTION_KEY`, `CRON_SECRET`,
`WORKFLOW_SIGNING_SECRET` and `USERTASKS_SETUP_CODE` only when they are
missing. When `--out` names a file that already exists, or `--merge` names
one, its values win over both the profile and generation. A re-run during an
upgrade or repair keeps the existing key. `--force` with a different
`ENCRYPTION_KEY` is refused, because replacing it would make every stored
credential unreadable.

`apply` keeps settings that already exist, because the customer may have
changed them in the wizard since. It merges `instance.admin_emails`. Use
`--overwrite` only on purpose.

## Checks

| Area | Check |
|---|---|
| database | Connects (with the profile's TLS and token settings), PostgreSQL 15 or later, the user may create the schema (or it's already migrated), TLS on remote connections |
| supabase | Auth health with the anon key, REST with the service-role key |
| auth | Each identity provider: OIDC discovery and signing keys, or SAML metadata and certificates (`doctor`'s check); LDAP server reachable |
| storage | Creates the local folder; writes, reads back and deletes a probe object (`doctor`) |
| email | Configuration; with `--email-to`, sends a real message (`doctor`) |
| scheduler | `pg_cron` and `pg_net` available (for pg_cron) |
| cache, secrets | `doctor`'s round trip |
| kms | Checked after install (`usertasks-admin doctor --area kms`) |

In the setup wizard the same checks also go through the egress guard, which
refuses cloud metadata addresses and private addresses that aren't on the
allowlist.

## What an installer runs

A fresh install with everything on the server:

```sh
usertasks-admin install profile validate --from profile.json
usertasks-admin install profile check --from profile.json --area database,storage,email
usertasks-admin install profile write --from profile.json --generate-secrets --out /etc/usertasks/usertasks.env
usertasks-admin db migrate
usertasks-admin install profile apply --from profile.json --merge /etc/usertasks/usertasks.env
```

`apply` takes the database from `--db-url`, the environment
(`MIGRATION_DATABASE_URL`, `DATABASE_URL`) or the profile. It encrypts
credentials with `ENCRYPTION_KEY` from the environment, from the file given
to `--merge` (the one `write` produced), or from the profile, in that order. For an upgrade, run `write` with the same `--out` (existing
secrets are kept), then `usertasks upgrade`. Don't re-run `apply` unless
the profile changed.

Windows (PowerShell), with the password in an environment variable:

```powershell
$env:UT_DB_PASSWORD = '…'
usertasks-admin install profile write --preset windows --set app.url=https://tasks.contoso.com --set database.password=@env:UT_DB_PASSWORD --generate-secrets --out C:\ProgramData\UserTasks\usertasks.env
```

The installer should then tell the user to open `<APP_URL>/setup` with the
setup code (`USERTASKS_SETUP_CODE` in the env file). The setup wizard takes
it from there.
