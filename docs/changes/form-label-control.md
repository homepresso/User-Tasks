# Release notes: Label fields and expressions in forms

Forms have a new **Label** field (palette group **Display**). It shows a value as text with a caption; people can't edit it. Its value can come from an **expression** that is worked out again as the form changes, from **rules**, or from a **default**. A new rule event, **Label changes**, lets other rules react when the value changes. See [Label and expressions](/docs/tasks/forms#label-and-expressions).

## What's new

- **Label field**: a styled value with a caption, an optional prefix and suffix (`$`, `items`), and the Data table cell formats (number, currency, percent, date, badge, text…). You can also set size, emphasis, alignment, the text to show when there's no value, and visible-when like any field.
- **Expressions** use the workflow expression language, with a `{x}` picker for fields, parameters, variables, controls (including a table's rows and column names) and functions. The designer shows a live preview value and names any problems: unknown field, unknown function, unclosed bracket. A division by zero leaves the label empty with a warning.
- **Row aggregates over a Data table**, through `control.<table>.rows` (the rows on the table with the person's edits), `added_rows`, `changed_rows`, `deleted_rows` and `selected_rows`:
  - `SUM(rows, "amount")`, plus `AVG`, `MIN` and `MAX` on a column;
  - `COUNT(rows)`;
  - `SUMPRODUCT(rows, "qty", "price")`;
  - `SUM(MAP(rows, "qty * price * (1 - discount)"))`;
  - `SUMIF(rows, "status", "open", "amount")` and `COUNTIF`.

  These functions also work in workflow expressions.
- **Include in submission** stores the label's value as `{{form.<key>}}` / `{{task_data.<key>}}`. The server never takes the browser's value:
  - An expression is recomputed from the checked values. Table rows are read from the database: the first page, with the person's changes applied.
  - A value a rule filled in is kept only if a rule of the saved form could have produced it.
- **Label changes** rule event, with `{{event.value}}` and `{{event.previous_value}}`. It fires once the value settles. A chain of label rules stops after 5 rounds, and the designer warns about loops. Other rules read a label as `{{control.<key>.value}}`.
- **Accessibility**: a label that updates is announced politely to screen readers. The checker warns about such a label with no caption.

## API, MCP, CLI

A Label is a field with `"type": "label"` and `label_config` (`expression`, `format`, `prefix`, `suffix`, `align`, `size`, `emphasis`, `empty_text`, `include`, `hide_caption`). Rules use `"event": "label_change"`. Exports, versions, packages, the REST API, the MCP `forms_*` tools and `usertasks forms` carry labels as they are.

## Limits

- An expression is at most 1,000 characters. It can read at most 5,000 rows, and `MAP` nests at most twice. `NOW()`, `RANDOM()` and `GUID()` can't be used in a label.
- A stored total over a table's rows covers the table's first page plus the person's changes. Searching or paging the table changes what the label shows, not what is stored.
- Whole-table aggregates beyond one page (up to 100 rows) aren't supported. Use a workflow step for those.

## Upgrading

Nothing to apply: no migration. Forms without labels are unchanged.
