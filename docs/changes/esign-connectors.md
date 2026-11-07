# Release notes: E-signature connectors

Six e-signature providers are now connectors with the same actions:
**DocuSign**, **Adobe Acrobat Sign**, **Dropbox Sign**, **PandaDoc**,
**SignNow** and **BoldSign**. A workflow sends documents or a template for
signature, waits until the envelope is completed, declined, voided or
expires, and continues with the outcome, the recipients and the signed PDF
stored as a workflow file. Docs: [E-signature](/docs/integrations/e-signature).

Database migration: `20261206000000_esign.sql` (send ledger, waits, webhook
delivery keys). See [Migrations](../migrations.md).

## Added

- **Connectors:** Adobe Acrobat Sign (integration key or OAuth; API access
  point discovered with `baseUris`), Dropbox Sign (API key or OAuth; test
  mode), PandaDoc (API key or OAuth), SignNow (service user or OAuth;
  sandbox environment) and BoldSign (API key; US or EU region). DocuSign is
  rebuilt on the same actions and gains **JWT Grant** (integration key, user
  ID, RSA private key), **account discovery** with `/oauth/userinfo`
  (account base URI auto-detected; Account ID optional) and a Demo /
  Production environment switch.
- **The same seven actions for every provider** (connector references, so
  they also work from Call Reference, agents, MCP, the API and the CLI):
  Send Documents for Signature, Send from Template, Get Envelope Status,
  Download Signed Document, Void / Cancel Envelope, Get Embedded Signing URL
  and List Templates. Status is normalized (`sent`, `delivered`,
  `completed`, `declined`, `voided`, `expired`) with per-recipient status,
  signed time and decline reason.
- **Workflow steps:** **Send for Signature** (documents — one or many,
  from attachments, generated files, storage references or URLs — or a
  template with role mapping and prefilled fields; recipients with role,
  signing order, copies and DocuSign anchor text; reminders, expiry,
  embedded signing, text tags; an Advanced JSON object for provider
  fields), **Wait for Signature** (pauses the run; branches on Completed /
  Declined / Voided / Expired / Timeout; stores the signed PDF and the
  certificate) and **E-signature Envelope** (status, download, void,
  signing URL, templates).
- **E-signature Event trigger:** start a workflow when an envelope is sent,
  viewed, signed by a recipient, completed, declined, voided or expires.
- **Template picker:** the designer searches the provider's templates and
  shows their roles.
- **Webhooks:** `/api/webhooks/esign/<provider>/<integration id>` for
  DocuSign Connect (HMAC), Acrobat Sign (client-ID handshake + URL token),
  Dropbox Sign (event hash), PandaDoc (HMAC), SignNow (HMAC) and BoldSign
  (timestamped HMAC). Every delivery is verified; replays are ignored;
  stale deliveries are refused; the workspace comes from the URL and the
  envelope's status is read back from the provider, never trusted from the
  payload.
- **Polling fallback:** the `esign-poll` scheduler job checks waiting
  envelopes every 5 minutes without webhooks (a 30-minute safety net with
  them), resumes final ones and times out waits.
- **Connection tests** call each provider's account endpoint through the
  same auth and discovery as the actions.

## Changed

- OAuth 2.0 connections can refresh at a separate endpoint (`refresh_url`,
  used by Acrobat Sign) and authenticate the client with HTTP Basic at the
  token endpoint (`client_auth: basic`, used by DocuSign and SignNow).
- API keys sent in the `Authorization` header keep an `API-Key` scheme
  (PandaDoc) instead of gaining `Bearer`.
- DocuSign references generated before this release (raw REST templates
  such as *Send Envelope for Signature*) keep working as they are;
  **Regenerate references** replaces them with the shared actions.

## Reliability and security

- **No duplicate envelopes:** each send claims a client reference (default:
  derived from the run, step and request) before calling the provider; a
  retried step returns the envelope already sent.
- Tokens refresh automatically; a 401 drops the cached token and retries
  once; 429 is retried after `Retry-After`, 5xx reads with backoff.
- No credentials in step outputs, logs or call logs; every call passes the
  egress guard.
