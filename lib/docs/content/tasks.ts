import type { DocPageDef } from '../types'
import { CUSTOM_FORM_CONTROLS_PAGE } from './custom-form-controls'
import { GALLERY_FORM_CONTROLS_PAGE } from './gallery-form-controls'

export const TASK_PAGES: DocPageDef[] = [
  {
    slug: 'tasks',
    title: 'Tasks',
    description: 'Human work inside automated processes: one task list with queued tasks and personal queue rules, assignment, lifecycle, outcomes and the Task completed screen — or your own front end.',
    body: `
A task is a unit of work for a person. Most tasks are created by **User Task** nodes, which pause a run until the task is completed; tasks can also be created by hand, by the API, or ingested from another workflow engine.

::image task-detail | A task with typed fields and Approve / Reject outcome buttons | Task detail: the request, typed fields to fill in, and one button per outcome.

## Where people work

- **My tasks** — the signed-in user's one task list, with filters and saved views. Tasks waiting for your response are in it with the status **Queued** (see [Queued tasks](#queued-tasks)).
- **My team** — for managers: the open tasks of the people who report to you (see [Manager view](/docs/tasks/manager-view)).
- **Task tracker** — the work you assigned to others, your team members' work, or every task, in tabs: **Following**, **Assigned by me**, **Team members** and **All tasks** (see [Following tasks](#following-tasks)).
- **Task detail** — description, fields, outcome buttons, notes, files, subtasks and history.

## Task lists: sorting, status and details

My tasks, My team, the Task tracker and the **My tasks** list on Home work the same way.

**Sorting.** Click a column header to sort by it: once for ascending, again for descending, a third time to go back to the list's own order. The arrow shows the direction; keyboard users press Enter or Space on the header. Tasks with no value (no due date, no assignee) go last either way. Priority sorts critical → low; status sorts queued and blocked work before to do, in progress, completed. The sort covers the whole list before it is split into pages, and applies inside each group when the list is grouped. Each list remembers your sort, per user, in this browser. The sortable columns are Task, Assignee, Status, Priority, Progress, Due and Updated (Task tracker and My team); Task, Status, Priority, Due and Progress (My tasks — dragging a row to reorder clears the column sort); Task, Due / SLA, Priority, Status and Assigned (Home — the list is paged on the server, so the server sorts it; on a narrow screen a **Sort** menu replaces the headers).

**Status.** Every list shows open work by default — everything except **Completed** and **Cancelled** (My tasks and Home also show **Queued**). Turn on **Show completed** to bring closed tasks back. The **Status** menu narrows the open statuses; nothing picked means all of them. The choice is remembered per user, per list, in this browser. On the tracker's **Following** tab the same switch replaces the old **Hide completed**. On **My team**, completed tasks are opt-in too, and the workload cards still count open tasks only.

**Opening a task.** Click a row (or press Enter on its title) to open its details under the row. On Home on a phone they open in a bottom sheet. Escape closes them. The details are the same on every list:

- **Summary** — status, priority, due date, assignee and requester.
- **Progress** — a slider (5% steps) and the percentage. When the task has subtasks, its progress follows them until you set it yourself; **Use subtask progress** goes back.
- **Effort** — hours logged against the estimate (the assignee's estimate, else the assigner's), the latest entries, and **Log effort**: hours, minutes, date and a note. Each entry adds to the task's actual effort and goes on its timeline.
- **Subtasks** — tick them off, or **Add subtask**: it goes to the task's assignee, with the task's priority, at the end of the list.
- **Latest comment or activity**, the number of **attachments**, and links to **Open task**, **Open form** (tasks with a form) and **Process view** (workflow tasks).

**Status** can be set to To do, In progress or Blocked. You complete a task with **Complete** in the row's **Actions** (the quick actions) or on the task page. A workflow task's status follows its workflow step, so it isn't offered there.

**Who can change what.** The details show controls only when the server would accept the change. Otherwise they are read-only, with the reason. Changing progress, status, effort and subtasks needs **Complete tasks** and a task you can reach: you're its assignee or a collaborator, a member of its team, the assignee's manager, the person who assigned it, or you have **View all tasks**. Progress, status and new subtasks need an open task. You can still log effort and tick subtasks on a closed task. Assigners and managers on the Task tracker and My team can therefore update the tasks they assigned or oversee, if their role has **Complete tasks**. The work plan (estimates, remaining effort, ETA) stays on the task page's **Effort** card.

Because UserTasks is headless, you can also build your own task inbox: list tasks with \`GET /api/v1/tasks/assigned\` and complete them with \`POST /api/v1/tasks/{id}/action\` (see [Completing tasks by API](/docs/tasks/api)).

## Following tasks

Click the bell on any task in the Task tracker — or **Follow** at the top of a task's page — to follow it. Followed tasks are listed in the tracker's first tab, **Following**, with a count, so you can come back to the tracker and see them straight away.

- The list has the tracker's columns, sorting, search, **Status** and **Priority** filters, grouping and pages. Completed and cancelled tasks are hidden unless **Show completed** is on (the same switch as the other tabs).
- **Processes you follow show here too.** When you complete or respond to a workflow task, you follow its process (run). This includes acting on someone's behalf, and it works from the app, the API, MCP or the CLI. The open tasks of the processes you follow are listed in **Following**, labelled **Via {workflow} · {run}**, with the Process view icon, so you can watch the request move through its later steps. Processes you started (Home → Following) count too. A task you follow directly and through its process is listed once. When a process finishes, its tasks drop out unless **Show completed** is on. You only see the tasks of processes you can still see in the Process view. To turn this off, switch off **Follow processes I act on** in **Settings → Preferences → Following** or on the Following tab. It is on by default, and processes you already follow stay followed.
- A completed task stays in the list, with its status, until you unfollow it. A deleted task drops out. So does a task you can no longer see.
- You can follow a task you can see: you're its assignee or a collaborator, you're in the team it's assigned to (before anyone claims it), you manage an assignee, you assigned it, or you have **View all tasks** or **Manage queue** in its workspace.
- The bell is filled when you follow the task. Click it again to unfollow.
- The tracker opens on the tab you used last, in this browser. If you haven't picked one yet, it opens on **Following** when you follow something, and on **Assigned by me** otherwise.
- API: \`GET /api/v1/tasks/following\`, \`PUT\` / \`DELETE /api/v1/tasks/{id}/follow\`. MCP: \`tasks_following\`, \`tasks_follow\`, \`tasks_unfollow\`. CLI: \`usertasks tasks following\`, \`usertasks tasks follow <id>\`, \`usertasks tasks unfollow <id>\`. These are personal, so they need a credential bound to a user.

## Descriptions: plain text or HTML

A description can be plain text or HTML. The app renders HTML formatting on the task detail page. Lists and queues show a plain-text excerpt. The **New task** form has a **Preview** toggle.

HTML is sanitised on every save, and again when it is displayed. These elements are allowed: \`p\`, \`br\`, \`div\`, \`span\`, \`hr\`, \`strong\`/\`b\`, \`em\`/\`i\`, \`u\`, \`s\`, \`sub\`, \`sup\`, \`a\`, \`ul\`, \`ol\`, \`li\`, \`h1\`–\`h4\`, \`blockquote\`, \`code\`, \`pre\`, \`table\`, \`thead\`, \`tbody\`, \`tr\`, \`th\`, \`td\` and \`img\`.

- Links may be \`http(s)\`, \`mailto\` or relative. They always open in a new tab with \`rel="noopener noreferrer"\`.
- Images need an absolute \`https\` URL.
- Everything else is removed: scripts, styles, \`style\`/\`class\`/\`id\` and \`on*\` attributes, iframes, forms, SVG and MathML, and \`javascript:\` or \`data:\` URLs.
- Text that only looks like a tag, such as \`<customer name>\`, stays as text.

In a User Task \`task_description\` template, values interpolated into HTML are escaped, so a variable cannot add markup.

## Lifecycle

| Status | Meaning |
|---|---|
| \`draft\` | Created but not yet issued |
| *Queued* | Shown in the list, not stored: an open task waiting for your response (\`acceptance_status\` \`pending\`, a pending collaborative invitation, or an unclaimed task of your team) |
| \`todo\` | Waiting to be worked on |
| \`in_progress\` | Accepted or started |
| \`blocked\` | Waiting on something else |
| \`completed\` | Done, with an outcome |
| \`cancelled\` | No longer needed |

Actions on a task — **accept**, **hold**, **reject**, **complete**, **escalate**, **redirect** — are recorded as lifecycle events, feed the event stream (\`task.*\`) and can start workflows through task triggers.

## Who can action a workflow task

A task a workflow is waiting on (a **User Task**) is actioned by its **assignee only** — on the task screen, the form buttons, the API, MCP, the CLI and agent tools alike:

- the individual assignee, or a collaborator on a collaborative task;
- for a task assigned to a **team** (no individual assignee yet): a member of that team;
- the assignee's **manager**, acting [on their behalf](/docs/tasks/manager-view) with a reason;
- a holder of **Complete any task (break-glass)** (\`tasks.complete_any\`, Owner and Admin by default), also on behalf and with a reason, recorded as break-glass.

Everyone else — admins included — sees the task read-only. Standard tasks you create by hand keep the usual rule (anyone with **Complete tasks** in the workspace).

## Unassigned tasks: take ownership

A task can end up with **nobody** on it — no assignee, no collaborators and no team (for example a User Task built without an assignee). Nobody can act on it, so it would wait forever. On such a task:

- a workspace admin (**Complete any task (break-glass)**, \`tasks.complete_any\`) or a **manager of the workflow** (an explicit Edit grant on it) sees a banner, **Nobody is assigned to this task**, with **Take ownership** and **Assign to…**;
- **Take ownership** assigns the task to you, accepted, so you can act on it at once;
- **Assign to…** picks a person or a team, with an optional reason;
- acting on it directly (an outcome button, the form's buttons, \`POST /api/v1/tasks/{id}/action\`, MCP) is the same as taking ownership and then acting;
- everyone else sees the banner without the buttons and the task read-only. Members of a team still **Claim** team tasks as before.

Every change is written to the task's history (*X took ownership*, *Reassigned from … to …*), the audit log (\`reassign\` on the task, with \`took_ownership\`) and the run's **Process view**, and the new assignee is notified. The Process view's **Unassigned** chip offers **Take ownership** to the people who may, and the workflow queue's **Active tasks** tab lists every active task.

## Reassigning a task

Besides the assignee's own **Reassign…** (when the step allows redirects), **Reassign…** in the task's **More actions** menu is offered to the assignee's manager (anyone in their manager chain), a manager of the workflow and admins (\`tasks.complete_any\`). Pick a person or a team and give a reason; both the new and the previous assignee are notified, and the history, audit log and process view record it.

## Task completed screen

When someone completes a task with an outcome, on the task page or with the task form's buttons, the **Task completed screen** replaces the task's tabs. It confirms what they did and says what happens next:

- **A heading with an icon**, for example **Approved: Invoice #1042**. The icon and colour follow the outcome, using the same mapping as Home → My activity: approve-like outcomes and plain completions (**Done**, **Submitted**) are green, **Reject** and **Send back** are amber, and any other choice (**Escalate**) is neutral.
- **What you chose**: the outcome and the time.
- **What happens next**, read after the task is completed:
  - **Now with Finance (Priya Shah)**: the step the process moved to and who has it (the person, the team, or both);
  - **Process complete**: the run finished;
  - **Waiting on Payment run**: a timer, an event, or a step nobody has yet;
  - **Processing…** while the queue is still moving the run on. The screen asks again every second for a few seconds, then says **The process continues**.

  Only step names and people's names are shown, never the run's data. Someone who acted on the task but may not see the run (a manager acting on behalf) sees **The process continues**.
- **Buttons**:
  - **Next task** opens your next open task, in the order of Home → **My tasks** (soonest due first). It is hidden when you have none.
  - **Back to my tasks** (or **Back to Home**). **Esc** does the same.
  - **Process view** (workflow tasks only) opens the run: the full run view if you can see runs, otherwise the [submitter-safe progress view](/docs/home).

The heading takes focus and the screen is announced to screen readers. It works the same on phones. A form button whose behaviours redirect, close the form or show their own success screen keeps doing that; a task with several assignees that still needs more responses shows **Response recorded** instead.

### The wording

The wording comes from **Settings → Task completion** (see [Task completion settings](/docs/tasks/completion-settings)). A task form can override it in the form designer: **Buttons & header → Task completed screen** (task forms only). Every field there is optional, and a blank field uses the workspace's wording. You can also give each outcome its own heading and subheading, so **Reject** can read differently from **Approve**. The preview shows the screen for each outcome.

Templates take these placeholders. Type \`{\` in a field to pick one:

| Placeholder | Value |
|---|---|
| \`{{task.title}}\` | The task's title |
| \`{{outcome}}\` | The outcome chosen ("need_more_info" reads "Need more info") |
| \`{{next.step}}\` | The step the process moved to |
| \`{{next.assignee}}\` | Who has it now: "Priya Shah", "Finance" or "Finance (Priya Shah)" |
| \`{{user.name}}\` | Your name |
| \`{{process.name}}\` | The workflow's name |

A placeholder with no value is left out, along with a separator it leaves dangling (\`{{outcome}}: {{task.title}}\` reads "Approved" when there is no title). A heading or label that comes out empty uses the built-in wording.

The override is stored in the form's layout, so it travels with versions, export, packages, the API, MCP and the CLI:

\`\`\`json title="A task form's own wording (layout)"
{
  "rows": [],
  "task_completed": {
    "heading": "Thanks, {{user.name}}",
    "back_target": "home",
    "show_view_flow": false,
    "outcomes": { "Reject": { "heading": "Sent back: {{task.title}}", "subheading": "The requester will be told why." } }
  }
}
\`\`\`

### API, MCP and CLI

Completing a workflow task with \`POST /api/v1/tasks/{id}/action\` (\`action: "complete"\`) or the MCP tool \`tasks_complete_workflow\` returns the same summary as \`next\`: \`state\` (\`assigned\`, \`waiting\`, \`complete\`, \`processing\`, \`stopped\`, \`none\` or \`unknown\`), \`steps\` (step names with the people and team), \`process\` and \`run_id\`. The response waits up to about three seconds for the queue. If \`state\` is still \`processing\`, ask again with \`GET /api/v1/tasks/{id}/next\`, the MCP tool \`tasks_next_step\` or \`usertasks tasks next <id>\`.

## Queued tasks

There is one task list. When a task is assigned to you, it is either **added** straight to **My tasks** or **queued**: it is in **My tasks** too, with the status **Queued**, until you respond. Choose **Queued** in the **Status** filter to see only these (old links to \`/tasks/queue\` open \`/tasks?status=queued\`). The side menu's **My tasks** count includes them.

- **Accept** makes the task yours (it moves to *In progress*); **Decline** asks for a short reason, cancels it for you and fires **Task Rejected** triggers so a workflow can reroute it.
- A task assigned to a **team** with no assignee yet is queued for every member, with **Claim**: the first member to claim it becomes its assignee. An **AAD group** task in claim mode works the same way for the group's members.
- **Hold**, **Redirect**, **Escalate** and completing with an outcome are on the task page, and in each row's **Actions** (below).

::image tasks-queue | The task list | The task list with priorities, due dates and SLA state.

## Quick actions from the task list

Each row of **My tasks** (\`/tasks\`) and of Home's **My tasks** list has an **Actions** button. It opens a panel under the row (on a phone, a sheet from the bottom of the screen) with what you may do with that task, without opening it. Clicking the row still shows its details and subtasks; **Actions** is separate. Press **Esc** to close the panel.

The panel offers only what the server allows for that task and for you:

| Action | Shown when |
|---|---|
| **Outcome buttons** (*Approve*, *Decline*, the step's own outcomes; *Mark complete* for a task without outcomes), with an optional **Comment** | You can complete the task (the **Complete tasks** permission; for a workflow task, you're its assignee) and you've accepted it. A multi-response task records your response and says how many are still needed. |
| **Open form to complete** | The task must be finished in its form: required fields are still empty, the form has its own button bar, or it uses an external form. The link opens the task's **Form** tab (\`/tasks/<id>?tab=form\`). |
| **Open task to act** | You're a manager acting on behalf of the assignee: the task page asks for your reason first. |
| **Hold…** | The task is queued for you. Holding needs a reason. **Resume** appears on a task you've put on hold. |
| **Redirect…** | You're the assignee and the task allows redirecting. Pick one person, or several when the task allows many (up to its limit); **Invite by email** appears when the task allows inviting people who aren't in the organisation yet (the task stays with you until they join). |
| **Invite someone…** | You're the assignee and the task allows several people (redirect to *many*). The people you pick join the task as collaborators; you stay on it. The task's people limit counts everyone on it. |
| **Escalate…** | You're the assignee and the task doesn't turn escalation off. Your manager is chosen to start with; pick someone else if needed. A comment is optional. |
| **Accept** / **Decline** / **Claim** | The task is queued for you (or unclaimed in one of your teams). Claim a team task before acting on it. |
| **Open task**, **Process view** | Always; **Process view** for workflow tasks. |

After an action the lists, Home, the task page and your notifications refresh, and a message says what happened (for example *Redirected to Priya Nair*). A task you no longer have leaves the list; the message stays above it.

**Process view** (also a small icon on each workflow task's row, and a button on the task page) shows where the request is in its process: the full run view if you can see workflow runs, otherwise the [progress view](/docs/home#process-view).

**Refresh** (the circular arrow next to the filters, on both lists and Home's other lists) reloads the list and the menu counts, and says when it last did. The **sliders** icon next to it opens your [queue rules](#task-queue-rules).

## Task queue rules

Each person decides which new tasks are queued for them and which are added straight to their list. Open the rules from the **sliders** icon (**Queue rules**) next to **Refresh** on **My tasks** and on Home's **My tasks** list (a sheet from the bottom on a phone), or in **Settings → Preferences → Task queue rules**. Both edit the same rules; you can only ever change your own.

- **Default**: **Queue new tasks for me to accept** or **Add straight to my tasks**.
- **Rules**, checked in order. The first rule that is **on** and matches decides; a task no rule matches gets the default. Each rule has an optional **name**, an **on / off** switch, **all** or **any** (must every condition hold, or is one enough?), its conditions, and **then**: *Queue it* or *Add it straight to my tasks*. Move rules up and down, **duplicate** or remove them. Up to 50 rules, 20 conditions each; a rule with no conditions matches every task.
- **Test a task** (in the dialog) describes a sample task — priority, where it came from, who assigned it, workflow, form, team, due date, title, tags, attachments, subtask, arrival time — and shows whether your rules (unsaved changes included) queue it or add it, and which rule decided. It uses your real manager, reports and teams.

### Conditions

| Group | Condition | Operators | Value |
|---|---|---|---|
| Who it's from | **Assigned by** | is, is not, is any of, is none of | People |
| | **Assigned by (relationship)** | is, is not, is any of, is none of | *Myself*, *My manager*, *Anyone above me* (manager chain), *One of my direct reports*, *Anyone I manage* (any level), *No person* (a workflow, schedule or agent) |
| | **Assigned by a member of team** | is any of, is none of | Teams |
| | **Assigned by someone in org unit** | is any of, is none of | Org units (a member of a unit is in every unit above it) |
| | **Assigned by someone on project** | is any of, is none of | Projects (members, and members of the project's teams) |
| Where it came from | **Came from** | is, is not, is any of, is none of | *A workflow*, *Created by a person*, *A form submission*, *The API*, *An MCP client*, *An AI agent*, *Another system (ingest)*, *A redirect*, *An escalation*, *A manager's reassignment*, *An invitation to collaborate*, *An AAD group*, *A team pool* |
| | **Workflow** | is, is not, is any of, is none of | Workflows |
| | **Form** | is, is not, is any of, is none of | Forms (the task's form) |
| | **Reached me** | is, is not, is any of, is none of | *Directly to me*, *Through a team*, *Through an AAD group*, *With other people* (collaborative) |
| | **Assigned through team** | is any of, is none of | Teams |
| What it is | **Priority** | is at least, is at most, is, is not, is any of, is none of | Critical, High, Medium, Low, None |
| | **Due date** | is within, is later than (N minutes / hours / days from arrival), is already past, is set, is not set | |
| | **Title**, **Title or description** | contains any of, contains none of (keywords, any case), matches pattern (a regular expression; slow patterns are refused) | |
| | **Has attachments**, **Is a subtask** | is | Yes / No |
| | **Tags** | include any of, include all of, include none of | Tags |
| When it arrives | **Day it arrives** | is any of, is none of | Days of the week |
| | **Time it arrives** | is inside / outside working hours | Your **working hours** (days, start, end, time zone — shown when a rule uses time; the time zone defaults to your profile's, else UTC) |

A condition about something the task doesn't record never matches, whichever operator it uses. For example, a task redirected to you doesn't know whether it has attachments, so neither *Has attachments is Yes* nor *is No* matches it. Relationship, team, org unit and project conditions use the workspace's org structure (reporting lines, teams, units, projects); without it they don't match.

### Where the rules apply

When a task lands with someone: a workflow User Task (no person assigned it: *No person*), each member of an AAD group task in *everyone* mode, a task created by hand (each assignee's own rules decide), redirects, escalations (including scheduled ones), a manager's reassignment, invitations to collaborate, and the MCP and agent redirect / escalate tools. A User Task node can override them with **Queue behaviour**: *Follow the assignee's queue rules* (default), *Always queue* or *Always add*.

### Stored shape

They are stored in \`users.preferences.queue_rules\` (version 2):

\`\`\`json title="Queue rules"
{
  "version": 2,
  "default": "queue",
  "working_hours": { "days": [1, 2, 3, 4, 5], "start": "09:00", "end": "17:00", "time_zone": "Pacific/Auckland" },
  "rules": [
    {
      "id": "r1",
      "name": "From my manager or urgent",
      "enabled": true,
      "match": "any",
      "conditions": [
        { "field": "assigned_by_relation", "op": "is", "value": "manager" },
        { "field": "priority", "op": "at_least", "value": "critical" }
      ],
      "then": "add"
    },
    {
      "id": "r2",
      "enabled": true,
      "match": "all",
      "conditions": [
        { "field": "source", "op": "in", "value": ["redirect", "escalation"] },
        { "field": "working_hours", "op": "outside" }
      ],
      "then": "queue"
    }
  ]
}
\`\`\`

Fields: \`priority\`, \`source\`, \`workflow\`, \`form\`, \`assigned_by\`, \`assigned_by_relation\`, \`assigned_by_team\`, \`assigned_by_org_unit\`, \`assigned_by_project\`, \`assignment\`, \`assigned_team\`, \`due\`, \`title\`, \`text\`, \`has_attachments\`, \`is_subtask\`, \`tags\`, \`day_of_week\`, \`working_hours\`. Operators: \`is\`, \`is_not\`, \`in\`, \`not_in\`, \`at_least\`, \`at_most\`, \`within\`, \`not_within\` (value \`{ "amount": 2, "unit": "hours" }\`), \`overdue\`, \`set\`, \`not_set\`, \`contains\`, \`not_contains\`, \`matches\`, \`contains_any\`, \`contains_all\`, \`contains_none\`, \`inside\`, \`outside\`. Ids are UUIDs; days are 0 (Sunday) to 6.

Nothing to migrate: rules saved in the earlier shape (\`{ "default", "rules": [{ "when": { "priority_at_least", "source", "workflow_id", "assigned_by_user_id" }, "then" }] }\`) are read as version 2 with the same behaviour, and are rewritten in the new shape the next time you save. Someone who never saved rules keeps the earlier **queue bypass priority** (\`queue_bypass_priority\`, default High): tasks at or above it are added, the rest are queued, exactly as before.

## Subtasks and dependencies

Tasks can have subtasks (created by hand, by the **Create Subtask** node, or in the ingest payload) with their own assignees and completion state.

## Tasks from other systems

\`POST /api/v1/tasks/ingest\` (\`usertasks tasks ingest\`) creates a task from another engine with an optional \`callback_url\` and \`idempotency_key\`, so UserTasks can be the human-task inbox for workflows that run elsewhere.
`,
  },
  {
    slug: 'tasks/completion-settings',
    title: 'Task completion settings',
    description: 'Settings → Task completion: turn the Task completed screen on or off and set its wording, buttons and where Back goes for the whole workspace, with a live preview; the API, MCP and CLI.',
    body: `
**Settings → Task completion** sets the [Task completed screen](/docs/tasks#task-completed-screen) for every task in the workspace. Every member can see it; changing it needs **Edit settings**. Task forms can override any of it in the form designer (**Buttons & header → Task completed screen**).

| Setting | Default |
|---|---|
| **Show the Task completed screen** | On. Off: completing a task leaves the person on the task page, which shows it completed. |
| **Heading** | \`{{outcome}}: {{task.title}}\` |
| **Subheading** | \`Thanks, {{user.name}}. Your response is recorded.\` (blank for none) |
| **Next: moved on to someone** | \`Now with {{next.assignee}}\` |
| **Next: process complete** | \`Process complete\` |
| **Next: waiting on a timer or event** | \`Waiting on {{next.step}}\` |
| **Buttons** | **Next task**, **Back** and **Process view**: each can be hidden or relabelled |
| **Back goes to** | **My tasks**, or **Home** (a blank Back label then reads "Back to Home") |

The **live preview** at the top shows the screen with sample values for four cases: an approval that moved on to someone, a rejection, the last step and a wait. Type \`{\` in any field to pick a placeholder; one the screen can't fill in is underlined.

The setting is stored with the workspace (\`tenants.settings.tasks.completion_screen\`); no migration is needed.

## API, MCP and CLI

- REST: \`GET /api/v1/workspace/task-completion\` (any member) and \`PATCH /api/v1/workspace/task-completion\` with only the settings to change (**Edit settings**; audited).
- MCP: \`task_completion_settings_get\` and \`task_completion_settings_update\`.
- CLI: \`usertasks task-completion get\` and \`usertasks task-completion update --heading "Done: {{task.title}}"\`.
`,
  },
  {
    slug: 'tasks/fields-and-outcomes',
    title: 'Fields and outcomes',
    description: 'Collect typed values on a task and route the workflow by the outcome the person chooses.',
    body: `
## Outcomes

A User Task lists its \`outcomes\`, for example **Approved** and **Rejected**. Each outcome is a button on the task and an outgoing edge on the canvas with the same label. When the task is completed, the run resumes on the matching edge and \`{{outcome}}\` and \`{{outcome_notes}}\` are set.

## Fields

\`fields\` define what the person fills in. Design them in the [form designer](/docs/tasks/forms) (**Design form** on the User Task), which also places them on a grid and themes the form. The field types:

| Type | Stored as | Notes |
|---|---|---|
| \`text\`, \`textarea\` (long text) | string | \`placeholder\`, \`min_length\` / \`max_length\`, \`pattern\` |
| \`email\`, \`phone\`, \`url\` | string | checked for the format |
| \`number\`, \`currency\` | number | \`min\` / \`max\`; currency has a \`currency\` code |
| \`date\` | \`YYYY-MM-DD\` | \`min_date\` / \`max_date\` |
| \`datetime\` | ISO 8601 (UTC) | |
| \`boolean\` | true / false | a required checkbox must be ticked |
| \`choice\` | string | \`options\` (or \`options_source\` from a data table column), dropdown or radio |
| \`multi_choice\` | array of strings | \`options\`; \`min\` / \`max\` selections |
| \`user\` | user id | a person in the workspace |
| \`lookup\` (autocomplete) | string (array when \`multiple\`) | suggestions from a data table or an API reference; the selected item is \`{{task_data.<key>_item}}\` — see [Autocomplete / lookup fields](/docs/tasks/forms#autocomplete-lookup-fields) |
| \`attachments\` | array of file objects | uploaded files; \`attachments\` sets counts, sizes and types; the number of files is \`{{task_data.<key>_count}}\` — see [Attachments](/docs/tasks/forms#attachments) |
| \`heading\`, \`divider\` | (no value) | layout only |

Each field has a \`key\` (defaults to the label in snake_case), a \`label\`, \`required\`, optional \`help_text\`, \`read_only\` and \`visible_when\`. Keys must be unique in the task and can't be reserved names such as \`outcome\` or \`task_data\`. After completion the values are available as \`{{task_data.<key>}}\` (also \`{{task.data.<key>}}\`).

\`\`\`json title="User Task config"
{
  "task_title": "Approve invoice {{invoice_number}}",
  "task_description": "{{vendor.name}} · {{=FORMAT_NUMBER(amount, 2)}} {{currency}}",
  "outcomes": ["Approved", "Rejected"],
  "fields": [
    { "key": "amount", "label": "Approved amount", "type": "number", "required": true, "default": "{{amount}}" },
    { "key": "cost_centre", "label": "Cost centre", "type": "choice", "options": ["OPS", "FIN", "IT"], "required": true },
    { "key": "comment", "label": "Comment", "type": "text" }
  ]
}
\`\`\`

## Several assignees

When a task is assigned to several people, \`completion_rule\` decides when it is done:

| Rule | Completes when |
|---|---|
| \`first_response\` | the first person responds (their outcome wins) |
| \`all_complete\` | everyone has responded (the most common outcome wins) |
| \`consensus\` | at least \`min_responses\` people agree |
| \`unanimous\` | everyone chooses the same outcome |
| \`custom\` | \`custom_rule_expression\` evaluates true |

Every response is kept (\`{{task.responses}}\`, \`{{task.outcome_counts}}\`), and the rule is applied the same way whether people respond in the app, through the API or through an agent.
`,
  },
  {
    slug: 'tasks/forms',
    title: 'Forms',
    description: 'Design grid forms for User Tasks, workflow starts and standalone form pages: every field type, steps and tabs, rules and read-only parts, parameters and test inputs, lazy loading and animations, sharing and embedding in websites, the form sign-in page, QR codes, the Form submitted trigger and testing.',
    body: `
A form is a set of typed fields placed on a grid, with an optional header, buttons and theme. The same designer builds four kinds of form:

- **Task forms** — what the assignee fills in on a User Task. Values come back as \`{{task_data.<key>}}\`.
- **Reusable forms** — saved in the Forms library, versioned, linked from any number of User Tasks, and published on their own page (\`/f/<id>\`, with a QR code). Submitting one fires the **Form submitted** trigger (\`{{form.<key>}}\`).
- **Start forms** — a workflow's inputs on a grid with a theme, shown by the Run dialog and **Save & Test**; **Publish as form page** gives one its own page.
- **Task trigger forms** — the fields a triggering task carries (\`{{task.data.<key>}}\`).

::image forms-designer | The form designer: field palette on the left, a grid of rows with one to four columns, and the Attachments field's settings on the right | The designer: drag types from the palette onto a grid of 1–4 column rows; the selected field's settings are on the right.

> [!TIP]
> Want a form, a responses table, an approval and a results page without the designer? Use the [form wizard](/docs/tasks/form-wizard). For a guided walk-through of the designer, follow the tutorial [Build your first form](/docs/tutorials/first-form).

## Build your first form in 5 minutes

1. **Create it.** Open **Build › Forms → New form**, choose **Start blank** if you are offered the wizard, name it (for example *Customer return*) and choose **Continue to designer**.
2. **Add fields.** Drag **Text**, **Email**, **Currency**, **Single select** and **Attachments** from the palette onto the grid (or select one and press **Enter**). Set each field's label; the key follows it in snake_case (\`contact_email\`).
3. **Lay it out.** Give a row 2 or 3 columns with the buttons beside **ROW n**, then drag fields side by side. Set **Width** on a field to span columns. Add a **Section** to group fields (optional and collapsible ones too), or **Section heading** and **Divider** for lighter structure.
4. **Validate.** Tick **Required**, set min / max, a pattern with a message, or **Visible when** on the fields that need it. **Preview → Check validation** tries the rules; **Phone** shows the one-column mobile layout.
5. **Buttons and look.** In the **Header** tab, turn on the header, rename **Submit** and add **Show success screen**. In the **Theme** tab, pick **Custom** and set an accent colour. Choose **Create form**.
6. **Use it.** **Open** the form in the library, or use **⋯ → Copy link** or **QR code** to share its page; add a **Form submitted** trigger to a workflow to run it on every submission, or link the form from a User Task with **Use a saved form**. Every field is in the workflow's **Data** panel as \`{{form.<key>}}\` / \`{{task_data.<key>}}\`.

Prefer code? \`usertasks forms create -f customer-return.json\` (or \`POST /api/v1/forms\`) takes the same \`fields\`, \`layout\`, \`theme\`, \`header\` and \`buttons\` — see [Reusable forms](#reusable-forms).

## The form designer

Open a **User Task** and choose **Form → Design form**. The dialog has three parts:

- **Palette** (left): text, long text, number, currency, email, phone, URL, date, date and time, checkbox, single select, multi-select, person, autocomplete / lookup, data table, attachments, label (display text with an expression), section heading, divider and button. Drag a type onto the grid, or select it and press Enter to add it in a new row.
- **Grid** (centre): rows of 1 to 4 columns. Choose the column count per row, add, move and remove rows, drag fields between cells, and set how many columns a field spans. Dropping onto a full row puts the field in a new row below it.
- **Properties** (right): the selected field's label, key, type, width, help text, placeholder, required, read-only, default value (expressions and the **Insert data** picker work), validation (min / max, length, pattern with a message, date range, selection count), options with values and labels (or loaded from a data table column when the task is created) and **Visible when** (show the field only when another field equals / doesn't equal / contains a value, or has a value). The **Form theme** tab styles the form.

**Preview** shows exactly what the assignee sees, in light or dark mode and at desktop or phone width, with **Check validation** to try the rules. On phones every row collapses to one column.

The designer has undo and redo (**Ctrl+Z**, **Ctrl+Shift+Z** or **Ctrl+Y** outside text boxes) and asks before closing with unsaved changes.

### Keyboard

Tab to a field on the grid. **Alt+←/→** moves it within its row, **Alt+↑/↓** moves it to the row above or below, **Delete** removes it and **Enter** selects it for the properties panel. Every palette item is a button.

## Grid layout

A form is a list of **rows**. Each row has 1 to 4 **columns**, and each field in it a **span** (how many of the row's columns it covers: 1/2, 1/3, 2/3, full…). Dropping a field onto a full row puts it in a new row below.

- **ROW n · 1 2 3 4** sets the row's columns; the arrows move the row, **+** inserts one below and the bin removes it.
- Drag a field by its handle to another cell, or onto **Drop here for a new row** (the **+ 1 col** … **+ 4 cols** buttons add an empty row).
- **Width** in the field's properties sets its span within the row.
- **Section heading** and **Divider** are layout-only fields: they take a cell (usually a full row) and hold no value.
- **On phones** (and narrow task panes) every row collapses to one column in the field order, so a form designed on a desktop works on a phone without a second layout. **Preview → Phone** shows it.

The layout is stored next to the fields as \`form_layout\` (on a User Task) or \`layout\` (on a reusable form):

\`\`\`json title="User Task config with a grid"
{
  "task_title": "Review expense claim",
  "outcomes": ["Approved", "Rejected"],
  "fields": [
    { "key": "employee_name", "label": "Employee name", "type": "text", "required": true },
    { "key": "amount", "label": "Amount", "type": "currency", "currency": "USD", "min": 0 },
    { "key": "category", "label": "Category", "type": "choice", "options": ["Travel", "Meals", "Equipment"] },
    { "key": "expense_date", "label": "Expense date", "type": "date" }
  ],
  "form_layout": { "rows": [
    { "columns": 2, "cells": [{ "field_key": "employee_name", "span": 1 }, { "field_key": "amount", "span": 1 }] },
    { "columns": 2, "cells": [{ "field_key": "category", "span": 1 }, { "field_key": "expense_date", "span": 1 }] }
  ] }
}
\`\`\`

A form without a layout renders one field per row, as it always has. Opening it in the designer shows one field per row and doesn't change anything until you edit it.

## Steps and tabs

A long form reads better in parts. **Layout** above the grid switches a form between **Single page** (the default), **Steps** (a wizard: one part at a time with Next and Back) and **Tabs** (every part one click away, one submission). Each step or tab has a title, an optional description and icon, and its own grid of rows; every field sits on exactly one of them.

::image forms-steps-designer | The form designer with the layout set to Steps: four step chips above the grid, the Company details step selected with its rule "Supplier type equals Company", and the step's settings on the right | **Steps** in the designer: a chip per step above the grid, the selected step's title, icon and rule on the right.

**In the designer:**

- **Add step** / **Add tab** adds one after the selected one. Click a chip to edit that page's grid; the **Step** (or **Tab**) tab on the right holds its title, description, icon and **Visible when** rule, and **Earlier** / **Later**, **Duplicate** (copies its fields with new keys) and **Delete**.
- **Reorder** by dragging a chip, or focus it and press Alt+Left / Alt+Right.
- **Move a field** to another page by dropping its card on that page's chip; drop a palette type on a chip to add it there.
- **Delete** asks where the page's fields go: **Move fields and delete** (to the page you pick) or **Delete with fields**. Ctrl+Z undoes it — undo and redo cover every page change.
- Switching **Steps ↔ Tabs** keeps the pages; switching back to **Single page** puts every page's rows into one grid, in page order.
- **Preview** shows the stepper or tab bar exactly as people see it, on a desktop or phone width, with your theme.

**Steps** settings (**All steps**):

- **Progress indicator** — **Numbered** (numbered steps with their titles; stacked on phones), **Progress bar** ("Step 2 of 4" and a percentage) or **Dots**.
- **Back** / **Next** button labels.
- **Next checks the step**: the step's visible fields must pass their rules (required, formats, bounds) before it moves on, and the first problem gets the focus. Submitting still checks every visible field on every step — in the browser and on the server.
- **Allow skipping ahead** lets the stepper open any step; without it, people go forwards with Next and back to any step they've passed.
- **Review step before submitting** adds a last step with a read-only summary of the answers, page by page, each with **Edit**. The form's buttons (Submit, outcomes, Cancel) show on the last step — the review when it's on; **Save draft** shows on every step, and a task form reopens on the step it was saved on.
- **Let people resume later** (reusable forms): on the form's own page (\`/f/<id>\`) unsent answers and the step stay in that browser until the form is submitted or discarded (files aren't kept).

::image forms-steps | A standalone form page on its review step: a numbered stepper with four completed steps, then the answers of each step with Edit links, and Back, Submit application and Cancel buttons | A form page's review step: the answers per step, each with **Edit**, and the form's buttons.

**Tabs** show a tab bar above the fields (it scrolls sideways on phones; icons optional) and the form's buttons under every tab. After a submit with problems, each tab with invalid fields gets a red count and the form opens the first one. The tab bar is a keyboard tablist: arrows, Home and End move between tabs.

::image forms-tabs | A tabbed form page: General, Billing with a red badge 2, and Shipping; the Billing tab shows two required fields with errors | **Tabs** after a submit: the tab with problems shows how many, and the form opens it.

**Conditional steps and tabs.** A page's **Visible when** uses the same rule as a field's (equals, does not equal, contains, has a value, is empty) on a field from an earlier step (tabs: from another tab). A hidden step is skipped and not counted in the progress — "Step 2 of 3" becomes "Step 2 of 4" when it appears — and its fields are not required and not checked. (Start forms have no page rules: their inputs are checked without the layout.)

**Everywhere a form runs:** task forms, \`/f/<id>\` pages, a workflow that starts from a form (the Run dialog and **Save & Test**), a workflow's start form, **Publish as form page** and linked reusable forms (versions, export and packages carry the pages). Completed tasks and other read-only views show every visible page stacked under its title. The mini theme styles the stepper and tabs: the accent marks the current step, the active tab and the progress bar, kept legible like the rest of the form.

**Pages are layout only.** Values stay flat — \`{{task_data.<key>}}\`, \`{{form.<key>}}\` and start-form variables are exactly what they would be on one page. The layout gains \`mode\`, \`pages\` and optional \`page_settings\`; the top-level \`rows\` is then empty:

\`\`\`json title="A steps layout (form_layout on a User Task, layout on a reusable form)"
{
  "mode": "steps",
  "rows": [],
  "page_settings": { "indicator": "progress", "review": true, "next_label": "Continue" },
  "pages": [
    { "id": "you", "title": "Your details", "icon": "user",
      "rows": [{ "columns": 2, "cells": [{ "field_key": "contact_name", "span": 1 }, { "field_key": "supplier_type", "span": 1 }] }] },
    { "id": "company", "title": "Company details", "description": "Only for companies.",
      "visible_when": { "field": "supplier_type", "operator": "equals", "value": "Company" },
      "rows": [{ "columns": 1, "cells": [{ "field_key": "company_name", "span": 1 }] }] }
  ]
}
\`\`\`

\`page_settings\` keys: \`indicator\` (\`numbered\`, \`progress\`, \`dots\`), \`next_label\`, \`back_label\`, \`allow_skip\`, \`review\`, \`review_title\`, \`resume\`. Icons are names from a fixed set (\`user\`, \`building\`, \`credit-card\`, \`truck\`, \`calendar\`, \`file-text\`, …). A field missing from every page lands on the last one, so nothing can be lost; an app that only knows \`rows\` shows the fields one per row.

## Sections and optional sections

A **section** is a named group of rows: a title, an optional description, and the fields inside it, laid out on the grid like any other rows. Choose **Section** in the palette (under **Group**) to add one at the end of the grid (or of the current step / tab), then drop fields onto its **Drop a field here** strip, drag them onto its rows, or use a row's **Section** menu to move the whole row in or out. Moving a row up or down at a section's edge moves it across the edge. Sections sit inside steps and tabs, and they don't nest: a row belongs to at most one section.

Select the section's header to edit it in the **Section** tab:

| Option | What it does |
|---|---|
| **Title**, **Description** | The group's legend and the text under it. |
| **Key** | How rules and the submission name it (\`section:<key>\`, \`<key>_included\`). It can't equal a field key. |
| **Optional** | The person chooses to fill it in: until they press **Add** followed by the section's title (rename the button with **Add button text**), only the title and the button show; **Remove** takes it away again. |
| **Collapsible** / **Start collapsed** | A chevron in the title opens and closes it. A section that holds an error always shows open. |
| **Style** | **Bordered** (a card around the group) or **Plain** (title and fields only). |
| **Visible when** | Show the section only when another field (or a state flag) has a value — like a field's rule. |

**What gets submitted.** While an optional section is left out, its fields are not required and not checked, and the server **stores them empty** (\`null\`; \`false\` for a checkbox, \`[]\` for lists) whatever the browser sent. The submission also records \`<key>_included: true | false\`, so a workflow can branch on \`{{task_data.<key>_included}}\` / \`{{form.<key>_included}}\`. API callers include a section by sending \`"<key>_included": true\` with the values. Only optional sections can be left out: \`<key>_included: false\` sent for any other section is ignored, so it never skips a required field.

**Rules.** Sections are targets in the **Rules** tab and in a Button's **Show / hide**: **Show / hide** and **Enable / disable** take \`section:<key>\`, and **Collapse / expand a section** (Then → Show / hide) opens or closes one. The event **Section added / removed** (When → Form) runs when the person adds or removes an optional section (\`{{event.section}}\`, \`{{event.included}}\`), and conditions can test **Section … is included** (\`section.<key>.included\`) or **is visible** (\`section.<key>.visible\`); placeholders read the same as \`{{control.<key>.included}}\` / \`{{control.<key>.visible}}\` (the **Controls** group). A hidden section's fields are not required, the same as hidden fields, and the server re-checks it: a section is hidden on the server only by its own rule, an Always rule, or a button or event rule that could have hidden it (see **Security** under Rules).

**Read-only views.** Completed tasks, the review step and **Submissions** show each section's title above its fields; an optional section that was left out shows **Not included**.

**Older forms.** Before sections, a **Section heading** with the rows under it (up to the next heading or divider) acted as a section, and \`section:<heading key>\` targets still mean exactly that — nothing changes in existing forms. To upgrade one, select the heading and choose **Convert heading to section**: the rows under it join a new section titled like the heading (its description and **Visible when** carry over), and rules that targeted the heading's section target the new one. Headings and dividers can now have **Visible when** too.

**Accessibility.** A section is a \`fieldset\` with the title as its \`legend\`; a collapsible one's chevron is a button with \`aria-expanded\`. The checker flags a section that starts collapsed but holds required fields, and generic titles ("Section 2").

## When to load (faster forms)

A long form doesn't have to load everything when it opens. Each **step / tab** (Step / Tab properties) and each **section** (Section properties) has a **When to load** setting:

| Setting | What happens |
|---|---|
| **On form open** (default) | The part loads with the form — how every form has always worked. |
| **When first shown** | A tab or step loads when the person first opens it. A section loads when it is expanded, or first scrolled into view. |
| **When a rule loads it** | The part loads when a rule runs **Load section / tab** on it (for example, when "Needs delivery" is ticked). |

Until a lazy part loads, its controls are not mounted, so none of their work runs. That means no Data table queries, no autocomplete lookups, no custom control frames, no file widgets, and no bound (dynamic) properties. Label totals over its tables wait too. A skeleton with the part's title stands in. When the part loads, its controls mount, start their queries and fade in. A loaded part stays loaded.

**Preload in background** (lazy parts only): once the visible part is idle, the form warms the part's custom control frames and resolves its bound properties without mounting it, so it opens quickly. Use it on the tab people usually open next.

::image form-lazy-load | The designer's Tab properties with When to load set to When first shown and Preload in background ticked; the tab strip shows an hourglass on the lazy tabs | When to load on a tab, with Preload in background.

**What to make lazy.** These parts benefit most:

- tabs and steps people don't always open, such as history, attachments and approval details;
- sections lower down the page that hold Data tables, charts, maps or other custom controls;
- sections that only matter for some answers. Make these **When a rule loads it**, with a rule on the answer.

Keep the part people fill in first **On form open**. The same goes for a part whose controls a rule on another part reads, such as a Label totalling a table's rows: the rows only exist once the table has loaded.

**Values don't depend on loading.** Field defaults, prefilled values, task values and values a rule sets are all part of the form's values, whether or not their controls have mounted. They are submitted the same way. A control that mounts later shows what the values already hold. A bound **default** still resolves on open, because it's a value; the part's other bound properties wait.

**Submitting.** Required fields stay required. When the person presses Submit, the form first loads every shown part that holds a required field, then validates, so any error shows in a real control. An error on a field in an unloaded part (from Next, a Validate action or a rule) also loads that part. Hidden steps, tabs and sections, and optional sections left out, follow the usual rules: their fields aren't required, so they aren't loaded. The server doesn't know or care what loaded. It validates the submission exactly as before.

**Rules.**

- **Load section / tab** (Then → Show / hide) loads any section, step or tab.
- **Section / tab loaded** (When → Form) runs once when a lazy part loads, with \`{{event.part}}\` (\`section:<key>\` or \`page:<id>\`).
- Conditions can test **Section … has loaded** (\`section.<key>.loaded\`) or **Step / tab … has loaded** (\`step.<id>.loaded\`). Placeholders read \`{{control.<section>.loaded}}\` and \`{{control.form.loaded.<step id>}}\`. A part that loads on open counts as loaded.
- In the designer, a **When a rule loads it** part that no rule or Button loads shows a warning.

**Read-only views, print and accessibility.** Completed tasks, the review step and **Submissions** show everything. **Print** (a Button or rule action) loads every part before the print dialog opens. The accessibility checker reads the form's definition, so lazy parts are checked like the rest.

\`\`\`json title="A lazy tab and a section a rule loads (layout)"
{
  "mode": "tabs",
  "pages": [
    { "id": "request", "title": "Request", "rows": [] },
    { "id": "history", "title": "Order history", "load": "visible", "preload": true, "rows": [] }
  ],
  "sections": [{ "key": "delivery", "title": "Delivery details", "load": "rule" }],
  "rules": [{ "id": "r_delivery", "event": "value_change", "target": "needs_delivery",
    "if": { "match": "all", "conditions": [{ "column": "needs_delivery", "operator": "eq", "value": "true" }] },
    "then": [{ "type": "load_part", "targets": ["section:delivery"] }] }]
}
\`\`\`

\`load\` is \`visible\` or \`rule\`; leave it out for **On form open**. Older forms have no \`load\` and load everything, exactly as before. The setting travels with versions, exports, packages, the API, MCP and the CLI.

## Animations

Forms can move a little as people use them: the card rises in, fields follow, steps slide, and messages and errors ease in. Set it in **Buttons & header → Appearance → Animation**:

| Style | What it looks like |
|---|---|
| **None** | Nothing moves; the form appears at once. |
| **Subtle** (the default) | Short fades and small rises. The whole entrance takes about a third of a second. |
| **Expressive** | The same moments with more movement: a springier entrance, a wider step slide and the success icon drawn in. You can also tick **Confetti on the Submitted page**. |

Subtle is the default for new forms and for existing ones. It only fades and moves things by a few pixels, and it never changes the size or position of anything once the form has settled, so a published form looks the same as before after its first third of a second. Choose **None** to turn animations off for a form.

**What animates** (Subtle and Expressive):

- **Form load:** the card fades and rises in, and the fields follow one row after another. A form with more than 20 fields comes in as one block, with no per-field stagger.
- **Steps and tabs:** the new step or tab slides in from the direction of travel (Next from the right, Back from the left). The progress bar fills smoothly.
- **When to load:** a lazy part shows its shimmering skeleton, and its controls fade in once it loads ([When to load](#when-to-load-faster-forms)).
- **Show and hide:** a field that a rule shows grows into place and fades in. A field that a rule hides fades and shrinks away. Collapsible sections open and close the same way. Nothing is measured in script, so there is no layout jank.
- **Banners and questions** from rules and buttons slide in and fade out when they are dismissed.
- **Validation errors:** the field gives a short, gentle shake and the error text fades in.
- **Buttons:** they press in slightly, and the button that is submitting shows a spinner.
- **Submitted page:** the icon pops in (with Expressive, its lines are drawn in), and then the heading follows. With **Expressive** and **Confetti on the Submitted page**, a success-coloured page adds a light confetti burst.
- **Data tables:** rows fade in on load and on a page change.
- **Custom controls:** a form part waiting for its custom controls fades in at the form's pace.

**Reduced motion.** When someone has asked their device for reduced motion, every style becomes a plain fade: nothing slides, shakes, grows or bursts, and there is no stagger or confetti. Animations never hold up typing or focus: fields can be used from the first frame, and focus moves exactly as it does without animations.

**Preview.** In the designer, **Preview → Replay animation** plays the form's load animation again.

The setting is stored in the form's layout as \`layout.animation\`. For example, \`{ "style": "expressive", "confetti": true }\` or \`{ "style": "none" }\`; leave it out for Subtle. It goes with versions, export, packages, the API, MCP and the CLI. Animations apply on the form's own page (\`/f/<id>\`), anonymous links (\`/p/…\`), task forms, the Run dialog and the designer preview, in light and dark mode and with any form theme.

## Resizing the designer

Drag any edge or corner of the designer to resize it (from 720 × 480 up to the window), or use the **Maximize** button in its header — or double-click an empty part of the header — to fill the window edge to edge; the same button restores the size. The **Hide palette** / **Hide properties** buttons fold the side panels away so the grid gets the room. The designer remembers its size, whether it was maximized and which panels were hidden in this browser. On phones it is always full screen. The resize handles are pointer-only; keyboard users have the Maximize button.

## Form width

**Form theme → Form width** sets how wide the form card is: **Narrow**, **Normal** (the default; existing forms are unchanged), **Wide**, **Full**, or **Custom %** — a share of the space the form is shown in (40–100 %, with a slider or a number). The width applies on the form's own page (\`/f/<id>\`), on the task screen, in **Save & Test**, and in the designer's **Preview** at desktop width; the Run dialog keeps its own width (Narrow and Custom % still apply inside it). A custom width never goes below 320 px, and on phones every form is full width. Picking a width on a form that uses the workspace theme switches it to a custom theme with only the width set.

**Wide Data tables.** A Data table with many columns scrolls sideways inside the card, with its first column (and the selection checkbox) kept in place. Tick **Full width** in the table's properties to give the form at least a **Wide** card.

## Field types

Every field has \`key\`, \`label\`, \`type\`, and optionally \`required\`, \`help_text\`, \`placeholder\`, \`default\` (expressions allowed), \`read_only\` and \`visible_when\` (\`equals\`, \`not_equals\`, \`contains\`, \`is_set\`, \`is_not_set\` on another field, or \`state.<flag>\` — a form state flag set by a Button). The type adds its own settings:

| Palette | \`type\` | Settings | Value | Also downstream |
|---|---|---|---|---|
| Text | \`text\` | \`min_length\`, \`max_length\`, \`pattern\`, \`pattern_message\` | string | — |
| Long text | \`textarea\` | as Text | string | — |
| Email | \`email\` | as Text; format checked | string | — |
| Phone | \`phone\` | as Text; format checked | string | — |
| URL | \`url\` | as Text; http(s) only | string | — |
| Number | \`number\` | \`min\`, \`max\` | number | — |
| Currency | \`currency\` | \`currency\` (ISO 4217, default USD), \`min\`, \`max\` | number | — |
| Date | \`date\` | \`min_date\`, \`max_date\` | \`YYYY-MM-DD\` | — |
| Date & time | \`datetime\` | \`min_date\`, \`max_date\` | ISO 8601 (UTC) | — |
| Checkbox (yes/no) | \`boolean\` | required means it must be ticked | true / false | — |
| Single select | \`choice\` | \`options\`, \`option_labels\`, \`options_source\` (a data table column), \`display\` (\`dropdown\` or \`radio\`) | string | — |
| Multi-select | \`multi_choice\` | \`options\`, \`option_labels\`, \`options_source\`, \`min\` / \`max\` selections | array of strings | — |
| Person | \`user\` | — | user id | — |
| Autocomplete / lookup | \`lookup\` | \`lookup\`: a data table or API reference, search, shown and stored fields, filters, fill-ins, several / free text | string (array when several) | \`<key>_item\`: the selected item |
| Attachments | \`attachments\` | \`attachments\`: \`min_files\`, \`max_files\`, \`max_file_mb\`, \`max_total_mb\`, \`types\`, \`custom_types\`, \`camera\` | array of file objects | \`<key>_count\`: the number of files |
| Section heading | \`heading\` | — | none | — |
| Divider | \`divider\` | — | none | — |
| Data table | \`data_table\` | \`data_table\`: a data table or API reference, columns and formats, base filter, sort, page size, mode — see [Data table fields](#data-table-fields) | the selected rows, or the changes \`{ added, updated, deleted }\` | — |
| Button | \`button\` | \`button\`: style, size, icon, alignment, tooltip, confirm prompt, \`disabled_when\`, On click \`actions\` — see [Buttons anywhere](#buttons-anywhere-and-form-state) | none | — |
| Label | \`label\` | \`label_config\`: \`expression\`, \`format\`, \`prefix\` / \`suffix\`, size, alignment, \`include\` — see [Label and expressions](#label-and-expressions) | display text; stored only with \`include\` (recomputed by the server) | — |

Every value field is \`{{task_data.<key>}}\` after a User Task, and the same field is \`{{form.<key>}}\` in a workflow started by **Form submitted**, \`{{task.data.<key>}}\` after a task trigger and \`{{<key>}}\` for a start form's inputs. A start form takes text, number, checkbox, date, date and time, email, URL, single select and attachments.

**Custom controls** — web components your workspace uploads in **Extensibility → Form controls** — appear in the palette under **Custom**, with their own properties panel and a value type from their manifest. See [Custom form controls](/docs/tasks/custom-form-controls).

## Keys and downstream data

Each field has a key, generated in snake_case from its label until you edit it. Keys are unique, lowercase and can't be reserved names (\`outcome\`, \`task_data\`, \`id\`…). After the task, every value is available to later steps as \`{{task_data.<key>}}\`, and the **Insert data** picker lists each field with its label and type. Values are typed: numbers and currency are numbers, checkboxes are true / false, dates are ISO strings and multi-selects are arrays.

Renaming a key that later steps use opens a list of those references (step, setting and count) and offers to update them to the new key or keep them as they are.

## Autocomplete lookup fields

An **Autocomplete / lookup** field suggests values as the assignee types, from a **data table** or an **API reference**, and stores the one they pick.

**Data table.** Choose the table, the **columns to search** (one or more, matched case-insensitively — *contains* or *starts with*), the **columns to show** (the first is the main text of a suggestion, the others its second line) and the column **stored as the value** (the row id by default). **Only rows where** adds fixed filters (column, operator, value); a value can use another field of the form (\`{{task_data.region}}\`), the task (\`{{task.title}}\`) or a workflow variable (resolved when the task is created). Set a sort, the maximum number of suggestions (default 10) and the minimum characters before searching (default 1).

**API reference.** Choose the integration and reference, then map its inputs: \`{{search}}\` is what the assignee types, \`{{task_data.<key>}}\` another field, or a fixed value. Pick the **results list** — any list in the response, at any depth — in the response tree (the same model the data picker uses; **Load sample** captures it with one test call, see [Pick a list from a nested response](#pick-a-list-from-a-nested-response)), then the item fields to show and the field stored as the value. **Wait after typing** debounces calls (default 300 ms) and **Cache responses** reuses a response for the same inputs for up to an hour.

::image forms-lookup | Preview of a form with the Customer lookup open, suggesting two customers with their city and country | **Preview** runs the real lookup: suggestions from the Customers table, with the city and country on the second line.

Both sources can **allow several** selections (chips), **allow free text** (a value that isn't a suggestion) and **fill other fields** from the selected item — choosing a customer can fill their email and phone (the assignee can still edit them). **Preview** in the designer runs the real lookup.

**Display value vs stored value.** What people see and what is stored can differ: store the row id (or a code) and show the name. **Store as the value** picks the stored column / field; **Display template** (optional) sets what is shown — \`{{company_name}} ({{customer_id}})\` — in the input, read-only views, submissions and the task; **Secondary text in the list** sets each suggestion's second line; **Search also matches the stored value** lets people type a code or id. When a form opens with a value (a default, task data, a draft) and no label yet, the server resolves the label from the field's own source, with the same filters and permission rules as a search (\`resolve\` on the lookup endpoints).

The selected value is \`{{task_data.<key>}}\` (an array when several are allowed), its display label is \`{{task_data.<key>_label}}\` (a list for several; computed on the server, never taken from the browser — a field that already uses that key keeps it), and \`{{task_data.<key>_item}}\` is the selected item with its shown, value and fill fields (an array of them for several) — both in the data picker with the item's fields. A field can't use the key \`<key>_item\` of a lookup.

\`\`\`json title="A customer lookup that fills email and phone"
{
  "key": "customer", "label": "Customer", "type": "lookup", "required": true,
  "lookup": {
    "source": "table", "table_id": "<customers table id>",
    "search_columns": ["company_name", "contact_name"], "display_columns": ["company_name", "city"],
    "filters": [{ "column": "country", "operator": "eq", "value": "{{task_data.country}}" }],
    "sort": { "column": "company_name", "direction": "asc" },
    "fill": [{ "from": "email", "to": "contact_email" }, { "from": "phone", "to": "contact_phone" }]
  }
}
\`\`\`

### Security

Suggestions are authorised by the **task**, not by data-table or integration permissions: the caller needs **Complete tasks** and must be able to act on that open task (its assignee, a collaborator, a member of its team, or a queue manager — a tenant-wide API key acts on any task of its workspace). The server reads the lookup from the task's stored form and runs only that query — the configured table or reference, columns and filters; nothing in the request can change them. Results contain only the shown, value and fill fields, integration credentials never reach the browser, lookups are rate limited per user (120 a minute) and time out with a friendly message. On completion the value is checked again against the source with the same configuration (re-queried by value, or matched with what the API returned to this task) unless free text is allowed, and \`<key>_item\` is computed on the server. Lookups travel with exports and packages: the table, reference and integration are dependencies and their ids are remapped on install.

API clients completing a task can ask for suggestions with \`POST /api/v1/tasks/{id}/lookup\` (\`{ "field_key", "query", "values" }\`), the MCP tool \`tasks_lookup\` or \`usertasks tasks lookup <id>\`.

## Data table fields

A **Data table** field (palette group **Data**) puts a table on the form: rows from a workspace **data table** or an **API reference / connector operation**, with search, column filters, sorting and pages — all run on the server — in one of three modes:

| Mode | What people do | Value (\`{{task_data.<key>}}\`) |
|---|---|---|
| **Read-only** | look, search, filter, sort, page | none |
| **Select rows** | tick rows (one, or several with **Several rows**) | the selected rows: \`[{ "<column>": …, … }]\` |
| **Editable** | edit cells in place, **Add row**, delete rows | the changes: \`{ "added": [ … ], "updated": [{ "key", "before", "after", "changed_fields" }], "deleted": [{ "key", "before" }] }\` |

::image forms-data-table | A form with a Data table of vendors: a search box, an open Filters panel (Risk equals Low), a Name sort, status badges for category and risk, and a row count | A Data table bound to a data table: search, a column filter and a sort, all run on the server.

### Set up the query (designer)

Everything the server runs is set by the form's author on the field's properties and stored in the form:

- **Rows from** — a data table, or an API reference (connector operations are references too).
- **Columns** — add columns with the searchable picker (the table's columns, or the fields of the API's results list from its response model), reorder them, rename them, choose the type (text, number, date, date & time, choice, yes / no) and the **display format**, hide a column (fetched for the value and rules, not drawn), and tick **People can sort** / **People can filter** per column. Only these columns are ever sent to the browser — the projection is applied on the server, for API sources too.
- **Row key** — the column that identifies a row (a data table's own row id by default). Select and edit modes need it.
- **Base filter (always applied)** — a visual condition builder: column, operator (equals, does not equal, greater / less than, at least / at most, contains, starts with, is one of, is not empty, is empty) and value, combined with **All (AND)** or **Any (OR)**, with one level of nested groups. A value is a constant or an expression: another field (\`{{form.region}}\`), the current user (\`{{user.id}}\`, \`{{user.email}}\`, \`{{user.name}}\`), a date (\`{{today}}\`, \`{{now}}\`, \`{{today-30d}}\`, \`{{today+1m}}\`, \`{{start_of_month}}\`, \`{{start_of_year}}\`) or a workflow variable (resolved when the task is created). The table refreshes when a field it reads changes.
- **Sort and paging** — a default sort on up to three columns, the rows per page (at most 100), the search box on or off, and a fixed locale for formats (the viewer's by default).
- **Live preview** — **Run the query** runs the real query on the server (with your access and the live preview's form values) and shows the first page and the row count.

::image forms-data-table-designer | The form designer with a Data table selected: the base filter (Active equals true AND Terms at least form.min_terms), sort and paging, and the live preview listing the first rows and "7 rows match" | The field's query in the designer, with the live preview.

**People narrow, never widen.** The browser sends only the field key, the search text, its column filters (on filterable columns only, with operators that suit the column), its sort (on sortable columns only), the page and the form values the base filter reads. The server reads the source, columns and base filter from the saved form and ANDs the person's conditions onto the base filter — a filter on any other column is refused, values are quoted (never parsed as filter syntax), and a base-filter value left empty on the form (a number field, say) matches nothing rather than being dropped.

### API sources

Map the reference's inputs to the table's state: \`{{search}}\`, \`{{page}}\` (1-based), \`{{page_size}}\`, \`{{offset}}\`, \`{{sort}}\` and \`{{sort_dir}}\`, \`{{filter.<column>}}\`, as well as form values, the user and dates. Choose the **rows list** from the response model and, when the API pages itself, the path of its **total count**. What isn't mapped is applied by the server to the rows the API returned (at most 1,000) — the designer says which — and the base filter is always applied there too. When the API pages itself, a filter or search the server applies covers that page only; the table says so under the rows. Credentials stay on the server.

#### Pick a list from a nested response

APIs rarely return a bare list: S3's list-objects call puts the files under \`contents\`, Microsoft Graph under \`value\`, others under \`data.result.items\`. The **Rows list** picker shows the reference's response as a tree:

- **Load sample (test call)** runs the reference once with sample inputs (fixed mappings and input defaults are filled in; type the rest) and folds the response into the reference's response model, merging with the model it already has. It needs **Test integrations**; with **Manage references** the model is saved on the reference for everyone, otherwise it is used for this session only. The call goes through the same path as a test on the integration page: egress rules, stored credentials and the call log.
- Objects expand; every list, at any depth, shows **list of N items** with a preview of its first item and a **Use as rows** button — the response itself, \`contents\`, \`data.result.items\`, or a list inside list items (\`orders[].lines\` reads every order's lines, one after the other). **Search keys** filters the tree.
- When the response holds exactly one list of objects, it is chosen for you — for S3, \`contents\`.
- **Path** takes a typed path instead: \`contents\`, \`data.items\`, \`value[0].children\`, \`orders[].lines\`. It is checked against the model when there is one.
- Choosing a list shows its **item fields** — nested objects up to three levels (\`owner.display_name\`) — with their types and an example. **Add** (or **Add all**) makes them columns with a format that suits them: dates and times from their examples, numbers, and **File size** for byte counts named \`size\` or \`bytes\`.
- **Paging keys** in the response (\`next_continuation_token\`, \`is_truncated\`, \`@odata.nextLink\`, \`cursor\`, \`total\`…) are listed under the picker, and totals are suggested for **Total count path**.

::image forms-data-table-collections | The Data table field's Rows list picker after Load sample on an S3 list-objects reference: the response tree with contents (list of 3 items) chosen as the rows, the item fields key, size, last_modified, etag and storage_class with their formats, and the paging keys is_truncated and next_continuation_token | An S3 list-objects response: \`contents\` is picked automatically and its fields are ready to add as columns.

The path is stored as \`results_path\` and the server reads exactly that path from the response the reference returns — the picker shows paths relative to the response body, which is what the server reads. Lookup fields (**Results list**) and workflow Loops (**Pick a list from a step's response**) use the same picker.

### Display formats

Each column's format is display-only: sorting, filtering, the field's value, the change set and workflow data keep the raw typed value. The default comes from the column type (a data table's column types; for an API, from the sample in its response model).

| Format | Options |
|---|---|
| Text | max length (…), wrap |
| Number, Whole number | decimals, thousands separator, negatives as \`-1,234\`, \`(1,234)\` or red |
| Percent | decimals; stored as 0–100 or as a 0–1 fraction |
| Currency | ISO code, symbol or code, decimals |
| Date, Date & time, Time | short / medium / long / ISO, or a custom pattern (\`yyyy MM dd HH mm ss\`, \`MMM\`, \`EEE\`, \`a\`, \`'text'\`); the viewer's time zone or a fixed one. A date-only value keeps its calendar day everywhere |
| Relative time | "3 days ago", "in 2 hours" |
| Yes / no | Yes / No, ✓ / ✗, or your own labels |
| Status badge | value → label and colour (theme-safe tints, readable in light and dark) |
| Link | web (http / https), email (\`mailto:\`) or phone (\`tel:\`) — anything else shows as text |
| Image thumbnail | app paths, or https hosts you list |
| File size, JSON | bytes as KB / MB / GB; pretty-printed JSON |

Numbers align right by default (override per column). Empty and invalid values show "—" — never "NaN" or "Invalid Date". Read-only task views, submissions and the designer preview use the same formats.

### Editing

In an **Editable** table people double-click a cell — or focus it and press **Enter** / **F2** — edit it with an input that matches the column (number with the column's decimals, date picker, choice list, checkbox), then **Enter** to keep it or **Esc** to cancel. A value that doesn't fit (a number out of range, a choice not in the list, a required cell left empty) is marked on the cell and listed under the table. **Add row** and the delete button (or **Delete**) are there when the author allows them; deleted rows stay struck through with **Undo**. Changed cells are tinted; the status line counts new, changed and deleted rows. Hidden, read-only and key columns can't be changed.

### Accessibility

A real \`<table>\` labelled by the field; a grid with arrow-key navigation (Home / End, Ctrl+Home / End) when rows can be selected (Space) or edited; sortable headers with \`aria-sort\`; labelled search and filters; a polite live region with the result count, selection and changes; loading, empty and error states announced. On a phone the table scrolls sideways inside its frame. Theme tokens are used throughout, in light and dark.

### Security

- **Where it runs.** Task forms: the caller needs **Complete tasks** and must be able to act on the task. Reusable forms (\`/f/<id>\`, start form pages): **Submit forms**. The designer preview needs **Edit forms** (or **Edit workflows**) plus **View data** / **View integrations**.
- **Data tables.** By default reading also needs **View data**, and the query runs with the reader's own access (their session, so row-level security applies; API keys are limited to their table allowlist). Turn on **People without data access can see these rows** to let the form authorise the read for everyone who can fill it in, as a lookup does — the columns and base filter still bound what they see.
- **Values are checked on the server.** A selection from a data table is re-read by key (within the base filter and the reader's access) and stored as the server's copy. A change set is validated against the declared columns and key (types, required, bounds, choices, add / delete allowed, at most 100 changes by default), and for a data table every changed or deleted row is re-read: \`before\` comes from the table, never from the browser, and a row the person can't see is refused. Rows of an API source are cleaned to the declared columns.
- Rate limited per user; page size ≤ 100; API rows ≤ 1,000; friendly errors without internal detail.

API clients read rows with \`POST /api/v1/forms/{id}/data-table\` or \`POST /api/v1/tasks/{id}/data-table\` (\`{ "field_key", "query": { "search", "filters", "sort", "page", "page_size" }, "values" }\`), the MCP tools \`forms_data_table\` / \`tasks_data_table\`, or \`usertasks forms data-table <id>\` / \`usertasks tasks data-table <id>\`.

## For each changed row

A form can write an Editable Data table's changes back. Add **For each changed row** as a step of a submitting button (**Buttons & header** → Submit → **+ Add a step**), or **Apply table changes** as an On click step of an in-form **Button**. For each change — added, changed and / or deleted rows, optionally **only rows where** a condition holds — it does one of:

| For each row | Settings |
|---|---|
| **Data table** | the table; **Operation**: mirror the change (insert added, update changed, delete deleted), or always insert / update / upsert / delete; **Match on target column** (or the row id) equal to a value (\`{{key}}\` by default); **Columns**: target column ← value |
| **API call** | the API reference / connector operation and its inputs ← values; each row's HTTP status and a short excerpt of the response are kept |
| **Workflow** | the workflow and its inputs, **once per row** or **once with all changes** (\`{{changes}}\`) |

Values are constants or row templates: \`{{row.<column>}}\` (the row after the change; before it for a deleted row), \`{{before.<column>}}\`, \`{{key}}\`, \`{{change}}\` (added / updated / deleted), \`{{changed_fields}}\`, \`{{form.<field>}}\`, \`{{user.email}}\`, \`{{today}}\`…; a value that is one placeholder keeps its type (numbers stay numbers).

::image forms-table-changes | An editable Data table: a new row Kiwi Freight, changed terms on two vendors, a changed risk, tinted changed cells, and "1 new, 3 changed, 0 deleted" under the table | People edit the table; the form keeps the change set.

**Order and errors.** Deletes, then updates, then inserts (or inserts first). **Stop** at the first failure (the rest are not attempted) or **Continue and report**. A match on more than one target row fails that row instead of guessing.

**Summary.** Each run gives a summary — "3 rows updated, 1 row added; 2 rows sent to the API, 1 failed" — shown as a message (unless you untick it) and available as \`{{table_changes_summary}}\` in later messages, the success screen and workflow inputs. The submission stores every rule's per-row results (\`result.table_changes\`), and the submit API returns them as \`table_changes\`.

**Dry run.** **Dry run with the preview's changes** shows what the rule would do with the edits made in the designer's live preview — one line per row with the match and the values — without writing anything. **Save & Test** of a form-started workflow logs the same plan.

::image forms-table-changes-rule | The Buttons & header tab with a "For each changed row" step writing to the Vendors table (mirror the change, match on vendor_id, column mapping) and its dry run: "Preview: 1 row updated" | A rule on the Submit button, and its dry run.

**Where it runs, and who it acts as.**

- On the server only, after the submission is stored (task forms: after the task is completed). The rule comes from the saved form; the browser sends only the change set, which is validated and re-read first (see Security above).
- Data table writes run **as the person who submits**: they need **Manage rows**, and their own data access applies. Written rows fire the table's workflow triggers like any other write; deletes go through the deletion queue.
- API calls and workflows were set up by the form's author — adding a rule that writes to a table needs **Manage rows**, one that calls an API needs **Test integrations**, one that starts a workflow **Activate workflows** — and run as system actions for the submitter, with credentials kept on the server.
- **Once per submission.** Each run is recorded with a key (the submission and the step; an in-form Button sends one key per click), so a double submit or a retry returns the first run's summary instead of writing again. At most 200 rows per run.
- Every run is in the audit log of the form, and its per-row results are kept with the run.

\`\`\`json title="A Data table field and a Submit rule (fields + buttons)"
{
  "key": "vendors", "label": "Vendors", "type": "data_table",
  "data_table": {
    "source": "table", "table_id": "<vendors table id>", "mode": "edit", "key_column": "vendor_id", "allow_add": true, "allow_delete": true,
    "columns": [
      { "key": "vendor_id", "label": "Vendor", "type": "text", "required": true, "sortable": true },
      { "key": "name", "label": "Name", "type": "text", "sortable": true, "filterable": true },
      { "key": "risk", "label": "Risk", "type": "choice", "options": ["Low", "Medium", "High"],
        "format": { "kind": "badge", "badges": [{ "value": "High", "color": "red" }] } },
      { "key": "payment_terms", "label": "Terms (days)", "type": "number", "min": 0, "max": 120, "format": { "kind": "integer" } }
    ],
    "base_filter": { "match": "all", "conditions": [{ "column": "country", "operator": "eq", "value": "{{form.country}}" }] },
    "sort": [{ "column": "vendor_id", "direction": "asc" }], "page_size": 10
  }
}
// buttons[0].actions:
[{ "type": "apply_table_changes", "table_changes": {
    "field": "vendors", "target": "table", "table_id": "<vendors table id>", "operation": "auto", "match_column": "vendor_id",
    "mapping": { "vendor_id": "{{row.vendor_id}}", "name": "{{row.name}}", "risk": "{{row.risk}}", "payment_terms": "{{row.payment_terms}}" } } },
 { "type": "apply_table_changes", "table_changes": {
    "field": "vendors", "target": "reference", "reference_id": "<update vendor reference id>", "kinds": ["updated"], "on_error": "continue",
    "inputs": { "vendor_id": "{{key}}", "payment_terms": "{{row.payment_terms}}" } } },
 { "type": "success_screen", "title": "Saved", "text": "{{table_changes_summary}}" }]
\`\`\`

Data table fields and their rules travel with versions, exports and packages: the tables, references, integrations and workflows they use are dependencies and their ids are remapped on install.

## Label and expressions

A **Label** (palette group **Display**) is display text on the form: a styled value with a caption, never an input. Use it for an order total, a running count, a status from an API or a sentence built from other fields. Its value comes from one of three places:

- an **Expression**, worked out again whenever what it reads changes;
- **rules**, through **Set or calculate field values**, **Copy values** or an API reference's results (a Label without an expression is a valid target in the rule editor, like a read-only field);
- its **Default value** (a constant or \`{{param.x}}\`), until a rule sets it.

::image forms-label | The form designer with a Label selected: the Expression SUMPRODUCT(control.lines.rows, "qty", "price") with its preview value $406.00, Currency format, Extra large and Bold; the preview shows the editable Order lines table, the Items and Order total labels under it and a Stock status badge | A Label's expression, evaluated live against the designer preview: the order total follows the lines table as rows change.

**Display.** **Format** uses the same formats as a Data table column (number, whole number, currency, percent, date, date and time, status badge, yes / no, text), plus a **Prefix** (\`$\`) and **Suffix** (\`items\`), **Align**, **Size** (small to extra large), **Emphasis** (bold or muted) and the text shown **when there is no value** (default "—"). **Hide the caption** keeps it for screen readers only.

### Expressions

The expression language is the workflow one — the same functions as a workflow's \`{{= … }}\`, written without the braces. Press \`{x}\` (or type \`{{\`) for fields, parameters, variables, controls (including a table's rows and column names) and functions with their signatures and examples.

| What | Expression |
|---|---|
| Arithmetic on fields | \`{{form.qty}} * {{form.price}}\` |
| Brackets and rounding | \`ROUND(({{form.a}} + {{form.b}}) / {{form.c}}, 2)\` |
| Parameters and variables | \`{{form.amount}} * {{param.rate}}\` |
| Another label | \`ROUND({{control.subtotal.value}} * 1.15, 2)\` |
| Sum / average / min / max of a column | \`SUM(control.lines.rows, "amount")\`, \`AVG(…)\`, \`MIN(…)\`, \`MAX(…)\` (or \`SUM(PLUCK(control.lines.rows, "amount"))\`) |
| Count rows | \`COUNT(control.lines.rows)\` |
| Multiply columns per row, then add up | \`SUMPRODUCT(control.lines.rows, "qty", "price")\` |
| Any per-row expression | \`SUM(MAP(control.lines.rows, "qty * price * (1 - discount)"))\` — inside the quotes, a row's columns by name and the row as \`row\` |
| Only some rows | \`SUMIF(control.lines.rows, "status", "open", "amount")\`, \`COUNTIF(control.lines.rows, "status", "open")\` |
| Text | \`CONCAT({{form.first}}, " ", {{form.last}})\`, \`IF({{form.qty}} > 10, "Bulk", "Standard")\`, \`COALESCE({{form.nickname}}, "(none)")\` |

**Which rows.** A Data table field offers its rows to expressions as controls:

| Control | Rows |
|---|---|
| \`control.<table>.rows\` | the rows the table holds now: the loaded page with the person's edits applied, new rows first, deleted rows left out (up to 200) |
| \`control.<table>.added_rows\` / \`changed_rows\` / \`deleted_rows\` | the change set of an editable table |
| \`control.<table>.selected_rows\` | the selection of a select table |

Every cell is typed by its column, so numbers add up as numbers. Text is never parsed with a locale: \`1,234.50\` is read with comma thousands, and anything else that isn't a plain number (\`1.234,5\`, \`12 kg\`) is not a number. Use a Number column for amounts.

**Errors don't break the form.** The designer checks the expression as you type: an unknown field, parameter, control or column, an unknown function, an unclosed bracket or quote. The **Preview value** under it is worked out from the preview's values, so fill in the preview (add table rows) to try it. A value that can't be worked out — a division by zero, an empty field in arithmetic — leaves the label empty with a warning, never an error. A list of rows or a whole row is refused with a hint (\`SUM(rows, "column")\`, \`row.column\`). \`NOW()\`, \`RANDOM()\` and \`GUID()\` can't be used: a label gives the same value for the same inputs (use \`TODAY()\` for the date). Expressions run in the expression engine only (no \`eval\`), are at most 1,000 characters, read at most 5,000 rows, and \`MAP\` nests at most twice.

### Include in submission

Off by default: a Label is display only. Tick **Include in submission** to store its value like a field — \`{{form.<key>}}\` after **Form submitted**, \`{{task_data.<key>}}\` after a User Task, and in the submission's values.

The server never takes the browser's value:

- **An expression** is worked out again on the server from the submitted values, after they are checked. When it reads \`control.<table>.rows\`, the server reads the table's rows itself — the first page as the form loads it (the base filter, the columns, the default sort and the page size), with the reader's access — and applies the person's verified changes. Rows the browser reports are ignored. **Limit:** searching or paging the table changes what the label shows, not what is stored. For an editable grid that fits on one page, such as order lines, the two always agree. Raise the page size (up to 100) if a total must cover more rows.
- **A rule-filled label** is kept only when an enabled rule of the saved form could have produced that value. This is the same check as for read-only fields: the rule writes the label, its condition holds for the submitted values, and a value the server can work out must match. An API reference's result is accepted when its rule passes that check, because the server can't call the API again. Anything else falls back to the label's stored value or its default.

Rules judged at submit (**Before submit** blocks, field errors) read the server's label values too.

### Label changes

**When › Label changes** runs when a label's value changes: from its expression, a rule or a parameter, once the value has settled (after 150 ms). It provides \`{{event.field}}\`, \`{{event.value}}\` and \`{{event.previous_value}}\`. Any rule can read a label as \`{{control.<key>.value}}\`.

Rules can chain: one label's rule sets a value that changes another label, whose rule changes another, and so on. The form runs at most **5 rounds** of such a chain, then stops (with a note in the browser console). The Rules tab and the label's properties warn when the saved rules form a loop (Total → Discount → Total), so you can fix it before anyone fills in the form.

### Examples

**Order total over an editable Data table.** Add a Data table **Order lines** (key \`lines\`, **Editable**, **Allow adding rows**) with Number columns \`qty\` and \`price\`. Add a Label **Order total** with:

- Expression \`SUMPRODUCT(control.lines.rows, "qty", "price")\`
- Format **Currency** (USD), size **Large**, emphasis **Bold**
- **Include in submission** ticked

The total follows every edit, added row and deleted row. The workflow receives \`{{form.order_total}}\`, recomputed by the server.

**A label filled by a rule from an API response.** Add a Label **Stock status** with no expression and the default \`Not checked\`. Add a rule: **When** *Autocomplete: item selected* on **Product** → **Then** *Call an API reference* **Check stock**, mapping the response's \`status\` to **Stock status**. The label shows the API's answer, and with **Include in submission** it is stored.

**A warning banner when the total exceeds 10,000.** Add a rule: **When** *Label changes* on **Order total**, **If** \`event.value\` *greater than* \`10000\` → **Then** *Show a message* (banner, warning) "Orders over 10,000 need a manager's approval." To stop the submission as well, add a **Before submit** rule with the condition **Order total** *greater than* \`10000\` and **Block submit**. The server applies it too, using its own total.

### Accessibility

A label whose value changes while the form is open — an expression, or a rule writes it — is a polite live region (\`aria-live="polite"\`), so screen readers announce the new value with its caption. The [accessibility checker](#accessibility-checker) warns about such a label that has no caption (WCAG 4.1.3). A static label is plain text.

### API, MCP, CLI and config-as-code

A Label is a field with \`"type": "label"\` and its settings under \`label_config\`. Exports, versions, packages, \`POST /api/v1/forms\`, the MCP \`forms_*\` tools and \`usertasks forms\` carry it unchanged:

\`\`\`json
{ "key": "order_total", "label": "Order total", "type": "label",
  "label_config": { "expression": "SUMPRODUCT(control.lines.rows, \\"qty\\", \\"price\\")", "format": { "kind": "currency", "currency": "USD" }, "size": "lg", "emphasis": "strong", "include": true } }
\`\`\`

\`label_config\` takes \`expression\`, \`format\` (a cell format), \`prefix\`, \`suffix\`, \`align\` (\`left\` / \`center\` / \`right\`), \`size\` (\`sm\` / \`md\` / \`lg\` / \`xl\`), \`emphasis\` (\`normal\` / \`strong\` / \`muted\`), \`empty_text\`, \`include\` and \`hide_caption\`. A rule on it uses \`"event": "label_change"\` with \`"target": "<label key>"\`. Forms without labels are unaffected.

## Attachments

An **Attachments** field (palette group **Files**) takes one or more uploaded files. It works everywhere a form does: task forms, a reusable form's own page (\`/f/<id>\`), a workflow that starts from a form (the Run dialog and **Save & Test**), a workflow's own start form (an attachments input — see below), **Publish as form page**, the Test runner's User Tasks, and the grid and themes.

**Settings** (Properties → Files): at least / at most so many files (default at most 10; **Required** means at least one), the largest single file (default 10 MB) and all files together, the allowed types — **Documents** (PDF, Word, OpenDocument, RTF, text, Markdown, PowerPoint), **Images** (PNG, JPEG, GIF, WebP, HEIC, BMP, TIFF, SVG), **Spreadsheets** (Excel, OpenDocument, CSV, TSV), **PDF only** or **Any (safe) file**, plus extra extensions or MIME types (\`.dwg\`, \`application/zip\`, \`image/*\`) — and **Offer the camera on phones** when images are allowed. The instance caps every file at \`FORM_ATTACHMENT_MAX_MB\` (default 25 MB, at most 45).

**Uploading:** drag files onto the drop zone, **Browse…**, or paste (focus the drop zone and press Ctrl+V / ⌘V). Several files upload at once, each with its own progress bar, **Cancel** while it uploads, **Retry** after a failure and **Remove** afterwards; images show a thumbnail, other files an icon with name and size, and the arrow buttons reorder them. Everything works with the keyboard (Enter or Space on the drop zone opens the file picker) and progress is announced to screen readers. Files that are too large, of a type the field doesn't allow, or over the count are refused before they upload, with the reason.

**The value** is a list of file objects, newest last in the order shown:

\`\`\`json title="{{task_data.receipts}}"
[
  {
    "id": "6f1c…", "name": "taxi.pdf", "size": 48213, "mime_type": "application/pdf",
    "url": "https://tasks.example.com/attachments/6f1c…",
    "storage_ref": "storage://form-files/<workspace>/task-<task>/6f1c…/taxi.pdf",
    "uploaded_by": "<user id>", "uploaded_at": "2026-11-20T09:14:03.000Z",
    "checksum_sha256": "9b74…"
  }
]
\`\`\`

\`{{task_data.<key>}}\` after a User Task, \`{{form.<key>}}\` in a **Form submitted** workflow, plus \`<key>_count\` (the number of files). In the data picker the field is a list with the file's fields (name, size, MIME type, URL…): **Loop For Each** offers it under **Items to loop through** (or drop it there), and inside the loop \`{{item.name}}\`, \`{{item.size}}\`, \`{{item.url}}\` are the current file. \`{{=FILE_NAMES(task_data.receipts)}}\` lists the names, \`{{=FILES_TOTAL_SIZE(task_data.receipts)}}\` adds up the sizes, \`{{=COUNT(task_data.receipts)}}\` counts them. See [Loops over files](/docs/workflows/api-responses#loops-over-files).

**Steps that take files** accept one file object or a list: the [document actions](/docs/workflows/documents) and [media actions](/docs/workflows/media) (transcribe a recording, analyse or redact a photo — see the [quick start](/docs/workflows/media/quick-start)), **Send Email → Attachments** (\`{{task_data.<key>}}\` attaches them all, \`{{item}}\` one), **HTTP Request** (body **Multipart form (files)** or **Binary (one file)**), **Call Reference** file inputs such as storage connector uploads (S3, Azure Blob, SharePoint, OneDrive, Box, Google Drive), **Word / Excel / PowerPoint** templates, and **Read File / Read CSV / Read Excel / Download File / File to Base64**.

\`\`\`json title="Worked example: log each receipt, post it to an archive, then email them all"
{
  "nodes": [
    { "id": "claim", "type": "user_task", "config": { "task_title": "Expense receipts", "outcomes": ["Submitted"],
      "fields": [{ "key": "receipts", "label": "Receipts", "type": "attachments", "required": true,
                   "attachments": { "max_files": 5, "max_file_mb": 10, "types": ["documents", "images"] } }] } },
    { "id": "each", "type": "loop", "config": { "items": "{{task_data.receipts}}" } },
    { "id": "log", "type": "log", "config": { "message": "Receipt {{item.name}} — {{item.size}} bytes ({{item.mime_type}})" } },
    { "id": "archive", "type": "http_request", "config": { "method": "POST", "url": "https://archive.example.com/upload", "content_type": "multipart",
      "multipart": [{ "key": "name", "value": "{{item.name}}", "type": "text" }, { "key": "file", "value": "{{item}}", "type": "file" }] } },
    { "id": "mail", "type": "send_email", "config": { "to": "finance@example.com", "subject": "{{task_data.receipts_count}} receipts",
      "body": "{{=FILE_NAMES(task_data.receipts)}}", "attachments": "{{task_data.receipts}}" } }
  ],
  "edges": [
    { "source": "claim", "target": "each", "label": "Submitted" },
    { "source": "each", "target": "log", "label": "Each Item" },
    { "source": "log", "target": "archive" },
    { "source": "each", "target": "mail", "label": "Done" }
  ]
}
\`\`\`

**Start forms:** **Design start form** offers Attachments too: the workflow input becomes \`{ "type": "array", "format": "attachments", "attachments": { … } }\` and the run gets \`{{<input>}}\` (the list of files) and \`{{<input>_count}}\`. The Run dialog uploads into the workflow's start context (needs **Activate workflows**), **Save & Test** into a test context (deleted after 24 hours), and the server rebuilds the list from the uploads of the person starting the run; the files then belong to the run and are deleted with it.

**API, MCP and CLI:** upload first, then pass the file ids as the field's value. \`POST /api/v1/files/uploads\` with \`task_id\`, \`form_id\` or \`workflow_id\` (a start form), \`field_key\`, \`name\` and either \`content_base64\` (small files; also multipart \`file=@…\`) or \`size\` — then PUT the bytes to the returned signed URL and \`POST /api/v1/files/uploads/{id}/complete\`. Use the ids in \`POST /tasks/{id}/action\` (\`values.<key>: ["<id>", …]\`), \`POST /forms/{id}/submit\` or \`POST /workflows/start\` (\`variables.<input>\`). Same checks as the browser; ids of files someone else uploaded, or uploaded elsewhere, are refused; a personal API key or OAuth is needed (uploads belong to a person). MCP: \`files_upload\` (base64, up to 5 MB), \`files_upload_init\` / \`files_upload_complete\`. CLI: \`usertasks files upload <path> --field receipts --task <id>\`, or \`--attach receipts=./taxi.pdf\` on \`tasks complete\`, \`forms submit\` and \`workflows start\` (repeat it for several files). SDK: \`client.uploadFile({ task_id, field_key }, { name, bytes })\`.

**AI agents:** a **Run Agent** step's **Files** (\`{{form.receipts}}\`, \`{{item}}\`) are given to the model — images as images to vision models (OpenAI, Azure OpenAI, Claude, Gemini), PDFs as documents where the API takes them (OpenAI) and otherwise, like Word, Excel and PowerPoint files, as extracted text — and the agent can read them again with its \`read_attached_file\` tool. Up to 10 files, 5 MB per image, 100 PDF pages, 100,000 characters of text per file; only names and sizes are logged.

**Downloads:** the task screen, the submission view (Forms → Submissions) and completed tasks list the files with a download link. \`url\` (\`/attachments/<id>\`) works for signed-in people who may see the file — the uploader; for a task's files the people who can see the task (assignee, collaborators, team members, their managers, **View all tasks** and queue managers); for a submission's files its submitter and **Edit forms** — and hands the browser a link signed for five minutes. It is never public: in an email to someone outside the workspace, attach the file instead of linking it.

### How files are kept safe

- **How a file travels.** With a storage provider that signs uploads (Supabase, S3 / MinIO, Azure Blob, Google Cloud Storage) the browser sends each file straight to the store through a signed URL valid for one object and \`FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES\` (15), and the server then reads it back and verifies it before it can be used — so big files work on any host, Vercel included. With local-disk storage files go through the app, up to \`FORM_UPLOAD_MAX_BODY_MB\` (50; 4 on Vercel). Reverse-proxy settings: [Self-hosting → File uploads and request size limits](/docs/self-hosting#file-uploads-and-request-size-limits).
- **Private storage.** Files are stored by the configured storage provider in a private \`form-files\` bucket (\`<workspace>/<form or task>/<uuid>/<name>\`). The bucket is never served by \`/files\`; every download is authorised by \`/attachments/<id>\` and served with \`Content-Disposition: attachment\` (only PNG / JPEG / GIF / WebP thumbnails are shown inline), \`X-Content-Type-Options: nosniff\`, a sandboxing Content-Security-Policy and no shared caching.
- **Checked content.** The server checks the size against the field and the instance cap, and the type by its **content** (magic bytes), not the name or what the browser says: a .pdf must be a PDF, a .docx a Word document without macros, a .png a PNG, a .csv UTF-8 text. Programs and installers (Windows, Linux and macOS executables), scripts, shortcuts, macro-enabled Office files, disk images and web pages are refused whatever they are called. SVG images are sanitised (scripts, event handlers and external references removed). File names are cleaned (no paths, control or direction-override characters) and stored with a SHA-256 checksum.
- **Virus scanning (optional).** \`FORM_ATTACHMENT_SCANNER=clamav\` scans every upload with clamd (\`CLAMAV_HOST\`, \`CLAMAV_PORT\` 3310) before it is stored; infected files are refused, and a scanner outage refuses uploads unless \`FORM_ATTACHMENT_SCAN_FAIL_OPEN=true\`. Off by default.
- **Pending until submitted.** An upload belongs to the person who uploaded it and to that form or task field. It stays *pending* until the form is submitted or the task saved, and is deleted if that doesn't happen within \`FORM_ATTACHMENT_PENDING_HOURS\` (24). On submit the server rebuilds the field's value from its own records: only files this person uploaded into this form (or into this task) are accepted, so a value naming someone else's file, another workspace's file or a made-up reference is refused, and names, sizes and links always come from the server. Counts, sizes and types are checked again.
- **Workflows read files for their own workspace only.** The engine reads an attachment's bytes through the storage provider with the run's workspace; a value naming another workspace's file is "not found". Run details and logs show file names and sizes, never contents.
- **Deleting.** Deleting a task or a submission (by hand or by a retention policy) deletes its files; the \`form-files-cleanup\` job (every 15 minutes) removes them and expired pending uploads, rows and stored objects.

Exports, packages and GitHub sync carry the field's settings; uploaded files never travel.

## Header

**Buttons & header** in the designer turns on a header above the fields: an image — the UserTasks mark (default), the workspace logo, an uploaded image (PNG, JPEG, SVG or WebP up to 1 MB; SVGs are sanitised; stored in the workspace's storage and served through \`/files\`) or none — a title and a subtitle, left or centred, optionally on the form theme's banner colour (kept legible). Titles and subtitles can use the form's values (\`{{task_data.customer}}\`, \`{{form.amount}}\`), the task (\`{{task.title}}\`) and workflow variables (resolved when the task is created). New forms start with a header; existing forms have none until you turn it on. A form header replaces the mini theme's header.

## Buttons and behaviours

Every form has a button bar — by default **Submit** and **Cancel**. In **Buttons & header** you can rename them, pick a style (primary, secondary, danger), hide Cancel, reorder them and add **outcome buttons** (task forms: each completes the task with one of the step's outcomes, so Approve / Reject work as buttons), a **Save draft** button (task forms) or more submit buttons. Placement — left, right or full width — is part of the form theme. Submit buttons validate the form first; Cancel discards what was typed (asking first).

After a click a button runs its steps in order:

| Step | What happens |
|---|---|
| **Show message** | a message under the form; \`{{field}}\` placeholders are filled |
| **Show success screen** | the form is replaced by a title, text and a **Submit another**, **Close** or link button |
| **Start workflow** | starts a workflow with form values mapped to its inputs (\`{{field}}\`, \`{{customer_item}}\`…); queued on the server; later texts can show \`{{run_reference}}\` |
| **Redirect** | goes to an app page (\`/tasks\`) or an address on the allow list (\`FORM_REDIRECT_ALLOWLIST\`) |
| **Close form** | closes the form |

Typical chains: *Submit → Show message → Start workflow*, or *Submit → Start workflow → Show success screen* (with the run reference). **Start workflow** runs on the server, never in the browser: adding one needs **Activate workflows** (the right to start workflows), and it then runs as a system action in the workspace, attributed to the person who submitted (\`workflow_started_by\`, \`form_submission_id\`) and audited on the form — the submitter needs no workflow permission. A failed start is reported in the message; the submission stands. Submitting twice (a double-click) records one submission. The designer's **Preview** runs the buttons without starting anything (\`{{run_reference}}\` shows PREVIEW).

A task form shows its button bar only when the step's form has buttons configured (or a Button on the form submits); otherwise the task keeps its usual outcome buttons. **Application mode** hides the bar — see below.

::image forms-buttons | The Buttons & header tab: header with the workspace logo, title and subtitle, and a Submit return button whose click shows a success screen | **Buttons & header**: a header with the workspace logo, and a submit button that shows a success screen with the submitted values.

## Submitted page

A **Submitted page** replaces the form with a confirmation once it is sent. It is optional and off by default, so existing forms behave as before. Turn it on in **Buttons & header → Submitted page → Show a submitted page**, then set:

- **Success icon.** Pick one of the built-in icons (check circle, party, mail sent, calendar check, thumbs up, clipboard check, badge, sent, heart, star, trophy, rocket), **upload an image** (the same upload as the header: PNG, JPEG, SVG or WebP up to 1 MB) or choose **none**. Icons take the form theme's **Success** or **Primary** colour, which follow light and dark mode, or a **custom** colour. An uploaded image has its own alt text.
- **Heading and subheading.** These take the same placeholders as button texts: answers (\`{{form.name}}\` or \`{{name}}\`), parameters (\`{{param.region}}\`), variables (\`{{var.seat}}\`), the submission reference (\`{{submission_id}}\`) and the reference of a started workflow (\`{{run_reference}}\`).
- **Summary of answers** (optional). Tick fields to list them under the subheading. Empty answers are left out. Yes/no answers read Yes or No.
- **Note** (optional). A short line such as what happens next, with placeholders.
- **Buttons.** **Submit another response** opens a fresh form. The answers are cleared and you are back on the first step, but link parameters (\`/f/<id>?region=…\`) are kept. **Close form** goes back to your Home dashboard (My Tasks until Home is available). In the Run dialog it closes the dialog. Each button can be turned off or relabelled.

The page is a centred card in the form theme and works on phones. Its heading takes keyboard focus when it appears and the text is announced to screen readers (\`role="status"\`). The entrance animation only plays when the device allows motion.

**What wins.** After a submit button, the first match below applies:

| | |
|---|---|
| 1 | a **Redirect** step (the button's or an After-submit rule's) goes to its page |
| 2 | a **Close form** step closes the form |
| 3 | the button's own **Show success screen** step shows that screen |
| 4 | the form's **Submitted page** |
| 5 | otherwise the form stays open, cleared, with its messages |

Messages, banners and table-change summaries still show, on the Submitted page. **Start workflow** steps and **After submit** rules still run first.

**Where it shows.** The page shows on form pages (\`/f/<id>\`), the main use, and in the **Run** dialog when a workflow starts from a form. It also shows in the designer's **Preview**. The submit API returns it as \`effects.success_screen\` with \`source: "form"\`, \`icon\`, \`summary\`, \`note\` and \`buttons\`. **Task forms don't show it**, because completing a task already moves on; a button's own success screen still works there. Form pages need sign-in, so there is no anonymous case.

It is stored on the form layout as \`layout.submitted_page\`. Versions, export / import, packages (an uploaded image travels with the form), the API, MCP, the CLI and config as code all carry it. The accessibility checker flags a Submitted page without a heading, and an uploaded image without alt text (**submitted-page**).

::image forms-submitted-page | A registration form page replaced by its Submitted page: a party icon, "You're registered, Nancy Davolio", the reference and event from a link parameter, a summary of the chosen answers, a note and Register someone else / Close form buttons | A Submitted page with an icon, placeholders in the heading and subheading, a summary of answers and both buttons.

## Application mode: hide Submit and Cancel

**Buttons & header → Application mode** removes the form's button bar — Submit, Cancel, outcome buttons and Save draft — from every page of the form, on every surface: task forms, \`/f/<id>\` pages, start forms, the Run dialog and **Save & Test**, and the designer's preview. It is off by default. Use it for:

- **Information pages** — terms, instructions, a printed sheet. With no button that submits, nothing is validated or sent: the page just shows its content (add a **Button** with **Print** if you like).
- **Forms driven by your own buttons** — an application form with **Next**, **Back** and **Send application** placed where they belong. A Button with a **Submit** action presses the bar's (hidden) Submit or outcome button, so its behaviours — message, success screen, start workflow, redirect, close — still run, and validation is unchanged.

On a steps form in Application mode with in-form **Next / Back** buttons, the wizard's own Back / Next are left out too.

::image forms-application-mode | A supplier application page in Application mode: no Submit or Cancel bar, a Show more details button that revealed a Trading history section, a References step added to the stepper, and an in-form Next button | Application mode: the form's own buttons reveal a section and a step, and move people along.

**Task forms.** A task still has to be completed. A task form in Application mode with no in-form Submit can only be completed with the task's own outcome buttons (its header) — the designer warns on **Buttons & header** and in the footer, and the accessibility checker reports it (**submit-path**). Add a Button with a **Submit** action (choose an outcome button to complete with that outcome) to complete it from the form.

::image forms-application-mode-designer | The form designer with Application mode ticked on a task form and a warning that no button on the form submits | The warning when a task form in Application mode has no in-form Submit.

Stored on the layout as \`"application_mode": true\`; versions, exports and packages carry it.

## Buttons anywhere and form state

**Button** (palette → Layout) places a button in any grid cell, on any step or tab. Set its label, style (primary, secondary, outline, link, danger), size, icon (before or after the label), full width, alignment, a tooltip (also read by screen readers) and an optional **Ask first** prompt. **Visible when** shows it only for some answers; **Disabled when** greys it out. **On click** runs steps in order, with the same builder as the bar's buttons:

| Step | What happens |
|---|---|
| **Show / hide** | shows, hides or toggles fields, **sections** (a heading and the rows under it, up to the next heading or divider), the **row** a field sits on, or whole **steps / tabs**. Tick **Starts hidden** for what should be hidden when the form opens |
| **Set a state flag** | turns a yes/no flag on, off or toggles it (declare flags in **Buttons & header → Form state**, or **New flag**) |
| **Go to step / tab**, **Next step**, **Back** | moves through a steps or tabs form; Next checks the step first and stops on errors |
| **Set field values** | a literal or a \`{{field}}\` template from other fields |
| **Clear fields** | empties the chosen fields |
| **Validate** | checks this step or the whole form, shows the errors and stops on problems |
| **Submit** | presses a Submit or outcome button of the bar (even in Application mode) — its own behaviours run |
| **Save draft** | presses the bar's Save draft (task forms) |
| **Print** | the browser's print dialog |
| **Open link** | an app page or an allowed address (the redirect rule: \`FORM_REDIRECT_ALLOWLIST\`) |
| **Show message** | a short message under the button |

::image forms-button-designer | The designer with a Button selected: Look settings (style, size, alignment, icon, tooltip, ask first) and the On click builder with a Submit step | A Button's properties: its look and the On click steps.

**State flags in rules.** A field's or a step's **Visible when** can test \`state.<flag>\` — "Show the notes when \`state.show_notes\` equals true" — so "Show more details" toggles and wizard branches are declared, not scripted.

**What wins.** An element shows only when (1) no button has hidden it — a button hide wins over every rule, (2) its own rule holds (state flags included) and (3) its step / tab shows. **Show** only undoes a button hide; it never shows something its rule hides. Hidden fields, sections and pages are not required and are skipped by validation; a hidden step or tab leaves the stepper, the progress and the tab bar.

**The server checks it too.** The state travels with the values as \`__form_state\` (\`{ flags, hidden }\`) and is never stored. The server keeps only declared flags and targets, and only what the form's own buttons can produce: a flag no button sets stays at its default, a target no button hides stays shown, a start-hidden target no button shows stays hidden. Missing state (the API, the CLI, MCP) means the defaults. So nobody can skip a required field the form always shows by sending a crafted state.

**Accessibility.** Buttons are real \`<button>\` elements with a visible label; toggles announce \`aria-expanded\` and point \`aria-controls\` at what they show or hide; Next / Back move focus to the new step's heading; the confirm prompt is an inline \`alertdialog\`; messages are polite status updates. They follow the form theme in light and dark. Completed tasks and other read-only views don't draw buttons, ignore button hides and show every answered field.

\`\`\`json title="A Button and the state it uses (fields + layout)"
{
  "key": "show_more", "label": "Show more details", "type": "button",
  "button": { "style": "secondary", "icon": "chevron-down",
    "actions": [{ "type": "show_hide", "mode": "toggle", "targets": ["section:history", "page:references"] }] }
}
// layout: "state": { "flags": [{ "key": "show_notes" }], "hidden": ["section:history", "page:references"] }
\`\`\`

Action types: \`show_hide\` (\`mode\`, \`targets\`), \`set_state\` (\`flag\`, \`state_value\`: \`true\` / \`false\` / \`toggle\`), \`go_to_page\` (\`page\`), \`next_page\`, \`previous_page\`, \`set_values\` (\`assign\`), \`clear_values\` (\`fields\`), \`validate\` (\`scope\`: \`page\` / \`form\`), \`submit\` (\`button\`: a bar button id), \`save_draft\`, \`print\`, \`open_link\` (\`url\`, \`new_tab\`), \`message\` (\`text\`, \`title\`, \`tone\`, \`style\`, \`duration\`, \`seconds\`), \`prompt\` (ask a question — see [Messages and questions](#messages-and-questions)). Targets: \`field:<key>\`, \`section:<heading key>\`, \`row:<key>\`, \`page:<id>\`. Undo / redo, versions, export and packages carry buttons and state like any field.

## Rules

The **Rules** tab of the form designer (next to **Field** and **Buttons & header**) lists every rule of the form in one place. Each rule reads **When** [an event] → **If** [conditions] → **Then** [actions]. Use it to hide and show, validate, update values and move data between fields, tables and APIs.

::image forms-rules | The designer's Rules tab: a list of rules with where-they-live badges, one rule open with its When, If and Then sections | The Rules tab: the form's own rules and the ones that live on fields and buttons, with badges, on / off switches and a conflict note.

**One list, nothing migrated.** Rules you already have keep living where they were and keep running unchanged; the tab shows them with a **where it lives** badge and you can edit them in either place:

| Badge | Where it lives | Shown as |
|---|---|---|
| **Rules** | the form's own rules (\`layout.rules\`) | as built |
| **Field: … · Visible when** | a field's or button's Visible when | Always → show while the condition holds |
| **Step / Tab: … · Shown when** | a page's Visible when | Always → show the step / tab |
| **Button: … · Disabled when** | a button's Disabled when | Always → disable while the condition holds |
| **Button: … · On click** | an in-form Button's steps | Button clicked → its steps |
| **Buttons & header: …** | a bar button's behaviours | After submit → its behaviours |
| **Form state · Starts hidden** | targets hidden when the form opens | Form loads → hide |

An edit that no longer fits the old place — AND / OR groups on a visibility rule, a condition on a button click, turning a rule off — moves the rule into the form's own rules (the old place is cleared, so it still runs once).

### When: events

| Event | Context (\`{{event.*}}\`) |
|---|---|
| **Always (while the condition holds)** | — declarative: show / hide, enable / disable, read only and errors follow the condition |
| **Form loads** | — |
| **Field value changes**, **gets focus**, **loses focus** | \`event.field\`, \`event.value\`, \`event.previous\` |
| **Button clicked** | \`event.button\` (runs after the button's own steps) |
| **Data table: row clicked / selected / deselected / double-clicked** | \`event.row.<column>\`, \`event.key\` |
| **Data table: cell edited / row added / row deleted** | \`event.row.<column>\`, \`event.column\`, \`event.value\`, \`event.previous\` |
| **Autocomplete: item selected** | \`event.value\`, \`event.item.label\`, \`event.item.fields.<field>\` |
| **Step / tab changed** | \`event.page\`, \`event.previous\` |
| **Before submit** | \`event.button\` — can block the submission with a message |
| **After submit** | \`event.button\` — runs on the server with the stored submission |
| **A state flag changes** | \`event.flag\`, \`event.value\` |
| **A question is answered** | \`event.response\` (\`yes\`, \`no\`, \`ok\`, \`cancel\`, a custom value or \`dismissed\`), \`event.message\` (the question's name), \`event.label\` |
| **Label changes** | \`event.field\`, \`event.value\`, \`event.previous_value\` — a [Label](#label-and-expressions)'s value settled on a new one (expression, rule or parameter) |
| **Section / tab loaded** | \`event.part\` (\`section:<key>\` or \`page:<id>\`): a lazy part loaded (see [When to load](#when-to-load-faster-forms)) |

### If: conditions

The same condition builder as a Data table's filter: conditions in an **All (AND)** or **Any (OR)** group, with one nested group. A condition tests a form field (or an autocomplete's \`<key>_label\`), a state flag (\`state.<flag>\`), the current user (\`user.email\`, \`user.name\`, \`user.id\`) or the event (\`event.row.city\`). The value can be fixed or a template — \`{{start_date}}\` compares two fields (dates and numbers compare as dates and numbers). No conditions: the rule always runs on its event.

### Then: actions

| Group | Actions |
|---|---|
| **Show / hide** | show / hide / toggle fields, sections, rows and steps / tabs; enable / disable fields; make a control, section, step / tab or the whole form read only (or editable again); collapse / expand a section; load a section, step or tab ([When to load](#when-to-load-faster-forms)) |
| **Validate** | show an error on a field; block submit with a message; validate the form or step |
| **Update values** | set or calculate values (\`{{qty}}\`, \`{{=SUM(qty, 2)}}\`); clear fields; set or toggle a flag |
| **Transfer data** | copy values into fields (from the clicked row or the selected item: \`{{event.row.name}}\`); run an autocomplete's lookup; refresh a Data table or autocomplete |
| **Messages** | show a message (a banner at the top of the form or inline; info / success / warning / error; until dismissed, auto-hide, until the next action, or stays); ask a question (OK, OK / Cancel, Yes / No, Yes / No / Cancel or your own buttons) — each answer runs its own actions |
| **Navigate** | go to a step / tab, next, back; open a link; submit; save draft; print |
| **Integrations / workflow** | call an API reference (**Inputs** mapped from placeholders, **Then map the response** into fields or variables, **If the call fails**: a message or leave the fields unchanged); start a workflow; apply table changes (for each changed row) |

Rules run in list order — drag them (or use the arrows) to reorder; the later rule wins when two set the same thing, and the list says so. Each rule has a name, an on / off switch, **Duplicate** and **Delete**; search by name, field or action and filter by event. **Test a rule** simulates an event — pick a Data table and type a sample row, or a value — and lists which rules would run and what they would do, using the Preview's values.

::image forms-rules-runtime | A form with a customer table: clicking a row filled the Customer name and City fields and switched to the Details tab | "Data table row clicked → copy the row into the customer fields and go to the Details tab" at runtime.

\`\`\`json title="Row clicked → fill the customer and show Details (layout.rules)"
{
  "id": "r_fill", "name": "Fill customer from the clicked row",
  "event": "row_click", "target": "customers",
  "then": [
    { "type": "copy_values", "assign": { "customer_name": "{{event.row.company_name}}", "city": "{{event.row.city}}" } },
    { "type": "go_to_page", "page": "details" }
  ]
}
\`\`\`

\`\`\`json title="Before submit → block with a message; Always → cross-field error"
[
  { "id": "r_block", "event": "before_submit",
    "if": { "match": "any", "conditions": [{ "column": "customer_name", "operator": "is_not_set" }] },
    "then": [{ "type": "block_submit", "text": "Pick a customer first" }] },
  { "id": "r_dates", "event": "always",
    "if": { "match": "all", "conditions": [{ "column": "end_date", "operator": "lt", "value": "{{start_date}}" }] },
    "then": [{ "type": "field_error", "field": "end_date", "text": "The end date must be after {{start_date}}" }] }
]
\`\`\`

### Read only

**Make read only / editable** (Then → Show / hide) locks controls without hiding them. Pick **Read only**, **Editable** or **Toggle**, then what it applies to: a control, a section, a row, a step or tab, or **Whole form**. A control is read only when it, or anything around it (its section, its step / tab, the whole form), is read only — **Editable** on one control doesn't unlock it inside a read-only section.

- **What the person sees.** The control keeps its value and its normal look on a quiet background with a dashed border, not the greyed-out disabled look. Text boxes, long text, numbers, dates and currency become read-only inputs (the value can still be selected and copied). Dropdowns, people pickers and autocompletes show their value in a read-only text box. Checkboxes, radio buttons and multi-choice chips keep their state but ignore clicks and keys. Data tables keep paging and searching but can't be edited, added to, deleted from or have their selection changed; attachments list the files without add, remove or reorder; custom controls get their \`readonly\` state. Read-only controls stay focusable and say so to screen readers (\`aria-readonly\`); the required asterisk goes.
- **Values.** The value is still submitted and still read by conditions, labels and validation. Rules can still change it (**Set or calculate field values**, **Copy values**, **Clear fields**).
- **Required.** A read-only control isn't required — the person couldn't fill it in. The server works this out itself: it recomputes **Always** rules, and accepts an event rule's read-only claim only when an enabled rule of the saved form could have made it (like hides). Other checks (format, ranges, rule errors) still run.
- **Always rules.** **When → Always** with **Read only** locks the targets while the condition holds and unlocks them when it doesn't. With no condition, the targets are always read only.
- **Buttons** aren't affected, even in a read-only section or form; use **Enable / disable** for them. Headings, dividers and labels hold no value and are skipped.
- **Not a server lock.** Like **Enable / disable**, a rule's read only is enforced in the browser: the server doesn't reject a changed value for a field a rule made read only. For a value the server keeps no matter what, use **Read-only** on the field itself.
- In JSON: \`{ "type": "read_only", "mode": "read_only" | "editable" | "toggle", "targets": ["field:amount", "section:billing", "page:review", "form:*"] }\`. \`form:*\` is the whole form.

\`\`\`json title="Always → lock the whole form once it's approved"
{ "id": "r_lock", "name": "Lock when approved", "event": "always",
  "if": { "match": "all", "conditions": [{ "column": "status", "operator": "eq", "value": "Approved" }] },
  "then": [{ "type": "read_only", "mode": "read_only", "targets": ["form:*"] }] }
\`\`\`

### Before submit on steps, bar buttons and read-only fields

- **Steps.** A **Before submit** rule runs when the form is submitted, not when a step's **Next** is pressed, so an error aimed at a field on another step no longer stops **Next** silently. When it blocks the submission, the form goes to the step holding the field and shows the error there. Tick **Also check on this step** on the rule to run it on **Next** too (for that step's fields). A step's **Next** never blocks on an error of another step's field.
- **Bar buttons.** A Before-submit rule aimed at one bar button (**When → Before submit → Approve**) applies to that button only, in the browser and on the server. A task completed from its header with an outcome counts as the bar buttons that complete with that outcome.
- **Read-only fields.** **Set or calculate field values**, **Copy values into fields** and **Clear fields** can write a read-only field (a display value the person can't edit). The server keeps such a value only when an enabled rule of the saved form assigns that field and its condition holds for the submitted values; when the server can work the value out itself (a literal or a template of form values) it must match exactly. Any other value sent for a read-only field is ignored.

### Messages and questions

**Show a message** puts a message in front of the person. Choose:

- **Where it shows** — a **banner at the top of the form** (the default for new messages) or **inline** (under the button, or under the form for a rule). Banners stack at the top and stay visible on a long form: they stick to the top of the form while it scrolls, and a focused input scrolls clear of them. At most three show at once; older ones collapse into "N earlier messages".
- **Tone** — info, success, warning or error, each with an icon and theme colours that work in light and dark and with form themes. Warnings and errors are announced at once (\`role="alert"\`); info and success politely (\`role="status"\`).
- **How long it stays** — **until dismissed** (a close button), **auto-hide after 2–60 seconds** (the countdown pauses while the pointer is over the banner or focus is in it), **until the next action** (the person's next click or key), or **stays** (no close button).
- An optional **title**. The title and text take placeholders: \`{{form.city}}\` or \`{{city}}\`, \`{{event.row.name}}\`, \`{{user.email}}\`, flags.

A message saved before banners existed keeps its original inline look; nothing changes until you pick a style.

**Ask a question** shows a message with response buttons — as a **banner with buttons** or a **dialog** (modal). Pick **OK**, **OK / Cancel**, **Yes / No**, **Yes / No / Cancel** or **custom buttons** (a label, a value and a style each). Under each response, **If Yes →** holds that answer's own actions — the same catalog as the rule or button — and **Then continue with the next steps** says whether the actions after the question run. OK and Yes continue by default; No, Cancel and closing the question stop the rest, unless you tick it or give them actions. **Escape** answers Cancel (else No) — choose another response if you like. Questions inside an answer are not allowed (one level).

::image forms-messages | A form with a "Low stock" warning banner and a "Note saved" success banner at the top, and a "Delete rows?" question with Delete and Keep them buttons | Banners stacked at the top of the form, and a Yes / No question shown as a banner.

- **Before submit — "Are you sure?"** A Before-submit rule with a Yes / No question: **Yes** lets the submission go on, **No** stops it (add "Show a message" under No to say why). Don't add **Submit** under Yes — the submission is already on its way.
- **A button — "Delete the selected rows?"** A Button clicked rule (or the button's own On click) with a Yes / No question and **Apply table changes** under Yes.
- **A question is answered.** Give the question a **name**; a rule on **A question is answered** (that name, or any) runs with \`{{event.response}}\` in its conditions — handy for one answer handled in several places. The Rules tab shows each question's branches in the rule's summary.
- **Test a rule** has **Answer questions with**: pick Yes, No (or any response) and the panel shows that branch, and where the rest stops.
- **Accessible.** A banner question is a non-modal \`alertdialog\`; a dialog question is modal with focus kept inside. Focus moves to the first button and returns where it was afterwards. The accessibility checker warns about auto-hide under 5 seconds and questions with no title or text.
- **Safe.** A question is browser-only: what runs after **Yes** on the server (API calls, workflows, table changes) is still looked up in the **saved** form by rule, question, answer and position, so a forged "yes" reaches only what the form declares. Validation and Before-submit blocks are still checked on the server.

\`\`\`json title="Before submit → ask, and say why when the answer is No"
{
  "id": "r_confirm", "name": "Are you sure?", "event": "before_submit",
  "then": [{
    "type": "prompt", "title": "Submit this order?", "text": "{{customer_name}} will be invoiced.", "tone": "warning",
    "prompt": {
      "id": "confirm_submit", "display": "dialog", "preset": "yes_no",
      "buttons": [
        { "value": "yes", "label": "Submit", "style": "primary", "continue": true },
        { "value": "no", "label": "Not yet", "then": [{ "type": "message", "text": "Not submitted.", "style": "banner", "duration": "auto", "seconds": 6 }] }
      ]
    }
  }]
}
\`\`\`

### Security

- **Browser rules change only what the person sees and types**: values, flags, hidden / disabled / read-only elements, the step, messages. Disabling a field, or making it read only with a rule, is presentation; use **Read-only** on the field for a value the server keeps.
- **Server actions run on the server** — calling an API reference, starting a workflow and applying table changes are looked up by rule id and position in the **saved** form (\`POST /api/internal/forms/rule-action\`); the browser sends only the values and the event. A reference writes only to fields the rule maps; a workflow starts as the form's action for the person (adding one needs **Start workflows**, adding an API call **Test integrations**, a table write **Manage rows** — checked when the form is saved).
- **Forged events go nowhere.** When a rule's condition reads only form values and flags, the server checks it before running a server action and before accepting a hide or flag the rule set. A crafted \`__form_state\` can only claim what the form's buttons and rules can produce, so a required field cannot be skipped.
- **Validation can't be skipped.** Errors and blocked submits on **Always**, **Before submit**, **Field value changes** and **Loses focus** rules are checked again by the server at submit (with the same values), like the field rules; **Always** hides are recomputed by the server, so they decide what is required. Rules that read the event of a click or the current user run in the browser only.
- The **accessibility checker** warns when a rule hides a required field and nothing shows it again.

Rules are part of the layout, so they travel with versions, exports, packages, the REST API (\`layout.rules\`), MCP (\`forms_create\` / \`forms_update\`) and the CLI's config-as-code.

## Parameters and variables

A form can take **parameters** — inputs it is opened with — and keep **variables** — values it remembers while it is open. Use them anywhere placeholders are accepted as \`{{param.<name>}}\` and \`{{var.<name>}}\`: rule conditions and actions, default values, a Data table's base filter and API request mappings, autocomplete filters and request mappings, headings, headers and messages. Declare both on the designer's **Data** tab (next to **Rules**): type a name (\`customer_id\`), pick the type and press **Add**. A name that is reserved (\`param\`, \`var\`, \`user\`, \`id\`…), already taken or not a plain lower-case name is explained under the box. Every placeholder menu lists them under **Parameters** and **Variables**, with their types.

**Parameters.** Each has a name, a type (**Text**, **Number**, **Yes / no**, **Date**, **List of text**), an optional default, **Required**, where it comes from, and optional validation (allowed values, a pattern, a minimum and maximum — the value, the length, the item count or the dates):

- **URL query parameter** — on the form's page, \`/f/<id>?customer=ALFKI&region=EU\`. The query parameter's name defaults to the parameter's. Lists take \`?tag=a,b\` or \`?tag=a&tag=b\`.
- **Passed by the embedding context** — a task form gets it from the User Task step's **Form parameters** (a value or a workflow \`{{variable}}\`, resolved when the task is created and kept on the task); a workflow started from a reusable form gets it from the **Form parameters** inputs of the Run dialog and the Test runner. Never read from the URL.

Values are converted to the type and checked; query parameters the form doesn't declare are ignored. When a required parameter is missing (or a value is refused), the page says which and doesn't open the form. The **Forms** menu opens forms without parameters, so a form with a required parameter that has no default **is not listed in the menu** — share a link with the values instead: the form's **QR code** dialog has a **Link with parameters** builder that fills them into the link and its code.

**Variables.** Each has a name, a type (the parameter types plus **Row / object**) and an initial value: empty, a constant, a parameter, or an expression (\`{{param.customer}}-{{today}}\`). The rule action **Set a variable** (Then → Update values) sets one — from the event (\`{{event.row.OrderID}}\`, or the whole row for a Row / object variable), a field, a formula (\`{{=UPPER(code)}}\`) — or clears it or resets it to its initial value; **Call an API reference** can map a response path into \`var.<name>\`. Data tables and autocompletes that read a parameter or a variable query again when it changes. Variables are not submitted unless you tick **Include in submission**; then the value (like an included parameter's) is stored with the submission under its name and the workflow gets it — \`{{form.<name>}}\` from a Form submitted trigger, \`{{task_data.<name>}}\` after a User Task — listed in the data picker as a form parameter or variable.

**Try them in the Preview.** When the form declares parameters or variables, the designer's **Preview** has an **Inputs (n)** button that shows or hides a **Test inputs** panel above the form. **Parameters**: one box per parameter, typed (a Yes / no or allowed-values list is a menu, a date a date picker, a list comma-separated), with its default as the placeholder, required ones marked and the same checks as the form page (a refused value is explained and the default applies). Changing one reopens the preview as opening the form with that link would: field defaults with \`{{param.x}}\` and variables that start from a parameter are worked out again, and **Form loads** rules run again. When a required parameter is missing the panel says what the form page would show instead of the form; the preview still opens so you can work on it. **Variables**: each variable's live value, as rules change it while you use the preview, and what it starts as. Edit one to override it (**Overridden**); **Reset** puts one back to its initial value, **Reset all** all of them. The Rules and Data tabs' preview values (a label's **Preview value**, dry runs) see the same parameters and variables. For a saved reusable form, **Copy link with these parameters** copies its page link with the URL parameters filled in. Test inputs are remembered in this browser for the form; they are never saved with it.

::image forms-params | A form page opened with ?customer=ALFKI: the Orders Data table lists only ALFKI's orders, and clicking order 10952 set a variable that the Order lines table below (an API reference) used to load that order's lines | \`/f/<id>?customer=ALFKI\`: the parameter filters the Orders table; a row click sets \`{{var.selected_order}}\` and the Order lines API table loads that order.

\`\`\`json title="?customer= filters a Data table of orders (field data_table + layout.params)"
{
  "data_table": {
    "source": "table", "table_id": "<orders table>", "mode": "display",
    "columns": [{ "key": "OrderID", "label": "Order", "type": "number" }, { "key": "OrderDate", "label": "Date", "type": "date" }],
    "base_filter": { "match": "all", "conditions": [{ "column": "CustomerID", "operator": "eq", "value": "{{param.customer}}" }] }
  },
  "layout.params": [
    { "name": "customer", "label": "Customer", "type": "text", "source": "url", "required": true, "pattern": "[A-Z]{5}" }
  ]
}
\`\`\`

\`\`\`json title="A row click sets a variable that drives an API reference (layout.variables, layout.rules, the second table)"
{
  "layout.variables": [{ "name": "selected_order", "type": "number", "include": true }],
  "layout.rules": [{
    "id": "r_pick", "event": "row_click", "target": "orders",
    "then": [{ "type": "set_variable", "variable": "selected_order", "variable_mode": "set", "value": "{{event.row.OrderID}}" }]
  }],
  "lines.data_table": {
    "source": "reference", "reference_id": "<Order lines reference>", "results_path": "data",
    "input_mappings": { "order": "{{var.selected_order}}" }
  }
}
\`\`\`

### Prefill from a URL parameter via an API

A common pattern: open the form with a key in the link, look the record up through an API reference and fill the form with it.

1. **Data** tab → **Parameters**: name \`customer_id\`, type **Text**, **Add**. It comes from the URL query parameter \`?customer_id=…\`. Optionally give it a pattern (\`[A-Z0-9]{5}\`) so other values are refused before anything is called.
2. **Rules** tab → **New rule**. **When**: **Form loads**. **If**: \`customer_id · text\` **is not empty**. Parameters don't change while the form is open, so **Form loads** is the event to use; it runs after the link's parameters are read. Shortcut: once the form has a parameter, the Rules tab offers **Prefill from \`{{param.customer_id}}\` via an API (template)**, which adds steps 2 and 3 with the reference left to choose.
3. **Then** → **Call an API reference** → choose the reference (e.g. *Get customer profile*, \`GET /customers/{{customer_id}}\`).
   - **Inputs**: each of the reference's inputs, with **required** marked. An input named like a parameter or a field is mapped to it at once (\`customer_id\` ← \`{{param.customer_id}}\`); otherwise use \`{x}\` → **Parameters**.
   - **Then map the response**: **Load sample** runs the reference once with a sample value (\`ALFKI\`) and lists the response's fields with their types and examples. Pick a response field and the form field or variable it fills, or press **Map matching names** (\`data.name\` → *Customer name*, \`data.email\` → *Email*…). Lists read their first item as \`[0]\` (\`[0].name\`, \`items[0].id\`); **Type a path instead** works without a sample. A note says when a value is converted (text into a number field, an object into a text field as JSON).
   - **If the call fails**: **Show a message** — your text, with placeholders (*We couldn't find customer {{param.customer_id}}*), or the service's own — or **Leave the fields unchanged** (nothing shown; the rule goes on with its next step).
4. Save, then open \`/f/<id>?customer_id=ALFKI\`. The fields fill in; without the parameter the rule doesn't run and the form opens empty.

::image forms-prefill-from-url | The Rules tab: a Form loads rule whose condition is customer_id is not empty, calling the Get customer profile reference with customer_id mapped from the parameter and six response fields mapped into the form's fields | A **Form loads** rule: *If customer_id is not empty*, call *Get customer profile* with \`{{param.customer_id}}\` and map the response into the fields.

\`\`\`json title="The rule (layout.params + layout.rules)"
{
  "layout.params": [{ "name": "customer_id", "type": "text", "source": "url", "pattern": "[A-Z0-9]{5}" }],
  "layout.rules": [{
    "id": "r_prefill", "name": "Prefill customer from the URL", "event": "form_load",
    "if": { "match": "all", "conditions": [{ "column": "param.customer_id", "operator": "is_set" }] },
    "then": [{
      "type": "call_reference", "reference_id": "<Get customer profile>",
      "inputs": { "customer_id": "{{param.customer_id}}" },
      "results": { "data.name": "customer_name", "data.email": "email", "data.address.city": "city", "data.credit_limit": "credit_limit", "data.segment": "var.segment" },
      "error_text": "We couldn't find customer {{param.customer_id}}"
    }]
  }]
}
\`\`\`

How it stays safe: the browser asks the server to run the rule's step by rule id; the server reads the reference, its inputs and the mapping from the **saved** form, checks the parameter against its declaration and the rule's condition again, sends the value only into the mapped input, and writes only the declared, editable fields and variables the rule maps — each converted to its type. A value the response doesn't have leaves its field as it is; read-only fields are never written by a response. \`on_error\` is \`"ignore"\` for **Leave the fields unchanged**.

**Is empty / is not empty** work on parameters, variables and fields alike: a missing parameter, an empty text, an empty list and a blank field are empty; \`0\` and *No* are values. A parameter that isn't a valid number or date for its type is refused, so it reads as empty.

### Event and control variables

Everything a rule can read is listed in its variable picker. That includes the condition values, Set / Copy values, Set a variable, messages and questions, and API and workflow mappings. The picker has typed groups — **This event**, **Controls**, **Fields on this form**, **Parameters**, **Variables**, **Sections**, **Current user**, **Dates**, **Flags** — each showing only what that place can fill in.

#### Inserting variables

Every text box that takes placeholders in the form designer has an **Insert variable** button, \`{x}\`, beside it. Press it, or type \`{{\` (or just \`{\`) anywhere in the text, to open the picker at the cursor:

- **Readable names.** Entries read like *Selected row › ID* or *Orders › Selected row › Total*, with the stored placeholder (\`{{event.row_id}}\`) underneath, a type badge (text, number, date, row, list) and a sample value from the designer's live preview where there is one.
- **Search** matches names and placeholders, and forgives spaces and underscores: *row id*, *rowid* and *order id* all find the row id. Recently used variables come first.
- **Rows.** A row (*Selected row*, *Orders › Selected row*) folds its columns under it. Choosing it opens the columns; *Insert the whole row* is the first choice inside.
- **Keyboard:** ↑ / ↓ to move, Enter or Tab to insert, → to open a row's columns, Esc to close the picker (the designer stays open).
- **Chips.** An inserted variable shows as a chip with its name (*Selected row › ID*); the form still stores \`{{event.row_id}}\`. Backspace next to a chip deletes it whole. Hover a chip to see its placeholder and sample — with **Test a rule** open, the value the test resolves.
- **Warnings.** A variable that would come out empty where it is used is underlined, with the reason under the box. For example, \`{{event.row_id}}\` in a **Form loads** rule, or in a Button's steps, suggests *Orders › Selected row › ID* (\`{{control.orders.selected_row_id}}\`) instead.

A Button's **On click** steps have no event: their picker lists the **Controls** instead, so *Orders › Selected row › ID* reads the table's selection. Data table filters list **Dates** and **Current user**; a field's default value lists the **Parameters**.

::image forms-variable-picker | The Rules tab: a Data table row selected rule with the variable picker open on its message, listing This event (Selected row › ID first, then the row and its columns with type badges and sample values) above Controls | The variable picker on a **Row selected** rule's message: *Selected row › ID* first, then the row's columns and the form's controls.

**This event** depends on the rule's **When**. A rule on a Data table lists that table's columns, and a rule on an autocomplete lists its item fields:

| When | Variables |
|---|---|
| Data table: row clicked / double-clicked | \`{{event.row_id}}\` (the row's key), \`{{event.row}}\` (the whole row), \`{{event.row.<column>}}\`, \`{{event.column}}\` (the clicked column), \`{{event.field}}\` (the table) |
| Data table: row selected / deselected / deleted | \`{{event.row_id}}\`, \`{{event.row}}\`, \`{{event.row.<column>}}\`, \`{{event.field}}\`; selected: \`{{event.selected}}\` |
| Data table: row added | \`{{event.row}}\`, \`{{event.row.<column>}}\`, \`{{event.field}}\` (a new row has no id yet) |
| Data table: cell edited | \`{{event.column}}\`, \`{{event.value}}\`, \`{{event.previous_value}}\`, \`{{event.row_id}}\`, \`{{event.row.<column>}}\` (with the edit), \`{{event.field}}\` |
| Autocomplete: item selected | \`{{event.value}}\` (stored), \`{{event.label}}\` (shown), \`{{event.item}}\`, \`{{event.item.<field>}}\`, \`{{event.field}}\` |
| Field value changes | \`{{event.value}}\`, \`{{event.previous_value}}\`, \`{{event.field}}\` |
| Field gets / loses focus | \`{{event.value}}\`, \`{{event.field}}\` |
| A question is answered | \`{{event.response}}\` (the answer's value), \`{{event.label}}\`, \`{{event.message}}\` (the question) |
| Step / tab changed | \`{{event.to}}\`, \`{{event.from}}\` (step / tab ids) |
| Button clicked, Before / After submit | \`{{event.button}}\` |
| A state flag changes | \`{{event.flag}}\`, \`{{event.value}}\` |

Earlier names keep working: \`event.key\`, \`event.previous\`, \`event.page\` and \`event.item.fields.<field>\`.

**Controls** hold the live state of the form's interactive controls. Any rule can read them, not only the rule the control triggered:

| Control | Variables |
|---|---|
| Data table \`<key>\` | \`{{control.<key>.selected_row_id}}\`, \`.selected_row\`, \`.selected_row.<column>\`, \`.selected_rows\` (list), \`.selected_count\`, \`.last_clicked_row_id\`, \`.last_clicked_row.<column>\`, \`.row_count\`, \`.changes_count\` |
| Autocomplete \`<key>\` | \`{{control.<key>.value}}\`, \`.label\`, \`.item.<field>\` |
| Steps / tabs | \`{{control.form.step_id}}\`, \`{{control.form.step_title}}\` |

Sections get \`.included\` and \`.visible\` when repeatable sections arrive. The selection comes from the table's value, the last clicked row and the row count from what the table shows, and the step from the form.

For example, a **Data table: row clicked** rule on **Orders** can **Set a variable** \`selected_order\` to \`{{event.row_id}}\`, and a **Before submit** rule can check \`control.orders.selected_row.total\` **is greater than** \`1000\` and show *"Order {{control.orders.selected_row_id}} needs approval"*.

**Test a rule** (Rules tab) takes a sample row or value for the event and a sample **Control state** (JSON). It lists the rules that would run and what each placeholder they read would resolve to.

::image forms-rule-variables | The Rules tab: a rule on the Orders table's row click with the placeholder menu open, showing the This event group (row id, the row and each column with its type) above the Controls group | A rule's placeholder menu: **This event** for a row click on Orders, then **Controls**.

Control variables are input from the browser, like parameters and variables. When a Data table query, a lookup, an API reference or a workflow start reads one, the server rebuilds the state from the request:

- Only declared controls are kept.
- A Data table's rows keep only its declared columns.
- Ids, counts and text are bounded.
- A table's own value wins over what the request claims.
- The value fills a placeholder in the saved form only. It is one quoted value in a base filter, so it can narrow the filter but never widen it.

**Parameters and variables are not trusted.** They come from the person filling in the form (a link can say anything), exactly like field values:

- The server reads them from the request it gets — the link's values on a form page, the values the workflow passed for a task (the browser's copy is ignored) — and checks them again against the saved declarations: unknown names dropped, values converted to the type and validated, sizes bounded (500 characters, 50 list items, 20 KB per row / object variable).
- They only fill placeholders in the **saved** form. A Data table's source, columns and base filter come from the form, never the request; a parameter's value is one quoted value in its condition, so it can narrow the base filter but never remove or widen it (an empty value is compared as empty; the condition is never dropped). A required parameter that is missing or refused stops the query.
- An API reference call reaches only the reference the form declares, with the value in the inputs the author mapped — never as a URL, a header or another reference.
- Use them to choose **what to show**, not **who may see it**: anyone who can open the form can change a parameter in the link. Put access rules in the base filter (\`{{user.email}}\`), the table's permissions or the reference.

Parameters and variables are part of the layout (\`layout.params\`, \`layout.variables\`), so they travel with versions, exports, packages, GitHub sync, the REST API, MCP and the CLI's config-as-code; the data-table, lookup and submit endpoints take \`params\` and \`variables\` (\`POST /api/v1/forms/{id}/submit\` \`{ values, params, variables }\`, MCP \`forms_submit\` / \`forms_lookup\` / \`forms_data_table\`, \`usertasks forms submit <id> --set params:='{"customer":"ALFKI"}'\`). Forms without them are unchanged.

## Dynamic properties

Many field settings don't have to be fixed. A property can take its value from a **dynamic source** instead of what you typed, so a select lists the countries of the region in the link, a chart plots what an API returns and a maximum follows a variable a rule sets.

**Bindable properties:**

- **Built-in fields:** the **options** of single and multi-select fields (dropdown and radio), the **default value**, **minimum / maximum** (numbers, currency, the multi-select count), **earliest / latest** (dates), the **placeholder**, **help text** and **label**, and **Required** (a yes / no source). Lookups' filters were already dynamic and use the same placeholders.
- **Custom controls:** any prop the control's manifest lets you bind. A manifest prop may say \`"bindable": true\` or \`false\`. Without it, text, number, yes / no, list and JSON props are bindable, and choice and colour props aren't. The official controls mark their data props: Chart **data** and title, Map **markers** (new in 1.2.0), Likert **statements**, Table **default rows**, Info card **text**, title and labels, Rating **max**, Progress values and steps, Slider min / max.

In the properties panel, each bindable property has a **Static / Dynamic** switch. **Dynamic** opens the binding editor with three tabs:

| Tab | What it does |
|---|---|
| **Expression** | A placeholder expression: \`{{param.x}}\`, \`{{var.x}}\`, \`{{form.x}}\` (or \`{{x}}\`), \`{{control.x.*}}\`, \`{{user.email}}\`, \`{{today+30d}}\`. One placeholder on its own keeps its value (a number, a list); text around it makes text. It's resolved in the browser and again whenever what it reads changes. |
| **Data table** | A query of a workspace data table. For options, choose the **value** and **label** columns. For a list prop, choose the **columns** each item keeps (rename them with *as*). Add a **filter** whose values can be placeholders, a **sort** and a **limit**. |
| **API reference** | An API reference or connector operation, including custom references. Map its **inputs** from placeholders, pick the **rows list** with **Load sample**, then the value / label or the fields each item keeps. You can add a filter and sort here too, applied to the returned rows. |

The editor says what the property expects (for example *a list of options { value, label }*, *a number* or *a list of objects*), and **Preview** shows the resolved value with the live preview's values, type-checked. A value that doesn't fit (text for a maximum, an object for a list) is reported, and the static value stays in place. The static value is always the designer's preview and the fallback while a source loads.

::image forms-dynamic-properties | The binding editor on a select field's options: the Data table tab with the Countries table, value and label columns, a filter on region equal to {{param.region}}, and the preview listing the matching countries | A select's options from the Countries table, filtered by the \`region\` URL parameter, with the preview.

### Examples

**Options from a Countries table, filtered by \`{{param.region}}\`.** Declare a URL parameter \`region\` (*Parameters and variables*). On a Single select, switch **Options** to Dynamic, then **Data table**: *Countries*, value \`code\`, label \`name\`, filter \`region\` *equals* \`{{param.region}}\`, sort by \`name\`. \`/f/<id>?region=Europe\` lists the European countries. Change the parameter (or a field the filter reads) and the list loads again.

**Chart data from a custom reference.** Place the **Chart** control (Static data source), switch its **Static data** prop to Dynamic, then **API reference**: your *Monthly sales* reference, input \`region\` → \`{{param.region}}\`, rows list \`items\`, columns \`month\` as \`label\` and \`total\` as \`value\`. The host calls the reference on the server and passes the rows to the chart as its \`data\`, so the control needs no network capability.

**A number field's maximum from \`{{var.limit}}\`.** Declare a number variable \`limit\`. On the Quantity field, switch **Maximum** to Dynamic with the expression \`{{var.limit}}\`. A rule's **Set variable** changes the limit, and the input's maximum and its validation follow.

### At run time

- **Expressions** resolve in the browser on every change of what they read.
- **Data table and API sources** are fetched from the server and debounced. Each result is cached per form, field, property and inputs, and fetched again when a parameter, variable or field the source reads changes.
- **While loading or after an error**, options are disabled with *Loading options…* or *Couldn't load options*. Other properties keep their static value.
- **A dynamic default** fills the field while it's empty, or while it still holds the previous dynamic default. It never replaces what someone typed.
- **Read-only views** (a completed task) don't ask the sources again.

### Security

Dynamic sources follow the **Data table field's** security model:

- **Declared sources only.** The browser names only a field and a property. The server reads the binding from the **saved** form (a task's stored form, or the reusable form) and refuses a property that has no source binding. Only the designer's preview sends an unsaved field, and it needs *Edit forms* or *Edit workflows*, plus *View data* for a table or *View integrations* for an API.
- **The reader's own access.** A data table is read with the caller's client (*View data*, row-level security as the user, an API key's table allowlist), unless the binding has **Open access**. API references run on the server, and their credentials never reach the browser.
- **Placeholders only narrow.** Parameters and variables are checked again against the saved declarations. A placeholder's value is one quoted value in the author's filter or mapped inputs: it can narrow the filter, never remove or widen it.
- **Caps and projection.** At most 500 options and 1,000 rows (API responses are read up to 1,000 rows). Only the declared columns or fields leave the server. Requests are rate limited and time limited.
- **Anonymous forms.** On a public link a data table or API binding resolves only if **Allow anonymous read** is on for *that binding*. Otherwise it resolves empty: no options, the static value elsewhere. The designer warns about it in the binding editor and in the form's anonymous-access checklist. Values of such option fields are dropped from anonymous submissions before any check.
- **Checked again on submit.** Before validating a submission, the server resolves **options, minimum / maximum, earliest / latest and Required** again for that submission's context (its parameters, variables and values) and judges the values against them, never against the browser's list. A value outside the resolved options is refused when **Restrict to the list** is on (the default). If the source fails, the value is refused with a retry message. Bounds from \`{{var.x}}\` are only as trustworthy as the variable: variables come from the browser, so use a validated parameter or a table source for limits that matter.

Bindings are stored on the field as \`dynamic: { "<property>": <binding> }\` (custom props as \`props.<name>\`), beside the static value. That means they travel with versions, exports, packages (table and reference ids are remapped on install), GitHub sync, the REST API, MCP and config-as-code. Forms without bindings are unchanged. The older *Load options from a data table column* setting (\`options_source\`) still works. For a filtered, sorted or live list, switch the options to Dynamic instead.

**Endpoints:** \`POST /api/internal/forms/dynamic-value\` (signed in: \`{ task_id | form_id, field_key, prop, values }\`) and \`POST /api/public/forms/<token>/dynamic-value\` (anonymous links).

## Forms on their own page

Every reusable form has its own page, \`/f/<form id>\`, for signed-in members with **Submit forms** (every role by default): **Copy link** in the library. The page is the form alone, without the app's sidebar or top bar, so the link can be shared and [embedded in a website](#sharing-and-embedding-forms); visitors who aren't signed in get the workspace's [form sign-in page](#form-sign-in-page). **Open** in the library, the Forms menu, Home and search open the form inside the app instead (\`/fill/<form id>\`). The page shows the header, the fields (lookups included), the theme and the buttons. Submissions are stored (\`form_submissions\`): **Submissions** in the library lists them (everyone sees their own; **Edit forms** sees all), shows one submission and exports CSV as a background job. A form can delete submissions older than a number of days (\`submission_retention_days\`). A [retention policy](/docs/governance/audit-and-retention#forms-and-their-submissions) assigned to the form (Details → Retention) replaces that setting and deletes due submissions with their uploaded files; a legal hold keeps everything. Grants, retention, legal holds and deletes are in the audit log. The API submits too: \`POST /api/v1/forms/{id}/submit\` (\`{ values, button_id, idempotency_key }\`), \`GET /api/v1/forms/{id}/submissions\`, \`GET /api/v1/form-submissions/{id}\`, MCP \`forms_submit\` / \`forms_submissions_list\` / \`forms_submission_get\` / \`forms_lookup\` and \`usertasks forms submit|submissions|lookup\`. People without an account can fill a form in too, through its public link, when you allow it — see [Anonymous forms](#anonymous-forms).

::image forms-page | A standalone form page with a header, three-column rows, a customer lookup that filled the email and phone, and three uploaded files | A form page (\`/f/<id>\`): header, grid, a lookup that filled the contact fields, and three uploaded files.

## Available forms in the menu

Give people a menu of the forms they fill in. Turn on **Available forms** on a form (Forms library → the form's **Details** ⚙), then under **Access** add the people, teams or roles who should have it. Each of them gets the form in two places:

- the **Forms** dropdown at the top of the side menu: click **Forms** and pick a form to open its page;
- under **Forms** in the side menu: click the arrow next to **Forms**.

::image forms-header-menu | The Forms dropdown open at the top of the side menu: a search box above an alphabetical list of forms | The Forms dropdown at the top of the side menu lists the forms you were given access to; with 10 or more there's a search box.

::image forms-available-menu | The side menu with the Forms item expanded: a search box above an alphabetical list of forms, with the matched text highlighted | Available forms: the arrow next to Forms lists the forms you were given access to; with more than 10 there's a search box.

Who sees a form in their menu:

- **The form is marked Available forms**, and
- **they were given access explicitly**: a grant for them, for a team they're in, or for a role they hold (View or Submit), and
- **they can submit forms** (the **Submit forms** permission, every role by default).

Workspace-wide rights alone don't add forms: an Owner or Admin without a grant, or the person who built the form, doesn't get it in their menu. Grants don't change who can open a form's link: anyone with **Submit forms** still can.

The list:

- is **alphabetical** (ignoring case and accents; "Form 2" comes before "Form 10");
- shows a **search box** once there are 10 or more forms in the **Forms** dropdown, and more than 10 under the side menu's **Forms** item: type to filter (names and descriptions, with the match highlighted), **↑ / ↓** to move, **Enter** to open, **Esc** to clear the search, and **Esc** again to close the list;
- **remembers** whether it's open, per person, in that browser;
- works in the **collapsed side menu** (the dropdown and the item's panel open beside their icons) and in the **phone menu** (the **Forms** dropdown sits at its top);
- with no available forms, the **Forms** dropdown says "No forms have been shared with you yet" and the side menu item has no arrow. People without the Forms library (no **View forms**) still get a **Forms** item when they have some; for them the label opens the list too.

The top of the side menu used to hold the workspace switcher. Workspaces are now in your **avatar menu** (top right), together with your profile, settings and **Sign out**.

The setting doesn't create a new version and is kept by every version. It travels with exports, packages and GitHub sync, the REST API and CLI (\`available_in_menu\` on \`POST /api/v1/forms\` and \`PATCH /api/v1/forms/{id}\`) and MCP (\`forms_create\` / \`forms_update\`). Grants don't travel: in another workspace, give access there.

## Anonymous forms

A reusable form can take responses from people who don't have an account — a contact form, a public sign-up, a feedback survey. Each such form gets its own **public link**, \`/p/<random token>\`, that anyone can open and submit without signing in. It is off everywhere until two people opt in: an admin for the workspace, and the form's designer for the form.


### Setting it up

1. **Settings → Forms → Anonymous forms** (needs **Edit settings**): tick **Allow anonymous forms**. Optionally choose bot protection — **Cloudflare Turnstile** or **hCaptcha** — with its site key and secret key (the secret is stored encrypted and never shown again).
2. **Forms library → the form's Details (⚙) → Anonymous responses** (needs **Edit forms**): tick **Allow anonymous responses**. A warning lists what anonymous visitors can and can't do, and what this form would not give them (see below); **Turn on** to confirm.
3. Share the **public link**: copy it, or open the **QR code** (the dialog switches between the signed-in link and the public one, and its link builder adds the form's URL parameters to either).


Under the link you set the form's visitor limits (within the platform limits): submissions **per visitor per minute** (1–60, default 10), a **daily cap** for the form (rolling 24 hours, up to 10,000, default 500), a **minimum fill time** (default 3 seconds), **Allow uploads** (off by default) with the largest file (up to 4 MB) and files per submission (up to 10), and **Let search engines index the page** (off: the page asks not to be indexed).

- **Regenerate** (↻) makes a new link: the old one stops working for everyone at once.
- Turning **Allow anonymous responses** off stops the link immediately; turning it on again brings the same link back (regenerate to retire it).
- Turning the workspace switch off stops **every** public link of the workspace immediately, whatever each form says.

Both switches and every regeneration are in the audit log. The same settings are in the API, MCP and CLI: \`GET|PATCH /api/v1/forms/{id}/anonymous\`, \`POST /api/v1/forms/{id}/anonymous/regenerate\`, \`GET|PATCH /api/v1/anonymous-forms\`; \`forms_anonymous_get|update|regenerate\`, \`anonymous_forms_settings_get|update\`; \`usertasks forms anonymous|anonymous-set|anonymous-regenerate\` and \`usertasks anonymous-forms get|update\`. Submitting stays the form page's job: there is no public submit endpoint in \`/api/v1\`.

### What anonymous visitors can do

They can open that one form and submit it — nothing else. The public page shows the form with its own theme and header, and nothing of your workspace: no navigation, no Home, no Forms menu, no favourites or drafts, no list of people, no settings. "Resume later" doesn't keep answers for them. On the Submitted page **Submit another** starts a fresh form and **Close form** ends on a neutral "you can close this page" screen.

Their submissions are stored like any other, marked **Anonymous**: \`source\` \`anonymous\`, no submitter, and \`{{submission.submitted_by}}\` is \`{ id: null, name: "Anonymous", email: null }\` (\`{{submission.source}}\` is \`anonymous\`). They are in the Submissions list (filter **Public link (anonymous)**), the CSV export, retention policies and legal holds, like every submission. The **Form submitted** trigger runs as usual; the run has no starter (\`started_by\` empty) and \`{{workflow_started_via}}\` is \`anonymous\` — the runs list marks it **Anonymous**.


### What they can't do unless you allow it

Everything that reads your data or acts on your systems is off for anonymous visitors until you allow it on that specific field or step:

- **Lookups and Data tables** (including API-reference sources) show nothing. Turn on **Allow anonymous read** on the field (designer → the field's properties) to let anyone with the link read it — only the columns / fields the field declares, within its base filter, at most 25 rows a page and 20 results a search.
- **Server steps** — a rule or button that calls an API reference, applies table changes or starts a workflow, and a bar button's Start workflow or Apply table changes — are skipped (a rule's step answers "not available"). Tick **Allow for anonymous** on the step to run it for anyone with the link, with the integration's credentials / the workflow's authority.
- **Uploads**: Attachments fields refuse files unless the form allows uploads; then only PDF, images, text and CSV, within the form's size and count limits, checked like every upload (content type, scanning), and tied to the visit — nobody else can attach or remove them.
- **Custom controls** run in their sandboxed frame without any of their capabilities (lookup, files, reports, network), never inline.
- **People pickers** can't search your directory; \`{{user.*}}\` placeholders are empty.

Values a visitor can't legitimately have — a lookup, Data table or people field they can't read, files when uploads are off — are dropped before anything is checked, so a crafted value can't be tested against your data. If such a field is required, the form can't be submitted: the designer warns you about each of these on the form's Anonymous responses section.

### Abuse protection

- **Rate limits** per visitor IP and form, and a daily cap per form, counted in the shared cache provider (Postgres or Redis when configured) and the database, so they hold across server instances. Over the limit: "Too many submissions" (HTTP 429 with Retry-After).
- A hidden **honeypot** field: a bot that fills it gets "Submitted." and nothing is stored.
- A **minimum fill time**: the page carries a signed, timestamped ticket; a submission faster than the form's minimum, or with a forged or day-old ticket, is refused.
- Optional **bot protection** (Turnstile / hCaptcha), verified on the server. Without it configured nothing is sent to any third party.
- **Body size caps** on every public endpoint, JSON only, and an **idempotency key** per filled form so a double click is one submission.
- For abuse review each anonymous submission keeps an **IP hash** (a keyed hash, cut to 16 characters — never the IP) and the browser's user agent (cut to 120 characters).

### Threat model

- **Who**: anyone on the internet who has (or guesses) a link. They are untrusted and unauthenticated.
- **The link** is 32 random bytes; form ids never appear in it, so forms can't be enumerated. Every unavailable link — unknown, regenerated, the form or the workspace switched off — answers the same "not available", so nothing can be learned by probing. The page is sent with \`Referrer-Policy: no-referrer\` (the token doesn't leak to other sites), \`Cache-Control: no-store\` and, unless you allow indexing, \`noindex\`. Anyone who has the link can pass it on: treat it as public, and regenerate it to revoke it.
- **What the server trusts**: nothing from the request but the token. The form, its version, its fields, rules, sources and steps come from the saved form; the tenant is the form's; the actor is nobody — a dedicated anonymous context that holds only "submit this form". Every public endpoint resolves the token first and every service checks the form id against it, so a crafted form id, field definition, \`__form_state\`, parameters, variables or control state can't reach another form, field, source or step.
- **What it can reach**: only the allowlist above, and only what you opened on the form. Your data stays behind **Allow anonymous read** (projection, filter, page caps) and your systems behind **Allow for anonymous**.
- **The database**: the link tokens live in a table no signed-in or anonymous client can read (\`form_anonymous_access\`, service role only); no new grants to anonymous database roles were added.
- **The browser**: the public page has the same Content-Security-Policy as the app (plus the captcha provider's hosts on public pages only); custom controls stay in their sandbox with no network access.
- **Residual risks**: spam within your limits (lower them, add bot protection), whatever you deliberately opened with Allow anonymous read / Allow for anonymous, and links shared further than you meant (regenerate).

## The Form submitted trigger

A workflow can start whenever a reusable form is submitted: **Form Submitted** trigger → choose the form (and optionally the buttons / outcomes that count). It fires for every submission — the form's page, the API and MCP, and a User Task whose form is linked to it (with \`{{form_outcome}}\` and \`{{task_id}}\`). Every field is available downstream, typed, as \`{{form.<key>}}\` (\`{{form.<key>_item}}\` for lookups), with \`{{submitted_by_name}}\`, \`{{submitted_at}}\`, \`{{form_button}}\`, \`{{form_version}}\` and \`{{form_submission_id}}\` — all in the data picker. Each submission is also a \`form.submitted\` event in the event stream (and so in log export destinations), without the values.

### Submission details: \`{{submission.*}}\`

Every run a form starts — the **Form submitted** trigger, a button's **Start workflow**, a form page, the Run dialog and a designed start form — also gets one reserved object, \`submission\`, listed as **Submission details** in the data picker:

| Variable | What it holds |
|---|---|
| \`{{submission.id}}\` / \`{{submission.reference}}\` | The submission id and the short reference people see on the Submitted page (empty for a start form, which stores no submission) |
| \`{{submission.submitted_at}}\` | When it was submitted (ISO 8601, server time) |
| \`{{submission.submitted_by.id}}\` / \`.name\` / \`.email\` | Who submitted it |
| \`{{submission.form.id}}\` / \`.name\` / \`.version\` | The form and the version submitted |
| \`{{submission.source}}\` | \`page\`, \`run_dialog\`, \`api\` (REST, MCP, CLI), \`task\`, \`test\` (Save & Test) or \`anonymous\` (a [public link](#anonymous-forms)) |
| \`{{submission.button}}\` / \`{{submission.outcome}}\` / \`{{submission.task_id}}\` | The button pressed, an outcome, the task of a task form |
| \`{{submission.url_params}}\` | The form's URL query parameters, as declared and checked by the server |

The server sets it from the signed-in person, its own clock and the stored submission: a \`submission\` value sent with the values or start variables is dropped. It lives at the top level, apart from the fields (\`form.<key>\`) and a custom control's \`<key>_raw\` / \`<key>_text\` extras, so it never collides with a field key; a workflow input named \`submission\` is replaced by it. The older flat variables (\`{{submitted_by_name}}\`, \`{{form_submission_id}}\`…) keep working. The same metadata is in the form's **Submissions** list (reference, email, form version, where), its CSV export, Home's **My submissions** and the API / MCP submission reads (\`submission\`; \`url_params\` is \`{}\` there, because URL parameters are not stored unless marked *Include in submission*). For User Tasks, \`{{completed_by}}\`, \`{{completed_by_name}}\`, \`{{completed_by_email}}\` and \`{{completed_at}}\` say who completed the task and when.

Used as a task form instead (a User Task linked to the form), the same form renders inside the task — header, theme and buttons included — and its values come back as \`{{task_data.<key>}}\`.

::image forms-trigger | A Form submitted trigger linked to the Customer return form, with its form page link, Copy link, Open form and QR code, and the list of form variables | The **Form submitted** trigger: the form, its page link with **QR code**, and every field available downstream.

## Use the values downstream: the Data panel and drag and drop

Form fields are the first thing every picker offers, labelled and typed:

- **Data panel.** **Data** in the settings panel's header (or **Alt+D**) docks a panel beside the selected step listing everything available at that step: **Form submitted › <form>** (\`{{form.<key>}}\`, then who submitted it and when), a task trigger's **Task form** (\`{{task.data.<key>}}\`), **Start form › Workflow inputs**, and each earlier User Task's **Form** (\`{{task_data.<key>}}\`, with \`<key>_item\` for lookups and \`<key>_count\` for attachments), then step outputs. Search matches labels and keys; a **Recently used** group keeps your last picks. The panel stays open as you move between steps.
- **Drag and drop.** Drag any row from the Data panel, the **Variables** panel or **Insert data** onto a setting: it is inserted where you drop it (a caret shows where), or replaces an empty field. Dropping a list (attachments, a multi-select, a lookup with several values) asks for the first item, an index, a find, the count or a loop; dropping it on a Loop's **Items to loop through** sets it. Click or **Enter** still inserts at the last place you typed.
- **Chips.** In expression inputs a field shows as a chip with its label (*Order number*); hover for the key.
- **Typing** \`{{\` lists the step's form fields first, with labels.

::image forms-data-picker | The Data panel docked beside a Log step, listing the Customer return form's fields with their keys and types | The Data panel at a later step: each form field with its label, \`{{form.<key>}}\` path and type, ready to drag into a setting.

## Test with the real form: Save & Test and Run

When a workflow starts from a form, testing and running it uses that form, not a list of variables:

- **Save & Test** with a **Form submitted** trigger draws the linked form exactly as its page does — header, grid, theme, lookups with real suggestions, validation and its buttons. Pressing a button sends a *test* submission: the server checks it like a real one (per-field errors come back on the form) and starts a test run with the same \`{{form.<key>}}\` payload, \`form_source\` = \`test\`. Nothing is stored — no submission, no \`form.submitted\` event, no other workflow started; the log says what the button would have done.
- With a **start form**, Save & Test shows its grid and theme over the inputs.
- **Test cases** remember each form's values and button: selecting a case refills the form, **Duplicate Selected** copies it, **Run Selected** shows the form and waits for its button, and **Run All (saved values)** reruns each case's last accepted submission (cases never submitted are skipped as *Needs form input*). **Show as fields** switches to the raw values.
- **Run** (workflow list and page) opens the same form. For a Form submitted workflow, submitting it is a real submission — stored, attributed to you, with its button behaviours — that starts the workflow through its trigger. For a start form it is a normal manual run.

## Reusable forms

**Build › Forms** is the library: search and filter by tag, create, edit, duplicate and delete forms, and see which workflow steps use each one. In the designer, **Save as reusable form** saves the form to the library and links the step to it; **Use a saved form** links an existing one.

- A linked step shows **Linked to form "…" vN**. Saving in the designer can create a new version of the form or **Detach and save here** (the step keeps a local copy). **Detach** on the step does the same without opening the designer.
- Every change to a form's fields, layout or theme creates a new version; name, description and tag changes don't.
- **Drafts follow the latest version** of a linked form. **Publishing pins** the version in use, so a published workflow keeps its form until you publish again.
- A form that workflows use can't be deleted; the error lists where it is used.

Forms need the **View forms**, **Edit forms** and **Delete forms** permissions (Owner, Admin and Manager have all three). Member and Viewer don't see the form library; they open and submit the forms they are given with **Submit forms**. They travel with config-as-code, GitHub sync and packages (a workflow that links a form brings it, and its saved theme, along), and have REST (\`/api/v1/forms\`, \`/api/v1/form-themes\`), MCP (\`forms_*\`, \`form_themes_*\`) and CLI (\`usertasks forms …\`) commands.

## Themes: the workspace theme and mini themes

By default a form uses the [workspace theme](/docs/governance/workspace-theme) — the full theme of the app, in light and dark. The **Form theme** tab can instead give the form a **mini theme**: a small set of overrides laid on top of the workspace theme (**Custom**, or a **Saved theme**), starting from any built-in preset:

- accent colour (buttons, focus ring, selection), background and text colour, separately for light and dark mode
- the page behind the form (a colour, or a gradient to a second colour — standalone form pages, the frame around a task form, the designer preview), the input background, border colour and primary button colour (derived from the accent unless you set one), per mode
- corner radius, font (from the workspace theme's fonts), density (comfortable or compact), label position (above or left of the input) and where the buttons sit (right, left or full width)
- a **heading font** separate from the body font (the same curated list: titles, section and page headings), the **button shape** (square, rounded — the corner radius — or pill), a **shadow** under the card (none, subtle, medium or strong; tuned for light and dark cards) and the **field style** (outlined, filled or underline — inputs always keep a 3:1 bottom rule)
- **Appearance**: follow the workspace (the default), follow each viewer's own light / dark setting (**Viewer's light / dark**, so your dark colours show to people in dark mode even when the workspace forces light), or **Always light** / **Always dark**
- an optional header with a title, subtitle, banner colour and the workspace logo

Shadows, button shapes and field styles are named choices, never CSS: a theme stores \`shadow: "subtle"\`, not a box-shadow. In the API, MCP and CLI the keys are \`heading_font\` (\`{ source, family }\`), \`button_shape\`, \`shadow\`, \`field_style\` and \`appearance\`; leaving one out keeps the look forms had before.

The theme covers the whole form: page, card, header banner, headings and dividers, inputs (background, border, focus ring, placeholder), help and error text, buttons, the autocomplete list and chips, checkboxes and radio buttons, the date picker's light / dark, messages, the success screen and the Cancel confirmation. Every text / background pair the form draws is kept legible — AA (4.5:1) for text, 3:1 for input borders and the focus ring; a mid-tone background on which neither white nor dark text would pass is nudged until one does. Contrast is checked against the workspace theme in both modes. Low-contrast pairs are listed with an **Auto-fix**, and the form always raises them when it is drawn, so text is never illegible. A theme whose own text and background are below 3:1 can't be saved. Without dark colours, dark mode keeps the workspace's dark palette with your accent.

Save a theme to reuse it (**Save as a reusable form theme**, or **Build › Forms → Form themes**). Tasks keep the theme they were created with.

::image forms-theme | The designer preview at phone width with a custom mini theme: bronze accent, cream page background and the header with the workspace logo | A mini theme in **Preview → Phone**: the page background, accent and header apply everywhere the form is shown.

## Accessibility checker

The designer's **Accessibility** tab scores the form against **WCAG 2.2 AA** (0–100; 100 means no findings) as you edit, and lists what to fix by severity — critical, serious, moderate, minor and *needs review* — each with its success criteria (linked to the W3C "Understanding" pages). Click a finding to select its field; **Fix** buttons apply the safe changes as one undoable step: **Add label**, **Use placeholder as label**, **Apply autocomplete**, **Add error message**, **Explain the asterisk**, **Add alt text**, **Auto-fix contrast** (moves the form theme's colours to the nearest passing values, light and dark).

It checks: every field has a meaningful label (not just a placeholder or its key) and labels are unique; help text and section descriptions; that required fields are explained in text; pattern rules have an error message; fields revealed by **Visible when** come after the question that reveals them; section headings and the form title; the page language; **input purpose** — personal-data fields (name, email, phone, address, postcode, date of birth…) should set **Autocomplete (input purpose)** in the field's properties; step / tab titles; time limits; alt text for an uploaded header image (**Image description** in **Buttons & header**); lookup instructions; button text; [custom controls](/docs/tasks/custom-form-controls)' accessible name (the field label), role and keyboard notes from their manifest; 24 px targets; and colour contrast of the form theme on the workspace theme in light and dark (text 4.5:1, placeholders 4.5:1, input borders and the focus ring 3:1, button text, selected chips).

**Scan preview with axe** runs [axe-core](https://github.com/dequelabs/axe-core) on the live preview in light and dark and merges its results. **Export CSV / PDF** produces a report in the background (the Jobs popup offers the download).

**Settings → Forms** sets the check made when a form is saved: **Off**, **Warn** (default — below the minimum score, 80 unless changed, the designer asks before saving) or **Block** (the designer refuses, and so do the forms API, MCP and CLI for reusable forms and form pages; config-as-code and package imports are not checked). Check a reusable form from outside the app with \`POST /api/v1/forms/{id}/accessibility\`, the MCP tool \`forms_check_accessibility\` or \`usertasks forms check-accessibility <id>\` (pass \`definition\` to check unsaved changes).

## Start forms and task triggers

- **Start form:** in the workflow settings (nothing selected on the canvas), **Design start form** edits the workflow inputs (text, number, checkbox, date, date and time, email, URL, single select and attachments) on a grid with a theme. The Run dialog and the form shown for API and CLI starts follow it. **From a saved form** copies a library form's fields as inputs.
- **Publish as form page:** a start form opens from **Run** and API / CLI starts; it has no page of its own. **Publish as form page** (the workflow page's **Form link** panel, the start form settings, or the trigger node's settings) gives it one: a reusable form named "<workflow> — start form" with the start form's fields, grid and theme, a header with the workflow's name, and a **Submit** button that **starts this workflow** with every field mapped to the matching input (numbers stay numbers, checkboxes booleans), run as the person who submits, then shows "Thanks — your request has been submitted" with the run reference. The workflow itself does not change: Run, API and CLI starts with inputs keep working. The workflow shows **Published as form page: /f/<id>** with Copy, Open and QR code; the form shows **Form page · starts <workflow>** in the Forms library. Publishing and updating need **Edit forms** and **Activate workflows** (the Start workflow action runs for whoever submits); unpublishing needs **Delete forms**.
- **Keeping it in sync:** the page follows the start form of the **published** version (the one runs use). When that start form changes, the panel asks **Start form changed — update form page?** and one click copies it again as a new form version. The update rewrites only what came from the start form (fields, grid, theme, the input mapping); the header, button labels and success screen stay as you edited them. If someone edited those copied parts on the form, it says so and never overwrites them without asking. **Unpublish** deletes the form (its versions and submissions); like any form, it can't be deleted while a workflow step uses it.
- **Export, import and packages:** the page travels with its workflow. Exporting a workflow with its dependencies brings its form page, and the link survives the import: the workflow id is remapped and the page is still linked and in sync.
- **Task triggers:** a task trigger's **Task form** declares the fields the triggering task carries, so they appear in the data picker as \`{{task.data.<key>}}\`.

## Friendly form links

When the workspace has an [address](/docs/governance/workspace-address) (\`acme.usertasks.com\`), every reusable form also opens at a friendly link on it:

\`https://acme.usertasks.com/form/employee-onboarding\`

The last part is the form's **system name**.

- **Where to set it:** Forms library → the form's **Settings** (⚙) → **System name**. It is suggested from the form name when the form is created ("Employee onboarding" → \`employee-onboarding\`, then \`employee-onboarding-2\` if that is taken). Edit it there, or use **Suggest from name**.
- **Rules:** lowercase letters a–z, numbers and hyphens, 3–60 characters, no hyphen at the start or end and no two in a row. Unique in the workspace; two workspaces can use the same name.
- **Renaming:** the old name keeps working. \`/form/<old name>\` redirects to the new one, so shared links, bookmarks and printed QR codes don't break. If another form later takes the old name, the old links open that form instead (the field warns you first).
- **Not a new version:** like the name and tags, changing the system name doesn't create a form version.

**Who can open it.** Exactly the same people as \`/f/<id>\`: signed-in members of the workspace with **Submit forms**. It renders exactly like its \`/f/\` page — the form on its own, no app sidebar or top bar — and URL parameters work the same way (\`/form/employee-onboarding?employee=E1001\`).

- Someone signed out gets the workspace's [form sign-in page](#form-sign-in-page), then goes straight back to the friendly link.
- Someone signed in to another workspace they belong to is switched to this one.
- Someone who isn't a member sees "You don't have access to Acme".
- An unknown address shows "No workspace at this address".

On the main domain (\`usertasks.com/form/<name>\`), the name resolves in your current workspace. A visitor who isn't signed in has no workspace there, so friendly links are meant to be shared with the workspace address.

**Anonymous visitors.** A system name is easy to guess; the \`/p/<token>\` link of an [anonymous form](#anonymous-forms) is not. So a friendly link only opens for visitors who aren't signed in when you choose it per form. In the form's **Anonymous responses**, with anonymous responses on, tick **Allow friendly public link** (off by default). Visitors then get exactly the \`/p/<token>\` page: the same allowlist, rate limits, honeypot, minimum fill time, bot protection and audit.

In every other case a visitor is sent to sign in, whether or not the name exists, so names can't be probed. Turning the option off stops new visits by name. A visitor who already opened the page can see the \`/p/\` link, so to revoke access completely, **Regenerate** the public link.

**Where the friendly link shows.** The Forms menu, Home favourites and search open forms inside the app (\`/fill/<id>\`); the friendly link is the one to share. **Copy link** in the Forms library copies the friendly link. The **QR code** dialog shows it first, with the URL builder for parameters, and lists the \`/f/<id>\` page and the public link under it.

**API, MCP and CLI.** \`system_name\` is a field on \`POST /api/v1/forms\` and \`PATCH /api/v1/forms/{id}\` (409 when taken). Use \`GET /api/v1/forms/system-name-check?system_name=…&form_id=…\` to check a name, and \`GET /api/v1/forms/{id}/links\` for the friendly link, the \`/f/\` page and the public link. The MCP tools are \`forms_create\` / \`forms_update\` (\`system_name\`), \`forms_system_name_check\` and \`forms_links\`. The CLI commands are \`usertasks forms update <id> --system-name …\`, \`usertasks forms check-system-name <name>\` and \`usertasks forms links <id>\`. The anonymous option is \`allow_friendly_link\` in the form's anonymous settings.

## Form pages and QR codes

Every reusable form has a page at \`/f/<id>\`. Wherever its link appears (the workflow page's **Form link** panel, workflow list rows, the **Form submitted** trigger settings, a start form's form page and the Forms library) it is the absolute address on the instance's public app URL (\`APP_URL\`), with **Copy link**, **Open form** and **QR code**. When the workspace has an address, the form's [friendly link](#friendly-form-links) (\`https://acme.usertasks.com/form/<system name>\`) comes first.

**QR code** opens a dialog with the code for the link: dark modules on a white card with a quiet zone in every theme (light, dark or custom), so it scans on screen and in print. **Download PNG** (at least 1024 px) or **Download SVG**, with or without the form's name and the link printed under the code, and **Copy link**. The code is drawn on the server; nothing extra is downloaded to the browser. Set \`APP_URL\` before you print codes: a code made on \`localhost\` only works on that machine.

## Sharing and embedding forms

Form links — \`/f/<id>\`, the [friendly link](#friendly-form-links) \`/form/<system name>\` and the [public link](#anonymous-forms) \`/p/<token>\` — open the form on its own page: no sidebar, top bar or workspace navigation, just the form with its theme (header, colours, page background). Signed-in members get the same bare page. Inside the app, the Forms menu, Home favourites, search and **Open** in the library keep the app around the form (\`/fill/<id>\`).

**Embed a form in a website.** In the form's **QR code** dialog (Forms library or any **Form link** panel), pick the link and open **Embed in a website**:

- **Copy embed code** copies an \`<iframe>\` for the link with \`?embed=1\`: the form alone on a transparent page with no outer padding.
- The optional **resize script** goes once on the host page. The embedded form posts \`{ type: "usertasks:resize", height, path }\` to the page whenever its height changes; the script checks the message comes from the form's own origin and frame and sets the iframe's height, so there is never a scrollbar inside the frame.
- Opened inside any frame, a form link uses the embedded look even without \`?embed=1\`.

**Which links can be embedded.** Only the form link pages may be framed by other sites (\`frame-ancestors *\`, no \`X-Frame-Options\`) — \`/f/\`, \`/form/\`, \`/p/\` and \`/form-login\`. Every other page of the app still refuses to be framed (\`frame-ancestors 'none'\` and \`X-Frame-Options: DENY\`).

- **Public forms** (anonymous links, or a friendly link with **Allow friendly public link**) work anywhere: no sign-in is involved.
- **Forms that need sign-in** can't be filled in inside another website. Browsers don't keep sign-ins for third-party frames, and the app never uses a session inside a frame from another origin: in one, the visitor always counts as signed out, so a website can't trick a member into submitting a form as themselves (clickjacking). The frame shows **Open the form in a new tab** instead; the visitor signs in and fills the form in there. To collect answers right on your page, use a public link.

## Form sign-in page

When a form link needs sign-in and the visitor isn't signed in, they get the workspace's form sign-in page (\`/form-login\`, on the same address as the link) instead of the app's generic sign-in. It offers the same sign-in methods as the app — password and the workspace's single sign-on buttons — and sends the person straight back to the form afterwards. The way back is always a form link on the same address (\`/f/…\` or \`/form/…\`); anything else is ignored.

**Settings → Forms → Form sign-in page** (changing it needs **Edit settings**):

- **Design:** one of ten — UserTasks (the default: the UserTasks sign-in look, a brand panel beside a clean form), Split screen, Minimal, Gradient, Brand rail, Glass, Top banner, Dark elegant, Soft shapes and Compact. Each is responsive and keeps text legible on its colours.
- **Logo:** PNG, SVG, JPEG or WebP up to 2 MB (SVGs are cleaned of scripts). Without one the UserTasks design shows the UserTasks logo and the others the workspace name.
- **Text:** heading (80 characters), welcome message (300), button label (40), footer text (300) and an optional support link (\`https://\` or \`mailto:\`).
- **Look:** by default the page uses the UserTasks colours (warm neutrals, ink buttons, Fraunces headings), like the app's own sign-in page. Turn on **Use the workspace theme** to draw it in the workspace theme instead — its colours, fonts, corners, light / dark mode and background; the design, logo and wording still apply.
- **Accent colour:** buttons and coloured panels, ink until you pick one (not used while the page follows the workspace theme, which brings its own primary colour). Text on it switches between white and dark to stay readable.
- A live **preview** (desktop / mobile) beside the settings, and **Reset to defaults**.

Which workspace's page shows: the workspace of the address (\`acme.usertasks.com\`), or for an \`/f/<id>\` link on the main address, the form's workspace. A \`/form/<name>\` link on the main address names no workspace, so it shows the default page with an **Organisation** field. Embedded in another website, the page uses the Compact design with **Open the form in a new tab**.

**API, MCP and CLI.** \`GET\` / \`PATCH /api/v1/workspace/form-sign-in-page\` (\`design\`, \`logo_url\`, \`heading\`, \`subheading\`, \`button_label\`, \`footer_text\`, \`support_link_label\`, \`support_link_url\`, \`accent_color\`, \`use_workspace_theme\`; \`""\` clears the optional ones), MCP \`form_sign_in_page_get\` / \`form_sign_in_page_update\`, and \`usertasks form-sign-in-page get|update\`. The setting is stored with the workspace's settings; the page only ever shows these fields, the workspace's name and — with the workspace theme on — the theme's design tokens.

## Validation is enforced on the server

Every way of saving or completing a task — the task screen, \`POST /api/v1/tasks/{id}/action\`, \`PATCH /api/v1/tasks/{id}\`, the MCP task tools and the CLI — checks the values against the form: types, required fields (hidden fields are skipped), ranges, lengths, patterns, options, people, lookup values and attachments (only files uploaded into that task, re-read from the server's records). Read-only fields keep their value whatever is sent. Invalid values are refused with one message per field and nothing is recorded. Form pages, the Run dialog, Save & Test and \`POST /api/v1/forms/{id}/submit\` go through the same checks.


## Favourite and Save draft icons

A form has two icons at its top right where people fill it in: on its page (\`/f/<id>\`) and in the **Run** dialog of a workflow that starts from it. They sit on their own row above the header, so they never cover the header image or the title, on any screen size.

- **Favourite** (♡) adds the form to your favourites or removes it. The heart is filled when the form is a favourite. Your favourites appear on [Home](/docs/home#favourite-forms) and in the Forms menu. The icon uses the same rule as the star: you need to be able to open the form (\`forms.submit\`).
- **Save draft** (💾) saves your answers so far and shows **Saved**. When you come back to the form, it asks **Resume your draft from <date>?**:
  - **Resume** fills your saved answers back in.
  - **Start fresh** deletes the draft.

  Your draft is deleted when you submit the form. A submission that fails, for example because a required field is empty, keeps it. Saving again replaces your draft. You get one draft per form, and nobody else can see it.

**Designer:** go to **Buttons & header → Form icons**. **Show favourite button** and **Show save-draft button** are both on by default, for existing forms too. The setting is stored in the form's layout (\`layout.form_actions\`, for example \`{ "draft": false }\`; when absent, both icons are shown). It goes with versions, export, packages and the API.

What a draft keeps:

- The form's own values: fields, lookup choices and optional sections. The URL parameters are stored alongside them. Anything else sent is dropped.
- Attachments are kept as references to your uploads, never as file bytes. A saved draft keeps its files for 30 days. If a file has gone when you come back, the draft is resumed without it.
- A draft can be up to 256 KB.
- Drafts are not saved automatically. Press **Save draft**.

The icons are only shown to signed-in people who can submit forms. On task forms, the **Save** button at the top right of **Task details** already saves the task's draft, so task forms don't get a second save icon. A workflow start form designed in the workflow (not a reusable form) has neither icon.

## Favourites, My submissions and Process view

- **Favourites.** Star a form (☆) in the Forms list or the Forms menu, or use the heart (♡) on its page (\`/f/<id>\`). It appears under **Favourite forms** on [Home](/docs/home). Anyone who can open forms can add favourites.
- **My submissions.** [Home → My submissions](/docs/home#the-list) lists every form you submitted. Each row shows the process it started (a button's **Start workflow** or a **Form submitted** trigger), its status, the current step, who has it and the last update. **View submission** shows the values you sent.
- **Process view.** People who submit a form often can't see workflows. **Process view** shows them the process's diagram with the finished and current steps highlighted, step names, assignees and dates. It never shows step settings, outputs, variables or other people's values. See [Process view](/docs/home#process-view).
- **Following.** Processes your submissions start are followed automatically, so they appear under [Home → Following](/docs/home#the-list). Turn this off with **Auto-follow processes I start**.
## Related

- [Home](/docs/home) — favourite forms, My submissions and Process view
- [Fields and outcomes](/docs/tasks/fields-and-outcomes) — outcomes as buttons and edges, several assignees
- [Custom form controls](/docs/tasks/custom-form-controls) — your own web components as field types
- [Triggers](/docs/workflows/triggers) — Form submitted and task triggers
- [The data picker](/docs/workflows/api-responses#the-data-picker) and [Loops over files](/docs/workflows/api-responses#loops-over-files)
- [Document actions](/docs/workflows/documents) — read, compare, convert and redact the files an Attachments field collects
- [Workspace theme](/docs/governance/workspace-theme) — the full theme forms build on
- [Packages](/docs/packages) — forms travel with the workflows that use them
`,
  },
  CUSTOM_FORM_CONTROLS_PAGE,
  GALLERY_FORM_CONTROLS_PAGE,
  {
    slug: 'tasks/attachments',
    title: 'Attachments',
    description: 'Attach contracts, invoices, receipts, photos and other files to any task, with a name, type and description. Use them in workflows.',
    body: `
Every task has an **Attachments** tab. People who work on the task attach files to it, each with a name, a type and a description. Everyone who can see the task can open them, and workflows can read them once the task is done.

::image task-attachments | A task's Attachments tab with a count of 3: a Contract PDF and an Image added by Ada Lovelace, and an Evidence text file added by a workflow, each with its type badge, description, file name and size, who added it and when; the hovered row shows Preview, Download and Delete | The Attachments tab: name, type, description, file, who added it and when. The last file was filed by the Add Task Attachment step.

## On the task

- **Add attachment** opens a dialog. Drop a file on it, or choose one, then give it a **name** (the file name by default), a **type** and an optional **description**. The upload shows its progress and can be cancelled.
- **Type** is free text with suggestions: *Contract*, *Invoice*, *Receipt*, *Evidence*, *Image* and *Other*, then the types your workspace already uses. A workspace that wants a fixed list just keeps to the same few words. Known types keep their capitalisation (\`invoice\` is stored as *Invoice*).
- The list shows each attachment's name, type, description, file name and size, who added it and when. Images (PNG, JPEG, GIF, WebP) open in a **preview**. **Download** gets the original file, PDFs included.
- The tab's count shows how many files the task holds.

### Who can do what

| Action | Who |
|---|---|
| See and download | The assignee, collaborators, team members of a team task, a manager of an assignee, the person who assigned the task, and anyone with **View all tasks** or **Manage queue** |
| Add | People who can work on the open task: **Complete tasks** plus the assignee, a collaborator, a team member or a manager of an assignee; **Complete any task**; **Manage queue** on a task that isn't a workflow task |
| Delete | The person who added it, or anyone with **Delete tasks** |

People who can see a task but not work on it get a read-only list. Closed tasks take no new attachments from people; a workflow step can still file a document on them. A deleted attachment disappears from the task at once. Its file is purged after 30 days (\`TASK_ATTACHMENT_DELETED_RETENTION_DAYS\`).

### Files and limits

Attachments go through the same checks as form uploads:

- the instance's size cap (\`FORM_ATTACHMENT_MAX_MB\`, 25 MB by default);
- the file's type checked against its content;
- programs and scripts refused;
- SVGs sanitised;
- the virus scanner, when one is configured.

A task holds up to 100 attachments (\`TASK_ATTACHMENT_MAX_PER_TASK\`). Files are private. They are stored in the \`form-files\` bucket of your storage provider (Supabase Storage, S3 / MinIO, Azure Blob, Google Cloud Storage or local disk), and are only served through \`/attachments/<id>\`, which checks the signed-in person on every request and hands out a five-minute signed link. Large files go straight to storage where the provider signs uploads. Otherwise they go through the app.

## In workflows

- **User Task steps** output \`attachments\`: the files attached to the task before it was completed, as a list. Each item has \`{ id, name, type, description, file_name, mime, size, url, storage_ref, uploaded_by, created_at }\`. They are in the data picker under the step.
- **Task-triggered workflows** read the triggering task's files as \`{{task.attachments}}\`.
- **Loop** over either list. \`{{item}}\` is one attachment, typed in the data picker: \`{{item.name}}\`, \`{{item.type}}\`, \`{{item.storage_ref}}\`.
- **File steps** take an attachment as their file: Read Document, Convert, PDF tools, Extract, OCR, Read File, Send Email attachments and HTTP Request uploads. Pass \`{{item}}\`, or one item such as \`{{attachments[0]}}\`. The run reads the file from storage for its own workspace only.
- **Add Task Attachment** files a file the run produced or downloaded on a task:
  - \`file\`: a document step's output, a Download File result, \`{{item}}\`, a \`storage://\` reference, a URL or base64.
  - \`name\`, \`type\` and \`description\`, all with expressions.
  - \`task_id\`: blank means the task that started the run, else the latest User Task's \`{{user_task_id}}\`.

  It outputs \`attachment\`. The file gets the same checks as an upload, shows on the task as added by *Workflow*, and records the run.

\`\`\`json
{ "type": "add_task_attachment", "config": { "task_id": "{{user_task_id}}", "file": "{{doc_file}}", "name": "Signed contract", "type": "Contract", "description": "Generated after approval" } }
\`\`\`

Every add and delete goes on the task's timeline. The event stream carries them as \`task.attachment_added\` and \`task.attachment_deleted\`, so log destinations and webhooks can filter for them.

## API, MCP and CLI

| | REST (\`/api/v1\`) | MCP | CLI |
|---|---|---|---|
| List | \`GET /tasks/{id}/attachments\` | \`tasks_attachments_list\` | \`usertasks tasks attachments <task-id>\` |
| Add (small file, base64) | \`POST /tasks/{id}/attachments\` with \`content_base64\` | \`tasks_attachments_add\` | \`usertasks tasks attach <task-id> <path> --type Contract --name … --description …\` |
| Add (direct upload) | \`POST /tasks/{id}/attachments\` with \`size\`, PUT to the signed URL, then \`POST /tasks/{id}/attachments/{attachmentId}/complete\` | \`tasks_attachments_add_init\`, \`tasks_attachments_complete\` | \`tasks attach\` picks the route for you |
| Download link | \`GET /tasks/{id}/attachments/{attachmentId}/download\` (5 minutes, no session needed) | \`tasks_attachments_download_url\` | \`usertasks tasks attachment-download <task-id> <attachment-id>\` |
| Delete | \`DELETE /tasks/{id}/attachments/{attachmentId}\` | \`tasks_attachments_delete\` | \`usertasks tasks attachment-delete <task-id> <attachment-id>\` |

Adding needs a user-bound credential: a personal API key, OAuth, or a signed-in user. The SDK's \`client.uploadTaskAttachment(taskId, { name, bytes }, { type, description })\` wraps both upload routes.

## Governance

- **Audit log**: every add, delete and download is recorded on the task (\`attachment_add\`, \`attachment_delete\`, \`attachment_download\`). Filter Governance → Audit log by the task.
- **Retention and legal hold** follow the task's reusable form, as they do for form submissions:
  - When the form's retention policy purges submissions, it also purges the attachments of the form's **closed** tasks created before the cut-off. Open tasks keep theirs.
  - While the form is on **legal hold**, its tasks' attachments can't be deleted or purged.
  - Tasks without a reusable form have no retention policy for their attachments.
- **Exports** never carry attachments. Like submissions, they are runtime data (see [What an export covers](/docs/config-as-code/export-coverage)). Download them from the task or through the API instead.
- Direct database access is limited by row-level security with the same rules (\`task_attachments\`, migration \`20261222000000_task_attachments.sql\`).
`,
  },
  {
    slug: 'tasks/assignment-and-slas',
    title: 'Assignment, SLAs and escalation',
    description: 'Assign tasks to people or teams, set due dates, send reminders, escalate overdue work and allow redirects.',
    body: `
## Assignment

- **Individual** — \`assignee_id\`, or \`assignee_variable\` to take the user id from a variable (for example the requester's manager returned by an integration).
- **Team** — \`team_id\`: the task goes to the team's queue.
- **AAD Group** — \`assignment_type: "aad_group"\` with \`aad_group_id\` (the Entra group's object id; \`aad_group_name\` labels it). Offered only when the workspace has an enabled [Entra ID directory connection](/docs/governance/sso#directory-sync); the designer's picker searches the groups directory sync stored, or Microsoft Graph when groups aren't synced. \`aad_group_mode\`:
  - \`claim\` (default, **Anyone in the group can claim it**) — one task, queued for every member with **Claim**; the first to claim it becomes the assignee and it leaves the others' lists.
  - \`everyone\` (**Everyone in the group gets it**) — one collaborative task with every member as an assignee; \`completion_rule\` decides when it is done ([Several assignees](/docs/tasks/fields-and-outcomes#several-assignees)).

  Members are read from Microsoft Graph when the step runs (\`aad_include_nested\`, default true, includes nested groups' members; cached for 5 minutes) and matched to people through directory sync's links, then by email. Members without an active membership in the workspace are skipped and counted in the run log; each person's [queue rules](/docs/tasks#task-queue-rules) (or the step's \`queue_behaviour\`) decide whether the task is queued or added for them. When nobody matches, Entra ID has been disconnected, or Graph can't be reached and the group has no synced team, the task is created unassigned and the run log says why. It uses the directory connection's app registration and the permissions directory sync already needs: \`GroupMember.Read.All\` (or \`Group.Read.All\`) and \`User.Read.All\`, application permissions with admin consent.

## Due dates

\`due_date_mode\` sets an exact \`due_date\` or an offset from creation (\`due_offset_amount\` + \`due_offset_unit\`). Overdue tasks are flagged in lists and reports (\`task.is_overdue\`).

## Reminders

\`reminders\` send notifications before or after the due date. The reminder sweep runs every 5 minutes.

## Escalation

With \`escalation_enabled\`, a task that is still open after \`escalate_after_minutes\` is escalated to a user (\`escalation_user_id\`), a team (\`escalation_team_id\`) or the assignee's manager. Escalations are recorded (\`task.escalated\` events) and visible on the task.

## Redirects

\`allow_redirect\` lets the assignee hand the task to someone else. Options:

- \`redirect_assignment_mode\` \`single\` or \`many\` recipients, with an optional cap (\`redirect_recipient_limit_mode\`, \`redirect_recipient_limit\`);
- \`allow_invite_on_redirect\` invites a person by email if they are not yet a member (with \`redirect_invite_role\`).

## Notifications

Assignment notifications use the workspace default, or an [email template](/docs/email-templates) chosen with \`notification_template_id\`.
`,
  },
  {
    slug: 'tasks/manager-view',
    title: 'Manager view and acting on behalf',
    description: 'Managers see their reports\' open tasks with workload per person, act on a task on the assignee\'s behalf with a note, and reassign work.',
    body: `
## Reporting lines

Each workspace member can have a **manager** in that workspace. Set it on the **Team** page (**Reporting lines**: pick a manager per member; needs **Manage roles**), with \`PUT /api/v1/users/{id}/manager\`, MCP \`users_manager_set\` or \`usertasks users set-manager <id> --set manager_user_id=<manager-id>\` (\`--set manager_user_id:=null\` clears it); \`usertasks users reports me\` lists your reports. A member cannot manage themselves and loops are refused.

Directory sync fills reporting lines from the directory's manager attribute:

| Directory | Attribute |
|---|---|
| Microsoft Entra ID | \`manager\` (Graph \`$expand=manager\`) |
| Okta | \`profile.managerId\` (an Okta id, login or email) |
| Google Workspace | \`relations\` of type \`manager\` (an email) |
| LDAP / Active Directory | \`manager\` (a DN; change it under the attribute mapping) |
| SCIM | enterprise extension \`manager.value\` (the manager's SCIM id) |

A line the directory sets is marked **From directory sync** and replaced on the next sync; a manager the directory names but who is not synced into the workspace leaves the line as it is.

Anyone with at least one direct report is a **manager**. Indirect reports are their reports' reports, up to 10 levels.

The **Organization** page draws reporting lines as an org chart and edits them alongside job titles, departments, org units and projects — see [Organization structure](/docs/governance/organization).

## My team

**Tasks → My team** appears for managers only. It lists the open tasks of your direct reports (tick **Include indirect reports** for every level) with:

- **workload** per person — open, overdue and SLA-breached counts (click a person to filter);
- filters for person, status, priority, workflow, **Overdue** and **SLA breached** (the waiting run's SLA is breached or the task's escalation fired);
- grouping by person, overdue due dates highlighted, sortable columns, **Show completed** (closed tasks are hidden by default) and **Refresh**;
- the task's details when you open a row (progress, effort, subtasks — see [Task lists](/docs/tasks#task-lists-sorting-status-and-details)), the row's **Actions**, and **Process view** for workflow tasks;
- **Act on behalf** and **Reassign** on each open task.

**Group by** offers **Reporting line** (the default), **Person** or **None** (one flat list). Your choice is remembered in this browser.

**Reporting line** shows your organisation as a tree. Your direct reports come first. Each person shows their job title and how many open, overdue and queued tasks they have, both their own and **in team** (everyone below them). Click a person, or press Enter or Space, to open them. You see their own tasks, with the same sorting, Status filter and task details as the list, and below those, their direct reports, one level at a time. A person's tasks load only when you open them.

- **Expand all** and **Collapse all** open or close everyone. The people you opened are remembered, per user, in this browser.
- Search matches people by name or job title, and by the titles of their open tasks. It opens the path to each match and highlights it.
- With **View all tasks** you can start the tree from another person.
- On a phone it is an indented list.

The tree only covers your own reporting line. The same layout, also the default, is on the Task tracker's **Team members** tab as **Group by → Reporting line**.

On a phone, Act on behalf and Reassign are hidden.

The same view is \`GET /api/v1/tasks?scope=reports\` (\`indirect\`, \`assignee_id\`, \`status\`, \`priority\`, \`workflow_id\`, \`overdue\`, \`sla_breached\`), MCP \`tasks_list\` with \`scope: "reports"\` and \`usertasks tasks team\`. It returns \`reports\` (workload per person) and \`tasks\`, and needs a user (a user-bound key or OAuth token) and **View own tasks**.

## Acting on behalf

Open a report's task. A banner says you are acting on behalf of the assignee and asks for a **reason**; the outcome buttons, form buttons and **Save** then act for them. What happens:

- the response counts as the assignee's (completion rules are unchanged);
- the task records \`actioned_by\` = you and \`actioned_on_behalf_of\` = the assignee;
- the history shows *on behalf of …* on the event, the lifecycle event carries \`on_behalf_of\`, \`on_behalf_note\` and \`acted_as\` (\`on_behalf\` or \`break_glass\`) — so do the event stream (\`task.task_response\`) and log export;
- an audit row (\`act_on_behalf\` / \`break_glass\` on the task) is written;
- the assignee gets a notification and an email with your reason;
- the resumed workflow sees \`{{actioned_by}}\`, \`{{actioned_on_behalf_of}}\`, \`{{actioned_on_behalf_of_name}}\` and \`{{on_behalf_note}}\`, and \`{{task.actioned_on_behalf_of}}\` is set on the task.

By API: \`POST /api/v1/tasks/{id}/action\` with \`"on_behalf": true\` and \`"on_behalf_note"\` (MCP \`tasks_complete_workflow\` / \`tasks_respond\` with \`on_behalf\`, CLI \`usertasks tasks complete <id> --on-behalf --note "…"\`). Without \`on_behalf\` a manager gets 403, as does anyone outside the assignee's manager chain.

## Reassigning a report's task

**Reassign** moves a report's open task to another of your reports or to yourself (**Take it myself**), with an optional comment; both people are notified. It needs **Assign tasks**, and a workflow task only moves when its step allows redirects.

## Permissions

| Action | Needs |
|---|---|
| See **My team** | at least one direct report, and **View own tasks** |
| Act on behalf | be in the assignee's manager chain, and **Complete tasks** |
| Act on anyone's task (break-glass) | **Complete any task (break-glass)** — Owner and Admin by default |
| Reassign a report's task | **Assign tasks** |
| Take ownership of an unassigned task, or reassign any task | **Complete any task (break-glass)**, or an Edit grant on the task's workflow, and **Complete tasks** |
| Edit reporting lines | **Manage roles** |
`,
  },
  {
    slug: 'tasks/api',
    title: 'Completing tasks by API, MCP and CLI',
    description: 'List assigned tasks and complete them with an outcome and field values from your own application, an AI client or a script.',
    body: `
Completing a task from outside the app does exactly what the outcome button does: field values are validated and saved, the completion rule is applied, and a waiting workflow resumes on the outcome's path (asynchronously, through the queue).

## REST

\`\`\`bash
# tasks assigned to the calling user (user-context key or OAuth token)
curl -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/tasks/assigned"

# complete one
curl -X POST "$USERTASKS_URL/api/v1/tasks/<task-id>/action" \\
  -H "Authorization: Bearer $USERTASKS_API_KEY" -H "Content-Type: application/json" \\
  -d '{"action":"complete","outcome":"Approved","outcome_notes":"Within budget","values":{"cost_centre":"OPS","amount":12400}}'
# → { "success": true, "data": { "action": "completed", "outcome": "Approved", "workflow_resumed": true, "workflow_status": "queued", "run_id": "…" } }
\`\`\`

\`action\` is one of \`accept\`, \`hold\`, \`reject\`, \`complete\`, \`escalate\` or \`redirect\` (with \`target_user_id(s)\` or \`target_email(s)\`). On a multi-assignee task, \`complete\` may return \`{ "action": "waiting", "responses": 1, "needed": 2 }\` until the completion rule is met.

A workflow task is actioned by its assignee only. A manager adds \`"on_behalf": true, "on_behalf_note": "…"\` (see [Manager view](/docs/tasks/manager-view)). Errors: 403 when you are not the assignee (or not in their manager chain), 404 for a task of another workspace, 409 once the task is closed. A tenant-wide API key has no user, so it needs **Complete any task (break-glass)** to complete a workflow task. Resuming a user task's event directly (\`POST /api/v1/workflows/events/{id}/complete\`) is refused with 409 — complete the task instead.

## Descriptions in API responses

Task responses keep \`description\` as stored (sanitised HTML or plain text) and add \`description_text\` (plain text). If your client cannot render HTML, add \`?strip_html=true\` to \`GET /tasks\`, \`/tasks/assigned\` or \`/tasks/{id}\`, and \`description\` comes back as plain text. MCP \`tasks_get\` takes \`strip_html: true\`. The CLI always asks for plain text; pass \`--html\` to see the stored HTML.

## CLI

\`\`\`bash
usertasks tasks assigned
usertasks tasks complete <task-id> --outcome Approved --notes "Within budget" --set cost_centre=OPS --set amount:=12400
\`\`\`

## MCP

AI clients use \`tasks_list\`, \`tasks_get\`, \`tasks_respond\`, \`tasks_complete_workflow\` (complete with an outcome and field values), \`tasks_redirect\` and \`tasks_escalate\`. The same permissions apply: \`tasks.complete\` to act, and a user-context credential can only act on tasks that user can see.

## SDK

\`\`\`ts
await client.POST('/tasks/{id}/action', {
  path: { id: taskId },
  body: { action: 'complete', outcome: 'Approved', values: { cost_centre: 'OPS' } },
})
\`\`\`
`,
  },
]
