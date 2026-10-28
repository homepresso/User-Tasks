# Release notes: workflow_started_by names who started the run

`{{workflow_started_by}}` was always the workflow's creator, whoever started
the run. A User Task assigned to `{{workflow_started_by}}` went to the
person who built the workflow instead of the person who pressed **Run**,
submitted the form or called the API. It is now the person who started the
run, and two new variables say how the run started and who owns the
workflow.

## Changed

- **`{{workflow_started_by}}`** is the user id of the person who started the
  run:
  - a form button's **Start workflow** or the **Form submitted** trigger: the
    person who submitted the form;
  - the **Run** dialog, the designer's Run and Test: the signed-in user;
  - REST `POST /api/v1/workflows/start`, the CLI and MCP `workflows_start`:
    the API key's, token's or connection's user (for a workspace key, the
    person who created it);
  - an agent's start-workflow tool: the agent's acting user;
  - task triggers: the task's assigner (created, received), the assignee
    (accepted, rejected) or whoever actioned it last (completed, updated);
  - a data-table row event: the person who wrote the row;
  - **Call Sub Workflow**: the parent run's `workflow_started_by`.

  Schedules, webhooks and the workflow error, SLA and retention triggers
  have no person behind them. Their runs still get the workflow's creator.
- The variable is owned by the engine. Start variables (`variables` on the
  API, MCP or a form button's inputs), a task's submitted values and a
  data-table get can't set it, and neither can `workflow_started_via` or
  `workflow_owner_id`. Queued starts carry the initiator signed with a
  server-only key, so a workspace member who calls `enqueue_workflow`
  directly can't pass a run off as someone else's. Such a run gets the
  creator.

## New

- **`{{workflow_started_via}}`**: how the run started: `ui`, `test`, `api`,
  `cli`, `mcp`, `form`, `agent`, `task`, `data_table`, `subworkflow`,
  `schedule`, `webhook`, `event` or `system`.
- **`{{workflow_owner_id}}`**: the workflow's creator, which is what
  `workflow_started_by` used to hold. Both new variables are in the
  designer's variable picker.

## Behaviour change

A workflow that reads `workflow_started_by` and is started by a person now
sees that person. This covers a User Task assignee, a condition, an email
recipient or `{{=COALESCE(x, workflow_started_by)}}`. Before you upgrade,
find these workflows (draft nodes and published versions). If a step really
meant the creator, change it to `{{workflow_owner_id}}`.

Steps that act with the workflow's own authority keep using the creator:
an AI agent's acting user and the actor recorded by the governance and
retention actions. Runs that were already paused when you upgrade keep
the values they started with.

The community gallery's packages already assign to `{{workflow_started_by}}`
where the requester should get the task back. They now behave as their
descriptions say without any change.
