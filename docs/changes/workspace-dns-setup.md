# Release notes: Workspace DNS setup page

Instance admins have a new page, **Settings → Workspace DNS**
(`/settings/workspace-dns`). It shows what to set up so workspace addresses
(`<workspace>.usertasks.com`, or `<workspace>.<APP_BASE_DOMAIN>` on a
self-hosted install) reach the app, and checks whether it works. Nothing is
migrated (no database change) and no setting is added.

## What's new

- **Status**, checked live on the server (cached for a minute; **Check
  again** re-runs it):
  - the base domain in use and whether addresses are on;
  - **wildcard DNS**: a random name, `ut-check-<random>.<base>`, must
    resolve; the page shows its CNAME and addresses;
  - **apex DNS** and the base domain's **nameservers**, with the DNS host
    detected: GoDaddy (`*.domaincontrol.com`), Vercel DNS, Cloudflare,
    Route 53 or another provider;
  - the **`_acme-challenge` delegation** (NS records), which Vercel needs
    to issue the wildcard certificate when it doesn't run the domain's DNS;
  - the **wildcard certificate**: a TLS connection to the random name, with
    its issuer, expiry and whether it is valid for the name;
  - **App answers**: `https://<random>.<base>/` must answer from the app
    (200, 30x or the 404 "No workspace at this address" page, recognised by
    the app's Content-Security-Policy header). Vercel's own "domain not
    added" error fails the check.
  Every check times out after 4–5 seconds, and every error shows as a
  failed check with its message.
- **What to set up**, for this environment, with every record computed from
  the base domain in a copyable table (Type, Host, Value, TTL):
  - **Vercel (cloud):** add `*.<base>` under Vercel → the project →
    Settings → Domains, then DNS. The **GoDaddy** tab (the default when the
    nameservers are `domaincontrol.com`) has two options:
    - **A, recommended:** switch the nameservers to `ns1.vercel-dns.com` and
      `ns2.vercel-dns.com` (My Products → the domain → DNS → Nameservers →
      Change Nameservers → "I'll use my own nameservers"), after exporting
      the zone file and importing every record into Vercel
      (`vercel dns import <domain> <zonefile>`). Email, including Microsoft
      365 bought through GoDaddy, stops if the MX and autodiscover records
      aren't copied first.
    - **B, keep GoDaddy DNS:** `CNAME *` → `cname.vercel-dns.com`, and `NS`
      records `_acme-challenge` → the two Vercel nameservers. Vercel
      documents nameserver switching as the supported route for wildcards,
      so this may not get a certificate; the status shows whether it did.
    There are short tabs for **Cloudflare** (the wildcard CNAME must be "DNS
    only", grey cloud) and **other DNS providers**.
  - **Self-hosted:** `APP_BASE_DOMAIN`, the wildcard A / AAAA record (filled
    in with the apex's current addresses) or CNAME, a wildcard certificate
    through DNS-01 (cert-manager, Caddy and Traefik examples), forwarding the
    `Host` header, the cookie-domain caveat and local `*.localhost`.
- **Settings → General → Workspace address** links instance admins to the
  page (in place of "see the self-hosting guide").

## Access and security

- Instance admins only (`INSTANCE_ADMIN_EMAILS` / `instance.admin_emails`),
  the same check as Settings → Infrastructure. Anyone else gets a 404, and
  **Check again** re-checks access on the server.
- The checks take no input. Every name looked up or contacted is derived
  from the configured base domain, so the page can't be used to probe other
  hosts.
