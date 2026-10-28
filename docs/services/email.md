# Choosing email

Every email the app sends goes through the email provider: invitations,
task notifications, the workflow **Send email** node and, with built-in
auth, confirmation and reset emails.

| Option | `EMAIL_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Resend | `resend` (default) | — | — | — | — | config |
| SMTP: Exchange, Postfix, any relay | `smtp` | yes | compatible: SES SMTP | compatible: Microsoft 365 SMTP AUTH | compatible: Workspace SMTP relay | config |
| Amazon SES (API) | `ses` | — | native: IAM role | — | — | config |
| Azure Communication Services Email | `azure_communication` | — | — | native: managed identity | — | config |
| Microsoft 365 / Exchange Online (Graph `sendMail`) | `microsoft_graph` | — | — | native: app registration or managed identity | — | config |
| Gmail API (Google Workspace) | `gmail` | — | — | — | native: domain-wide delegation | config |
| Console: log plus `.eml` files | `console` | yes | — | — | — | config |

## When to pick which

- **Resend** for the quickest start.
- **Your cloud's email service** (SES, ACS) when mail must come from your
  account and domain with no keys.
- **Microsoft 365 or Gmail** when mail must come from a real mailbox in
  your tenant.
- **SMTP** on premises, and as the universal fallback.
- **Console** for development, CI and air-gapped demos.

## Rules

- **SDKs:** `smtp` (nodemailer), `ses` and `azure_communication` need their optional SDK, included in the Docker image by default ([Optional drivers](../optional-drivers.md)).
- `EMAIL_FROM` is required by every provider except `resend` and
  `console`.
- With Supabase Auth, sign-in emails are Supabase's own. Configure its
  SMTP in the Supabase dashboard.
- `--test-to` sends a real message before the switch writes anything.

```bash
usertasks-admin switch email --to ses --set ses_region=eu-west-1 --set from='UserTasks <tasks@corp.example>' --test-to you@corp.example --yes
```

Reference: [Email](../infrastructure.md#email).
