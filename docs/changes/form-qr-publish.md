# Release notes: QR codes for form pages and "Publish as form page"

Form page links now come with a QR code, and a workflow that starts from a
start form (its inputs) can get a shareable form page without changing how
it starts.

## Added

- **QR codes** wherever a form page link appears: the workflow page's
  **Form link** panel, workflow list rows, the **Form submitted** trigger
  settings and the Forms library. The dialog shows the code (dark modules
  on a white card in every theme), with **Download PNG** and **Download
  SVG**, optionally captioned with the form's name and the link, and
  **Copy link**. The SVG is drawn on the server (`qrcode` 1.5.4, MIT); the
  PNG is rasterised from it in the browser.
- **Absolute links:** form links and QR codes use the instance's public app
  URL (`APP_URL`), falling back to the browser's address when it is not set.
- **Publish as form page** for start forms (the workflow page's **Form
  link** panel, the start form settings and trigger node settings). It
  creates a reusable form "<workflow> — start form" with the start form's
  fields, grid and theme, a header, and a **Submit** button that starts the
  workflow with every field mapped to the matching input (typed), as the
  submitter, then shows "Thanks — your request has been submitted" with the
  run reference. The workflow is unchanged: Run, API and CLI starts with
  inputs keep working.
  - The workflow shows **Published as form page: /f/<id>** (Copy / Open /
    QR); the Forms library shows **Form page · starts <workflow>**.
  - **Sync:** when the published version's start form changes, **Start form
    changed — update form page?** copies it again as a new form version.
    Only the copied parts (fields, grid, theme, input mapping) are rewritten;
    header, labels and the success screen are kept. Edits to the copied
    parts on the form are detected and never overwritten without a
    confirmation.
  - **Unpublish** deletes the form (with its versions and submissions);
    refused while a workflow step uses it.
  - Permissions: **Edit forms** and **Activate workflows** to publish and
    update, **Delete forms** to unpublish.
  - Export / import / packages: a workflow exported with its dependencies
    brings its form page; the link is kept (the workflow id is remapped).

## Changed

- `GET /api/v1/forms` (and `forms_list`) summaries carry `form_page_of`
  (`{ workflow_id, workflow_name }` or null).
- A form button's `start_workflow` action may carry `start_form_page: { key }`
  (the link and the fingerprint of what was copied). **Duplicate** drops it:
  a copy is an ordinary form.

No database migration.
