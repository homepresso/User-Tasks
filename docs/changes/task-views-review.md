# Release notes: Task lists review (sorting, status, task details)

The four task lists — the **Task tracker** (`/tasks/assigned`, every tab),
**My team** (`/tasks/team`), **My tasks** (`/tasks`) and the **My tasks**
list on **Home** — now work the same way.

## New

- **Sortable columns.** Click a header to sort: ascending, then
  descending, then back to the list's own order. The header has
  `aria-sort` and its label is a button, so Enter or Space works. Empty
  values go last. Priority and status sort by meaning, and text ignores
  case and reads numbers as numbers. The sort covers the whole list before
  paging, and applies inside groups. Each list remembers it per user in
  this browser. Tracker and My team: Task, Assignee, Status, Priority,
  Progress, Due, Updated (both gain an **Assignee** and an **Updated**
  column). My tasks: Task, Status, Priority, Due, Progress; its **Sort by**
  menu is gone, and dragging to reorder clears the column sort. Home: Task,
  Due / SLA, Priority, Status, Assigned, sorted on the server because the
  list is paged there; narrow screens get a **Sort** menu.
- **Open work by default.** Completed and cancelled tasks are hidden on
  every list. **Show completed** brings them back, and the **Status** menu
  narrows the open statuses. Both are remembered per user, per list. The
  tracker's Following tab drops its own **Hide completed**: the same
  switch now covers it. My team can show closed tasks too, and its
  workload cards still count open tasks only.
- **One task detail panel**
  (`components/tasks/task-detail-panel.tsx`) when a row opens, on every
  list:
  - **Summary:** status (editable: To do / In progress / Blocked),
    priority, due date, assignee and requester.
  - **Progress:** a slider. Once it's set by hand, **Use subtask progress**
    goes back to following the subtasks.
  - **Effort:** hours logged against the estimate, the latest entries, and
    **Log effort** (hours, minutes, date, note).
  - **Subtasks:** tick them off, or **Add subtask** (new).
  - **Latest comment or activity**, the attachments count, and links to
    Open task, Open form and Process view.

  On Home it is a compact version, in a bottom sheet on phones. Escape
  closes it and returns focus to the row. The data loads only when a row
  opens: one read, `tasks.panel`.
- The Task tracker's old inline **work plan** (estimates, remaining
  effort, ETA) is gone from the list. It stays on the task page's
  **Effort** card. The tracker still shows queue order, team acceptance
  and collaborators under the panel.
- **Quick actions, Refresh and Process view on every list.** The Task
  tracker and My team gain the row **Actions** toggle (bottom sheet on
  phones), a **Refresh** button and the Process view icon.

- **Group by reporting line** (My team, and the Task tracker's Team
  members tab — the default on both, remembered per user; Person / None
  and the tracker's People / Teams stay as alternatives). It shows the
  viewer's org tree from reporting lines.
  - Level 1 is their direct reports. Each person shows an avatar, name,
    job title and open / overdue / queued counts: their own and **in
    team** (rolled up over everyone below).
  - Opening a person (chevron, `aria-expanded`, Enter / Space) shows their
    own tasks, with the same row, sort, status filter and detail panel as
    the list, and beneath them their direct reports, level by level.
  - A person's tasks are read only when they open (`tasks.reports` with
    `root` + `person`). The tree and its counts are one read
    (`tasks.teamHierarchy`, `lib/services/team-hierarchy.ts`): one people
    load and one task query for the whole subtree, no per-person reads.
  - **Expand all** / **Collapse all**. The people you opened are
    remembered per user (localStorage).
  - Search matches names, job titles and open task titles. It opens the
    path to each match and highlights it.
  - Scope: the viewer's own reporting subtree. Anyone with **View all
    tasks** can pick another root.
  - On phones it is an indented list.
- **Auto-follow what I act on.** Completing or responding to a workflow
  task follows its run (`run_followers`, source `auto`). This includes
  acting on behalf, and covers the UI, REST, MCP and the CLI: it is done
  in `lib/services/task-actions`. It applies only to people (not agents
  or credentials with no user), and only to runs they may see
  (`can_view_run_progress`). It never fails the action. A new preference,
  **Follow processes I act on** (`users.preferences.auto_follow_acted_runs`,
  default on), is in Settings → Preferences → Following, next to **Follow
  processes I start**, and as a quick toggle on the tracker's Following
  tab.
- **Following lists the open tasks of followed runs**, labelled **Via
  {workflow} · {run}** with the Process view icon. A task followed both
  ways is listed once. Finished runs drop out unless **Show completed** is
  on. The tab's count includes them. The list comes from the new
  `list_followed_run_tasks` (migration `20261228000000`), which re-checks
  run visibility on every read. Until that migration is applied, Following
  lists the directly followed tasks only. The REST / MCP following list is
  unchanged.

## Permissions

The panel shows a control only when the server would accept the change.
Otherwise it reads only, and says why.

- Progress, status, effort and subtasks need **Complete tasks** and a task
  the person can reach. That means the assignee, a collaborator, a team
  member, the assignee's manager, the assigner, or someone with **View all
  tasks**. It is the same rule (`requireTaskReach`) as
  `updateTaskField`, `logManualEffort`, `setSubtaskCompleted` and the new
  `addSubtask`.
- Status is never offered on workflow tasks, whose status follows their
  step. Completed goes through **Complete**.
- Progress, status and new subtasks need an open task. Effort and ticking
  subtasks also work on a closed task, as the server allows.
- `tasks.panel` returns nothing for a task the person can't reach, the
  same as the task page.

## Server

- New server action `addSubtask(parentTaskId, { title, due_date? })`,
  backed by `lib/services/tasks.addSubtask`. It needs **Complete tasks**
  and reach on the parent, and refuses closed parents. The subtask goes
  to the parent's assignee, with the parent's priority, last in order,
  already accepted. The parent's timeline records it.
- New UI read `tasks.panel` (`lib/services/task-panel.ts`).
- `tasks.reports` (My team) takes `includeClosed`. Its rows also carry
  `progress_pct`, `child_count`, `completed_child_count`, `updated_at` and
  `workflow_run_id`, which is additive for `GET /api/v1/tasks?scope=reports`
  and MCP. The API still lists open tasks only.
- `tasks.reports` also takes `root` (the reporting-line view: someone in
  the caller's subtree, or anyone with tasks.view_all) and `search`. New
  UI read `tasks.teamHierarchy`.
- Migration `20261228000000_followed_run_tasks.sql` (additive): not
  applied live yet.
- `home.myTasks` takes `columnSort` and `includeClosed`. The REST, MCP and
  CLI home task lists are unchanged.
