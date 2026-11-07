# Release notes: Anonymous forms (public form links)

A reusable form can now take responses from people who don't have an
account: contact forms, public sign-ups, feedback surveys. The form gets an
unguessable public link, `/p/<token>`, that anyone can open and submit
without signing in. It is off everywhere until an admin allows it for the
workspace and a designer turns it on for the form.

## Added

- **Settings → Forms → Anonymous forms** (Edit settings): **Allow anonymous
  forms**, off by default. Turning it off stops every public link of the
  workspace at once. Optional **bot protection**: Cloudflare Turnstile or
  hCaptcha, with site key and secret key. The secret is write-only and
  stored encrypted. Without it, no third party is ever called.
- **Anonymous responses** in a form's **Details** (Edit forms):
  - **Allow anonymous responses**, off by default. Turning it on needs the
    workspace switch. A warning shows what anonymous visitors can and can't
    do, and what this form would not give them.
  - The public link, with **Copy**, **QR code** and **Regenerate**.
    Regenerating makes a new link, and the old one stops working at once.
  - The visitor limits: per visitor per minute, daily cap, minimum fill
    time, uploads (size and count), and search-engine indexing.
- **QR dialog**: switch between the signed-in link (`/f/<id>`) and the
  public link. The link builder fills in URL parameters for either.
- **Allow anonymous read** on Lookup and Data table fields, including API
  sources. Off by default, so anonymous visitors see nothing there. With it
  on, anyone with the link reads only the field's declared columns, within
  its base filter. Pages are capped at 25 rows and lookups at 20 results.
- **Allow for anonymous** on server steps: rule and button **Call an API
  reference**, **Apply table changes** and **Start workflow**, and a bar
  button's **Start workflow** / **Apply table changes**. Off by default:
  public links skip the step.
- **Submissions**:
  - Anonymous submissions are stored with `source: 'anonymous'` and no
    submitter.
  - In the submission metadata, `{{submission.source}}` is `anonymous` and
    `{{submission.submitted_by}}` is `{ id: null, name: "Anonymous",
    email: null }`. The server sets both.
  - They appear in the Submissions list (new filter **Public link
    (anonymous)**), CSV exports, retention and legal holds.
  - The **Form submitted** trigger runs as usual. The run has no
    `started_by`, `{{workflow_started_via}}` is `anonymous`, and the runs
    list marks it **Anonymous**.
- **API, MCP and CLI**:
  - REST: `GET|PATCH /api/v1/forms/{id}/anonymous`,
    `POST /api/v1/forms/{id}/anonymous/regenerate` and
    `GET|PATCH /api/v1/anonymous-forms`.
  - MCP: `forms_anonymous_get`, `forms_anonymous_update`,
    `forms_anonymous_regenerate`, `anonymous_forms_settings_get` and
    `anonymous_forms_settings_update`.
  - CLI: `usertasks forms anonymous|anonymous-set|anonymous-regenerate` and
    `usertasks anonymous-forms get|update`.
  - The public submit endpoint (`/api/public/forms/<token>/…`) serves only
    the form page. It is not part of `/api/v1`.

## What anonymous visitors can and can't do

- **Can**: open that one form and submit it.
- **Can't**, unless you allow it on the specific field or step:
  - read any lookup, Data table or API source;
  - run any server step;
  - upload files. When the form allows uploads, they are limited to PDF,
    image, text and CSV files, at most 4 MB each and 10 per submission,
    checked like every upload and tied to the visit.
- **Never**:
  - custom-control capabilities (lookup, files, reports, network). Controls
    run in the sandboxed frame without them;
  - people search or `{{user.*}}`, which is empty;
  - Home, the Forms menu, favourites, drafts or resume-later;
  - any other form or workspace data.
- **Dropped before validation**: values for sources, people fields or
  uploads the visitor can't legitimately have. A crafted value therefore
  can't be tested against your data.

## Abuse protection

- Per-IP-per-form rate limit and a per-form daily cap, counted in the
  shared cache provider and in Postgres, so they hold across instances.
  Over the limit, the request gets a 429 with Retry-After.
- A hidden honeypot field. When a bot fills it in, it sees "Submitted." and
  nothing is stored.
- A signed, timestamped render ticket that enforces the minimum fill time
  and expires after 24 hours.
- Optional Turnstile / hCaptcha, verified on the server.
- JSON-only public endpoints with body size caps, plus idempotency keys.
- For abuse review, each anonymous submission keeps a keyed hash of the IP
  (16 hex characters, never the IP) and the user agent cut to 120
  characters (`form_submissions.anonymous_meta`).

## Threat model

- **The visitor is untrusted and unauthenticated.** All they hold is the
  token: 32 random bytes, base64url.
- **The link reveals nothing.** Form ids are not in it, so forms can't be
  enumerated. Every unavailable link answers the same 404, so probing tells
  an attacker nothing. The page sends `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` and, by default, `noindex`.
- **The server decides everything from the saved form.** The tenant is the
  form's. The actor is a dedicated anonymous context (`authKind:
  'anonymous'`, no user, permissions = `forms.submit` only), never a
  session and never an ungated system context.
- **Every request is checked against the token.** Each public endpoint
  resolves the token first and passes the form id it resolved to, and each
  service re-checks it. A crafted form id, field definition,
  `__form_state`, parameters, variables or control state therefore can't
  reach another form, field, source or step.
- **Service-role access goes through the explicit allowlist only.** Every
  query is tenant-filtered, and each per-source and per-step opt-in is read
  from the saved form.
- **The tokens are unreadable to clients.** They live in
  `form_anonymous_access`, which has RLS on and no grants to `anon` or
  `authenticated`. No anonymous database grants were added.
- **The CSP is unchanged.** Public pages only add the captcha provider's
  hosts. Custom controls get no approved network hosts there.
- **Residual risks**:
  - spam within your limits (lower them or add bot protection);
  - data and steps you deliberately opened;
  - links shared further than intended (regenerate to revoke).

## Upgrading

Apply `supabase/migrations/20261219000000_anonymous_forms.sql` before you
deploy the code. It is additive and idempotent:

- `form_anonymous_access` (service role only);
- `form_submissions.source` allows `anonymous`, plus `anonymous_meta` and a
  partial index for the daily cap;
- `form_files.upload_session`.

The workspace switch lives in `tenants.settings.forms.anonymous`, and every
switch starts off. Nothing changes until an admin and a designer opt in.

Self-hosted: put the app behind a proxy that sets `X-Forwarded-For` (the
per-IP limit reads it), and set `ENCRYPTION_KEY` (it keys the IP hash, the
render tickets and the captcha secret).
