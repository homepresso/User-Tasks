# Licences for paid extensions

UserTasks itself is open source (Apache-2.0) and needs no licence. Paid
extensions (for example SharePoint) ship in the Enterprise build but stay
switched off until a **licence** enables them. Without one, the Enterprise
build behaves like the Community edition and lists the extensions as
"available, not licensed".

This page covers self-hosted and air-gapped installs (licence files) and the
hosted cloud (workspace entitlements).

## The licence file

A licence is one JSON file (`.licence`), signed by UserTasks with Ed25519:

```jsonc
{
  "format": 1,
  "kind": "usertasks.licence",
  "licence_id": "lic_6fc6128f81f957a82ec7",
  "customer": { "name": "Example Corp" },
  "issued_at": "2026-11-12T00:00:00.000Z",
  "expires_at": "2027-12-31T00:00:00.000Z",
  "updates_until": "2027-12-31",
  "binding": { "instance_ids": ["inst_…"], "hostnames": ["usertasks.corp.example"] },
  "extensions": [{ "id": "sharepoint", "features": ["connector", "importers"], "limits": { "farms": 2 } }],
  "limits": { "sharepoint.active_users": 500 },
  "kid": "lic-2026-1",
  "signature": { "alg": "ed25519", "kid": "lic-2026-1", "value": "…" }
}
```

- **Signature.** The server checks the signature offline against the public
  keys built into UserTasks (`lib/licensing/keyring.ts`), picked by key id
  (`kid`). Any change to the file breaks the signature. A licence signed with
  a key this version does not know is refused (`unknown_key`).
- **Binding.** A licence can be bound to this installation's **instance id**
  and/or **hostname** (the host of `APP_URL`). Either match is enough. Trial
  licences are usually unbound.
- **Extensions and features.** Each extension lists the features it grants.
  No list, an empty list or `"*"` grants every feature.
- **Limits.** Numeric limits, named `<extension>.<limit>`. SharePoint is
  licensed per farm: `{ "sharepoint.farms": 2 }`. A limit is checked when
  something is added (a third farm is refused), never retroactively.
- **`updates_until`** is the newest extension release the licence covers.

## Install a licence

Any of these works. Licences from every source count together.

**Settings → Licence** (instance admins: `INSTANCE_ADMIN_EMAILS` or
`usertasks-admin instance-admins add <email>`). Upload the file or paste it.
The page shows the instance id, licensed extensions with an expiry countdown,
limits and current usage, and warnings.

**Admin CLI**, on the server:

```bash
usertasks-admin licence install ./example.licence
usertasks-admin licence status            # or --json
usertasks-admin licence remove lic_6fc6128f81f957a82ec7
usertasks-admin licence remove --all
```

**Environment**, useful with Helm and Kubernetes secrets:

| Variable | Value |
|----------|-------|
| `USERTASKS_LICENCE` | The licence JSON, its base64, or a `secret://<name>` reference resolved through the configured secrets provider |
| `USERTASKS_LICENCE_FILE` | Path to a licence file, for example a mounted secret |

The US spellings `USERTASKS_LICENSE` and `USERTASKS_LICENSE_FILE` also work.
To remove a licence that came from the environment, unset the variable.

**API** (instance admin token, `Authorization: Bearer $INSTANCE_ADMIN_TOKEN`):

| Method | Path | |
|--------|------|-|
| `GET` | `/api/v1/licence` | Status: licences, extensions, limits and usage, warnings |
| `PUT` | `/api/v1/licence` | Install or replace: `{ "licence": "<file contents>" }` |
| `DELETE` | `/api/v1/licence?licence_id=…` (or `?all=true`) | Remove |
| `GET` | `/api/v1/licence/request` | Offline activation request |
| `GET` / `PUT` | `/api/v1/licence/entitlements` | Cloud workspace entitlements: list, grant |
| `DELETE` | `/api/v1/licence/entitlements/{tenant_id}/{extension_id}` | Remove an entitlement |

The `usertasks` CLI has the same commands (`usertasks licence status`,
`usertasks entitlements list`, …) when it uses the instance admin token.

Installing checks the signature, key id, binding and dates. An invalid,
foreign or expired licence is refused. A licence with the same `licence_id`
replaces the installed one. Running app processes pick up a change within a
minute.

## Offline activation (air-gapped)

1. On the server: `usertasks-admin licence request` writes
   `usertasks-licence-request-<instance id>.json` with the instance id,
   hostnames and version. (Settings → Licence → **Download activation
   request** does the same.) It contains no secrets and no usage data.
2. Carry the file to any connected machine and upload it in the licensing
   portal.
3. Carry the licence file back and install it (`usertasks-admin licence
   install <file>`).

## Renewal

Install the renewed licence the same way, before the old one expires. A
licence with a new `licence_id` sits beside the old one until you remove the
old one. The extension uses whichever usable licence lasts longest.

## Warnings before expiry

- **30 days before expiry**: a banner for instance admins in the app, and
  warnings in Settings → Licence and `usertasks-admin licence status` /
  `usertasks-admin status`.
- **Email** to instance admins at 30, 14, 7 and 1 days before expiry, at
  expiry, and when the extensions stop. The daily `licence-check` job sends
  them (06:00 UTC; also `GET /api/cron/licence-check`). Each notice is sent
  once.

## What happens at expiry

**The licensed extensions stop 24 hours after the licence expires.** There is
no longer grace period.

| When | What happens |
|------|-------------|
| Before `expires_at` | Everything works |
| From `expires_at` until 24 hours later | Everything still works. The banner turns red and shows when the extensions stop |
| 24 hours after `expires_at` | The extension's licence check returns **expired**. Its triggers no longer start runs, and new runs of workflows that use its steps don't start (a queued start fails its job with `extension_licence_expired`; Workflow queue → Retry starts it after renewal). Publishing a workflow that uses its steps is refused, and running its importers is locked. Its API routes, MCP tools and public routes return **402** `extension_licence_expired` |

**Runs already in progress.** If a run reaches one of the extension's steps
after the cutoff, that step fails with the error `extension_licence_expired`
("licence expired"). The error is marked **retryable**: the run is not failed
but **paused at that step**, with the reason on the run. Its data, variables
and earlier steps are kept. After you install a renewed licence, resume the
run (Runs → Resume, `POST /api/v1/workflows/runs/{id}/action` with
`{"action":"resume"}`, or MCP) and it runs that step again and continues.
Resuming before renewal pauses it again. Nothing is deleted at expiry, and
data the extension created stays readable.

> This is the current policy. The owner may revisit how in-flight runs are
> handled (for example, letting runs that started before the cutoff
> complete).

Other errors: an extension with no licence returns **402**
`extension_not_licensed`. Going over a limit returns **402**
`extension_limit_reached`.

## Hosted cloud: workspace entitlements

In the cloud, paid extensions are switched on per workspace by rows in
`tenant_entitlements` (migration `20270112000100_licensing.sql`). Instance
admins manage them for now. A billing integration can write them later, with
`source = 'stripe'`.

```bash
usertasks-admin entitlements grant --tenant <workspace id> --ext sharepoint \
  --until 2027-12-31T00:00:00Z --limits sharepoint.farms=2 [--features connector,importers]
usertasks-admin entitlements list [--tenant <id>] [--ext sharepoint] [--json]
usertasks-admin entitlements revoke --tenant <workspace id> --ext sharepoint
```

The same 24-hour rule applies after `ends_at`. A self-hosted licence covers
every workspace on the installation.

## Audit

Licence events are recorded in `licence_events`: install, replace, remove,
expiry notices, denied checks and entitlement changes. Events about one
workspace also go to that workspace's audit log (`audit.licence.*` in log
export). Denied checks are recorded at most once an hour per workspace,
extension and state.

## For UserTasks staff: issuing licences

`scripts/licence-issue.ts` signs licences with a private key that is read at
run time and is never kept in the repository:

```bash
tsx scripts/licence-issue.ts keygen --kid lic-2027-1 --out ~/secure/lic-2027-1.pem   # then add the printed entry to lib/licensing/keyring.ts
tsx scripts/licence-issue.ts sign --key ~/secure/lic-2026-1.pem --kid lic-2026-1 \
  --customer "Example Corp" --expires 2027-12-31T00:00:00Z \
  --ext sharepoint:connector,importers --limit sharepoint.farms=2 \
  --request usertasks-licence-request-inst_….json --out example.licence
tsx scripts/licence-issue.ts verify example.licence
```

You can also pass the key as `USERTASKS_LICENCE_SIGNING_KEY_FILE` or
`USERTASKS_LICENCE_SIGNING_KEY`. To rotate keys, add the new key with a new
`kid` and keep the old entry until every licence signed with it has expired.
