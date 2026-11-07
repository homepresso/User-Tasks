# Release notes: quick actions on the task lists

Act on a task straight from **My tasks** (`/tasks`) and Home's **My tasks**
list, without opening it.

## New

- **Actions** on every row: an inline panel under the row on desktop, a
  bottom sheet on phones (`aria-expanded` / `aria-controls`, Esc closes).
  Separate from the row's details / subtasks expansion. It offers only
  what the server would allow for that task and person
  (`lib/tasks/quick-actions.ts`, read through `tasks.quickActions`):
  - the task's **outcome buttons** with an optional comment (workflow tasks
    through `completeWorkflowTask`, so multi-response tasks report
    "waiting for more responses"; standard tasks through
    `completeTaskWithOutcome`), or **Open form to complete** when required
    fields are empty, the form has a button bar or an external form
    (`/tasks/<id>?tab=form`); managers acting on behalf get **Open task to
    act** (the task page asks for their reason);
  - **Hold** (reason required) while queued, **Resume** when held
    (`respondToTask`);
  - **Redirect** — one person or many, the task's recipient limit, email +
    invite when allowed (`rerouteTask('redirect')`);
  - **Invite someone** — add collaborators and stay on the task (new
    `inviteToTask` server action), for tasks that allow several people
    (`allow_reassign` and redirect mode *many*), within the people limit;
    a single-assignee task becomes collaborative with its assignee as
    lead, and each new person's queue rules decide Queued or added;
  - **Escalate** — your manager pre-selected (`rerouteTask('escalate')`);
  - **Accept / Decline / Claim** for queued tasks (unchanged component);
  - **Open task** and **Process view**.
  After an action the lists, Home, the task page and notifications refresh
  and a message says what happened ("Redirected to Priya Nair").
- **Process view** (renamed from *View flow* everywhere it is user-facing:
  the task page button, Home's Following / My submissions, the Task
  completed screen's default label, docs). Workflow task rows on both lists
  get a small Process view icon. Settings keys (`show_view_flow`,
  `view_flow_label`) are unchanged; a workspace that saved its own label
  keeps it.
- **Refresh** on both task lists and Home's Following / My submissions:
  refetches the list and the menu counts, spins while it runs (not with
  reduced motion), shows "Updated just now".
- `Sheet` gains `side="bottom"` (phone bottom sheets).

## Changed

- `/tasks`: the expanded row no longer carries its own outcome / redirect /
  escalate buttons (they could complete a task whose form had required
  fields, and offered Escalate to people who weren't the assignee); the
  row's **Actions** replaces them.
- `tasks.list` rows include `workflow_run_id`; Home task rows include
  `run_id`.

## Notes

- The server has no "comment required" rule for outcomes; the panel
  requires a reason only where the server does (Hold; Decline).
- Home's rows already show the current stage (Stage / team column); the
  `/tasks` list doesn't add a per-row stage hint (it would need a per-run
  read).
