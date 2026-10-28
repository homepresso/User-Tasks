# Release notes: LDAP, Google Workspace and SCIM directory sync

Directory sync grows from Entra ID and Okta to every common directory, and an
on-premises one: LDAP / Active Directory (pulled, with nested groups and delta
syncs), Google Workspace (pulled) and SCIM 2.0 (pushed by the identity
provider). With built-in auth, an LDAP connection can also let people sign in
with their directory password. Existing Entra ID and Okta connections keep
working unchanged.

## Migration

`20261109000000_directory_sync_providers.sql` (idempotent, apply before
deploying the app):

- `directory_links.provider` accepts `ldap`, `google`, `scim`;
  `directory_sync_runs.provider` accepts `ldap`, `google`, and runs record
  `mode` (`full` / `delta`);
- `scim_tokens`, `scim_resources`, `scim_group_members` (RLS on, service role
  only);
- `cron_tick_probe()` counts enabled LDAP and Google connectors for the
  `directory-sync` job (same function otherwise).

## Added

- **LDAP / Active Directory** connector: LDAPS or StartTLS with a per-connection
  CA bundle and certificate checks, paged searches, Active Directory /
  OpenLDAP / generic presets with an editable attribute mapping and filters,
  nested groups (AD `LDAP_MATCHING_RULE_IN_CHAIN`, recursion elsewhere),
  delta syncs (`uSNChanged` / `modifyTimestamp`) between daily full syncs,
  deprovisioning of users who leave the directory, and **Test connection**
  with a mapped sample and warnings.
- **LDAP bind login** (built-in auth, opt-in per workspace): directory users
  sign in with their LDAP password; other names keep the local password.
- **Google Workspace** connector: Admin SDK Directory API with a
  service account and domain-wide delegation; users, groups and derived
  (nested) membership.
- **SCIM 2.0 server** at `/scim/v2`: Users and Groups (GET / POST / PUT /
  PATCH / DELETE, `.search`), filters, paging, attribute projection, weak
  ETags, discovery endpoints; tested with the request shapes of Microsoft
  Entra ID's and Okta's SCIM validators. Per-workspace bearer tokens (SHA-256
  at rest, scopes, expiry, rotation with a grace period, rate limits).
- Per-connector `sync_interval_minutes` (default 60, minimum 10).
- Credentials may be `secret://tenants/<workspace id>/<name>` references to the
  instance secret store; other references are refused.
- REST `/api/v1/directory-sync/connections[/{provider}[/test|/sync]]`,
  `/api/v1/directory-sync/runs`, `/api/v1/directory-sync/scim-tokens[/{id}[/rotate]]`;
  CLI `usertasks directory-sync list|get|connect|update|disconnect|test|sync|runs`
  and `usertasks scim-tokens list|create|delete|rotate`; MCP `directory_sync_*`
  and `scim_tokens_*` (reads need `settings.view`, changes `settings.edit`).
- Settings → SSO & Directory: LDAP, Google Workspace and SCIM cards; LDAP
  settings can be edited after connecting; **Full sync** for LDAP.

## Changed

- The SSO & Directory page's server actions return `{ ok, error }` results
  (messages survive production builds) and go through the shared service, so
  connecting Entra ID or Okta is audited and verified exactly as through the
  API.
- New dependency: `ldapts`.

## Notes

- LDAP servers on private addresses need `ALLOW_PRIVATE_EGRESS=true` (as for
  integrations); cloud metadata addresses stay blocked.
- For Active Directory delta syncs, point the URL at one domain controller:
  `uSNChanged` is per DC.
- SCIM `DELETE` and `active: false` remove access in the workspace but never
  delete the account; deleting a SCIM group keeps its team (SCIM-managed
  members leave it).
