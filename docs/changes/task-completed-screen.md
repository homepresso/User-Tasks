# Release notes: Task completed screen

Completing a task with an outcome now shows a **Task completed screen** in
place of the task's tabs. It confirms what the person chose, says what
happens next in the process, and offers where to go. The wording is set
per workspace in **Settings → Task completion**, and task forms can
override it. Nothing is migrated (no database change): the setting is
stored with the workspace, and the override in the form's layout.

## What's new

- **The screen**, on desktop and phones, after completing a task on the
  task page or with the task form's buttons:
  - a heading with an icon, for example **Approved: Invoice #1042**. The
    tone follows the outcome (same mapping as Home → My activity):
    approvals and plain completions are success, reject and send back are
    warning, other choices are neutral;
  - **What you chose**: the outcome and the time;
  - **What happens next**: **Now with Finance (Priya Shah)**, **Process
    complete** or **Waiting on …**. It is worked out on the server from the
    run and the tasks it created, with names and step labels only. While
    the queue is still moving the run on it shows **Processing…** and asks
    again for a few seconds;
  - **Next task** (your next open task in the Home "My tasks" order;
    hidden when there is none), **Back to my tasks** or **Back to Home**
    (Esc does the same), and **View flow** for workflow tasks (the full
    run view or the submitter-safe one, by permission).
  - The heading takes focus and the screen is announced to screen readers.
- **Settings → Task completion** (needs **Edit settings**): turn the screen
  on or off, and set the heading and subheading templates, the three
  "what happens next" lines, button labels and which buttons show, and
  where Back goes. A live preview shows four cases. Templates take
  `{{task.title}}`, `{{outcome}}`, `{{next.step}}`, `{{next.assignee}}`,
  `{{user.name}}` and `{{process.name}}`, inserted with the variable
  picker.
- **Per task form**: the form designer's **Buttons & header → Task
  completed screen** overrides any of it for that form. Blank fields
  inherit the workspace wording, and each outcome can have its own heading
  and subheading. Stored as `layout.task_completed`, so it travels with
  versions, export, packages, the API, MCP and the CLI.
- **API, MCP and CLI**:
  - `GET` / `PATCH /api/v1/workspace/task-completion`, MCP
    `task_completion_settings_get` / `task_completion_settings_update`,
    `usertasks task-completion get|update`;
  - completing a workflow task (`POST /api/v1/tasks/{id}/action`, MCP
    `tasks_complete_workflow`) returns `next`, the same summary the screen
    shows, after a brief bounded wait for the queue;
  - `GET /api/v1/tasks/{id}/next`, MCP `tasks_next_step` and
    `usertasks tasks next <id>` ask again.

## Behaviour kept

- A form button that redirects, closes the form or shows its own success
  screen still does that.
- A task with several assignees that needs more responses still shows
  **Response recorded (n of m)**.
- With the screen turned off, completing a task works as before: the task
  page refreshes and shows the task completed.
- Home's task rows don't action tasks (they open the task), so they have
  no compact screen.

## Access

The next step is shown to people involved in the task (its assignee, a
collaborator, whoever actioned it) or holders of **View all tasks**. The
run follows the Home run-progress rules. Someone who acted on the task but
may not see the run, such as a manager acting on behalf, sees **The
process continues**.
