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
- Leave \`ALLOW_PRIVATE_EGRESS\` and \`ALLOW_QUERY_KEY_AUTH\` off unless you need them. [Custom workflow actions](/docs/workflows/custom-actions) always run sandboxed; \`CUSTOM_ACTIONS_DISABLED=true\` switches them off entirely.
- Serve over HTTPS; the app sends HSTS, a strict CSP, \`X-Frame-Options: DENY\` and \`nosniff\` by default (only the form link pages — \`/f/\`, \`/form/\`, \`/p/\` and \`/form-login\` — may be framed, for [embedding](/docs/tasks/forms#sharing-and-embedding-forms)).
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

API keys and OAuth tokens carry a permission ceiling of their own; a request is allowed only if the credential **and** (for user-context credentials) the user hold the permission. A user's key follows their **current** roles: demote them and the key shrinks with them; remove them from the workspace (or delete them) and the key stops working. Every role change is audited as a \`security.permission.*\` event.

### What each system role is for

| Role | Intent |
|---|---|
| **Viewer** | A read-only consumer: works the tasks assigned to them, submits the forms they are given, reads data and reports, sees the people directory. No build, design or admin areas — the side menu shows no **Build** or **Govern** section and those pages say *Not authorized*. |
| **Member** | Does the work: creates and assigns tasks, edits data rows, builds their own reports and sees the workflow queue items they are involved in. Builds nothing. |
| **Manager** | Builds and oversees work (workflows, forms, data tables, integrations, agents, the task tracker, every run) and manages projects; no people, role, credential or settings administration. |
| **Admin** | Everything except the Owner-only break-glass (**Complete any task**). |
| **Owner** | Everything. |

Pages check the same permissions as the data behind them: open a page your role doesn't include and you get *Not authorized*; the server refuses the data whatever the page. The database enforces it too — writes to roles, grants, API keys, invitations and every build object need the matching permission in that workspace.

## Grants on objects

Roles decide what someone can do across the workspace. **Grants** give a role, a team or a person access to one object: a workflow, data table, **form**, agent, integration, report or API key. Manage them on the object (a workflow's Access panel, a data table's Access tab, a form's **Details → Access**) or for every object at once in **Settings → Governance → Object Permissions**, which lists workflows, data tables, forms, agents and integrations with a filter per type. Managing grants needs \`team.change_roles\`.

| Object | Columns |
|---|---|
| Workflows, agents, integrations | View, Edit, Delete, Execute |
| Data tables, reports, API keys | View, Edit, Delete |
| Forms | View, **Submit** (\`can_execute\`) |

For forms, a grant does not lock anyone out: with the form in **Available forms**, it lists the form in the Forms menu of the people it names (who also need **Submit forms**). Editing and deleting forms is governed by the \`forms.edit\` and \`forms.delete\` role permissions, so forms have no Edit or Delete columns.

Every grant change is recorded in the audit log on the object (\`grant\` / \`revoke\`, for example *Gave role "Member" View, Submit on form "Expense claim"*). The same operations are on every surface:

\`\`\`bash
usertasks object-permissions list --object-type form --object-id <form-id>
usertasks object-permissions set --set object_type=form --set object_id=<form-id> --set role_id=<role-id> --set can_execute:=true
usertasks object-permissions remove <grant-id>
\`\`\`

REST: \`GET\` / \`POST /api/v1/object-permissions\`, \`DELETE /api/v1/object-permissions/{id}\`. MCP: \`object_permissions_list\`, \`object_permissions_set\`, \`object_permissions_remove\`.

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

Teams can also have a lead, an org unit, a colour and a kind; [Organization structure](/docs/governance/organization) shows teams alongside reporting lines, org units and projects.
`,
  },
  {
    slug: 'governance/organization',
    title: 'Organization structure',
    description: 'Reporting lines, people attributes, org units, teams and projects: view the org chart, edit the structure, and import it from Okta, Entra ID, Google Workspace, LDAP / AD, SCIM or CSV.',
    body: `
The **Organization** page shows who reports to whom, how the workspace is divided into divisions and departments, which teams exist and who works on which project. The same structure is available to the API, MCP and CLI, and is what upcoming task views ("my team", "this project's team") will use to decide whose work to show.

## Concepts

| Concept | What it is | Stored in |
|---|---|---|
| **Reporting line** | Each member's manager in this workspace. Direct reports, indirect reports (up to 10 levels), the manager chain and peers (same manager) are derived from it. | \`user_memberships.manager_user_id\` |
| **People attributes** | Job title, department, location, employee id and cost centre — per workspace, so one person can have a different title in each workspace. | \`user_memberships\` |
| **Org unit** | A box in the formal structure: company, division, department, unit or any custom kind. Units nest, have an optional **head** and members; one unit can be a person's **primary** unit. | \`org_units\`, \`org_unit_members\` |
| **Team** | A working group used for task assignment and queues ([Teams and invitations](/docs/governance/teams-and-invitations#teams)). Teams nest and have a **lead**, an optional org unit, a colour and a kind (\`team\`, \`squad\`, \`guild\` or your own). | \`teams\`, \`user_teams\` |
| **Project** | A piece of work with a key (\`APOLLO\`), a status (\`active\`, \`on_hold\`, \`completed\`, \`archived\`), an owner, an optional sponsor, owning team and org unit, dates and a colour. Its people are its **direct members** (each with a role such as Lead or Member and an optional allocation %) plus the members of the owning team and every **attached team**, sub-teams included. | \`projects\`, \`project_members\`, \`project_teams\` |

Loops are refused everywhere: nobody can be managed by someone who reports to them, and a unit or team cannot be moved inside itself — the database checks this on every write. A member who leaves the workspace leaves its units and projects and stops being a unit head or team lead.

## Views

**Organization** in the sidebar (\`/org\`, needs **View organization** or **View projects**) has four views. Each has a chart and an accessible **List** layout; on a phone the chart becomes an indented list.

- **People** — the org chart from reporting lines: avatar, name, title, department and direct-report count on each card. Expand and collapse branches, pan and zoom, search to jump to a person, and **Show me** to centre on yourself. Click a person for a side panel with their manager chain, direct reports, teams, projects and org units. Large organisations open branch by branch.
- **Org units** — the division / department tree with each unit's head and headcount (the unit's own members, and everyone including sub-units).
- **Teams** — teams as cards nested under their parent team, with the lead, member avatars, the linked org unit and the team's projects.
- **Projects** — project cards with status, owner, dates, members and attached teams. Open a project (\`/org/projects/<id>\`) to see its team: direct members with their roles and allocation, and each attached team with its members.

## Editing

**Organization → Manage** (\`/org/manage\`, needs **Manage organization** or **Manage projects**) is where the structure is edited:

- **People**: set a person's manager, job title, department, location, employee id and cost centre. Changing a manager needs **Manage organization** or **Manage roles**.
- **Org units**: create, rename, change the kind, move (**Move to…**, or drag a unit onto another in the tree), set the head, add and remove members, mark a primary unit, delete. Deleting a unit moves its sub-units up to its parent; its teams and projects lose the link.
- **Teams**: what the Team page does, plus lead, org unit, colour and kind.
- **Projects**: create, edit, archive / restore and delete; add members with a role and allocation; attach and detach teams. A new project gets a key from its name (\`Mobile App Relaunch\` → \`MAR\`) unless you give one; keys are unique per workspace, ignoring case.

Every change is written to the audit log (object types **Member**, **Org unit**, **Team** and **Project**).

## Detaching imported data

Data that came from a directory or a CSV import is marked with its source and is **read-only** in the editor until you detach it:

- **People attributes** imported by directory sync are refreshed on every sync. **Detach** a person's attributes to edit them here; sync then leaves that person's attributes alone.
- **Org units** created by an import are updated by the next import (name, kind, parent). **Detach** a unit to edit or delete it; imports stop changing it but still place people in it.

Reporting lines keep their rule: a manager set by directory sync replaces a manual one on the next sync ([Reporting lines](/docs/tasks/manager-view#reporting-lines)).

## Importing from a directory

[Directory sync](/docs/governance/sso#directory-sync) can import the org structure as well as users and groups. Each connection has two switches in **Settings → SSO & Directory**:

- **Import job titles & locations** — fills the people attributes below.
- **Import org structure (departments / divisions)** — creates org units from company / division / department (Google Workspace: the org unit path) and places each person in their unit.

Both are **on** for new connections and **off** for connections that existed before this release, so nothing changes until an admin turns them on.

| Directory | Job title | Department | Division / company | Location | Employee id | Cost centre | Manager |
|---|---|---|---|---|---|---|---|
| Microsoft Entra ID | \`jobTitle\` | \`department\` | \`companyName\` | \`officeLocation\` | \`employeeId\` | — | \`manager\` |
| Okta | \`profile.title\` | \`profile.department\` | \`profile.division\`, \`profile.organization\` | — | \`profile.employeeNumber\` | \`profile.costCenter\` | \`profile.managerId\` |
| Google Workspace | \`organizations[].title\` | \`organizations[].department\` | \`orgUnitPath\` as a hierarchy | — | — | \`organizations[].costCenter\` | \`relations\` of type \`manager\` |
| LDAP / Active Directory | \`title\` | \`department\` | — | \`physicalDeliveryOfficeName\` | \`employeeID\` | — | \`manager\` (a DN) |
| SCIM | \`title\` | enterprise \`department\` | enterprise \`division\`, \`organization\` | — | enterprise \`employeeNumber\` | enterprise \`costCenter\` | enterprise \`manager.value\` |

Imported org units are keyed by source and path (for example \`company:acme/division:operations/department:finance\`, or \`ou:/engineering/web\` for Google), so a re-sync updates the same units instead of duplicating them. A renamed department gets its new name; a sync never deletes units (an emptied department stays until you delete it). Only memberships the same source created are moved or removed; people you added to a unit by hand stay.

## Importing from CSV

**Organization → Manage → Import / export** takes a CSV file (UTF-8, up to 5 MB and 10,000 rows):

| Column | Meaning |
|---|---|
| \`email\` | Required; identifies the member. Rows for people who are not members are errors — invite them first, an import never creates accounts. |
| \`display_name\` | Optional, for your reference. |
| \`manager_email\` | The person's manager (a member of the workspace). |
| \`job_title\`, \`location\`, \`employee_id\`, \`cost_center\` | People attributes. |
| \`division\`, \`department\` | Org units: the division, then the department inside it, created when missing (source \`csv\`). |
| \`team\` | One or more team names separated by \`;\`. The person is added to each (teams are created when missing); an import never removes anyone from a team. |

1. **Download the template** (or export the current structure) to get the headers.
2. Upload the file and check the **column mapping**: headers are matched by name and common synonyms (*Email Address*, *Manager*, *Title*, *Dept*, *Cost Centre*), and you can map any column to any field or skip it.
3. The **dry run** lists every row as *create* (the person gets attributes, a manager, a unit or a team for the first time), *update*, *unchanged* or *error*, with its changes, the org units and teams that would be created, and any manager **loops** the file would create. Nothing is written yet.
4. **Apply** checks the file again on the server and writes the valid rows; rows with errors are skipped. One audit entry records the import.

A blank cell leaves the value as it is; a single \`-\` clears it (manager, attributes, division / department). Rows that would change attributes owned by directory sync are errors (detach them first).

**Export** downloads the current structure as CSV in the same format, one row per active member, so you can edit it in a spreadsheet and import it back. Cells that a spreadsheet would treat as a formula are prefixed with \`'\`.

## API, MCP and CLI

| | REST | MCP |
|---|---|---|
| Org chart | \`GET /api/v1/org/chart\` | \`org_chart\` |
| A person in context | \`GET\` / \`PATCH /api/v1/org/people/{id}\`, \`POST /api/v1/org/people/{id}/detach\` | \`org_person_get\`, \`org_person_update\`, \`org_person_detach\` |
| Reports, chain, peers | \`GET /api/v1/org/people/{id}/subordinates\` (\`depth=direct\` or \`all\`, \`include_self\`), \`…/manager-chain\`, \`…/peers\` | \`org_subordinates\`, \`org_manager_chain\`, \`org_peers\` |
| A person's teams and projects | \`GET /api/v1/org/people/{id}/teams\`, \`…/projects\` | \`org_person_get\`, \`projects_mine\` |
| People in a scope | \`GET /api/v1/org/scope\` (\`scope\` = \`me\`, \`direct_reports\`, \`all_reports\`, \`team\`, \`org_unit\` or \`project\`, with \`id\`) | \`org_scope_resolve\` |
| Org units | \`/api/v1/org/units\`, \`/api/v1/org/units/{id}\`, \`…/detach\`, \`…/members\`, \`…/members/{userId}\` | \`org_units_list\`, \`org_unit_get\`, \`org_unit_create\`, \`org_unit_update\`, \`org_unit_delete\`, \`org_unit_detach\`, \`org_unit_members\`, \`org_unit_member_add\`, \`org_unit_member_remove\` |
| Team tree | \`GET /api/v1/org/teams\`, \`GET /api/v1/org/teams/{id}/members\` (\`recursive\`) | \`org_team_tree\`, \`org_team_members\` |
| CSV | \`GET /api/v1/org/export\`, \`GET /api/v1/org/import/template\`, \`POST /api/v1/org/import\` (\`dry_run\` defaults to true) | \`org_export\`, \`org_import\` |
| Projects | \`/api/v1/projects\`, \`/api/v1/projects/{id}\`, \`…/archive\`, \`…/members\`, \`…/members/{userId}\`, \`…/teams/{teamId}\` | \`projects_list\`, \`projects_get\`, \`projects_create\`, \`projects_update\`, \`projects_archive\`, \`projects_delete\`, \`projects_members\`, \`projects_member_add\`, \`projects_member_remove\`, \`projects_team_attach\`, \`projects_team_detach\` |

\`me\` works in place of a user id with a user-bound key or OAuth token. \`POST\` / \`PATCH /api/v1/teams\` also accept a team's lead, org unit, colour and kind. \`GET /api/v1/org/export\` and \`/org/import/template\` return \`{ csv, filename }\`; add \`?format=csv\` for the file. The CLI has the same operations under \`usertasks org …\`, \`usertasks org-units …\` and \`usertasks projects …\` ([CLI commands](/docs/cli/commands)); parameters are in the [API endpoint reference](/docs/api/endpoints).

## Permissions

| Permission | Allows | Default roles |
|---|---|---|
| **View organization** (\`org.view\`) | The org chart, people attributes, org units, the team tree, anyone's reports, chain and peers | Every system role, and custom roles with **View members** |
| **Manage organization** (\`org.manage\`) | People attributes and managers, org units and their members, detaching, CSV import | Owner, Admin |
| **View projects** (\`projects.view\`) | Every project with its members and teams | Every system role, and custom roles with **View members** |
| **Manage projects** (\`projects.manage\`) | Create, edit, archive and delete projects; members and attached teams | Owner, Admin, Manager |

Without these, people still see their own reporting line, reports, teams and the projects they are on. Team changes keep the team permissions (**Invite members**, **Remove members**). OAuth tokens get the four through the \`team:read\` / \`team:write\` scopes.

## Coming next

The task tracker will use this structure for "my team" and "project team" views. The building block is already available as people scopes (\`GET /api/v1/org/scope\`).
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
- **AAD group task assignment** (Entra ID): while an Entra ID connection is enabled, workflow User Tasks can be assigned to an Entra group — see [Assignment](/docs/tasks/assignment-and-slas#assignment). It reads groups and (nested) members through Graph with the permissions sync already needs (\`GroupMember.Read.All\`, \`User.Read.All\`; \`Group.Read.All\` also works).
- **Org structure**: with **Import job titles & locations** and **Import org structure (departments / divisions)** on, sync also fills job titles, departments, locations, employee ids and cost centres and builds org units — see [Importing from a directory](/docs/governance/organization#importing-from-a-directory).

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

With the org structure switches on, \`title\`, \`department\`, \`physicalDeliveryOfficeName\` and \`employeeID\` fill job title, department, location and employee id, and departments become org units — see [Organization structure](/docs/governance/organization#importing-from-a-directory).

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
- **Org structure** (optional): job title, department and cost centre from \`organizations[]\`, and org units from each user's \`orgUnitPath\` — see [Organization structure](/docs/governance/organization#importing-from-a-directory).
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
- **Org structure** (optional): \`title\` and the enterprise extension's \`department\`, \`division\`, \`organization\`, \`costCenter\`, \`employeeNumber\` and \`manager\` fill people attributes, reporting lines and org units — see [Organization structure](/docs/governance/organization#importing-from-a-directory).
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

- **Audit log** — every create, update, delete, publish and import, with who, when and which fields changed (\`usertasks audit-log list\`, needs \`settings.view\`). **Settings → Governance → Audit Log** and **Activity** filter it by object type and action. For forms it records create, update (with the new version number), Available forms toggles, grants and their removal, retention-policy changes, submission purges, legal holds and deletes (with the number of submissions, files and grants removed). Filter with \`usertasks audit-log list --object-type form\` or \`GET /api/v1/audit-log?object_type=form\`.
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

Durations are days, months or years. A policy's **Applies to** list says what it can be assigned to: data tables, individual rows, roles (review modes only) and **forms**. Assign policies to data tables, individual rows, roles and forms:

\`\`\`bash
usertasks retention create --set name="Invoices 7 years" --set policy_mode=purge_on --set duration_value:=7 --set duration_unit=years
usertasks retention assign --set target_type=data_table --set target_id=<table-id> --set retention_policy_id=<policy-id>
\`\`\`

The retention job runs daily (03:00 UTC); executions fire **Policy Executed** triggers and \`system.retention.*\` events.

### Forms and their submissions

A form's retention policy governs its **submissions**; the form itself is never purged by retention.

- **Purge modes** delete submissions as they come due: with \`purge_on\`, every submission older than the duration (each one ages from when it was submitted); with \`purge_on_exact_date\`, everything submitted before the date, once the date has come. Files uploaded with a submission are deleted with it (row and stored object), unless a task also uses them.
- **Review modes** open a review of the form (admin tasks and **Policy Review** triggers), due from when the policy was applied.
- \`keep_forever\` keeps everything. While any policy is assigned it replaces the form's own **Keep submissions** setting.
- Each purge is recorded: a retention execution event (target \`form\`, with the counts) and a \`purge\` entry in the audit log. Submission values never go into the audit log.

Assign the policy in the form's **Details → Retention**, in **Settings → Governance → Retention** (the *Forms and submissions* list shows every form's policy, status and hold), or from any surface:

\`\`\`bash
usertasks retention assign --set target_type=form --set target_id=<form-id> --set retention_policy_id=<policy-id>
usertasks forms governance <form-id>
\`\`\`

### Legal hold

Put a form on **legal hold** (form Details → Retention, \`usertasks forms legal-hold <form-id> --set hold:=true --set reason="Case 114"\`, \`POST /api/v1/forms/{id}/legal-hold\` or MCP \`forms_legal_hold\`; needs \`team.change_roles\`) and nothing of it is purged — neither by its retention policy nor by Keep submissions — and it cannot be deleted until the hold is released. Placing and releasing a hold are audited (\`legal_hold\` / \`legal_hold_release\`).

## Deletion queue

Deleting workflows, reports, data tables, integrations, decision tables, agents, custom steps, retention policies or rows goes through a queue. Dependencies are checked first (a workflow that uses an agent is deactivated, for example), the deletion runs in the background, and \`system.deletion.completed\` / \`failed\` events report the result.

Forms are deleted straight away, because form pages, package uninstalls and form themes rely on the form being gone: the delete is refused while a workflow step or start form uses the form (the usages are listed) or while it is on legal hold. Otherwise it removes the form with its versions, submissions, the files uploaded with them, and its grants, and the audit entry records how many of each were removed.
`,
  },
  {
    slug: 'governance/workspace-address',
    title: 'Workspace address',
    description: 'Give a workspace its own address (acme.usertasks.com) for friendly form links: rules and reserved names, changing it and the year-long redirect, how sign-in, membership and the current workspace work on an address, DNS setup for instance admins, and the API, MCP and CLI.',
    body: `
Every workspace can have its own web address, **\`acme.usertasks.com\`**. Members open the app there, and every reusable form gets a [friendly link](/docs/tasks/forms#friendly-form-links) on it: \`acme.usertasks.com/form/employee-onboarding\`. The main address, \`usertasks.com\`, keeps working exactly as before, so a workspace address is optional.

## Setting the address

Open **Settings → General → Workspace address**. Every member can see it; changing it needs **Edit settings**.

- **Rules:** lowercase letters a–z, numbers and hyphens, 3–40 characters. It can't start or end with a hyphen or contain two in a row.
- **Reserved names** can't be used: \`www\`, \`app\`, \`api\`, \`docs\`, \`admin\`, \`mail\`, \`status\`, \`cdn\`, \`static\`, \`assets\`, \`auth\`, \`login\`, \`help\`, \`support\`, \`blog\`, \`gallery\`, \`form\` and others.
- **Availability** is checked as you type. Each address belongs to one workspace.
- **New workspaces** get their organisation name (the slug you sign in with) as address when it fits these rules. Otherwise the address is empty until an admin sets one.

**Changing it breaks old links, slowly.** For a year, links to the old address redirect to the new one, and no other workspace can take the old address. After that the old links stop working. Removing the address breaks them at once. Update bookmarks, printed QR codes and shared form links when you change it. The page warns you before you save.

The address is not the organisation name people type when they sign in. That stays as it was.

## How an address behaves

- **Signed out:** you are sent to sign in, then straight back to the page you asked for. Sign-in happens on the main address, so SSO and single sign-on settings need no change.
- **A member:** the app opens in that workspace. If your current workspace was another one (or the **All organizations** view), it switches. It's the same switch as the avatar menu's, and it stays after you leave the address.
- **Signed in, not a member:** a "You don't have access to Acme" page, with **Go to my workspace** and **Use another account**.
- **No workspace has the address:** a "No workspace at this address" page (404).

One sign-in covers every workspace address, and signing out on any of them signs you out everywhere. The session cookie is shared across \`*.usertasks.com\`. It is HttpOnly, Secure and SameSite=Lax. Return links after sign-in only ever lead to our own addresses.

## API, MCP and CLI

| | REST | MCP | CLI |
|---|---|---|---|
| Read | \`GET /api/v1/workspace/address\` | \`workspace_address_get\` | \`usertasks workspace-address get\` |
| Check | \`GET /api/v1/workspace/address/check?subdomain=…\` | \`workspace_address_check\` | \`usertasks workspace-address check <subdomain>\` |
| Change / remove | \`PATCH /api/v1/workspace/address\` \`{ subdomain }\` (\`null\` removes) | \`workspace_address_set\` | \`usertasks workspace-address set <subdomain>\` |

Reading and checking are open to every member. Changing needs \`settings.edit\` and is written to the audit log with the old and new address.

## Self-hosted installs

Workspace addresses are off until you set \`APP_BASE_DOMAIN\`. They also need a wildcard DNS record and a wildcard TLS certificate. See [Self-hosting → Workspace addresses](/docs/self-hosting#workspace-addresses-optional).

## DNS setup (instance admins)

**Settings → Workspace DNS** (\`/settings/workspace-dns\`) is for instance admins (\`INSTANCE_ADMIN_EMAILS\`, like Settings → Infrastructure); everyone else gets a 404. The Workspace address card links to it.

- **Status:** live checks, kept for a minute; **Check again** re-runs them. Wildcard DNS (a random \`ut-check-…\` name must resolve), apex DNS, the nameservers and the DNS host they belong to (GoDaddy, Vercel, Cloudflare, Route 53), the \`_acme-challenge\` delegation, the wildcard certificate (issuer, expiry, valid for the name) and whether the app answers on the random name (a 404 "No workspace at this address" is the app working).
- **What to set up:** the records for your base domain, each with a copy button. On Vercel: add \`*.<base>\` under the project's **Settings → Domains**, then point DNS at Vercel. Self-hosted: the wildcard A / AAAA or CNAME, a DNS-01 wildcard certificate, and forwarding the \`Host\` header.

**GoDaddy with Vercel.** Two options:

1. **Switch the nameservers to Vercel (recommended).** Export the zone file in GoDaddy (**My Products** → the domain → **DNS**) and import every record into Vercel (\`vercel dns import <domain> <file>\`): MX, TXT (SPF, DKIM, DMARC, verification) and CNAMEs such as \`autodiscover\` for Microsoft 365. Then **DNS → Nameservers → Change Nameservers → I'll use my own nameservers**: \`ns1.vercel-dns.com\`, \`ns2.vercel-dns.com\`. Email stops if the mail records aren't copied first; propagation can take up to 48 hours.
2. **Keep GoDaddy DNS.** Add \`CNAME\` host \`*\` → \`cname.vercel-dns.com\`, and \`NS\` records host \`_acme-challenge\` → \`ns1.vercel-dns.com\` and \`ns2.vercel-dns.com\`. Vercel documents option 1 as the supported route for wildcards, so this may not get a certificate; the status shows whether it did.
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
- **Pill buttons, display headings and soft shadows:** turn on **Fully rounded (pill)** under **Shape & elevation → Buttons**, pick a display font and set **Size & headings → Heading font** to **Display font** (Fraunces is served from the app; other curated fonts come from Google Fonts), and choose **Flat**, **Soft**, **Crisp** or **Deep** shadows in **Shape & elevation** (custom shadows are lengths plus one colour per layer — no other CSS). The dark palette is the **Dark** colour set; **Mode** decides whether members follow their device (auto) or everyone sees one mode. Individual forms can override some of this with a [form mini theme](/docs/tasks/forms#themes-the-workspace-theme-and-mini-themes).
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
