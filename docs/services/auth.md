# Choosing auth

The auth provider decides who may sign in, and how. Every sign-in runs on
the server, and the session lives in httpOnly cookies. Invitations, API
keys, OAuth clients and directory sync work the same with every provider.

| Option | `AUTH_PROVIDER` | On-prem | AWS | Azure | Google Cloud | Switch |
|---|---|---|---|---|---|---|
| Supabase Auth: passwords, Google and Microsoft set up in Supabase | `supabase` (default) | — | — | — | — | data |
| Built-in: passwords in the app's Postgres, plus any OIDC / SAML IdPs | `builtin` | yes | native: `cognito` preset | native: `entra` presets | native: `google` preset | data |
| OIDC only | `oidc` | yes, with Keycloak, Authentik, Zitadel, Dex or AD FS | native: Amazon Cognito (`cognito` preset, `cognito:groups` → roles) | native: Entra ID, Entra External ID | native: Google / Workspace | data |
| SAML only | `saml` | yes, with AD FS, Keycloak or Shibboleth | — | native: Entra ID enterprise app | native: Workspace SAML app | data |

OIDC presets: `entra`, `entra_multitenant`, `entra_external_id`, `google`,
`okta`, `auth0`, `keycloak`, `authentik`, `zitadel`, `dex`, `adfs`,
`cognito` and `generic`. SAML presets: `adfs`, `entra`, `okta`, `google`, `keycloak`,
`shibboleth`, `onelogin` and `pingfederate`.

## When to pick which

- **Supabase Auth** when the database is on Supabase and Google or
  Microsoft sign-in is enough.
- **Built-in** when you need corporate SSO next to passwords, LDAP bind
  login, or the database on your own PostgreSQL. It is the most flexible choice.
- **`oidc` / `saml`** when everyone must come through your IdP and nobody
  should have a password.

## Rules

- **SAML** needs the optional package `@node-saml/node-saml`, always in the Docker image ([Optional drivers](../optional-drivers.md)).
- **Everyone signs in again** after an auth switch. Passwords carry over
  (Supabase and built-in both use bcrypt), and user ids, memberships and
  identities are copied.
- **Built-in auth on the Supabase database** needs `SUPABASE_JWT_SECRET`
  (PostgREST and Supabase Realtime then accept the app's sessions) and
  `DATABASE_URL` for the `app_auth` store.
- **Email first:** with built-in auth, confirmation and reset emails go
  through your [email provider](email.md), so configure it before you
  switch.
- Register the redirect URI (`<APP_URL>/auth/sso/<id>/callback`) or the SAML
  ACS URL. `npm run auth -- redirect-uris` prints them.
- Set `allowedDomains` for Entra ID, AD FS and SAML IdPs, which don't
  attest email ownership.

```bash
usertasks-admin switch auth --to builtin --map google=oidc:google,azure=oidc:entra --dry-run
```

Reference: [Auth](../infrastructure.md#auth),
[Single sign-on](../infrastructure.md#single-sign-on-oidc-and-saml) and
[Switching auth](../switching-providers.md#auth).
