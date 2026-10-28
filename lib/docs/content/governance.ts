import type { DocPageDef } from '../types'

export const GOVERNANCE_PAGES: DocPageDef[] = [
  {
    slug: 'governance',
    title: 'Governance and security',
    description: 'Workspace isolation, roles and permissions, credentials, identity, audit, retention and deletion.',
    body: `
UserTasks is built to be operated by more than one team and called by more than one system, so every surface — app, REST, MCP, CLI — goes through the same checks.

## Workspace isolation

Every row belongs to a workspace. Postgres row-level security enforces isolation for signed-in users, and service code adds explicit workspace checks on every query, including the queue workers and \`SECURITY DEFINER\` functions.

## Who can do what

- [Roles and permissions](/docs/governance/roles-and-permissions): fine-grained permissions grouped into roles; five system roles plus your own.
- [Teams and invitations](/docs/governance/teams-and-invitations): groups for assignment and queues; invite people by email with a role.
- [SSO and directory sync](/docs/governance/sso): Microsoft Entra ID, Okta, [LDAP / Active Directory](/docs/governance/ldap), [Google Workspace](/docs/governance/google-workspace) and [SCIM](/docs/governance/scim).

## Credentials

- [API keys](/docs/governance/api-keys): workspace or user context, a permission ceiling, optional workflow/table allow-lists and expiry.
- [OAuth apps and scopes](/docs/governance/oauth-apps): authorization code with PKCE, client credentials, refresh rotation with reuse detection.
- Integration and log-destination secrets are encrypted with \`ENCRYPTION_KEY\`, write-only and masked as \`__SECRET__\` in every response and export.

## Evidence and lifecycle

- [Workspace theme](/docs/governance/workspace-theme): the one brand theme every member sees, edited in the theme designer or through the API.
- [Audit, retention and deletion](/docs/governance/audit-and-retention): audit log, permission changes, security events, retention policies with review and purge, and a deletion queue that checks dependencies.
- Every change and security event is in the [event stream](/docs/observability) and can be shipped to your SIEM.

::image roles | Roles and permissions settings | Roles: the system roles and a custom "Finance approver" role.

## Hardening checklist (self-hosted)

- Set \`ENCRYPTION_KEY\`; without it stored secrets are plaintext.
- Keep \`SUPABASE_SERVICE_ROLE_KEY\`, \`CRON_SECRET\` and \`ENCRYPTION_KEY\` out of the browser and version control.
- Leave \`ENABLE_CUSTOM_ACTIVITY_CODE\`, \`ALLOW_PRIVATE_EGRESS\` and \`ALLOW_QUERY_KEY_AUTH\` off unless you need them.
- Serve over HTTPS; the app sends HSTS, a strict CSP, \`X-Frame-Options: DENY\` and \`nosniff\` by default.
`,
  },
  {
    slug: 'governance/roles-and-permissions',
    title: 'Roles and permissions',
    description: 'Every permission, which system roles hold it and which OAuth scopes grant it — generated from the permission catalog.',
    tocDepth: 2,
    body: `
A **role** is a named set of permissions. Members can hold several roles; their permissions are the union. Five **system roles** exist in every workspace and cannot be deleted; create custom roles for anything in between.

\`\`\`bash
usertasks roles create --set name="Finance approver" --set permissions:='["tasks.view_own","tasks.complete","reports.view"]'
usertasks users add-role <user-id> <role-id>
usertasks users remove-role <user-id> <role-id>
\`\`\`

API keys and OAuth tokens carry a permission ceiling of their own; a request is allowed only if the credential **and** (for user-context credentials) the user hold the permission. Every role change is audited as a \`security.permission.*\` event.

## Permission reference

Generated from \`lib/permissions.ts\`, the system role definitions and the OAuth scope map.

::permissions
`,
  },
  {
    slug: 'governance/teams-and-invitations',
    title: 'Teams and invitations',
    description: 'Group people into teams for assignment and queues, and invite new members by email with a role.',
    body: `
## Teams

Teams group members for task assignment, queues and escalation. A User Task assigned to a team appears in that team's queue; directory sync can create teams from directory groups.

\`\`\`bash
usertasks teams create --set name="Accounts payable"
usertasks teams add-member <team-id> <user-id>
usertasks teams remove-member <team-id> <user-id>
\`\`\`

## Invitations

Invite people by email with a role (\`owner\`, \`admin\`, \`manager\`, \`member\` or \`viewer\`). They receive a link, sign up or sign in, and join the workspace with that role.

\`\`\`bash
usertasks invitations send --set email=grace@example.com --set role=member
usertasks invitations list
usertasks invitations resend <id>
usertasks invitations revoke <id>
\`\`\`

User Tasks can also invite on redirect: when an assignee redirects a task to an email address that is not yet a member, an invitation is sent (if the task allows it).

Permissions: \`team.view_members\`, \`team.invite\`, \`team.remove\`, \`team.change_roles\`.
`,
  },
  {
    slug: 'governance/api-keys',
    title: 'API keys',
    description: 'Workspace and user-context API keys with permission ceilings, resource allow-lists, expiry and revocation.',
    body: `
API keys authenticate the REST API, MCP and CLI (\`Authorization: Bearer ut_…\`). Create them in **Settings → API Keys**, with the API, MCP or CLI.

::image api-keys | API key settings | API keys with their permissions and expiry.

| Setting | Meaning |
|---|---|
| \`key_type\` | \`tenant\`: acts for the workspace. \`user\`: acts as \`user_id\` and only sees what that user can see. |
| \`permissions\` | The key's ceiling — a subset of the creator's permissions. Omit to inherit. |
| \`workflow_ids\`, \`table_ids\` | Optional allow-lists: the key can only touch these workflows / data tables. |
| \`expires_in_days\` | 1–3650 days (at most 90 when the key is created through an OAuth token). |

\`\`\`bash
usertasks api-keys create --set name="CI deploy" --set permissions:='["workflows.view","workflows.edit","workflows.activate"]' --set expires_in_days:=30
usertasks api-keys revoke <id>
\`\`\`

The full key is shown **once**. UserTasks stores a bcrypt hash and a short prefix; successful validations are cached in memory for 60 seconds and \`last_used_at\` is updated at most once a minute. Revoking a key takes effect immediately on the instance that handles the revocation and within 60 seconds elsewhere.

Repeated authentication failures produce sampled \`security.api_key.auth_failed\` events (at most one per key prefix per 5 minutes). Creating, revoking and deleting keys is audited.

Managing keys needs \`settings.manage_api_keys\`. OAuth clients need the first-party-only scope \`keys:write\`, so third-party apps can never mint keys.
`,
  },
  {
    slug: 'governance/oauth-apps',
    title: 'OAuth apps and scopes',
    description: 'Let other applications act on UserTasks with OAuth 2.0: discovery, PKCE, client credentials, consent, refresh and revocation.',
    body: `
UserTasks is an OAuth 2.0 authorization server for its own API and MCP server.

| Endpoint | Purpose |
|---|---|
| \`/.well-known/oauth-authorization-server\` | Authorization server metadata |
| \`/.well-known/oauth-protected-resource\` | Protected resource metadata (for MCP clients) |
| \`/api/oauth/register\` | Dynamic client registration |
| \`/api/oauth/authorize\` → \`/oauth/consent\` | Authorization code flow with PKCE (S256) and user consent |
| \`/api/oauth/token\` | \`authorization_code\`, \`refresh_token\` and \`client_credentials\` grants |
| \`/api/oauth/revoke\` | Token revocation |

Register apps in **Settings → OAuth Apps** (public or confidential, redirect URIs, grant types, allowed scopes) or let MCP clients register themselves dynamically.

## Security properties

- Authorization codes are single use; replaying one revokes the tokens issued with it (\`security.oauth.code_replay\`).
- Refresh tokens rotate on every use; presenting an old one revokes the family (\`security.oauth.refresh_reuse\`).
- Consent, token issue and revocation are audited security events.
- A token's permissions are the intersection of its scopes and the user's current permissions, re-checked on every request.

## Scopes

Scopes are coarse grants that expand to permissions. Generated from \`lib/oauth/scopes.ts\`:

::scopes

The UserTasks CLI is a first-party client: \`usertasks login\` requests every scope except \`keys:write\` unless you pass \`--scopes\`.
`,
  },
  {
    slug: 'governance/sso',
    title: 'SSO and directory sync',
    description: 'Sign in with your identity provider and provision users and groups from Entra ID, Okta, LDAP / Active Directory, Google Workspace or SCIM.',
    body: `
## Single sign-on

How people sign in depends on the instance's auth provider (see [Infrastructure: Auth](/docs/self-hosting/infrastructure#auth)):

- **Supabase Auth** (the default): enable the Azure (Microsoft) provider or SAML in your Supabase project, then set \`NEXT_PUBLIC_SSO_MICROSOFT=1\` to show **Sign in with Microsoft** on the login page.
- **Built-in auth**: email and password in UserTasks' own database plus any OIDC or SAML identity provider (Entra ID, Okta, Google, Keycloak, AD FS, …), and optionally [LDAP bind login](/docs/governance/ldap#bind-login) so people sign in with their directory password.

> [!TIP]
> On the Microsoft app registration used for sign-in, add the \`email\` and \`xms_edov\` optional claims so Microsoft reports verified emails. That is what links a sign-in to the account directory sync created, instead of creating a duplicate.

## Directory sync

**Settings → SSO & Directory** keeps the workspace's people and teams in step with your directory:

| Directory | How | Page |
|---|---|---|
| Microsoft Entra ID | pulled through Microsoft Graph (app registration with \`User.Read.All\` and \`GroupMember.Read.All\`) | this page |
| Okta | pulled through the Okta API (API token) | this page |
| LDAP / Active Directory | pulled over LDAPS or StartTLS with a service account; nested groups, delta sync | [LDAP and Active Directory](/docs/governance/ldap) |
| Google Workspace | pulled through the Admin SDK Directory API (service account with domain-wide delegation) | [Google Workspace](/docs/governance/google-workspace) |
| Any SCIM 2.0 identity provider | pushed by the IdP to \`/scim/v2\` with a workspace token | [SCIM provisioning](/docs/governance/scim) |

Every directory follows the same rules:

- **Matching**: a directory user with an email links to the account with that email; otherwise, with **Automatically create accounts** on (the default), an account without a password is created — they sign in through SSO or LDAP. Users without an email are skipped.
- **Access**: linked users get an active membership in this workspace and the Member role (when they hold no role here yet).
- **Leaving**: a disabled or deleted directory user loses access on the next sync (SCIM: immediately) — the membership is deactivated and their roles here are removed, so their API keys and OAuth tokens stop working. The account itself is never deleted, and coming back restores access.
- **Groups**: with **Sync groups as teams** on, each directory group becomes a team and its membership is kept in step. Only members added by the directory are ever removed; people you added to the team by hand stay.

Pulled directories sync every hour by default (\`sync_interval_minutes\`, minimum 10, via the \`directory-sync\` job) and on demand; the page shows progress and history, and \`system.sync.directory.*\` events record each run. Credentials are encrypted, never shown again, and may be \`secret://tenants/<workspace id>/<name>\` references to the instance's secret store.

The same settings are available through the API (\`/api/v1/directory-sync\`), the CLI (\`usertasks directory-sync …\`, \`usertasks scim-tokens …\`) and MCP (\`directory_sync_*\`, \`scim_tokens_*\`).
`,
  },
  {
    slug: 'governance/ldap',
    title: 'LDAP and Active Directory',
    description: 'Sync users and nested groups from Active Directory, OpenLDAP or any LDAP directory, and optionally let people sign in with their directory password.',
    body: `
## Connect

**Settings → SSO & Directory → LDAP / Active Directory → Connect**. You need:

- **Server URL**: \`ldaps://dc1.corp.example.com:636\` (TLS from the start), or \`ldap://…:389\` with **Use StartTLS**. Plain LDAP works but is flagged: the bind password and directory data cross the network unencrypted.
- **CA certificate** (PEM) when the server's certificate is issued by your own CA; the system's roots are used otherwise. **Verify the server certificate** stays on unless you are testing. Set **Certificate host name** when it differs from the URL host.
- **Bind DN and password** of a read-only service account (\`CN=svc-usertasks,OU=Service Accounts,DC=corp,DC=example,DC=com\`, or \`svc-usertasks@corp.example.com\` for Active Directory).
- **Base DN**, optionally separate bases for users and groups.

**Test connection** connects, binds, reads the base DN and counts users and groups with your filters, showing five mapped users and warnings (no email attribute, no stable id, unencrypted). The connection is tested again when you save.

## Directory types and attribute mapping

| | Active Directory | OpenLDAP | Other (389 DS, FreeIPA, lldap) |
|---|---|---|---|
| User filter | \`(&(objectCategory=person)(objectClass=user))\` | \`(objectClass=inetOrgPerson)\` | \`(|(objectClass=inetOrgPerson)(objectClass=person))\` |
| Group filter | \`(objectClass=group)\` | groupOfNames, groupOfUniqueNames, posixGroup | the same plus \`group\` |
| Id | \`objectGUID\` | \`entryUUID\` | \`entryUUID\` |
| Username / email / name | \`sAMAccountName\` / \`mail\` (else \`userPrincipalName\`) / \`displayName\` | \`uid\` / \`mail\` / \`displayName\` | the same |
| Disabled users | \`userAccountControl\` ACCOUNTDISABLE bit | — (remove them from the filter) | — |

Every filter and attribute can be overridden under **TLS, search and attribute mapping options** — e.g. a user filter of \`(&(objectCategory=person)(objectClass=user)(memberOf=CN=UserTasks,OU=Groups,DC=corp,DC=example,DC=com))\` syncs one group's members only. Searches are paged (500 entries per page).

## Groups

Groups become teams. With **Nested groups count as members** (the default), members of a nested group are members of the parent: Active Directory resolves this server-side with \`LDAP_MATCHING_RULE_IN_CHAIN\` (\`1.2.840.113556.1.4.1941\`); other directories by following \`member\` / \`uniqueMember\` DNs (cycles are safe), and \`memberUid\` lists usernames.

## Full and delta syncs

The first sync, a daily one, any sync after you change the settings, and **Full sync** read every user. In between, only users changed since the last run are read: Active Directory by \`uSNChanged\` (the cursor is the domain controller's \`highestCommittedUSN\`; keep the URL pointing at the same DC), other directories by \`modifyTimestamp\`. Groups are read in full on every run. A full sync also deactivates linked users the user filter no longer returns (**Deactivate users that leave the directory**, on by default) — unless it returned nobody, so a broken filter cannot lock everyone out.

## Bind login

With **Let users sign in with their directory password** (built-in auth only), the organisation's login page checks passwords against the directory:

1. the service account finds the entry whose \`mail\`, \`userPrincipalName\` (AD) or username equals what was typed (one enabled entry, value escaped);
2. UserTasks binds as that entry's DN with the password, on a separate connection (an empty password is refused before it reaches the server);
3. the linked account — or the account with that email, or a new one when accounts are created automatically — is signed in.

Names the directory doesn't know (and an unreachable directory) fall through to the normal password login, so local accounts such as a break-glass admin keep working. A directory user with a wrong password is refused without trying a local password. Attempts are rate limited per IP and per name.
`,
  },
  {
    slug: 'governance/google-workspace',
    title: 'Google Workspace',
    description: 'Sync users, groups and nested group membership from Google Workspace with a service account and domain-wide delegation.',
    body: `
## Set up

1. In Google Cloud, create a service account and a JSON key for it.
2. In the Google Admin console, **Security → Access and data control → API controls → Domain-wide delegation**, add the service account's client id with these scopes:
   - \`https://www.googleapis.com/auth/admin.directory.user.readonly\`
   - \`https://www.googleapis.com/auth/admin.directory.group.readonly\`
   - \`https://www.googleapis.com/auth/admin.directory.group.member.readonly\`
3. In **Settings → SSO & Directory → Google Workspace → Connect**, paste the JSON key and the email of a Workspace admin for the service account to act as. Optionally limit the sync to one **domain**.

The key is encrypted and never shown again (or store it in your secret manager and enter \`secret://tenants/<workspace id>/google-key\`).

## What is synced

- **Users** of the customer (or the domain): primary email, full name; suspended and archived users are inactive. A users query (\`user_query\`, e.g. \`orgUnitPath=/Engineering\`) narrows the set.
- **Groups** become teams; membership includes members of nested groups (derived membership), users only.
- Linked users no longer returned lose access on the next sync (\`deprovision_missing\`, on by default).

Sign-in is separate: use the Google OIDC preset with built-in auth, or Google in Supabase Auth.
`,
  },
  {
    slug: 'governance/scim',
    title: 'SCIM provisioning',
    description: 'Let Microsoft Entra ID, Okta, OneLogin, JumpCloud or any SCIM 2.0 client push users and groups to UserTasks.',
    body: `
## Set up

1. **Settings → SSO & Directory → SCIM provisioning → Create token.** Copy the token — it is shown once.
2. In your identity provider, add a SCIM 2.0 app with:
   - **Tenant URL / SCIM base URL**: \`https://<your UserTasks>/scim/v2\` (shown on the page);
   - **Secret token / API token**: the token, sent as \`Authorization: Bearer <token>\`.
3. Assign users and groups and start provisioning.

| Identity provider | Where |
|---|---|
| Microsoft Entra ID | Enterprise application → Provisioning → Automatic; **Test connection**, then map attributes (\`userName\` ← \`userPrincipalName\`, \`emails[type eq "work"].value\` ← \`mail\`). Entra's provisioning quirks — capitalised op names, \`"False"\` strings, filters like \`members[value eq "…"]\` — are handled. |
| Okta | App → Provisioning → SCIM 2.0, authentication **HTTP Header** (the token); enable Push New Users, Push Profile Updates, Push Groups and Deactivate Users. |
| OneLogin, JumpCloud, Keycloak (SCIM plugin), others | the same base URL and bearer token. |

## Behaviour

- **Users** follow the [directory rules](/docs/governance/sso#directory-sync): linked by email or created, \`active: false\` and \`DELETE\` remove access in this workspace at once (the account is kept). Passwords sent by the IdP are ignored.
- **Groups** become teams, members kept in step (people added by hand stay).
- Every request acts on the token's workspace only; another workspace's ids are not found, and members from other workspaces are ignored.
- Supported: \`/Users\`, \`/Groups\` (GET, POST, PUT, PATCH, DELETE), \`/.search\` on both, filters (\`eq ne co sw ew gt ge lt le pr\`, \`and\` / \`or\` / \`not\`, value filters like \`emails[type eq "work"]\`), \`startIndex\` / \`count\` paging (up to 1000), \`attributes\` / \`excludedAttributes\`, weak ETags with \`If-Match\` / \`If-None-Match\`, and the discovery endpoints \`/ServiceProviderConfig\`, \`/ResourceTypes\`, \`/Schemas\` (core User with the enterprise extension, Group). Not supported: bulk, sorting, password changes.

## Tokens

Tokens are stored as SHA-256 hashes, can be limited to scopes (\`users:read\`, \`users:write\`, \`groups:read\`, \`groups:write\`) and given an expiry. **Rotate** issues a new token with the same name and scopes; the page keeps the old one working for an hour so you can update the IdP (\`grace_minutes\` through the API, 0 = revoke now). Requests are limited to 1200 per minute per token (\`rate_limit_per_minute\` in the SCIM settings), and repeated failed authentication from one address is throttled. **Disable** revokes every token at once.
`,
  },
  {
    slug: 'governance/audit-and-retention',
    title: 'Audit, retention and deletion',
    description: 'Audit trails, security events, retention policies with review and purge, and a dependency-aware deletion queue.',
    body: `
## Audit

- **Audit log** — every create, update, delete, publish and import, with who, when and which fields changed (\`usertasks audit-log list\`, needs \`settings.view\`).
- **Permission audit** — role grants and removals, including those made by workflows.
- **Security events** — OAuth consent and tokens, API key lifecycle and failures, code replay and refresh reuse.
- **Run history and integration call logs** — every step and outbound call.

All of these feed the [event stream](/docs/observability/events) as \`audit.*\`, \`security.*\` and \`system.*\` events, so you can keep them in your own SIEM for as long as you need.

## Retention policies

A retention policy says how long something is kept and what happens then:

| \`policy_mode\` | Effect |
|---|---|
| \`review\` | After a duration, a review is due (fires **Policy Review** triggers) |
| \`review_on_exact_date\` | Review on a date |
| \`purge_on\` | Purge after a duration |
| \`purge_on_exact_date\` | Purge on a date |
| \`keep_forever\` | Never purged |

Durations are days, months or years. Assign policies to data tables, individual rows and roles (roles support review modes only):

\`\`\`bash
usertasks retention create --set name="Invoices 7 years" --set policy_mode=purge_on --set duration_value:=7 --set duration_unit=years
usertasks retention assign --set target_type=data_table --set target_id=<table-id> --set retention_policy_id=<policy-id>
\`\`\`

The retention job runs daily (03:00 UTC); executions fire **Policy Executed** triggers and \`system.retention.*\` events.

## Deletion queue

Deleting workflows, reports, data tables, integrations, decision tables, agents, custom steps, retention policies or rows goes through a queue. Dependencies are checked first (a workflow that uses an agent is deactivated, for example), the deletion runs in the background, and \`system.deletion.completed\` / \`failed\` events report the result.
`,
  },
  {
    slug: 'governance/workspace-theme',
    title: 'Workspace theme',
    description: 'One brand theme for the whole workspace: the theme designer, fonts and logos, contrast checks, and the REST, MCP, CLI and config-as-code surfaces.',
    body: `
Every workspace has **one theme that all of its members see**. It sets colours for light and dark mode, fonts and font weights, corner radii and shadows, density, the sidebar and top bar styles, logos, the favicon and a wordmark. New workspaces start from the default template. Members can follow their device's light or dark setting, unless the theme forces one mode.

## Theme designer

Open **Settings → Theme**. Every member can view it, and members with \`settings.edit\` can change it.

- **Start from template:** pick one of the 43 built-in themes. Your logos and wordmark are kept.
- **Colours:** separate light and dark palettes covering brand, navigation, surfaces, feedback, status pills, table row highlights and chart series. The badge next to a colour field shows its WCAG contrast ratio. A theme cannot be saved if text on primary buttons or the sidebar is below **3:1**. Other text below AA (4.5:1) is shown as a warning.
- **Typography:** choose from the curated Google Fonts, a system font stack or an uploaded \`.woff2\` file (at most 1 MB), each with a live specimen. You can also set weights, the base size, the heading font, letter spacing and uppercase form labels.
- **Shape & elevation**, **Density & layout**, **Sidebar & top bar** (solid, gradient or dot texture, plus glows, hover colour and decorations) and **Branding** (logos for light and dark sidebars, favicon and wordmark).
- On the right, the **live preview** shows the app with your draft applied: the sidebar, top bar, a task list with highlighted and critical rows, buttons, inputs, status pills, a task detail with outcome buttons and a chart. Switch it between light and dark.
- **Undo / redo** (Ctrl/⌘ Z, Shift Ctrl/⌘ Z), **Reset to template**, **Import** and **Export** of the theme JSON.
- **Save for workspace** asks you to confirm, because the change applies to every member immediately. If someone else saved after you opened the designer, you can load their version or overwrite it.

::image theme-designer | Theme designer with a custom theme | A template rebranded with new colours and fonts, previewed in light mode.

::image theme-designer-dark | Theme designer previewing the dark palette | The same draft previewed with its dark palette.

## API, MCP and CLI

Reading the theme is open to every member. Changing it, applying a template or uploading a font needs \`settings.edit\`.

| Operation | REST (\`/api/v1\`) | MCP | CLI |
|---|---|---|---|
| Get | \`GET /workspace-theme\` | \`workspace_theme_get\` | \`usertasks workspace-theme get\` |
| Replace | \`PUT /workspace-theme\` | \`workspace_theme_update\` | \`usertasks workspace-theme update -f theme.json\` |
| List templates | \`GET /workspace-theme/presets\` | \`workspace_theme_presets_list\` | \`usertasks workspace-theme presets\` |
| Apply a template | \`POST /workspace-theme/apply-preset\` | \`workspace_theme_apply_preset\` | \`usertasks workspace-theme apply-preset <id>\` |
| Upload a font | \`POST /workspace-theme/fonts\` | \`workspace_theme_font_upload\` | \`usertasks workspace-theme upload-font\` |

\`\`\`bash
usertasks workspace-theme get -o json > theme.json       # edit, then:
usertasks workspace-theme update -f theme.json
usertasks workspace-theme apply-preset night-drive
curl -X POST "$URL/api/v1/workspace-theme/fonts" -H "Authorization: Bearer $KEY" -F file=@AcmeSans.woff2 -F family="Acme Sans"
\`\`\`

\`PUT\` takes the whole theme, and also accepts the \`GET\` response as it is. Add \`expected_version\` to refuse the write (409) if the theme changed since you read it. A font upload returns a font reference such as \`{ "source": "upload", "family": "Acme Sans", "url": … }\`. Put it in \`typography.sans\`, \`display\` or \`mono\`; uploading a font does not change the theme.

## Config as code

[Config export](/docs/config-as-code) writes the theme to \`workspace-theme.json\` at the root of the folder. Uploaded fonts are referenced by file name, and logos by URL. When you apply the folder to another workspace:

- Fonts are looked up by file name in that workspace's font folder. If a file is missing, the default font is used and the apply returns a warning. Upload the file there, then apply again.
- Logo and favicon URLs that are not that workspace's own uploads are dropped, with a warning.
- The plan shows \`workspace_theme\` as \`update\` or \`unchanged\`, with field diffs. Applying it needs \`settings.edit\`.
`,
  },
]
