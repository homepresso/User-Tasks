# Choosing directory sync

Directory sync keeps a workspace's members and groups in step with your
directory: accounts are created, updated and deactivated, and groups map to
roles. It is set per workspace (Settings → SSO & Directory,
`/api/v1/directory-sync`, `usertasks directory-sync …`), works with every
auth provider, and runs under any scheduler.

| Directory | `provider` | Transport | On-prem | AWS | Azure | Google Cloud |
|---|---|---|---|---|---|---|
| Microsoft Entra ID | `entra` | Microsoft Graph, client credentials | — | — | native | — |
| Okta | `okta` | Okta API token | — | — | — | — |
| LDAP / Active Directory | `ldap` | LDAPS or StartTLS, paged searches, nested groups, delta sync | yes | compatible: AWS Managed Microsoft AD | compatible: Entra Domain Services | compatible |
| Google Workspace | `google` | Admin SDK Directory API, domain-wide delegation | — | — | — | native |
| SCIM 2.0, pushed by your IdP | `scim` | inbound `/scim/v2`, bearer token per workspace | yes, with an IdP that speaks SCIM | yes | yes: Entra provisioning | yes |

## When to pick which

- **Your IdP pushes SCIM** (Entra ID, Okta, Keycloak with a plugin): the
  quickest changes, and no credentials stored in UserTasks.
- **Pull from the directory** when the IdP can't push, or for
  on-premises Active Directory. LDAP also enables **bind login**:
  directory passwords on the organisation's login page, with built-in
  auth.

## Rules

- LDAP and the other pulled directories go through the egress guard. A
  directory on a private address needs `ALLOW_PRIVATE_EGRESS=true`.
- SCIM needs the reverse direction: the IdP must reach `/scim/v2` on the
  app, over TLS.
- Credentials are stored encrypted, or as `secret://tenants/<workspace
  id>/<name>` references. A workspace can't reference another workspace's
  secrets or the instance's.
- LDAP bind login needs built-in auth. Supabase Auth installs can sync but
  not bind. With bind login on, the login field also takes user names
  (`jdoe`, `CONTOSO\jdoe`).
- Active Directory: use LDAPS or StartTLS (Windows Server 2025 refuses
  unsigned simple binds), a read-only bind account, and a user filter scoped
  to the people who use UserTasks. Disabled accounts lose access and leave
  their teams; a second sync with nothing new changes nothing. Step by step:
  [Active Directory and AD FS](active-directory.md).

Reference: [Directory sync](../infrastructure.md#directory-sync).
