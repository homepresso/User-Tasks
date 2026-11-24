# Release notes: typed test inputs in Extensibility

Release note line: **Extensibility's Test tab now generates a typed input
form for each function (no more hand-written JSON), and form controls get a
Try it preview driven by a typed properties form.**

## What's new

- **Workflow actions → Manage → Test**: the "Inputs (JSON)" box is replaced
  by a form generated from the chosen function's declared inputs. Each type
  gets the right control: number boxes, switches, date and date-and-time
  pickers, dropdowns, multi-line boxes (also for lists, one item per line),
  nested fields for objects with declared fields, repeatable groups for lists
  of such objects, key / value rows for free objects, and a JSON box only for
  `json` and other complex values. Labels, help, required markers and
  defaults come from the manifest; the sample is pre-filled; inline
  validation uses the same rules a run applies. For script activities
  (which receive their inputs as they are) problems are shown but don't
  block the run, and their saved demo inputs are the starting values.
- **Edit as JSON** shows the same inputs as JSON, kept in sync both ways
  (invalid JSON shows an error and the form keeps its values). **Reset to
  defaults** goes back to the sample. The last inputs per function are
  remembered in the browser.
- **Results** show the outputs as a typed table (name, declared type, value;
  long values fold), plus the raw JSON, duration, host calls, memory,
  warnings and logs. An input the run refused is highlighted on the form.
- **Keyboard**: Enter runs the test (Cmd / Ctrl + Enter in a multi-line
  box).
- **Switching functions** regenerates the form; a function without inputs
  says *This function takes no inputs*.
- **Form controls → Try it**: the real control (sandboxed frame) beside a
  form generated from its `props` (min / max, choices, colours, lists, JSON),
  with Required / Read-only switches and the value the form would receive.

## Secrets

Inputs named like a credential (older activities only; current manifests
use `capabilities.credentials`) get a masked box. Their values are never
stored in the browser, never shown in the JSON view, and are blanked out of
outputs, logs and errors in the result.

## Not changed

No API, MCP, CLI or database change. `POST /api/v1/workflow-activities/{id}/test`
takes the same `operation` / `inputs`. `file` inputs still take a URL or a
storage reference (Test cannot upload a sample file).
