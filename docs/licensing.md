# Licences for paid extensions

UserTasks itself is open source (Apache-2.0) and needs no licence. Paid
extensions (SharePoint Server, the Infrastructure add-on) ship together in one
image, [UserTasks Enterprise](self-hosting.md#editions), which usertasks.com
lets you download with any valid licence for one of them. Each extension stays
switched off until its own **licence** enables it: on the Enterprise image,
installing another licence unlocks another extension, with no reinstall.
Without a licence, the Enterprise image behaves like the public image and lists
its extensions as "in this build, not licensed".

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

### For extension authors: features and limits

- Nodes, triggers, REST endpoints and MCP tools can name a licence
  `feature`; the framework checks it on every call (402 when it is missing).
- `ctx.licence.assert(feature)` throws the matching 402 error inside a
  handler; `ctx.licence.check(feature)` returns the decision.
- Limits: register a counter per limit key in the server module
  (`usageCounters: { 'sharepoint.farms': ({ ctx, unit }) => … }`; it runs
  instance-wide with the service-role client). Settings → Licence shows the
  usage, and `ctx.licence.assertLimit('sharepoint.farms', { unit: farmId })`
  refuses an addition over the limit. With `unit`, a unit that is already
  counted (the same farm connected again, from another workspace) adds
  nothing.

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

## Self-serve trials (30 days)

Paid extensions can declare a self-serve trial in their manifest (`licence.trial: { days, unit: 'farm' }`; today only the SharePoint extension, SKU `sharepoint-se`). A trial is an ordinary licence file with `"trial": true`, a `"sku"`, a term of at most 30 days and `"binding": { "farm_ids": ["<farm GUID>"] }` (plus `instance_ids` when the request came from an installation). It is installed, listed, warned about and expires like any licence. The user guide is the public docs page **SharePoint trial** (`/docs/sharepoint/trial`).

### The trial-only signing key

Trials are signed on usertasks.com with a **separate trial key**; the main licence key stays offline and is never needed. In the keyring (`lib/licensing/keyring.ts`) the trial key has `kind: 'trial'` and `trialSkus`. An installation accepts a licence signed by a trial key only when **all** of these hold (`lib/licensing/trial-policy.ts`), otherwise it gets the `trial_policy` problem and is refused (never installed, never granting anything):

- `trial: true`;
- `sku` is one of the key's `trialSkus` and has rules in `TRIAL_SKUS`, and the licence grants only that SKU's extension and only its limits;
- at most 30 days from `max(issued_at, not_before)` to `expires_at` (10 minutes clock skew), `issued_at` not in the future, `not_before` not before `issued_at`;
- bound to exactly one farm (`binding.farm_ids`, a GUID) with at most one farm in its limits.

Even a leaked trial key can therefore only mint 30-day, one-farm trials starting now. Retire it by removing its keyring entry (trial licences it signed then fail with `unknown_key`) and generating a new one.

**Owner steps (once):**

1. `npx tsx scripts/licensing/new-trial-key.ts --kid trial-1 --out ~/secure/usertasks-trial-1.pem` — writes the private key (mode 600, outside the repository, never over an existing file) and prints only the public keyring entry.
2. Set the private key as the Vercel production secret `TRIAL_LICENCE_SIGNING_KEY` (and `TRIAL_LICENCE_KID` if the kid is not the only trial key). Optional: `TRIAL_IP_SALT` for the stored IP hashes.
3. Paste the printed entry into `LICENCE_KEYRING` and release (installations must have the public key to accept trials).
4. Apply migration `20270117090000_licence_trials.sql` on the cloud database.

Until steps 2–4 are done the endpoint answers `503 trials_unavailable` ("Trials aren't available yet") and the website shows **Contact us** instead of the trial buttons. The issuer refuses to sign unless the key's public half matches a `kind: 'trial'` keyring entry, so it can never sign with a main key.

### Issuing (usertasks.com only)

`POST /api/public/trials/sharepoint` (cloud only; 404 elsewhere), JSON `{ name, email, company, farm_id | request_code, accept_terms, source?, website }` (`website` is a honeypot). `GET` answers `{ available }`.

- Work email only (free and disposable domains are refused: `lib/licensing/free-mail.ts`).
- Rate limits per IP: 5 an hour, 20 a day; 300 an hour for everyone.
- One trial per farm and per email domain (table `licence_trials`, unique per SKU): the same farm while its trial runs gets **the same licence back** (and it is e-mailed again to whoever started it); the same domain with another farm is refused while its trial runs; a farm or domain whose trial ended is refused (buy, or contact us).
- After the response (never blocking it): the licence is e-mailed to the requester (attached and pasted) and the team is notified through the shared team pipeline (`lib/contact/trial-chirp.ts`: ChirpMe sub-tab **Trials**, reply-to the requester, new vs re-sent).
- Instance admins of usertasks.com see every trial in **Settings › Licence › Trials issued**.

### Inside an installation

**Settings › Extensions** shows **Start a 30-day trial** on an unlicensed extension that offers one (self-hosted; instance admins). The server posts the request with a request code (farm ID, instance ID, hostnames; no secrets) to `USERTASKS_TRIAL_URL` (default `https://usertasks.com`, https only) and installs the returned licence through the normal install path (audited as `installed`). When usertasks.com can't be reached it shows the request code (`UTTRIAL1-…`) to paste on the website and a box to paste the licence back. `/settings/extensions?trial=<extension>&farm=<id>` opens the form pre-filled (the SharePoint add-in links here).

During a trial instance admins see "Trial: N days left · Buy" in the shell banner and on the extension card. Trial e-mails start 7 days before the end (7, 1, expired, stopped); the 30 / 14-day notices of paid licences are skipped.

### When a licence lapses: extension housekeeping

An extension job with `runWhenUnlicensed: true` still runs (in workspaces with the extension enabled) when the only problem is the licence, so the extension can give back what it changed outside UserTasks and put it back later. `ctx.licence.check()` says whether the deciding grant is a trial, its expiry, cutoff, days left and the farms it is bound to; `ctx.licence.pausedRuns()` / `resumePausedRuns()` count and resume the runs a lapsed licence paused (each resume audited on the run). `ServerExtension.licensing.notices` returns plain-language notes shown under the extension in Settings › Extensions. What the SharePoint extension does (forms restored, workflows paused, everything put back) is in the public **SharePoint trial** page.
