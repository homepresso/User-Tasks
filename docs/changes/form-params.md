# Release notes: form parameters and variables

Forms can now be opened with **parameters** (`/f/<id>?customer=ALFKI`, or
values a task step or the Run dialog passes) and keep **variables** while
they are open. Both work wherever placeholders do, as `{{param.<name>}}` and
`{{var.<name>}}`. Existing forms are unchanged and nothing is migrated.

## What's new

- **Data tab in the form designer**, next to **Rules**:
  - **Parameters**: name, type (text, number, yes / no, date, list of
    text), default, required, and where the value comes from. It can be a
    URL query parameter (its name defaults to the parameter's) or a value
    the embedding context passes. Optional validation: allowed values, a
    pattern, and minimum / maximum.
  - **Variables**: name, type (the parameter types plus row / object), and
    an initial value: empty, a constant, a parameter, or an expression.
  - **Include in submission** on either stores the value with the
    submission, under its name, for the workflow.
- **Set a variable** rule action (Then → Update values). It can set a
  variable from the event (`{{event.row.OrderID}}`, or the whole row), a
  field, or a formula, and it can also clear the variable or reset it.
  **Call an API reference** can also map a response path into
  `var.<name>`.
- **Placeholders everywhere**: rule conditions and actions, default values,
  Data table base filters and API request mappings, autocomplete filters and
  request mappings, headings, headers and messages. The placeholder menus
  and the rule condition picker list **Parameters** and **Variables**,
  typed. Data tables and autocompletes that read one query again when it
  changes.
- **Embedding contexts**:
  - The form's page reads its URL parameters. Unknown query parameters are
    ignored. A missing required parameter, or a refused value, shows a
    clear message instead of the form.
  - A **User Task** step has **Form parameters**: a value or a workflow
    `{{variable}}` for each, resolved when the task is created and kept on
    the task (`metadata.form_params`). Field defaults can use
    `{{param.x}}`.
  - The **Run dialog** and the **Test runner** show **Form parameters**
    inputs for a workflow that starts from a reusable form.
- **Link builder**: a form's **QR code** dialog has **Link with
  parameters**. Fill in values and the link and its code carry them. The
  server builds the link, so only declared URL parameters go in.
- **Forms menu**: the menu opens forms without parameters. A form with a
  required parameter that has no default is **left out of the menu**, and
  the designer says so.
- **Workflow data picker**: parameters and variables marked "Include in
  submission" appear in the form's outputs (`{{form.<name>}}` from a Form
  submitted trigger, `{{task_data.<name>}}` after a User Task).

## Event and control variables

- **This event** — every rule's placeholder menus and condition picker list exactly what its event carries, typed:
  - `{{event.row_id}}`, `{{event.row}}` and `{{event.row.<column>}}` for row events;
  - `{{event.previous_value}}`;
  - `{{event.label}}` and `{{event.item.<field>}}` for an autocomplete;
  - `{{event.response}}` for a question;
  - `{{event.from}}` / `{{event.to}}` for a step change.
- **Controls** — readable from any rule:
  - Data tables: `{{control.<table>.selected_row_id}}`, `.selected_row.<column>`, `.selected_rows`, `.selected_count`, `.last_clicked_row.<column>`, `.row_count`, `.changes_count`;
  - autocompletes: `.value`, `.label`, `.item.<field>`;
  - the current step: `{{control.form.step_id}}`.
  The server rebuilds control state from declared controls and columns only, bounded. In a query it can only narrow a base filter.
- **Test a rule** takes a sample control state and lists every placeholder's resolved value.

## Security

Parameters and variables are user-controllable input, like field values.
They are not trusted:

- The server resolves them from the request it receives and checks them
  again against the saved declarations. Unknown names are dropped, and
  values are converted to the declared type, validated (allowed values,
  pattern, min / max) and bounded (500 characters, 50 list items, 20 KB per
  object, 64 KB of variables). A task form's parameters come from the task
  (what the workflow passed). The browser's copy is ignored.
- They only fill placeholders in the **saved** form. A Data table's source,
  column projection and base filter come from the form; a parameter is one
  quoted value in its condition, so it can narrow the base filter, never
  remove or widen it. A missing required parameter stops the query.
- API reference calls reach only the declared reference, with the values
  in the inputs the author mapped, never as URLs or headers.
- A submission with a missing required parameter, or a refused value, is
  refused.

## API, MCP and CLI

- The layout carries `params` and `variables` (`layout.params`,
  `layout.variables`) through versions, exports, packages, GitHub sync and
  config-as-code.
- `POST /api/v1/forms/{id}/submit`, `/forms/{id}/lookup` and
  `/forms/{id}/data-table` take `params` and `variables`.
  `/tasks/{id}/data-table` and `/tasks/{id}/lookup` take `variables`; a
  task's parameters come from the task.
- In MCP, `forms_submit`, `forms_lookup` and `forms_data_table` take
  `params` and `variables`.
- In the CLI, use `usertasks forms submit <id> --set params:='{"customer":"ALFKI"}'`.

## Notes

- There is no migration: everything is stored on the form's layout.
- See [Forms → Parameters and variables](/docs/tasks/forms#parameters-and-variables).
