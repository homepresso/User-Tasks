# Release notes: Process view — who has each step, its history, and open the waiting task

The Process view (the full run page `/automations/runs/{id}` and Home's
progress view `/home/runs/{id}`) now shows, for every User Task step, who
it is with, what happened, and — when the run is waiting on a task — a form
icon that opens the task, for the people allowed to act on it.

## New

- **Who has each step**: avatar(s) and name(s), the team for an unclaimed
  team task, or "Unassigned". Several people collapse to "Priya Nair +2"
  with everyone, and each person's status (Queued, In progress, On hold,
  Done, Declined, Closed), in the tooltip. A badge above each task step on
  the diagram shows the same (or who completed it).
- **Step history** (in **User Tasks** on the run page, **Steps so far** on
  Home, and the step details panel): every response — who, "on behalf of
  X" when a manager / workflow manager / break-glass holder acted, the
  outcome in its colour, when (absolute time on hover), the comment or
  on-behalf reason (truncated, **More** to expand) — plus redirects,
  reassignments, escalations and declines.
- **Open the waiting task**: a form icon next to each waiting step (one per
  open task) and a **Waiting at: {step} · {name}** chip at the top. It opens
  `/tasks/{id}` (`?tab=form` when the task has a form). Tooltip and
  aria-label: "Open task — {title} · assigned to {names}" (plus "you can act
  on behalf of {name}" for managers).
- **Workflow managers act on behalf**: an explicit **Edit** grant on a
  workflow (`object_permissions.can_edit`, to the person, a role they hold
  or a team they are in) now lets the holder open that workflow's tasks and
  act on behalf of the assignee with a reason, like a manager in the
  assignee's reporting line. The task page says "You manage this workflow".
  The response is recorded with `on_behalf_basis: 'workflow_manager'` in
  the task history (lifecycle `task_response` / `task_data_saved` /
  `task_accepted|held|rejected` metadata) and the `act_on_behalf` audit
  entry (`metadata.basis`), and the assignee is notified as before. A
  **View** grant still only shows the runs.

## Who sees what (decided per task on the server)

| Viewer | Form icon | Can act | Outcomes / comments |
|---|---|---|---|
| Assignee, collaborator, claim candidate, member of an unclaimed team task | Yes | Yes (themselves) | Yes |
| Manager of an assignee (direct or indirect) | Yes | On behalf, with a reason | Yes |
| Workflow manager (explicit Edit grant) | Yes | On behalf, with a reason | Yes |
| `tasks.view_all` (admin) | Yes | Only with `tasks.complete_any` (break-glass) | Yes |
| Task assigner | Yes | No | Yes |
| Run initiator only, View-grant holders, other run viewers | No — "Waiting for {name}" | No | No (who + when only) |
| Can't see the run | Nothing (the run read is 404 / null) | – | – |

Names of the people a task is with are shown to everyone who can see the
run, as Home's progress view already did.

## API / MCP

- `GET /api/v1/workflows/runs/{id}` and MCP `workflows_run_get` return
  `tasks`: the run's User Tasks with `assignees`, `history`,
  `completed_by`, and the caller's `can_open`, `can_act`
  (`assignee` / `on_behalf` / `none`), `access`, `on_behalf_of`, `href`.
  `title`, `outcome`, comments and redirect lines are null / omitted where
  `can_open` is false.
- `GET /api/v1/home/runs/{id}/progress` returns the same `tasks`.

## Notes

- No migration. Everything is read with the service-role client, tenant
  filtered, in a fixed number of queries per run (≤ 200 tasks).
- Admins don't get a new override: acting for someone outside your
  reporting line still needs a workflow Edit grant or `tasks.complete_any`.
