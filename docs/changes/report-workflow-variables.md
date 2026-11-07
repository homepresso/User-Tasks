# Release notes: workflow variables in reports

Reports on workflow runs showed only the run's own fields (status, times,
title, error). A workflow's variables — its inputs, the values people
entered in its task forms, the form that started it and what its steps set
— never appeared, because a finished run didn't keep them: the engine only
held them while a run was paused (`pause_variables`, cleared on resume), and
the **Workflow runs** source had a fixed column list.

## New

- **Pick a workflow** on the **Workflow runs** source in the report builder.
  Its variables become typed columns you can show, filter, sort, group by,
  aggregate (sum / average / min / max on numbers), chart and export:
  - `vars.<name>` — workflow inputs (start form fields / user variables),
    Set Variable and other scalar step outputs (`outcome`, `score`,
    `<step>_status`),
  - `vars.task_data.<key>` — User Task form fields (attachments as
    `<key>_count`, a lookup's selected item as `<key>_item.<field>`),
  - `vars.form.<key>` — the fields of the form that started the run
    (**Form submitted**), plus `submitted_by_email`, `submitted_at`,
    `form_outcome`.

  Types come from the workflow's definition (draft and recent published
  versions) and from values stored on recent runs. The column pickers group
  variables by where they come from.
- **Tasks** with a workflow picked: the tasks that workflow created, with
  their form fields as `fields.<key>` columns.
- **Stored run variables**: when a run completes, fails or pauses, the
  engine stores a bounded, redacted copy of its variables on the run
  (`workflow_runs.variables`). Left out: engine keys (ids, initiator,
  trigger type, internal keys, steps' resume tokens `<step>_event_id`), credential-like names (`password`,
  `*_token`, `api_key`, `secret`, …) and secret-looking values (encrypted
  values, bearer tokens, JWTs), file contents and file lists (counts are
  kept), data URLs and long base64, nesting deeper than three levels. Text
  is cut at 500 characters, lists at 25 values, and a run keeps at most
  about 32 KB (inputs and form values first).
- **API, CLI, MCP, OData**: `GET /api/v1/reports/sources?workflow_id=<id>`
  (`usertasks reports sources --workflow-id <id>`) and MCP
  `reports_source_get` / `reports_query` with `workflow_id`; report configs
  carry the workflow in `source_inputs.workflow_id`; OData
  `SavedReportResults` returns the variable values of saved reports.
- The workflow **process overview** shows the first three inputs on each
  instance and links to a report on them (`/reports/builder?source=workflow_runs&workflow_id=<id>`).

## Changed

- Variable columns need **View workflows** (`workflows.view`) as well as
  `reports.view`. Report previews from the app now check the signed-in
  person's permissions too (so `agent_runs` also needs `agents.view` there,
  as it already did through the API).
- Report rows of **Workflow runs** no longer include the paused run's
  working state (`pause_variables`) when no columns are picked.
- Report filters on joined or variable columns now narrow the rows
  **before** grouping (they used to be applied to the grouped rows, where
  the field did not exist), and number / yes-no filters on variables compare
  as numbers / booleans.
- Grouped report tables and chart legends label aggregates from the
  column ("Sum of Approved amount") instead of the raw key
  (`SUM_vars.task_data.approved_amount`).
- **Workflow runs** gains `workflow_id` and `task_id` columns; **Tasks**
  gains `workflow_id`.

## Upgrading

Apply `supabase/migrations/20261129000000_workflow_run_variables.sql` (adds
the nullable `workflow_runs.variables` column; safe before or after the
code — the engine skips the write until the column exists). Nothing is
backfilled: runs that finished before the code is deployed have no stored
variables and show blanks in variable columns. Runs paused at deploy time
get their variables when they next pause, complete or fail.
