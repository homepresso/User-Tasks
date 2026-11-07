# Release notes: Workspace addresses and friendly form links

Each workspace can now have its own address, **`acme.usertasks.com`**. Every
reusable form gets a friendly link on that address, named after the form:
**`acme.usertasks.com/form/employee-onboarding`**. The main address
`usertasks.com`, plus `www.` and `app.`, works exactly as before.

## Added

- **Workspace address** in **Settings → General**:
  - **Rules:** lowercase a–z, 0–9 and hyphens, 3–40 characters, no hyphen at
    either end and no two in a row.
  - **Reserved names** (`www`, `app`, `api`, `docs`, `admin`, `mail`,
    `status`, `auth`, `login`, `help`, `support`, `gallery`, `form`, …) are
    refused.
  - **Checks:** validation and availability are checked as you type.
  - **Changing it** shows a warning that old links stop working. For a year
    the old address redirects to the new one and no other workspace can take
    it.
  - **New and existing workspaces** get their organisation slug as address
    when it fits the rules.
- **On a workspace address:**
  - Signed-out visitors sign in on the main address and come straight back.
  - Members open the app in that workspace. It becomes their current
    workspace, using the same switch as the avatar menu.
  - Signed-in non-members see "You don't have access to …".
  - An unknown address shows "No workspace at this address" (404).
- **Form system names:** each reusable form has a `system_name`. It is
  suggested from the form name (`employee-onboarding`, then `-2`, `-3`, …) and
  is unique per workspace. Edit it in the form's **Settings**. Renaming keeps
  the old name as a redirect, so shared links keep working.
- **`/form/<system name>`:**
  - On a workspace address it renders exactly like `/f/<id>`, with the same
    access rules (signed in, **Submit forms**) and URL parameters.
  - On the main address it resolves in your current workspace.
  - `/f/<id>` and `/p/<token>` keep working.
- **Allow friendly public link** (per form, off by default) in the form's
  anonymous settings. With anonymous responses on, visitors who aren't signed
  in can open the form by name and get exactly the `/p/<token>` page, with the
  same allowlist, rate limits and bot protection. Without it, a visitor is
  always sent to sign in, whether or not the name exists.
- **Links:**
  - The QR code dialog shows the friendly link first, with the URL builder,
    and lists the `/f/` page and public link under it.
  - **Copy link** copies the friendly link.
  - On a workspace address, the Forms menu, Home favourites and search open
    forms at `/form/<system name>`.
- **API, MCP and CLI:**
  - REST:
    - `GET|PATCH /api/v1/workspace/address`
    - `GET /api/v1/workspace/address/check`
    - `system_name` on `POST|PATCH /api/v1/forms`
    - `GET /api/v1/forms/system-name-check`
    - `GET /api/v1/forms/{id}/links`
  - MCP: `workspace_address_get|check|set`, `forms_system_name_check` and
    `forms_links`.
  - CLI:
    - `usertasks workspace-address get|check|set`
    - `usertasks forms check-system-name|links`
  - The new MCP read tools need `tasks.view_own` (workspace address) and
    `forms.view` (form links).

## Security

- **Sessions across subdomains.** With workspace addresses on, the session
  cookie is scoped to the base domain:
  - built-in auth uses `__Secure-ut_session` (a `__Host-` cookie can't carry a
    Domain);
  - Supabase Auth uses `__Secure-sb-ut-auth-token`;
  - both are HttpOnly, Secure and SameSite=Lax.

  One sign-in works on every address, and signing out on any address clears
  the cookie everywhere and revokes the session. Existing Supabase sessions
  are moved to the shared cookie on their next request, so nobody is signed
  out. Hosts outside the base domain, such as preview URLs, keep host-only
  cookies.

  **Trade-off:** every host under the base domain receives the session. Serve
  nothing but the app on `*.usertasks.com`.

  We chose this over a signed hand-off token to a host-only cookie on each
  subdomain. With hand-off, every subdomain would hold a copy of the same
  Supabase refresh token, and Supabase rotates refresh tokens on use, so
  copies on other hosts would keep getting revoked. Signing out everywhere
  would also need a visit to every subdomain.
- **Open redirects.** Sign-in still only carries same-origin paths. The way
  back to a workspace address is the path `/ws/<subdomain>/<path>`, which
  only ever redirects to `<subdomain>.<base domain>` (the label is
  validated). Other hosts, `//`, backslashes and nested labels are refused.
- **The workspace header** the proxy passes to the server is always
  overwritten, so a client can't choose a workspace by sending it.
- **CSP:** per request, as before. `frame-ancestors 'none'` stays, so no
  framing anywhere. Requests are same-origin on each address, so there is no
  CORS allowlist to widen.
- **Tenant isolation:** a name is resolved only in the address's workspace.
  Workspace A's address never serves workspace B's form.
- **Database:** `tenant_subdomain_history` and `form_system_name_history`
  have RLS on and no client grants; only the service role can use them.

## Before deploying usertasks.com

**Settings → Workspace DNS** (`/settings/workspace-dns`, instance admins)
walks through steps 2 and 3 with the records for the actual base domain and
checks the result live (wildcard DNS, nameservers, `_acme-challenge`, the
wildcard certificate and whether the app answers).

1. **Apply** `supabase/migrations/20261223000000_workspace_subdomains.sql`.
   It is additive and idempotent, and it backfills addresses and system names.
2. **Vercel → the project → Settings → Domains → Add** `*.usertasks.com`.
   Keep `usertasks.com` and `www.usertasks.com` as they are.
3. **DNS for the wildcard.** Vercel can only issue a certificate for
   `*.usertasks.com` through a DNS-01 challenge. Vercel says wildcard domains
   must use Vercel's nameservers. `usertasks.com` is registered and its DNS
   hosted at **GoDaddy**, so one of:
   - **Recommended: switch the nameservers to Vercel.**
     1. In GoDaddy: **My Products** → `usertasks.com` → **DNS**. Use
        **Export zone file**, or copy every record: MX, TXT (SPF, DKIM,
        DMARC, site verification) and CNAMEs such as `email`,
        `autodiscover`, `lyncdiscover` (Microsoft 365 bought through
        GoDaddy).
     2. Import them into Vercel: `vercel dns import usertasks.com
        ./usertasks.com.txt`, or Vercel → **Domains** → `usertasks.com` →
        **DNS records**. Skip GoDaddy's parking `@` / `www` records.
     3. In GoDaddy: **DNS** → **Nameservers** → **Change Nameservers** →
        **I'll use my own nameservers** → `ns1.vercel-dns.com`,
        `ns2.vercel-dns.com`.
     Email stops if the MX and autodiscover records aren't copied first.
     Propagation can take up to 48 hours; lower the TTLs a day before if
     you can. Vercel then creates the wildcard record and renews the
     wildcard certificate itself.
   - **Keeping GoDaddy DNS:** in GoDaddy **DNS Records → Add New Record**:
     `CNAME`, host `*`, value `cname.vercel-dns.com`; and two `NS` records,
     host `_acme-challenge`, values `ns1.vercel-dns.com` and
     `ns2.vercel-dns.com`, so Vercel can answer the DNS-01 challenge.
     Vercel documents the nameserver route as the supported one for
     wildcards, so this may not get a certificate: the Workspace DNS page
     shows whether it did. If not, use the nameserver option.
4. **Environment:** nothing to set. In `cloud` mode the base domain is the
   host of `APP_URL` (`usertasks.com`). Set `APP_BASE_DOMAIN=off` to keep
   addresses off.
5. **Supabase Auth and SSO:** no change. Sign-in stays on
   `https://usertasks.com`, so no wildcard redirect URLs are needed.
6. **Check after deploy:**
   - `https://<your workspace>.usertasks.com` opens the app;
   - an unknown name shows the 404 page;
   - Settings → General shows the address.

## Self-hosted

Workspace addresses are off until you set `APP_BASE_DOMAIN`. They need:

- a wildcard DNS record;
- a wildcard TLS certificate (DNS-01);
- a proxy that forwards `Host`.

See the self-hosting guide, "Workspace addresses", and **Settings →
Workspace DNS** for the records and live checks. For local development,
use `APP_BASE_DOMAIN=localhost` and open `acme.localhost:3000`.
