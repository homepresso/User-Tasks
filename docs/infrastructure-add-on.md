# Infrastructure add-on

UserTasks runs on a **standard stack** out of the box. Moving services off that
stack, one at a time, is the **Infrastructure add-on**: a paid extension,
licensed per deployment at **$9,000 USD per deployment per year**.

## What is free

The open-source edition **runs any configuration**. Every runtime provider is
part of the free core: PostgreSQL or Supabase for the database, built-in,
Supabase, OIDC or SAML sign-in, local, S3, Azure Blob, Google Cloud Storage or
Supabase files, Server-Sent Events or Supabase live updates, pg_cron, the
built-in worker or an external scheduler, every email provider, secret store,
cache and KMS. These are free too:

- the two standard stacks, installed with the one-line installer, the Windows
  installer or Docker Compose:
  - **bundled**: PostgreSQL, built-in sign-in, files (a local folder or the
    bundled MinIO), live updates, the worker and the cache, all installed with
    UserTasks (`--preset standalone`);
  - **Supabase**: a Supabase project holds the database, sign-in, files and
    live updates;
- configuring those stacks:
  - email through SMTP (including Microsoft 365 and Exchange), Resend or
    log-only;
  - identity providers (Entra ID, AD FS, Okta, Keycloak, any OIDC or SAML
    provider) on built-in sign-in;
  - directory (LDAP) sign-in;
- Settings → Infrastructure as a status page, with health checks and the
  switch log (read-only);
- `usertasks-admin status`, `providers`, `doctor`, `history` and
  `kms rotate|rewrap`.

## What the add-on adds

- **Provider switches**, from Settings → Infrastructure or
  `usertasks-admin switch`, for the database, sign-in, files, live updates,
  background jobs, email APIs (Amazon SES, Azure Communication Services,
  Microsoft Graph, Gmail), the secret store, the cache and the KMS.
  - Every switch tests the connection and shows its plan before anything
    changes.
  - Data moves (database copy, user accounts with their passwords, files with
    URL rewriting) run in the background with progress.
- **Backups and rollback**: a backup before every move, the switch log with
  Cancel, Retry and Rollback, and `usertasks-admin rollback`.
- **Settings of the other areas** from the page: storage, scheduler, cache,
  secret store and KMS options.
- **Moving off Supabase** in the setup wizard: the moves in a safe order.
- **Installing onto separated services**: your own or a managed PostgreSQL,
  your own bucket, SSO-only sign-in, an email API and so on, written by the
  installers.

## Installs that already moved services

Installs separated with v0.2.0 or v0.3.0, when these tools were free, keep
running and upgrade without a licence. Core runs their configuration as before.
The add-on is needed only to make further changes: switch another service,
roll back, or run a switch again.

## Licence and expiry

The add-on uses the standard extension licensing:

- extension `infrastructure`, SKU `infrastructure`, feature
  `infrastructure-separation`;
- install the licence in **Settings → Licence**, or with
  `usertasks-admin licence install <file>`, or set `USERTASKS_LICENCE_FILE`;
- licences are checked offline, so air-gapped installs work.

When a licence expires, the add-on stops 24 hours later. That stops
**changes** only: the running providers are never touched. A queued switch
waits, and the old provider stays active until the switch ends, until a
licence is installed again.

## At install time

The installers offer your own services but need the Infrastructure licence
file before they write a separated configuration. The same `--licence` file
also picks the [UserTasks Enterprise](self-hosting.md#editions) image, which
contains the add-on (and every other paid extension, each locked until its own
licence), and covers other add-ons in the licence:

```bash
curl -fsSL https://usertasks.com/install.sh | sh -s -- --preset postgres --licence ./usertasks.licence
```

`usertasks-admin install profile validate|write|apply` check the licence
offline before they write anything:

- the signature against the keys built into UserTasks;
- the dates;
- the extension and feature;
- the licence's binding to the install's address.

A licence bound only to an instance id can't be checked before the instance
exists. In that case, install the standard stack first, then install the
licence and change providers in Settings → Infrastructure.

Re-running an installer (`usertasks config`) with services the install
already uses needs no licence.

## Getting it

1. Get the add-on and a licence: [contact us](/contact).
2. Already on UserTasks Enterprise (one image with every paid extension, for
   example because you use SharePoint)? Install the licence in Settings →
   Licence: the add-on unlocks, **no reinstall**.
3. On the public image? Switch once, data kept:
   `usertasks upgrade --edition enterprise --licence ./usertasks.licence`
   (PowerShell: `-Edition enterprise -Licence …`). Settings → Extensions shows
   which edition runs and whether the add-on is in this build and licensed.

The add-on's page is **Infrastructure changes** (`/x/infrastructure`); the
**Change…** buttons in Settings → Infrastructure open it.

The separate [Processing add-on](/docs/self-hosting/infrastructure#processing-tier), for
separate processing workers and remote runners, is a different paid extension
at $2,500 USD per deployment per year.

## A note on open source

The core is open source (Apache-2.0). Its runtime can be pointed at other
services by editing the environment by hand. The add-on is the supported,
tested way to change providers: checks, backups, data copies, rollback and the
installers.
