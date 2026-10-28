# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately, through GitHub's
[private vulnerability reporting](https://github.com/homepresso/User-Tasks/security/advisories/new) (the repository's
**Security** tab → **Report a vulnerability**). If you cannot use GitHub,
use the contact form at <https://usertasks.com/contact> and start the
message with "Security". Do not report a suspected vulnerability in a
public issue, pull request, discussion or forum post.

Include as much of the following as you can:

- the affected component, route or file, and the version or commit;
- steps to reproduce, or a proof of concept;
- the impact you expect (for example, cross-tenant data access, privilege
  escalation, secret disclosure);
- whether the issue is already public.

We will acknowledge the report, keep you informed while we investigate and
fix it, and credit you in the release notes unless you prefer otherwise.
Please give us reasonable time to release a fix before disclosing details.

## Supported versions

Security fixes are made on the `main` branch. Self-hosted installations
should track `main` or the latest release.

## Scope

In scope: this repository's code, including the workflow engine, API, MCP
server, OAuth server, row-level-security policies and migrations.

Out of scope: vulnerabilities in third-party services (Supabase, Resend,
GitHub) and issues that require a deliberately insecure configuration, such
as enabling `ENABLE_CUSTOM_ACTIVITY_CODE` or `ALLOW_PRIVATE_EGRESS` for
untrusted users, or exposing the service-role key.
