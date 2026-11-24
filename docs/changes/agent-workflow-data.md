# Release notes: Run Agent can use the workflow's data as context

A Run Agent step only got the prompt typed into it. An expense-approval
workflow that asked its agent to "review the claim" left the agent guessing
which claim, so it queried the table and reviewed every open claim. The
workflow already knew the claim; now the agent can too.

## New

- **Use this workflow's data as context** on the Run Agent step. When it's
  on, the agent gets a block before the prompt with:
  - the workflow name, run id and step;
  - the trigger type and its data (the submitted form values or the
    data-table row that started the run);
  - the current variables;
  - the outputs of steps that already ran (or their errors);
  - the related task, row, submission and form ids;
  - who started the run.

  The agent is told that this is the process it is working inside and to act
  on that item instead of searching for one.
- **Which data**: *All of the workflow's data* (the default) or *Only the
  fields I pick* (variable names or paths such as `claim_id, form.amount`).
- The run log says `Workflow data passed as context (3.2 KB: trigger data
  (4 fields), 2 variables, 1 earlier step)`. The step's output carries
  `workflow_data` (size and counts), the run timeline shows "With this
  workflow's data as context (3.2 KB)", and the agent run's Conversation tab
  shows the same line. The data itself is not stored with the agent run.

## Defaults

- On for new Run Agent steps added in the designer.
- Off for steps saved before this release, so they keep behaving as they
  did. Tick the box to turn it on.
- Steps created through MCP, the API or config-as-code: set
  `include_workflow_data: true` (plus `workflow_data_scope: "fields"` and
  `workflow_data_fields` to narrow it). Leaving it out means off.

## Safety and size

- Left out: keys starting with `_` (engine state such as `_task_resume`,
  `_resume_*`, `_engine_call`), resume tokens (`event_id`,
  `<step>_event_id`), credential-like keys (password, secret, token,
  api_key, authorization, webhook_url, connection_string …) at any depth,
  and the shared `agent_context` (Share context passes that).
- Redacted: encrypted values, bearer / basic credentials, JWTs and API-key
  patterns inside text.
- Files go as references (name, URL without a signed query, type, size),
  never their bytes. Data URLs and long base64 are left out.
- Long text (2,000 characters), lists (25 items), objects (60 fields) and
  nesting (6 levels) are cut with a `… [truncated …]` marker. The whole block
  is capped at about 20 KB: the largest values are tightened first, then left
  out and named in a `truncated` note.
- No new data access: the block comes from what the run already holds, and
  the agent's tools keep their own grants.

No migration.
