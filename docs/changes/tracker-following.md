# Release notes: Task tracker → Following

The Task tracker (`/tasks/assigned`) has a new first tab, **Following**.
Click the bell on any tracker row, or **Follow** at the top of a task's
page, and the task is listed there. Coming back to the tracker shows your
followed tasks straight away.

## New

- **Following tab** (first, with a count): the followed tasks in the
  tracker's list view. It has the same columns, search, Status / Priority
  filters, Group by and pages as the other tabs. **Hide completed** leaves
  out completed and cancelled tasks.
- **Follow bell** on every tracker row, in every tab. It is
  `aria-pressed`, with the tooltip "Follow" or "Following — click to
  unfollow". It also appears as **Follow / Following** in the task page
  header, for open and closed tasks. The toggle is optimistic: if the
  server refuses, it rolls back and shows the error in the tooltip.
  Toggling refreshes the Following list and its count. The bells on a page
  of rows load in one read (`tasks.followedIds`), not one read per row.
- **Completed tasks stay** in Following, with their status, until you
  unfollow them. Deleted tasks drop out. So do tasks you can no longer
  see: visibility is checked again on every read.
- **Remembered tab**: the tracker opens on the tab you used last, stored
  per user in this browser (`localStorage`). If you haven't picked one, it
  opens on **Following** when you follow at least one task, and on
  **Assigned by me** otherwise (the old default).
- **Who can follow**: anyone who can see the task. That means its
  assignee or a collaborator, a member of the assigned team (unassigned
  team tasks), a manager of an assignee (up to 10 levels), the assigner,
  or anyone with `tasks.view_all` / `tasks.manage_queue` in the task's
  workspace. Any other task answers 404, so you can't probe for tasks.
- **API / MCP / CLI** (personal: these need a user-bound credential;
  tenant-wide keys get 403):
  - `GET /api/v1/tasks/following`: the tracker's row shape plus
    `followed_at`, sorted by due date. Takes `search`, `status`,
    `priority`, `hide_completed` and `limit` / `offset`.
  - `PUT` / `DELETE /api/v1/tasks/{id}/follow`: follow or unfollow.
    Idempotent.
  - MCP `tasks_following`, `tasks_follow`, `tasks_unfollow`
    (`tasks.view_own`).
  - CLI `usertasks tasks following`, `usertasks tasks follow <id>`,
    `usertasks tasks unfollow <id>`.

## Database: migration `20261226000000_task_followers.sql` (required)

Additive and idempotent. Until it is applied, the Following tab and the
follow buttons report a database error. Nothing else changes.

- `public.task_followers (tenant_id, user_id, task_id, created_at)`,
  primary key `(user_id, task_id)`. `tenant_id` always follows the task
  (trigger), and follows cascade when a task or user is hard-deleted. RLS
  lets a person read and delete their own rows in their member workspaces.
  INSERT works only for a task they can see. There is no UPDATE grant.
- `public.task_view_access(task, user)`: the "can see this task" rule
  above. A signed-in caller can only ask about themselves.
- `public.list_followed_tasks(user, tenant)`: the follows whose task
  isn't deleted and is still visible, newest first, at most 1000.

Check it after applying:

```sql
select to_regclass('public.task_followers');                         -- task_followers
select count(*) from pg_policies where tablename = 'task_followers';  -- 3
select proname from pg_proc where proname in ('task_view_access', 'list_followed_tasks');  -- 2 rows
```

## Notes

- The list refreshes when you toggle a bell, and when the window regains
  focus or you come back to the tab after 30 seconds. Other people's
  changes to a followed task don't push live updates to the Following tab
  yet.
- At most 1000 follows are listed (newest first).
- Followed subtasks are listed too. The other tracker tabs show top-level
  tasks only.
