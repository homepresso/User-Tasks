# Release notes: unread tasks

A task you haven't opened since it became yours now looks new on your task
lists: a small accent dot before its title, and the title in bold, as on the
product demo. The side menu shows how many are unread next to **My tasks**.

## New

- **The unread dot.** My tasks (table and phone cards), the **My tasks** list
  on Home and the Task tracker (its **Following** tab especially) mark unread
  tasks with an accent dot and a bold title. The dot is the theme's accent
  text colour, which every theme derives to AA on cards in light and dark, so
  it clears the 3:1 contrast a non-text indicator needs. Screen readers hear
  "Unread" before the title.
- **The rule.** A task is unread for you while it is open (to do, in
  progress or blocked), you hold it (assignee, collaborator or claim
  candidate, or a member of the assigned team of an unassigned team task)
  and you haven't opened it since it became yours: assigned or reassigned to
  you or your team (delegated, escalated, redirected, claimed), or back to
  work (reopened, published from a draft, sent back as a new task). Edits to
  fields, comments and progress don't make it unread again. Completed,
  cancelled and draft tasks are never unread.
- **Reading.** Opening a task marks it read: its page and form, or its
  details under a list row. **Mark as unread** (a row's **Actions**, or the
  top of the task page) brings the dot back; **Mark all as read** on the
  lists clears them.
- **Counts.** The side menu (and the phone menu and tab bar) show the unread
  count next to My tasks; the My tasks header says how many unread tasks the
  list holds.
- **API, SDK, CLI, MCP.** Task list and get responses carry `unread` for the
  credential's person (`false` for a credential with no user):
  `GET /api/v1/tasks`, `/tasks/{id}`, `/tasks/assigned`, `/tasks/following`;
  MCP `tasks_list`, `tasks_get`, `tasks_following`. New:
  `PUT` / `DELETE /api/v1/tasks/{id}/read`, `POST /api/v1/tasks/read-all`,
  `GET /api/v1/tasks/unread-count`; MCP `tasks_mark_read`,
  `tasks_mark_unread`, `tasks_mark_all_read`, `tasks_unread_count`; CLI
  `usertasks tasks mark-read | mark-unread | mark-all-read | unread-count`;
  SDK operations `markTaskRead`, `markTaskUnread`, `markAllTasksRead`,
  `countUnreadTasks`. Personal: they need a credential bound to a user.

## Upgrading

Apply `20270115300000_task_reads.sql` (additive, idempotent, safe before or
after the code). It adds `tasks.routed_at` without rewriting the table, the
`task_reads` table with its RLS, the rule (`task_unread_ids`) and the counts,
and marks every task that is open at that moment as read for its current
holders, so nothing turns bold on upgrade day. Until it is applied the app
shows no unread state and the mark endpoints report a database error.
