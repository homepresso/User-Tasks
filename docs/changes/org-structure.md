# Release notes: organization structure, org units and projects

Workspaces get an organization structure: reporting lines drawn as an org
chart, people attributes (job title, department, location, employee id,
cost centre), org units (company / division / department), richer teams
and projects. It can be built by hand, imported from a directory (Okta,
Entra ID, Google Workspace, LDAP / Active Directory, SCIM) or from CSV, and
read through the API, MCP and CLI. The task tracker will use it next for
"my team" and "project team" views; nothing in task handling changes in
this release.

## New

- **Organization page** (`/org`, sidebar **Organization**): four views,
  each with a chart and an accessible list, and an indented list on phones.
  - **People**: the org chart from reporting lines (avatar, name, title,
    department, direct-report count), expand / collapse, pan and zoom,
    search, **Show me**; a person's side panel shows their manager chain,
    direct reports, teams, projects and org units.
  - **Org units**: the division / department tree with heads and headcounts.
  - **Teams**: nested team cards with lead, member avatars, org unit and
    projects.
  - **Projects**: project cards; `/org/projects/{id}` shows the project's
    team (direct members with role and allocation, and attached teams).
- **Organization → Manage** (`/org/manage`): edit people's manager and
  attributes, org units (create, rename, move, head, members, primary
  unit, delete), teams (lead, org unit, colour, kind) and projects (create,
  edit, archive, delete, members with roles and allocation, attached
  teams); **Import / export** for CSV.
- **CSV import and export**: columns `email`, `display_name`,
  `manager_email`, `job_title`, `department`, `division`, `location`,
  `employee_id`, `cost_center`, `team`; column mapping, a dry run that
  shows each row as create / update / unchanged / error, the org units and
  teams to be created and manager loops, then apply (up to 5 MB / 10,000
  rows). Imports never create accounts or remove anyone from a team; a
  blank cell leaves a value unchanged and `-` clears it; `team` takes
  several names separated by `;`. A template download and an export in
  the same format.
- **Directory sync imports the org structure** (two switches per
  connection: **Import job titles & locations** and **Import org structure
  (departments / divisions)**):
  - Entra ID: `jobTitle`, `department`, `companyName`, `officeLocation`,
    `employeeId`;
  - Okta: `title`, `department`, `division`, `organization`, `costCenter`,
    `employeeNumber`;
  - Google Workspace: `organizations[].title` / `department` /
    `costCenter`, org units from `orgUnitPath`;
  - LDAP / AD: `title`, `department`, `physicalDeliveryOfficeName`,
    `employeeID`;
  - SCIM: `title` and the enterprise extension's `department`, `division`,
    `organization`, `costCenter`, `employeeNumber`.
  The existing manager mapping is unchanged. Imported org units are keyed
  by source and path, so re-syncs update them instead of duplicating;
  syncs never delete units and only move memberships they created.
- **Detach**: imported people attributes and org units are read-only in
  the editor until detached; after that the import leaves them alone.
- **API**: `/api/v1/org/chart`, `/api/v1/org/people/{id}` (+ `/detach`,
  `/subordinates`, `/manager-chain`, `/peers`, `/teams`, `/projects`),
  `/api/v1/org/scope`, `/api/v1/org/units` (+ `/{id}`, `/detach`,
  `/members`, `/members/{userId}`), `/api/v1/org/teams` (+
  `/{id}/members`), `/api/v1/org/export`, `/api/v1/org/import/template`,
  `POST /api/v1/org/import` (`dry_run` defaults to true), `/api/v1/projects`
  (+ `/{id}`, `/archive`, `/members`, `/members/{userId}`,
  `/teams/{teamId}`). The export and template endpoints return
  `{ csv, filename }` as JSON; add `?format=csv` for the file itself.
  33 MCP tools, `org_*` and `projects_*`. Reads of your own data
  (`org_person_get`, `org_subordinates`, `org_manager_chain`, `org_peers`,
  `org_scope_resolve`, `projects_mine`, `projects_get`,
  `projects_members`) are gated at `tasks.view_own`, and the service
  requires `org.view` / `projects.view` to read anyone else; org-wide
  reads need `org.view` / `projects.view`, writes (and `org_import`, even
  as a dry run) `org.manage` / `projects.manage`. CLI:
  `usertasks org chart|person|update-person|detach-person|reports|manager-chain|peers|teams|projects|scope|team-tree|team-members|export|import|import-template`,
  `usertasks org-units …` and `usertasks projects …`.
- **People scopes** (`GET /api/v1/org/scope`, MCP `org_scope_resolve`):
  the people in `me`, `direct_reports`, `all_reports`, a team, an org unit
  or a project — the query the task tracker views will build on.
- **Permissions**: `org.view` (every system role, and custom roles with
  `team.view_members`), `org.manage` (Owner, Admin), `projects.view` (every
  system role, and custom roles with `team.view_members`),
  `projects.manage` (Owner, Admin, Manager). OAuth `team:read` /
  `team:write` include them.

## Changed

- **Teams** have a lead, an org unit, a colour and a kind (`team`,
  `squad`, `guild` or custom), accepted by `POST` / `PATCH /api/v1/teams`
  and the MCP team tools. A team can no longer be moved inside one of its
  own sub-teams (the database refuses team loops).
- **Managers** can be changed from the Organization editor with
  `org.manage` as well as `team.change_roles`.
- A member who leaves a workspace is removed from its org units and
  projects and stops being a unit head or team lead.
- The audit log has the object types **Org unit** and **Project**.

## Database

Migration `20261224000000_org_structure.sql`:

- `user_memberships`: `job_title`, `department`, `location`,
  `employee_id`, `cost_center`, `profile_source` (`manual` / `directory`),
  `profile_updated_at`;
- `org_units`, `org_unit_members` (parent in the same workspace, loops
  refused, unique `(tenant_id, source, external_id)`, one primary unit per
  person);
- `projects` (key unique per workspace ignoring case), `project_members`,
  `project_teams`;
- `teams.lead_user_id`, `org_unit_id`, `colour`, `kind` and a team-loop
  trigger;
- RLS: members read their workspace's rows; writes need `org.manage` or
  `projects.manage` in the row's workspace (the app writes with the
  service role after the same checks);
- the four permissions in `seed_tenant_roles` and existing roles.

## Upgrade notes

- **Apply `20261224000000_org_structure.sql` before deploying the app.**
  The new pages, API and directory sync read the new tables and columns.
  The migration only adds objects and is idempotent; the previous app
  version keeps working after it is applied.
- **Existing directory connections start with both import switches off**,
  so the first sync after the upgrade changes nothing new. New connections
  have them on. Turn them on in **Settings → SSO & Directory** when you
  want the directory's titles, departments and org units.
- `PERMISSION_PAYLOAD_VERSION` is bumped, so signed-in sessions refresh
  their permissions and pick up `org.view` / `projects.view` without
  signing out.
- API keys with an explicit permission list need the new permissions
  added to use the org and project endpoints; keys without a list (every
  permission) work as before.

Docs: **Governance and security → Organization structure**
(`/docs/governance/organization`).
