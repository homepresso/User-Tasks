# Topology: Supabase only

The default, and our recommended way to run UserTasks: Supabase is an
excellent platform, and one Supabase project provides the database, auth, file storage,
realtime and scheduling, and Resend sends the email. You run the app (on
Vercel, a VM, or the Docker image on any container platform) and nothing
else. No provider variable is set: every area uses its default.

<!-- ::topology supabase -->

## What runs where

| Area | Service | Provider id | Notes |
|---|---|---|---|
| Database | Supabase Postgres (through PostgREST) | `supabase` | Row-level security for every request |
| Auth | Supabase Auth | `supabase` | Email + password; Google and Microsoft configured in the Supabase dashboard |
| Storage | Supabase Storage | `supabase` | Public URLs served by Supabase |
| Realtime | Supabase Realtime | `supabase` | `postgres_changes` with RLS per subscriber |
| Scheduler | pg_cron + pg_net, secrets in Supabase Vault | `pg_cron` | One job calls `/api/cron/tick` every minute |
| Email | Resend | `resend` | Sign-in emails come from Supabase Auth's mailer |
| Secrets | Environment variables | `env` | |
| KMS | `ENCRYPTION_KEY` | `env` | AES-256-GCM for stored credentials |
| Cache | In-process memory | `memory` | Fine for one instance |
| Log export | Any destination, per workspace | — | Splunk, Datadog, OpenTelemetry, webhook, syslog and the cloud destinations |
| Directory sync | Entra ID, Okta, LDAP, Google Workspace, SCIM | — | Per workspace; LDAP bind login needs built-in auth |

## Configuration

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…
NEXT_PUBLIC_APP_URL=https://tasks.example.com
CRON_SECRET=…            # also stored in Vault as cron_secret
ENCRYPTION_KEY=…         # openssl rand -base64 32
RESEND_API_KEY=…         # without it, sending email fails with "not configured"
```

Then apply the migrations (`npx supabase db push`), store the two Vault
secrets for pg_cron, and create the first workspace
(`npm run bootstrap`). The [self-host quickstart](/docs/quickstart/self-host)
and [Self-hosting](../self-hosting.md) cover every step.

## Getting here

There is nothing to switch. To check the install:

```bash
usertasks-admin status    # every area: default
usertasks-admin doctor    # Supabase Auth health, storage probe, pg_cron jobs, last tick
```

## Trade-offs

- **Cost:** the Supabase plan, plus email volume. No other infrastructure.
- **Operations:** the least of any topology. Backups, upgrades and
  failover of the database are Supabase's job.
- **Latency:** put the app in, or next to, the Supabase project's region.
  Every API request makes database round trips.
- **Compliance:** your data sits in the Supabase project's region, covered
  by Supabase's certifications. Corporate SSO through SAML needs built-in
  auth (see [Hybrid](hybrid.md)).

## Data residency

Choose the project's region when you create it. Data tables, task data, run
history, the event stream and files all live there. Resend and your log
destinations receive copies of some data, so choose their regions as well.

## Failure domains

Two vendors: Supabase (the database, auth, storage, realtime and the
scheduler share one project) and Resend. A Supabase outage stops the app.
A Resend outage only delays email.

## When to move an area

Supabase only is a complete topology. If you'd like to use other services,
you can move each area whenever you're ready:

- You need files, email, secrets or sign-in under your own cloud account:
  go [Hybrid](hybrid.md), one area at a time.
- You run more than one app instance: `usertasks-admin switch cache --to
  postgres` (no extra service), so rate limits and revocations are shared.
- You need the database in your own account: plan a
  [single-cloud](README.md#comparing-the-topologies) or
  [on-premises](on-premises.md) topology.
