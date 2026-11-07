# Release notes: Data table fields and "for each changed row" rules

Forms get a built-in **Data table** field, plus rules that write a table's
changes back to a data table, an API or a workflow. Existing forms are
unchanged: nothing new appears until you add the field.

## What's new

- **Data table** field type (palette → Data). Rows come from a workspace
  **data table** or an **API reference / connector operation**. Three modes:
  **Read-only**, **Select rows** (one or several; the value is the selected
  rows) and **Editable** (inline cell editing, add and delete rows; the value
  is the change set `{ added, updated: [{ key, before, after, changed_fields }], deleted }`).
- **The author sets up the query** in the designer: a searchable column
  picker (order, labels, types, hidden columns, which columns people may sort
  and filter on), the row key, a visual **base filter** with AND / OR groups
  (values: constants, `{{form.x}}`, `{{user.id|email|name}}`, `{{today-30d}}`
  and other date expressions, workflow variables), a multi-column default
  sort, the page size, and a **live preview** that runs the real query on the
  server and shows the first page and the row count.
- **Search, filters, sort and paging run on the server.** The person's
  conditions are ANDed onto the base filter, so they can only narrow it; only
  the selected columns ever reach the browser. API sources map the table's
  state to request parameters (`{{search}}`, `{{page}}`, `{{page_size}}`,
  `{{offset}}`, `{{sort}}`, `{{sort_dir}}`, `{{filter.<column>}}`); what an
  API doesn't do, the server applies to the rows it returned (at most 1,000),
  and the designer and the table say so.
- **Display formats per column** (a shared formatter,
  `lib/formatting/cell-format.ts`): text (max length, wrap), number / whole
  number (decimals, thousands, negative style), percent (0–100 or 0–1),
  currency (code, symbol or code, decimals), date / date & time / time
  (presets, custom patterns, time zone), relative time, yes / no labels,
  status badges with theme-safe colours, safe links (http(s), mailto, tel),
  image thumbnails from allowed hosts, file sizes and JSON. Display only —
  values, sorting, filtering and workflow data keep the raw value. The
  viewer's locale, or a fixed one per field.
- **For each changed row** — a step of a submitting button, and **Apply
  table changes** on an in-form Button: loop over the added / changed /
  deleted rows (optionally filtered) and insert, update, upsert or delete in a
  data table (column mapping, match on a key), call an API reference per row
  (each row's status and response kept), or start a workflow per row or once
  with all changes. Deletes → updates → inserts by default; stop or continue
  on errors; a dry run in the designer; a summary ("3 rows updated, 1 failed")
  shown on the form and available as `{{table_changes_summary}}`.
- **Values everywhere.** The field's value is typed in the workflow data
  picker, usable in Visible when rules (`has a value` = rows selected /
  changes made), shown in read-only task views and submissions with the same
  formats, and carried by exports, packages, the API, MCP and the CLI.

## Security

- The source, columns, base filter and rules come only from the saved form
  definition; the browser sends the field key, its own query and the change
  set. A request for a field that isn't a Data table on that form is refused.
- Data table reads need **View data** and run with the reader's own access
  (RLS for a session; an API key's table allowlist), unless the author turns
  on **People without data access can see these rows**.
- Change sets are validated against the declared columns and key; `before`
  is re-read from the table on the server (never trusted from the browser)
  and rows outside the base filter or the person's access are refused.
- Table writes run as the submitter (**Manage rows**, their data access);
  API calls and workflows were authorised by the form's author
  (**Test integrations** / **Activate workflows** when added) and run on the
  server without exposing credentials. Runs are idempotent per submission /
  click, capped at 200 rows, audited and logged with per-row results.

## API, MCP and CLI

- `POST /api/v1/forms/{id}/data-table` and `POST /api/v1/tasks/{id}/data-table`
  (MCP `forms_data_table` / `tasks_data_table`, CLI `forms data-table` /
  `tasks data-table`) return a page of rows.
- `POST /api/v1/forms/{id}/submit` returns `table_changes` (the rules' results).

## Notes

- Migration `20261205000000_form_table_change_runs` adds the run log and
  idempotency table (`form_table_change_runs`). Apply it before using
  "for each changed row" rules.
- The field and its rules are stored on the form (`field.data_table`,
  `apply_table_changes` actions), so versions, exports and packages carry
  them; table, reference, integration and workflow ids are remapped on install.
- See [Forms → Data table fields](/docs/tasks/forms#data-table-fields) and
  [For each changed row](/docs/tasks/forms#for-each-changed-row).
