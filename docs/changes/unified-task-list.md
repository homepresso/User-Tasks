# Release notes: One task list, with queued tasks and queue rules

**My tasks** is now the only task list. The separate **Task queue** page,
its side-menu item and Home's **Task queue** tab are gone: tasks waiting
for your response are in **My tasks** with the status **Queued**. Each
person sets **task queue rules** that decide which new tasks are queued
and which are added straight to their list. Nothing is migrated (no
database change): the rules are stored in your preferences.

## What's new

- **Queued tasks in My tasks** (`/tasks` and the Home **My tasks** tab):
  - tasks sent to you for acceptance, collaborative invitations and
    unclaimed tasks of your teams show the status **Queued**;
  - queued rows have **Accept** and **Decline** (Decline asks for a short
    reason), or **Claim** for a team task;
  - **Hold**, **Redirect**, **Escalate** and completing with an outcome are
    on the task page;
  - the **Status** filter has **Queued**, to see only those.
- **One count.** The side menu's **My tasks** badge includes queued tasks
  (it adds what the **Task queue** badge used to show).
- **Task queue rules** (**Settings → Preferences**): a default
  (**Queue new tasks for me to accept** or **Add straight to my tasks**)
  and an ordered list of rules on priority, source (workflow or by hand),
  a specific workflow and who assigned the task, each saying **Queue** or
  **Add**. The first matching rule wins. Stored in
  `users.preferences.queue_rules`. See
  [Task queue rules](/docs/tasks#task-queue-rules).
- **User Task node: Queue behaviour.** *Follow the assignee's queue rules*
  (default), *Always queue* or *Always add* (`queue_behaviour`: `rules`,
  `queue`, `add`).
- **Trigger wording.** **Task Received** now reads "When a task is assigned
  (queued or added)", and **Task Rejected** "When an assignee declines a
  queued task". They fire as before.

## Behaviour kept

- Without saved rules, your earlier **queue bypass priority**
  (`queue_bypass_priority`, default High) still decides: tasks at or above
  it are added, the rest queued. Existing workflows behave the same: a
  User Task follows the assignee's rules unless its Queue behaviour says
  otherwise.
- Old links to `/tasks/queue` open `/tasks?status=queued`. A Home tab saved
  as **Task queue** opens **My tasks**.
- The API, MCP and CLI are unchanged: `GET /api/v1/home/queue`
  (`home_queue`, `usertasks home queue`) still lists only the queued tasks,
  and `GET /api/v1/home/tasks` the accepted ones.

## Changed

- A task created by hand is now queued or added by **each assignee's own
  rules**. Before, the creator's queue bypass priority decided for every
  assignee.
- Redirects, escalations and reassignments now follow the new assignee's
  rules too. Before, they were always queued.
