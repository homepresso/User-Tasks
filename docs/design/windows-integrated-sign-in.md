# Design: Windows Integrated sign-in (Kerberos) directly to UserTasks

Status: **design only — not built.** Automatic sign-in through an identity
provider (`lib/providers/auth/sso/auto.ts`; AD FS with Windows Integrated
Authentication is the common on-premises case) already signs domain users in
without a sign-in page. This document specifies the secondary path for
self-hosted installs that have Active Directory but **no IdP**: the browser
authenticates to UserTasks itself with Kerberos (HTTP `Negotiate`). It was
not built with automatic sign-in because doing it properly needs a native
GSSAPI acceptor, keytab handling and a deployment test matrix
(Windows / Linux servers, MIT / Heimdal, Edge / Chrome / Firefox policies)
that could not be proven in the time available; a weak version (NTLM, or
trusting a user-name header from a reverse proxy) would be worse than none.

## Goals and non-goals

- Domain-joined browsers reach UserTasks and are signed in with their
  Windows logon: no prompt, no IdP.
- Kerberos only. **No server-side NTLM validation**: NTLM needs either the
  user's NT hash or a Netlogon secure channel (a machine account and
  NetrLogonSamLogonEx over SMB / RPC with signing and sealing) — not
  something to reimplement in Node. Browsers that can't do Kerberos (outside
  the domain, no SPN, IP-address URLs) get the normal sign-in page.
- Nothing the client asserts is trusted except the Kerberos AP-REQ validated
  with the service key.
- Same account model as SSO: the principal maps to a user through the
  directory; JIT, pending directory entries and "no personal workspace when
  an organisation brought the person in" behave exactly as for SSO
  (`lib/providers/auth/sso/accounts.ts`).

## Flow

1. `GET /auth/windows?redirect=<local path>&org=<slug>` — a new route. When
   configured, automatic sign-in treats it as an identity provider of type
   `windows`, so `auto_sign_in`, `sso_only` and the frame / popup handling
   work unchanged.
2. No `Authorization` header → `401` with `WWW-Authenticate: Negotiate` and a
   small HTML body linking to `/login?local=1` (what a browser that can't do
   Kerberos shows). Never `WWW-Authenticate: NTLM`.
3. `Authorization: Negotiate <base64>` → the SPNEGO token goes to the
   acceptor (the optional native `kerberos` package already used by the
   Windows connector transport: `initializeServer('HTTP@<host>')`,
   `server.step(token)`). An NTLMSSP token (`TlRMTVNTUA…`) is refused with 401
   and no retry loop.
4. Success → `server.username` = `user@REALM`. Optional mutual
   authentication: `WWW-Authenticate: Negotiate <server.response>` on the
   redirect.
5. Principal → account (below) → built-in session (`startBuiltinSession`,
   method `windows`) → 303 to `redirect` (through `sanitizeRedirect`).
6. Rate limit per IP; audit `auth.windows.sign_in` (principal, result).
   Replay protection is Kerberos' own (authenticator timestamps and the
   GSSAPI replay cache; MIT krb5 needs a writable `KRB5RCACHEDIR`).

Frames: Kerberos needs no cookies, so the silent attempt works in the hidden
frame exactly as the AD FS one does (the 401 / 200 exchange never renders);
the session cookie follows the framed-session rules (`lib/embedding.ts`).

## Configuration

| Setting | |
|---|---|
| `AUTH_WINDOWS_ENABLED=true` (`auth.windows`) | turns the route and the "Windows" automatic sign-in option on |
| `AUTH_WINDOWS_SPN` | default `HTTP/<APP_URL host>`; registered on exactly one AD account (`setspn -S HTTP/tasks.contoso.com CONTOSO\svc-usertasks`) — duplicate SPNs break Kerberos silently |
| `KRB5_KTNAME` | keytab (`FILE:/etc/usertasks/http.keytab`), from `ktpass /princ HTTP/tasks.contoso.com@CONTOSO.COM /mapuser CONTOSO\svc-usertasks /crypto AES256-SHA1 /ptype KRB5_NT_PRINCIPAL /pass * /out http.keytab`; AES only, no RC4 |
| `AUTH_WINDOWS_REALMS` | allowed realms (default: the keytab's); other realms (cross-forest trusts) refused unless listed |
| `AUTH_WINDOWS_DIRECTORY` | the LDAP / AD directory-sync connection used to map principals (default: the workspace's only LDAP connection) |
| `AUTH_WINDOWS_DEFAULT_ORG`, role mapping | as `defaultOrg` / `roleMapping` on SSO providers (AD group names / DNs) |

`usertasks-admin doctor` checks that the native module loads, the keytab
exists, is readable only by the service user and holds the SPN with an AES
key, the clock is within 5 minutes of the KDC, and the directory connection
binds.

## Mapping the principal to a user

1. `user@REALM` → LDAP (LDAPS, the directory-sync bind account):
   `(&(objectClass=user)(userPrincipalName=<user@upnSuffix>))`, else
   `(sAMAccountName=<user>)` in the realm's naming context. Disabled
   (`userAccountControl` bit 2) and locked-out accounts are refused.
2. `mail` (else `userPrincipalName`) is the verified address — supplied by the
   directory, not the browser (the same trust rule as AD FS with
   `allowedDomains`); `objectGUID` is the stable subject (`windows:<guid>`).
3. Groups from `tokenGroups` (nested) for role mapping and teams.
4. Then `resolveExternalAccount`'s rules: linked identity, link by verified
   email, JIT into the default organisation, pending directory entries
   claimed (seat counted at first sign-in), no personal workspace when an
   organisation brought the person in.

## Security notes

- Only the AP-REQ validated with the service key identifies the user; no
  `X-Remote-User` / `REMOTE_USER` headers are accepted (a proxy doing
  Kerberos itself would be a separate, explicitly configured trusted-header
  mode with a shared secret and an address allowlist — out of scope).
- GET only, `Cache-Control: no-store`, no session on any failure.
- Signing out ends the UserTasks session only; with automatic sign-in on,
  the next visit signs the person in again (as with AD FS).
- Browsers send Kerberos only to sites in the Local intranet zone or the
  `AuthServerAllowlist` (Edge / Chrome) / `network.negotiate-auth.trusted-uris`
  (Firefox) policies — part of the deployment guide.

## Tests to build with it

Unit: SPNEGO parsing (Kerberos vs NTLMSSP), principal parsing, realm
allowlist, LDAP filter escaping, mapping (disabled / locked / no mail), route
behaviour (401 challenge, NTLM refused, success → session + redirect,
failure → no session). Integration: a Samba AD DC container with a keytab
and a `kinit` client running `curl --negotiate`. Lab: Edge on a domain-joined
VM against an SPN on the UserTasks host.
