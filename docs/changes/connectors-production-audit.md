# Release notes: connectors production audit

All 44 built-in connectors, the reference runtime they share, OAuth and
credential handling were reviewed. Most connector failures came from the
shared runtime, so most fixes are there and apply to every reference
(connector-generated or hand-built).

## Security

- **Workflows go through the egress guard.** The Call Reference and HTTP
  Request nodes used to call any address, including private networks and
  cloud metadata endpoints. Every outbound integration call now checks each
  redirect hop. Private addresses still need `ALLOW_PRIVATE_EGRESS=true`, and
  metadata addresses stay blocked. Credentials are not forwarded when a
  redirect leaves the original host.
- **OAuth connect completes only for the user who started it.** The callback
  checks the signed-in user against the one who began the flow. An OAuth
  integration can only use token stores in its own workspace.
- **Testing a reference needs `integrations.test` or `integrations.edit`.**
  The old `{ url, integration_id }` form of `/api/integrations/test-reference`
  has been removed: it sent an integration's credentials to any URL.
- **Credentials stay on the server.** Integration and connector reads for the
  UI show stored secrets as `__SECRET__`. Edit forms send that value back to
  keep the stored secret. Execution results no longer include request
  headers.
- **Request templates are escaped.** In a path, an input is percent-encoded
  per segment, and `.` / `..` segments are rejected. Query and form values
  are encoded. In JSON bodies, string values are escaped, so a value can no
  longer add fields to the document. Line breaks are removed from header
  values.
- **More keys count as secrets.** `webhook_url`, `connection_string` and
  `*passphrase*` keys are now encrypted at rest and masked. Call logs also
  mask `sig=` and other credential query parameters, and any header whose
  name contains api-key, token, secret, signature or password.

## Reliability

- **Retries.** A call that gets 429 is retried for any method; 502, 503,
  504 and network errors are retried only for idempotent methods or requests
  that carry an `Idempotency-Key`. `Retry-After` is honoured. All attempts
  share one 30-second budget.
- **Size limits.** A JSON or text response can be up to 20 MB. A binary
  response can be up to 50 MB, and is stored as a workflow file (`{ _file,
  url, name, size, content_type }`) instead of being decoded as text.
- **Clear errors.** When a provider returns HTTP 400 or higher, the result
  carries `error_message` with the provider's message. A Slack-style
  `{ ok: false }` response is treated as an error too. The Call Reference
  node also logs a warning in this case.
- **Token mints.** Microsoft client-credentials, Box CCG, Google service
  account and refresh-token grants are minted at run time and cached per
  workspace. A token the provider rejects with 401 is minted again once.
  OAuth refreshes are single-flight. `invalid_grant` marks the connector as
  needing to be reconnected.
- **Connector settings reach templates.** Values such as account IDs,
  sender addresses and API versions are available as `{{placeholders}}`.
- **Paging.** An input named `next_link` can hold the provider's
  continuation URL. It must be on the integration's own host.

## Behaviour changes

- **Query parameters.** An input whose `{{placeholder}}` appears in the
  path, body or a header template is no longer also sent as a query
  parameter. A `name={{input}}` query or form pair is left out when the
  input is empty. An empty optional number input is left out instead of
  being sent as `0`.
- **Unquoted JSON placeholders.** An unquoted `{{x}}` in a JSON body becomes
  a JSON value: a number, boolean, array, object or a quoted string. When
  the value is empty, the member is dropped. For connector references, the
  input's declared type decides.
- **Text responses** are returned in full up to 1 MB as `{ _raw }`. Earlier
  versions cut them at 5 KB. In workflows, `_text` is also set.
- **Regenerate references** updates references in place and keeps their IDs,
  so workflows that use them keep working.
- **Connector references stay current.** A generated reference that has
  never been edited now follows the connector's current template.
  References generated before this release need **Regenerate references**
  once to pick up the fixes.
- **Database references in workflows** run through the same executor as
  tests and agents. Database connector references now work in Call
  Reference nodes. Workflows still receive a row array.
- **Private networks.** Workflow HTTP Request nodes and database or SFTP
  references whose host is a private, loopback, `.local` or `.internal`
  address now need `ALLOW_PRIVATE_EGRESS=true`. The host is checked on every
  call.
- **Custom SQL.** A `{{token}}` in hand-written SQL is now bound as a value
  unless it names a structural input (`table`, `columns`, `where_clause`,
  `order_by`, `sql` and the like). Inputs that name tables, columns or
  clauses are validated. On SQL Server, `@name` values are real parameters.
  A string input that holds digits and is used in `TOP (@x)` or
  `OFFSET @x` must now be typed number. PostgreSQL runs one statement per
  call. The list and get templates run read-only. Results are capped at
  `DB_MAX_ROWS` (default 5000).
- **MongoDB.** Invalid filter JSON is now an error; it used to match
  everything. An empty-filter delete-many or update-many needs `allow_all`.
  Credentials typed into the connection string move to the encrypted
  credentials when the row is read. They stay in plaintext in the stored row
  until the connector is saved again.
- **SFTP** (it never worked before) needs a host key fingerprint, which
  **Test connection** shows.
- **Stripe** requests carry an idempotency key and the pinned
  `Stripe-Version: 2025-09-30.clover` once the connector is saved again. The
  subscription period fields are now under `items.data.0`.
- **Renamed settings.** Workday `default_tenant` is now `tenant`; old values
  still work. Slack `default_channel` is now `channel`.
- **Removed operations** that could not work: n8n execute and trigger webhook
  (the latter sent the API key to the webhook), UKG authenticate and BI
  report, Gmail delete (it needs full mailbox scope), SAP client-certificate
  auth. Existing references for these keep failing until they are deleted or
  regenerated.

## Connectors

- **Microsoft 365 / Azure / AWS:**
  - Exchange, OneDrive, SharePoint and Dataverse mint tokens at run time and
    follow `@odata.nextLink`.
  - Teams posts Adaptive Cards to Workflows webhooks; the URL is stored as a
    secret.
  - Azure OpenAI uses the v1 API with the configured deployment.
  - The S3 signature works for any key name. S3 lists page with continuation
    tokens, and a presigned-URL template is added.
- **Google, Box, Dropbox:**
  - Firebase uses the right base URL.
  - The Gemini key is sent as a header.
  - Drive pages and supports shared drives.
  - Box uses CCG and upload.box.com.
  - Dropbox renews its token with the refresh token and uses its content
    host.
- **CRM / ERP / ITSM / messaging / payments / AI:**
  - Jira uses `/search/jql`.
  - Slack files upload uses the v2 flow.
  - Twilio Verify and Lookups go to their own hosts.
  - SAP OData fetches a CSRF token before writes.
  - Salesforce, ServiceNow, Workday and DocuSign can renew tokens with a
    refresh token.
  - AI connectors use current models with typed parameters.
- **Databases:** see the behaviour changes above. Snowflake supports key-pair
  sign-in. The SFTP connector is new.
- **Test connection** now checks the credentials of every connector, not just
  that the base URL answers.

## New settings

`DB_MAX_ROWS`, `SFTP_MAX_BYTES` and `SFTP_ALLOW_UNPINNED_HOST_KEYS` (see
`.env.example`).
