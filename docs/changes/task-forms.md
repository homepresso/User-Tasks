# Release notes: task forms

User Tasks get a form designer, a library of reusable forms and form
themes. Existing workflows don't change: a User Task without a layout
renders exactly as before, and its fields keep their stored shape.

## What's new

- **Form designer.** **Design form** on a User Task (and on task triggers
  and the workflow start form) opens a dialog with a field palette, a grid
  of 1–4 columns per row (drag and drop, or Alt+Arrow keys), a properties
  panel and a live preview in light / dark mode at desktop and phone width.
  Undo and redo, and a warning before closing with unsaved changes. See
  [Task forms](/docs/tasks/forms).
- **More field types.** Long text, currency, email, phone, URL, date and
  time, multi-select, person, section heading and divider join text,
  number, date, checkbox and single select (now also as radio buttons, with
  value / label options or options from a data table column). Fields can
  have help text, read-only values, length / range / pattern / date rules
  and a **Visible when** condition.
- **Typed values downstream.** Every field is `{{task_data.<key>}}` in the
  data picker with its label and type; numbers and currency are numbers,
  checkboxes booleans, dates ISO strings and multi-selects arrays.
  Renaming a key lists the later steps that use it and offers to update
  them.
- **Reusable forms.** **Automations → Forms** lists forms with search,
  tags, duplicate, delete and where each is used. Steps link a form
  (**Use a saved form** / **Save as reusable form**) or detach into a local
  copy. Changes create versions: drafts follow the latest, publishing pins
  the version in use. A form in use can't be deleted.
- **Form themes.** Inherit the workspace theme, or override accent,
  background and text (light and dark), radius, font, density, label
  position and a header. Contrast is checked with an auto-fix, and the form
  always raises illegible colours. Themes can be saved and reused.
- **Everywhere assets go.** REST `/api/v1/forms`, `/api/v1/form-themes`;
  MCP `forms_*`, `form_themes_*`; CLI `usertasks forms …` and
  `usertasks form-themes …`; config-as-code / GitHub sync sections `forms`
  and `form_themes`; packages bring the forms (and saved themes) their
  workflows link.

## Server-side validation

Saving and completing a task checks every value against its form on the
server — the task screen, REST, MCP and the CLI alike: types, required
fields (hidden fields are skipped), ranges, lengths, patterns, options and
that a Person is a member of the workspace. Read-only fields keep their
stored value.

## Permissions and migration

Migration `20261115000000_forms.sql` adds the `forms`, `form_versions` and
`form_themes` tables (members read their workspace's rows; writes go
through the service) and the permissions **View forms**, **Edit forms** and
**Delete forms** — all three for Owner, Admin and Manager, View for Member
and Viewer. OAuth `workflows:read` / `workflows:write` include them.
Apply it before deploying this release.
