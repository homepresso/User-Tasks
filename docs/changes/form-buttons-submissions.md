# Release notes: form buttons, headers, form pages and the Form submitted trigger

Reusable forms work on their own now — with a header, configurable
buttons that do things, a page to submit them, a list of submissions and a
trigger that starts workflows. Existing forms and tasks are unchanged:
without a stored button bar a form has Submit and Cancel and a task keeps
its outcome buttons; existing forms have no header.

## What's new

- **Header.** The UserTasks mark, the workspace logo, an uploaded image
  (PNG / JPEG / SVG / WebP, ≤ 1 MB, SVGs sanitised) or none, with a title and
  subtitle that can show form values (`{{task_data.customer}}`), left or
  centred, optionally on the theme's banner colour. New forms start with
  one.
- **Buttons and behaviours.** Rename Submit and Cancel, choose a style,
  hide Cancel, add outcome buttons (Approve / Reject complete the task with
  that outcome), Save draft or more submit buttons. Each button runs a
  chain: show a message, show a success screen, start a workflow (form
  values mapped to its inputs), redirect (app pages or allow-listed
  addresses), close. Placement comes from the form theme.
- **Form pages.** `/f/<form id>` for signed-in members with the new
  **Submit forms** permission (every role). Open form / Copy link in the
  library.
- **Submissions.** Every submission is stored; the library lists them
  (own, or all with Edit forms), shows one and exports CSV in the
  background. Optional `submission_retention_days` per form.
- **Form submitted trigger.** Starts a workflow for every submission of a
  form (its page, the API / MCP, or a linked task form), optionally only for
  some buttons; `{{form.<key>}}` (typed), `{{form.<key>_item}}`,
  `{{submitted_by_name}}`, `{{submitted_at}}`, `{{form_button}}`… in the
  data picker. Submissions are `form.submitted` events in the event stream
  and log export.
- **API.** `POST /api/v1/forms/{id}/submit`, `GET /api/v1/forms/{id}/submissions`,
  `GET /api/v1/form-submissions/{id}`, `POST /api/v1/forms/{id}/lookup`; MCP
  `forms_submit`, `forms_submissions_list`, `forms_submission_get`,
  `forms_lookup`; CLI `usertasks forms submit|submissions|lookup`,
  `usertasks form-submissions get`.

## Security

Submitting needs Submit forms and the values are validated on the server
like a task form's. A button's Start workflow is configured by the form's
author, who needs Activate workflows to add it; it then runs on the server
as a system action attributed to the submitter (and audited), queued.
Redirects only go to app pages or `FORM_REDIRECT_ALLOWLIST` hosts. A
repeated idempotency key (a double-click) is one submission.

## Migration

`20261116000000_form_submissions.sql`: `forms.buttons`, `forms.header`,
`forms.submission_retention_days` (and the version columns), the
`form_submissions` table with RLS, the `form.submitted` event-stream
trigger and the `forms.submit` permission for every system role. Apply it
before deploying.

## Not yet

Anonymous (public) form links are a follow-up.

## Portability

The Form submitted trigger's form and a button's workflow are
dependencies in exports and packages, remapped on install; uploaded header
images travel inside the export. Submissions never travel.
