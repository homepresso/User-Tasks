# Table

`<ut-table>` — an editable table with typed columns, per-cell validation, an optional totals row
and spreadsheet-style keyboard editing (an ARIA grid). For line items, attendees, readings,
expenses: anything that repeats.

## Value

An array of row objects keyed by column key, or empty (`null`) until the person edits the table.
Every row carries every column key:

| Column type | Stored as | Blank |
|---|---|---|
| `text` | string | `null` |
| `number`, `currency` | number (`1250.5`) — text that isn't a number is kept as typed and reported invalid | `null` |
| `date` | `"YYYY-MM-DD"` | `null` |
| `select` | the option text | `null` |
| `checkbox` | `true` / `false` | `false` |

```json
[{ "item": "Laptop", "quantity": 2, "unit_price": 1499 }]
```

The server checks the value is an array of objects with at most 200 rows. The control checks
each cell (required, number bounds, date format, select options) and the row count, marks bad
cells (`aria-invalid`, with the message under the value) and reports the first problem to the
form: "Row 2: Quantity must be at least 1 (and 2 more problems)". Cell errors show on rows
that have content, and on every row once the form marks the field invalid.
Read-only views (completed tasks, mobile, emails) show the value as JSON; the control itself,
when read-only, renders a plain table with formatted values and the totals.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Columns (`columns`) | JSON list | Item (text, required), Quantity (number, min 1), Unit price (currency, min 0) | `{ "key", "label", "type", "required", "options", "min", "max", "width" }`; up to 20 |
| Minimum rows (`min_rows`) | number 0–200 | 0 | Blank rows shown at the start; rows can't be deleted below it |
| Maximum rows (`max_rows`) | number 1–200 | 50 | |
| Allow adding rows (`allow_add`) | yes / no | yes | |
| Allow deleting rows (`allow_delete`) | yes / no | yes | |
| Show totals (`show_totals`) | yes / no | no | Footer row summing number and currency columns |
| Currency (`currency`) | text | USD | ISO 4217 code for currency columns |
| Starting rows (`default_rows`) | JSON list | — | Shown while the value is empty; stored only once the person edits |

## Keyboard and screen readers

The table is an ARIA grid named by the field label, with one Tab stop (roving focus):

- Arrow keys move between cells; Home / End go to the start / end of the row, Ctrl+Home /
  Ctrl+End to the first / last cell; Page Up / Page Down move five rows.
- Enter, F2, Space or simply typing starts editing a cell (typing replaces its content). In the
  editor, Enter saves and moves down (Shift+Enter up), Tab / Shift+Tab save and move to the
  next / previous cell, Escape cancels. Dates use the browser's date input, choices a native select.
- Delete or Backspace clears a cell; Space or Enter toggles a tick box.
- Tab / Shift+Tab move cell by cell and leave the table after the last / before the first cell.
- Ctrl+Enter adds a row (or use the Add row button). The last cell of each row is a "Delete row 2"
  button. Adding and deleting rows is announced politely.

Column headers and row numbers are real header cells, so every cell is announced with its column
and row; editors are labelled "Quantity, row 2". Errors are linked with `aria-describedby`.
On narrow screens the table scrolls sideways inside its own frame (the page doesn't).

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
