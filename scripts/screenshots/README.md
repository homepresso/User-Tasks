# Docs & marketing screenshots

Scripts that seed a realistic demo workspace ("Northwind Trading") on a **local** stack and capture
the app and CLI screenshots in `public/screenshots/`.

> **Never point these scripts at a real project.** They create data, mint an API key with the
> service role and start workflow runs. `seed-demo.ts`, `capture.ts` and `terminal.ts` refuse to run
> unless `NEXT_PUBLIC_SUPABASE_URL` and the app URL are `localhost` / `127.0.0.1`.

| File | What it does |
|---|---|
| `mock-services.mjs` | Mock "Northwind ERP" REST API (`GET /vendors/:id`, `POST /payments`), a Splunk HEC endpoint and a webhook receiver on `127.0.0.1:4010` |
| `seed-demo.ts` | Creates the tenant if missing, mints an API key (→ `.out/api-key.txt`, git-ignored), then seeds everything through `/api/v1`: integration + references, decision table, email template, custom step, data table, 4 workflows (one, "Customer welcome pack", with three typed inputs for the Run dialog), runs/tasks, a newer "Vendor onboarding" version its runs are not on (for the migration shots), report, role, team, invitation, log destinations |
| `capture.ts` | Signs in as the demo owner and writes the app screenshots (`designer.webp`, `run-detail.webp`, …; `theme-designer[-dark].webp` edit an unsaved draft, so the demo theme is not changed; `live-instances`, `migrate-instances[-review].webp` stop at the migration plan, so nothing is migrated; `run-workflow.webp` fills the Run dialog without starting a run) |
| `terminal.ts` | Runs the real `usertasks` CLI, redacts secrets, renders each session as a terminal window → `cli-*.webp`, and saves the transcripts to `transcripts/*.txt` |
| `common.ts` | Shared helpers (local-only guard, API client, demo constants) |

## Prerequisites

1. Local Supabase stack running (`supabase start`) with all migrations applied.
2. The app running against it as a **production build** on a local port, e.g.
   `npm run build && npx next start -p 3100`, with:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local stack)
   - `NEXT_PUBLIC_APP_URL=http://localhost:3100`
   - `CRON_SECRET` (any value; the scripts call the queue processor and log shipper with it)
   - `ENCRYPTION_KEY` (64 hex chars)
   - `ALLOW_PRIVATE_EGRESS=true` (the mock services listen on 127.0.0.1)
3. The same variables exported in the shell that runs the scripts (plus `DEMO_APP_URL` if the app is
   not on `NEXT_PUBLIC_APP_URL`).
4. Browser tooling outside the repo (no devDependency is added): install `playwright-core` in a
   tools dir and point `SCREENSHOT_TOOLS_DIR` at it. System Google Chrome is used (`channel: "chrome"`),
   so no browser download is needed. `sharp` comes from the repo's `node_modules`.

   ```sh
   mkdir -p /tmp/shots-tools && (cd /tmp/shots-tools && npm init -y >/dev/null && npm i playwright-core)
   export SCREENSHOT_TOOLS_DIR=/tmp/shots-tools
   ```
5. `jq` on `PATH` (used in the CLI workflow-edit session).

## Run

From the repo root, with the env above exported:

```sh
node scripts/screenshots/mock-services.mjs &        # keep running for all steps
npx tsx scripts/screenshots/seed-demo.ts             # ~45 s (one invoice run waits for a 30 s ERP timeout)
npx tsx scripts/screenshots/terminal.ts              # cli-*.webp + transcripts/*.txt
npx tsx scripts/screenshots/capture.ts               # app screenshots
```

Capture a subset by name: `npx tsx scripts/screenshots/capture.ts designer reports`,
`npx tsx scripts/screenshots/terminal.ts cli-login cli-crud`.

Demo login: org `northwind-trading`, `ada@northwind.example` / `demo-password-2026`.

## Re-running

- `seed-demo.ts` is idempotent (find-or-create by name). Workflows are only re-saved and
  republished when their definition in the script changes.
- Runs are only started when the "Invoice approval" workflow has none. `--reset-runs` deletes the
  demo workflows' runs, queue jobs and tasks and starts a fresh batch; `--more-runs` adds a batch.
- Delete `.out/browser-state.json` (or set `FRESH_LOGIN=1`) if the saved browser session expires.
- Run `terminal.ts` before `capture.ts` if you want the designer badge to show the version the CLI
  session just published. The CLI sessions clean up what they create (role, email template, extra
  log destination) except the published workflow version.
- Images are WebP (quality 80 → 60, effort 6) at deviceScaleFactor 2 (1.5 if still > 250 KB).
  `SCREENSHOT_DEBUG_DIR=<dir>` also writes the raw PNGs.

## Notes on app behaviour these scripts rely on

- **User Task steps** create their task with `tasks.workflow_id` (migration
  `20261030000000_tasks_workflow_id.sql` — apply it to the local stack). The earlier workaround that
  mirrored the demo workflows into `workflow_sources` is gone; `--reset-runs` deletes tasks by
  `workflow_id`.
- **CSP:** `connect-src` is derived from `NEXT_PUBLIC_SUPABASE_URL` at build time (`lib/csp.ts`), so a
  production build against `http://127.0.0.1:54321` signs in; `capture.ts` no longer needs
  Playwright's `bypassCSP` (rebuild the app if it predates that change).
- `call_reference` (like `http_request`) stores an HTTP 4xx/5xx response and its `status` instead of
  failing the step — workflows branch on `{{status}}`. To get one genuinely failed run, the mock
  hangs for vendor `V-1099` past the engine's 30 s timeout (a transport failure fails the step).
- The "Email requester" step has `onError: continue` because local stacks have no `RESEND_API_KEY`.

## Packages

`packages.ts` captures the Packages docs screenshots (`packages-*.webp`). They need a second, *target*
workspace that installed a package built in the demo workspace:

1. In the demo workspace build a package from "Invoice approval" (add the Vendors table with rows):
   `usertasks packages create …`, `packages add …`, `packages build invoice-approval --out invoice-approval-1.0.0.utpkg`.
2. Create a target workspace with an owner (e.g. `npx tsx scripts/bootstrap-tenant.ts`) and an API key for it, then
   `usertasks packages install invoice-approval-1.0.0.utpkg --keep-incomplete --yes` against it.
3. Capture (each phase signs in with system Chrome like `capture.ts`):

```sh
export PKG_TARGET_SLUG=<target org slug> PKG_TARGET_EMAIL=<owner email> PKG_TARGET_PASSWORD=<password>
PKG_WORKFLOW_ID=<installed workflow id> \
PKG_REQUIREMENT_VALUES='{"integration_auth:integrations:<id>":{"config.auth_config.token":"…","config.base_url":"http://127.0.0.1:4010"}}' \
  npx tsx scripts/screenshots/packages.ts incomplete   # banner, library (incomplete), Complete setup — submits it
# change a step in the demo workspace and build the next version, then:
PKG_FILE=invoice-approval-1.1.0.utpkg npx tsx scripts/screenshots/packages.ts upgrade   # wizard steps, not applied
npx tsx scripts/screenshots/packages.ts authored    # Authored tab and editor in the demo workspace
```

## Forms screenshots

`forms-*.webp` (the /forms page and /docs/tasks/forms) were captured by hand from the same demo workspace,
at 1440×900 CSS px, deviceScaleFactor 2 (the phone shot at 390×844, factor 3, resized to 780 px wide), light
theme, WebP quality 80. They use a reusable form "Customer return" (lookup on the Customers table, three-column
rows, an Attachments field, a header with the workspace logo, a custom mini theme and a success screen) and a
workflow "Customer return" with a Form submitted trigger, a loop over the files, a condition and a User Task.
The form page link in `forms-trigger.webp` shows a placeholder public URL (`https://tasks.northwind.example`).
