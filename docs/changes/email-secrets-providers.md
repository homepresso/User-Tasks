# Release notes: email and secrets providers

App email no longer needs Resend, and provider credentials no longer need to
sit in environment variables. Nothing changes unless you opt in: Resend and
environment variables stay the defaults.

## Added

- **`EMAIL_PROVIDER`**: `smtp` (any relay — Exchange, Postfix, Microsoft
  365, Google Workspace SMTP relay — with implicit TLS or STARTTLS, auth and
  certificate checks), `ses` (Amazon SES), `azure_communication` (Azure
  Communication Services, connection string or managed identity),
  `microsoft_graph` (Graph `sendMail`, client secret or managed identity),
  `gmail` (Gmail API with domain-wide delegation) and `console` (log +
  `.eml` files). See [Infrastructure and providers](infrastructure.md#email).
- **`EMAIL_REPLY_TO`**: default Reply-To for app email.
- **`SECRETS_PROVIDER`**: `env` (now also `<VAR>_FILE` and a secrets
  directory), `db` (encrypted instance settings), `supabase_vault`,
  `hashicorp_vault` (also OpenBao; token, AppRole and Kubernetes auth),
  `azure_key_vault`, `gcp_secret_manager` and `aws_secrets_manager`.
- **`secret://<name>[#field]` references** in any provider option (env
  variable or instance setting), resolved at runtime with a cache
  (`SECRETS_CACHE_TTL_SECONDS`, default 300 s) so rotations are picked up
  without a restart. See [Secrets](infrastructure.md#secrets).
- **`ENCRYPTION_KEY` from the secret store**: `ENCRYPTION_KEY=secret://…`,
  or the store's `encryption_key` when the variable is unset.

## Changed

- Every app email goes through the email provider (`lib/email.ts`); the
  Resend path sends exactly as before.
- Instance settings refuse plaintext credentials for email and secrets
  options too (storage already did); `secret://` references are accepted
  as plain values.
- The secrets provider id `supabase-vault` (reserved, never implemented) is
  now `supabase_vault`.

## Upgrade

No migration. To switch, set the variables and restart.
