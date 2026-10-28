# Release notes: auth providers

Sign-in moves to the server, and UserTasks can run its own accounts and
sessions — or hand sign-in to any OIDC or SAML identity provider — instead of
Supabase Auth. Nothing changes for existing installs unless you opt in:
Supabase Auth stays the default.

## Changed (everyone)

- **Server-side sign-in.** The login, forgot-password and reset-password pages
  and the beta signup now post to server actions; sign-out is a server action
  too. Session cookies are set by the server and are `HttpOnly` (plus
  `SameSite=Lax`, and `Secure` on https). The browser no longer loads an
  auth client at all, and no longer loads supabase-js unless Supabase Realtime
  is in use (which now gets a short-lived token from the server).
- The dashboard checks the session with the server (`GET /api/auth/session`)
  at boot and on a light heartbeat, and signs out other tabs over a
  BroadcastChannel. `POST /api/auth/session` (setting cookies from browser
  tokens) is gone.
- The login page shows a message for SSO / invitation errors
  (`?error=no_invite`, `sso_failed`, …).
- Migration `20261106000000_auth_portability.sql`: the foreign keys that
  pointed at `auth.users` (`users.id`, `user_roles.user_id`,
  `agents.created_by`, `reports.created_by`, `workspace_themes.updated_by`)
  now point at `public.users` (or are dropped for `users.id`); deleting a
  Supabase auth user still deletes the profile (a trigger replaces the
  cascade). The personal-workspace provisioning the `on_auth_user_created`
  trigger does is now an idempotent function, `public.provision_auth_user`,
  shared with the app. Row-level security is unchanged.

## Added

- **`AUTH_PROVIDER=builtin`**: email + password accounts in the app's
  Postgres (`app_auth`, migration `20261106100000_builtin_auth.sql`), bcrypt
  (Supabase-compatible), invitation-only sign-up by default, confirmation and
  reset emails through `EMAIL_PROVIDER`, opaque server-side sessions with
  idle / absolute expiry and revocation, rate limits and account lockout.
- **Single sign-on** with any number of IdPs (`AUTH_SSO_PROVIDERS`), next to
  passwords or alone (`AUTH_PROVIDER=oidc` / `saml`):
  - OIDC (code + PKCE, state, nonce, JWKS-verified ID tokens) with presets for
    Microsoft Entra ID (single and multi-tenant), Entra External ID, Google /
    Google Workspace, Okta, Auth0, Keycloak, Authentik, ZITADEL, Dex and AD FS;
  - SAML 2.0 (SP- and IdP-initiated, signed assertions, replay protection, SP
    metadata) with presets for AD FS, Entra ID, Okta, Google Workspace,
    Keycloak, Shibboleth, OneLogin and PingFederate;
  - just-in-time accounts, email-domain allowlists, linking by verified email,
    a default organisation and role, and IdP group → role mapping.
- **`npm run auth -- migrate-users`** copies Supabase Auth users (ids,
  passwords, confirmation, Google / Azure identities) into built-in auth;
  `npm run auth -- redirect-uris` prints the URLs to register at each IdP.

## Upgrade notes

- Apply both migrations. With the default provider nothing else is needed.
- Users stay signed in across the upgrade (their Supabase cookies are reused
  and become `HttpOnly` on the next refresh).
- Switching to built-in / OIDC / SAML: see Infrastructure → Auth. Everyone
  signs in again after a switch; passwords carry over.
