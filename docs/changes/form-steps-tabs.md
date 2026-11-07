# Release notes: form steps and tabs

Forms can be split into **steps** (a wizard with a progress indicator) or
**tabs**, in the form designer and everywhere a form runs.

## Added

- **Layout: Single page / Steps / Tabs** in the form designer. Each step or
  tab has a title, optional description and icon, its own grid, and an
  optional **Visible when** rule; every field is on exactly one page. Add,
  rename, reorder (drag or Alt+Arrow keys), duplicate (with copies of the
  fields) and delete (moving the fields to another page, or deleting them);
  drop a field on a page's chip to move it there. Undo / redo cover page
  changes. See [Task forms → Steps and tabs](/docs/tasks/forms#steps-and-tabs).
- **Steps:** a numbered stepper (stacked on phones), a progress bar
  ("Step 2 of 4", %) or dots; editable Back / Next labels; Next checks the
  step's fields; optional skipping ahead; an optional **review step** with
  the answers and **Edit** links. The form's buttons show on the last step;
  **Save draft** on every step (a task reopens on the step it was saved on).
- **Tabs:** a keyboard tab bar (arrows, Home, End; scrolls on phones;
  icons), the buttons under every tab, a red count on tabs with problems
  after a submit, and a jump to the first one.
- **Conditional steps and tabs:** a hidden step doesn't count in the
  progress, and its fields are neither required nor checked — in the
  browser and on the server.
- **Resume later** (reusable forms' pages, `/f/<id>`): unsent answers and
  the step stay in the browser until the form is submitted or discarded.
- Runs in task forms, form pages, form-started workflows (Run dialog,
  **Save & Test**), start forms, **Publish as form page** and linked
  reusable forms; read-only views stack the pages under their titles. The
  mini theme's accent styles the stepper and tabs (kept legible).

## Compatibility

- Pages are layout only: values, `{{task_data.<key>}}`, `{{form.<key>}}` and
  start-form variables are unchanged.
- The layout gains optional `mode` (`steps` / `tabs`), `pages` and
  `page_settings`; forms without them render as before, and versions,
  exports and packages carry them. A reader that only knows `rows` shows a
  paged form's fields one per row. No database migration.
