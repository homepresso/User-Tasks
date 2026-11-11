# Kitchen sink — platform self-test

`kitchen-sink.bundle.json` installs a workflow that runs every built-in step type that does not need an outside service (about 80 checks), compares each result with the expected value and reports:

- run title **Kitchen sink: 78/78 passed** when everything works;
- otherwise the run **fails** with `Kitchen sink failed: N of 78 checks failed (…)`, and the `failures` variable lists each failed check with its expected and actual value.

Full guide: **Docs → Workflows → Platform self-test** (`/docs/workflows/self-test`).

## What the bundle contains

One config manifest (`format_version: 3`):

| Section | Asset |
|---|---|
| `workflows` | **Kitchen sink — platform self-test** and **Kitchen sink — sub-workflow** (both active) |
| `data_tables` | **Kitchen sink scratch rows** (written and cleaned up on every run) |
| `decision_tables` | **Kitchen sink pricing rules** |
| `forms` | **Kitchen sink human check** (the User Task form) |
| `roles` | **Kitchen sink test role** (`reports.view` only; granted and removed during the run) |
| `workflow_activities` | **Kitchen sink: double** (a custom action) |

Every asset has a fixed UUID, so the workflow's references survive the import (they are remapped to the new local ids). Importing again updates the same assets instead of creating copies.

## Install

Pick one:

1. **Settings → General → Platform self-test → Install self-test** (admins). Imports the bundle, publishes both workflows and opens the kitchen sink.
2. **Workflows → Import** → choose `kitchen-sink.bundle.json` → review the plan → **Apply**. Then open the workflow and **Publish** it (Run uses the published version).
3. API: `POST /api/v1/config/apply` with `{ "manifest": <the file> }`, MCP `config_apply`, or
   ```bash
   usertasks config apply examples/kitchen-sink/kitchen-sink.bundle.json
   ```
   then publish both workflows (`POST /api/v1/workflows/{id}/publish`, or **Publish** in the designer) — the sub-workflow first.

You need the permissions to create workflows, data tables, decision tables, forms, roles and workflow actions (an admin has them).

## Run

**Run** the workflow. After about 10 seconds a task **Kitchen sink self-test: please confirm** is waiting in your tasks: accept it if it is queued and click **Confirm**. The run then finishes.

Inputs: `include_human_step` (default `true`; turn off for unattended or scheduled runs), `send_test_email` (default `false`) and `test_email_to`.

## Keeping it up to date

The bundle and `test-workflows/17-kitchen-sink.json` are generated from `lib/kitchen-sink/build.ts`:

```bash
npm run kitchen-sink:build
```

`__tests__/test-workflows-run.test.ts` runs the workflow end to end on every CI run, and `__tests__/kitchen-sink.test.ts` fails when a new step type is neither covered nor listed in `KITCHEN_SINK_EXCLUDED`.
