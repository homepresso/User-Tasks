# Release notes: field-change history for data tables

Data tables can now keep a full change history: who changed which field of
which row, when, and the old and new values.

## New

- **Turning it on.** Change history is opt-in per table. Turn it on with
  **Data → a table → Change history → Record every field change of every
  row**, or with `PATCH /api/v1/data-tables/{id}` `{ "audit_changes": true }`.
  Packages and config-as-code carry the setting (`audit_changes: true`).
- **What is recorded.** Every update of a row is recorded, whatever made it:
  the grid, a form, an app, the API or a workflow. Each changed field gets
  one entry with its old and new value, who made the change and when.
  - The person is the signed-in user, or the actor an API or service write
    names.
  - Workflow and schedule writes show as **Automation**.
  - Inserted rows start with an empty history.
- **Where the history shows:**
  - the row drawer in **Data** (**Change history**);
  - app **Record card** widgets with `show_history: true`;
  - `GET /api/v1/data-tables/{id}/rows/{rowId}/changes` (CLI:
    `rows changes`), newest first, `limit` up to 200.
- **Access.** People see the history of the rows they can read (data.view
  and the rows' own access rules). Nobody can edit or delete history
  directly.
- **Retention.** A row's history is deleted with the row, so row and table
  retention policies cover it too.

## Database

Migration `20270128090000_data_table_change_audit.sql` is **not applied
yet**. It adds:

- `custom_tables.audit_changes`;
- the table `custom_table_row_changes`, with RLS through the rows;
- the trigger `trg_custom_rows_audit`.

Until the migration is applied, the history reads are simply empty, and the
switch explains that the migration is pending.
