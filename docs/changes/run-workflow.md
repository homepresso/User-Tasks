# Release notes: run a workflow by hand with its inputs

Workflows can now be started from the workflow list and the designer, with a
form for their input parameters. Before this release a manual start needed
the API, MCP or the generated `workflows start` command, and the variables
were passed as free-form JSON without any checks.

## New

- **Run button.** Each row of **Automations → Workflows** (list and card
  view) and the designer header have **Run**. It is shown to people with
  **Activate workflows** (`workflows.activate`) and disabled, with the reason
  as tooltip, until the workflow is published and active.
- **Run dialog.** A form generated from the published version's workflow
  variables: text, number, checkbox, date, date & time, email, URL, choice
  list and JSON fields, with defaults filled in, descriptions as help text
  and required inputs marked and checked. **Run in background** (default,
  with a queue priority) or **Wait for result** (shows the final status and
  step outputs). The result links to the run (or the queue while the job
  waits).
- **Input settings in the designer.** A workflow variable can be marked
  **Required input**, and a string variable refined to date, date & time,
  email, URL or a choice list (`required`, `format`, `options` in
  `user_variables`).
- **REST:** `GET /api/v1/workflows/{id}/inputs` returns the input fields
  (`key`, `label`, `type`, `required`, `default`, `description`, `options`)
  of the published version, or of the draft when never published.
- **MCP:** `workflows_inputs_get`.
- **CLI:** `usertasks workflows inputs <id>` and
  `usertasks workflows run <id> [--input key=value …] [-f inputs.json] [--wait] [--priority <n>]`,
  which converts values to the input types and asks for missing required
  inputs on a terminal. Without a terminal it lists them and exits 2.

## Changed

- `POST /api/v1/workflows/start`, MCP `workflows_start` and the generated
  `workflows start` validate `variables` against the declared inputs: a
  missing required input or a value of the wrong type is a `400`
  (`validation_error`) with one `details` entry per field, and nothing
  starts. Values are converted to the input type (`"42"` → `42` for a number
  input, `"true"` → `true` for a boolean, a JSON string → the object for an
  object input). Variables that are not declared inputs still pass through
  unchanged and are listed in the new `warnings` field. Workflows without
  declared inputs behave as before.
- The start response also carries `workflow_id` and `published_version_id`;
  async starts still answer `202` with `job_id`.

## Upgrade

No migration. Existing workflow variables have no `required` flag, so
existing callers are only affected if they pass a value that cannot be
converted to the variable's declared type (for example `"abc"` for a number
variable).
