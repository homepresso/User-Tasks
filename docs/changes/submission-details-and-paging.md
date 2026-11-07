# Release notes: submission details for workflows, full-width step bars, paged workflow lists

Three fixes from user testing.

## Who submitted a form, and when: `{{submission.*}}`

*"On the data of the form, can we also include who submitted, date etc."*

Every run a form starts now gets one reserved object, `submission`, shown as
**Submission details** in the data picker (under **Form submitted › <form>**,
or **Start form › Workflow inputs** for a designed start form):

| Variable | What it holds |
|---|---|
| `submission.id`, `submission.reference` | The submission id and the short reference people see (first 8 characters; empty for a start form, which stores no submission) |
| `submission.submitted_at` | ISO 8601, server time |
| `submission.submitted_by.id` / `.name` / `.email` | Who submitted it |
| `submission.form.id` / `.name` / `.version` | The form and version submitted |
| `submission.source` | `page`, `run_dialog`, `api` (REST, MCP, CLI), `task` or `test` (Save & Test) |
| `submission.button`, `submission.outcome`, `submission.task_id` | The button pressed, an outcome, a task form's task |
| `submission.url_params` | The form's URL query parameters, as declared and checked by the server |

It reaches the **Form submitted** trigger, a button's **Start workflow** (form
pages and published start-form pages included), the Run dialog (its
submissions are now marked `run_dialog`, recorded in the submission's
`result.surface`; the stored `source` stays `standalone`, so no migration),
designer test runs and start-form runs.

- **Server-set.** Built from the signed-in person, the server's clock and the
  stored row. A `submission` value in the form values or start variables (REST,
  MCP, the Run dialog) is dropped and replaced, never merged.
- **One namespace.** It is a single top-level variable, separate from the
  fields (`form.<key>`) and from custom-control extras (`<key>_raw`,
  `<key>_text`, `<key>_parts`…), so it can't collide with them. The engine
  treats it as reserved, so a data-table read never copies a column over it.
  A workflow input named `submission` is replaced by it. The older flat
  variables (`submitted_by_name`, `form_submission_id`, `form_source`…) still
  work.
- **Views.** The form's **Submissions** list shows the reference and where it
  came from (Form page, Run dialog, API / MCP, Task form). The detail view
  adds the email and form version. The CSV export adds `reference`,
  `submitted_by_email`, `submitted_by_id`, `form_version` and
  `submission_source`, and existing columns keep their meaning. Home's **My
  submissions**, `GET /forms/{id}/submissions`, `GET /form-submissions/{id}`,
  `GET /home/submissions` and the MCP `forms_submissions_list` /
  `forms_submission_get` tools return `submission` on each row. In stored
  reads `url_params` is always `{}`, because URL parameters are only stored
  when marked *Include in submission*. Submit responses add
  `submission.reference`.
- **Task forms.** A completed User Task now also resumes with
  `completed_by`, `completed_by_name`, `completed_by_email` and
  `completed_at`, which are listed under the step in the data picker.

## Save & Test, run views and the reports flow: the step bar runs edge to edge

*"Can we make sure the green bar covers from one end to another."*

In the runtime canvas (Save & Test, run detail and compare, the reports flow
view, Home's **View flow**), each step has a 2 px status or heat ring. That
ring sat flush against the card, so the step's coloured header bar looked
inset inside a frame. It didn't look like the designer card. The ring now
sits past a 2 px gap in the canvas colour, so the header bar runs from edge to
edge with rounded top corners, as in the designer. This applies to every step
type, not only triggers. The current-step pulse and the reports view's
suspect outlines moved out with it.

## Paging for the workflows list (and other Automations lists)

*"With the workflow screen, there is no paging of the list or card view."*

- **Workflows** (cards and list) page on the server. Search, status, trigger,
  tag and sort run in the query with an exact count. Cards come 24, 48 or 96
  per page, and the list 25, 50 or 100. There are previous / next buttons,
  page numbers and the total. Filters, sort, page and size live in the URL
  (`q`, `status`, `trigger`, `tag`, `sort`, `dir`, `page`, `size`), so they
  survive refresh and Back. Any filter change goes back to page 1.
- **Forms library** and **Email templates** now page as well (25 / 50 / 100).
  **Rules** were already paged. The data tables list is unchanged.
- The shared pager (`components/ui/list-controls.tsx`) gained optional page
  numbers and per-list page sizes. Existing lists look the same.
