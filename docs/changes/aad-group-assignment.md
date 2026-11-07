# Release notes: AAD (Entra ID) group task assignment

Workflow User Tasks can be assigned to a Microsoft Entra ID (Azure AD)
group. The option appears only in workspaces with an enabled Entra ID
directory connection; elsewhere the Assignment control shows Individual
and Team only (the old disabled "AAD Group (soon)" placeholder is gone).

## New

- **AAD Group** in the User Task's **Assignment** control, shown when the
  workspace's Entra ID directory connection (Settings → SSO & Directory) is
  enabled and has credentials. Pick the group from a search: the groups
  directory sync stored (when **Sync groups as teams** is on), else a live
  Microsoft Graph search, 25 at a time with **Load more**.
- **Two modes**:
  - **Anyone in the group can claim it** (`aad_group_mode: "claim"`,
    default): one task, queued for every member with **Claim**. The first
    claim wins (409 for the others) and the task leaves the other members'
    lists. It completes on the claimer's response.
  - **Everyone in the group gets it** (`aad_group_mode: "everyone"`): one
    collaborative task with every member as an assignee; the step's
    **Completion rule** (first response, all, consensus, unanimous,
    custom) decides when it is done.
- **Include members of nested groups** (`aad_include_nested`, default on):
  Graph's transitive members; off reads direct members only.
- **Run time**: members are read from Microsoft Graph when the step runs
  (cached 5 minutes per workspace and group; 429 / 503 honour
  Retry-After), matched to people through directory sync's links, then by
  email, and kept only when they have an active membership in the
  workspace. The run log notes how many were skipped and why. Each
  person's queue rules (or the step's **Queue behaviour**) decide whether
  the task is queued or added for them; every member is notified. A group
  with exactly one matching member assigns the task to them directly; at
  most 500 people get one task.
- **Fallbacks**: no member matches, Entra ID has been disconnected, or the
  group is missing → the task is created unassigned (the step's existing
  no-assignee behaviour) with a warning in the run log. When Graph can't
  be reached but directory sync keeps a team for the group, the task goes
  to that team instead (claim) or to its members (everyone).
- **Designer warnings**: a step saved with an AAD group in a workspace
  whose Entra ID connection was later removed keeps its settings, shows a
  warning, and fails workflow validation ("AAD group assignment needs an
  enabled Entra ID directory connection").
- **API / MCP / CLI**: `GET /api/v1/directory-sync/capabilities`
  (`{ entraGroups, syncedGroups }`), `GET /api/v1/directory-sync/entra/groups`
  (`search`, `limit`, `cursor`) — both need **View workflows**; MCP
  `directory_capabilities` and `directory_entra_groups_search`; CLI
  `usertasks directory-sync capabilities` and `usertasks directory-sync groups`.
  Workflow definitions carry the new keys (`assignment_type: "aad_group"`,
  `aad_group_id`, `aad_group_name`, `aad_group_mode`, `aad_include_nested`)
  unchanged through REST, MCP, config as code and exports; MCP
  `workflows_preflight` checks them against the workspace.

## Admin: Microsoft Graph permissions

Nothing new to grant. The Entra ID app registration used for directory
sync already has what this needs (**application** permissions with admin
consent):

- `User.Read.All` — members' mail / user principal name for matching;
- `GroupMember.Read.All` — lists groups (the designer's live search) and
  reads direct and transitive (nested) members. `Group.Read.All` works
  too, in place of it.

When Graph refuses (401 / 403) the designer's search says which permission
to grant, and a running step falls back as described above.

## Changed

- Claiming: `POST /api/v1/tasks/{id}/claim` (and the app's **Claim**, MCP
  `tasks_claim`) also claims AAD group tasks for their candidates.
  Candidates are `task_assignees` rows with role `candidate`; after a claim
  only the claimer stays (role `lead`).

No database migration: `tasks.assignment_type` and `task_assignees.role` are
free text.
