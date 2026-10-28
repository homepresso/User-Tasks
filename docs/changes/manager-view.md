# Release notes: assignee-only workflow tasks, reporting lines and the manager view

Until now any workspace member with **Complete tasks** could complete
anyone's workflow task: from the task screen, the API, MCP or by writing to
the database directly. A workflow task is now actioned by its assignee
only. Managers get a view of their reports' work and can act on a task on
the assignee's behalf, with a reason that is recorded and shown to the
assignee.

## Changed

- **Workflow tasks are assignee-only** on every surface: the task screen
  (outcome buttons, form buttons, **Save**), `POST /api/v1/tasks/{id}/action`
  (`accept`, `hold`, `reject`, `complete`), `PATCH /api/v1/tasks/{id}`
  values, the MCP tools `tasks_complete_workflow`, `tasks_complete`,
  `tasks_respond` and `tasks_update`, the CLI and agent action tools. Who may act:
  - the assignee, or a collaborator on a collaborative task;
  - a member of the assigned team, for a team task with no individual
    assignee (there is no separate claim step: the team is the assignee);
  - the assignee's manager, acting on their behalf with a note;
  - a holder of the new **Complete any task (break-glass)** permission
    (`tasks.complete_any`, Owner only by default), also on behalf with a
    note, recorded as break-glass.

  Everyone else gets 403 (404 for another workspace's task, 409 once the
  task is closed). There is no admin override beyond `tasks.complete_any`.
  Standard tasks you create by hand keep their rules.
- **Workspace API keys** (no user) need `tasks.complete_any` to complete a
  workflow task. Legacy keys without an explicit permission list have
  every permission, so they keep working; keys with an explicit list need
  the permission added.
- **Resuming a user task's event directly** (`POST /api/events/complete`
  from a session, `POST /api/v1/workflows/events/{id}/complete`, the agent
  tool `complete_server_event`) is refused with 409. Complete the task
  instead.
- **Database:** an end-user database caller (PostgREST with a user's JWT)
  can no longer complete a workflow task, change its outcome, `actioned_*`
  columns or form values, or write `task_responses`. The app writes them
  with the service role after the assignee check.
- **`enqueue_workflow` and `enqueue_workflow_batch` are service-role only.**
  Signed-in users could call them directly with any trigger data. The app
  already enqueued manual runs after the `workflows.activate` check; the
  data-table trigger path and `POST /workflows/start` now enqueue with the
  service role too, and the tasks trigger (`fn_enqueue_task_workflows`)
  runs with definer rights so task writes still queue their `task_*`
  workflows. `reassign_task` and `escalate_task` (no app callers, no
  assignee check) are revoked from signed-in users as well.

## New

- **Reporting lines:** each member can have a manager in each workspace
  (`user_memberships.manager_user_id`). Edit them on the **Team** page
  (**Reporting lines**), with `GET`/`PUT /api/v1/users/{id}/manager`,
  `GET /api/v1/users/{id}/reports` (`indirect=true` for every level),
  MCP `users_manager_get`, `users_manager_set` and `users_reports`, or
  `usertasks users manager|set-manager|reports`. Loops and non-members are
  refused.
- **Directory sync** fills reporting lines from the directory: Entra ID
  `manager`, Okta `profile.managerId`, Google Workspace `relations` of type
  `manager`, LDAP / Active Directory `manager` (a new attribute mapping
  key) and the SCIM enterprise extension's `manager.value`.
- **Tasks → My team** (managers only): the open tasks of your direct
  reports, or every level with **Include indirect reports**. Workload per
  person (open, overdue, SLA breached), filters for person, status,
  priority, workflow, overdue and SLA breached, grouping by person,
  **Act on behalf** and **Reassign** (to another report or to yourself).
  Phones show the list read-only. Same data: `GET /api/v1/tasks?scope=reports`,
  MCP `tasks_list` with `scope: "reports"` and `usertasks tasks team`.
- **Acting on behalf:** on a report's task a banner asks for a reason. The
  response counts as the assignee's. The task records `actioned_by` (the
  manager) and the new `actioned_on_behalf_of` (the assignee); the history
  shows *on behalf of …*; the lifecycle event, the event stream
  (`task.task_response`) and log export carry `on_behalf_of`,
  `on_behalf_note` and `acted_as`; an audit row is written; the assignee
  gets a notification and an email. The resumed workflow sees
  `{{actioned_on_behalf_of}}`, `{{actioned_on_behalf_of_name}}` and
  `{{on_behalf_note}}`, and `{{task.actioned_on_behalf_of}}` is set.
  By API: `"on_behalf": true` with `"on_behalf_note"`; CLI
  `usertasks tasks complete <id> --on-behalf --note "…"`.

## Upgrading

Apply `supabase/migrations/20261118000000_manager_tasks.sql`. It adds the
reporting-line and on-behalf columns, the workflow-task guard, the
`tasks.complete_any` permission (added to every workspace's Owner role)
and the queue-function grants. Deploy the app with it: older app builds
call `enqueue_workflow` with the signed-in user's client from
`POST /workflows/start` (async) and data-table writes.

Before you upgrade, check who completes workflow tasks that are not
theirs today (people who will get 403 afterwards) and which workspace API
keys complete workflow tasks.
