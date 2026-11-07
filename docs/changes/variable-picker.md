# Release notes: a variable picker for the form designer

Adding a Data table's selected row id to a message was hard: the placeholder
menu listed about 80 workflow-only variables (task, API, status values…)
before the form's own, the row id came 83rd in a short scrolling list, the
menu opened only on an empty box or after typing `{{`, search needed the
exact spelling, and a Button's steps didn't offer the table's selection at
all. The form designer now has one variable picker everywhere a text box
takes placeholders. Stored forms are unchanged: a variable is still saved as
`{{path}}`, and nothing is migrated (no database change).

## What's new

- **Insert variable button.** Every placeholder box in the form designer has
  a `{x}` button beside it. Typing `{{` or `{` anywhere in the text opens the
  same picker at the cursor.
- **Designer words.** Entries read like *Selected row › ID*,
  *Selected row › Customer name* and *Orders › Selected row › Total*, using
  the table's column labels. The placeholder is shown underneath, with a
  type badge (text, number, date, row, list) and a sample value from the
  designer's live preview.
- **Groups for the place you're in:**
  - **This event** follows the rule's **When** and its table: a **Row
    selected** rule starts with *Selected row › ID*.
  - **Controls**, **Fields on this form**, **Parameters**, **Variables**,
    **Sections**, **Current user**, **Dates** and **Flags** appear where
    they are filled in. For example, Dates and Flags appear in a rule's
    conditions, Data table filters and table changes.
  - The workflow-only lists no longer appear in the form designer.
- **Search** matches names and placeholders, and forgives spacing:
  *row id*, *rowid* and *order id* all find the row id. Recently used
  variables come first.
- **Rows fold their columns.** Choosing *Selected row* opens its columns;
  *Insert the whole row* is still there.
- **Keyboard and screen readers.** Use ↑ / ↓, Enter or Tab, → for a row's
  columns, and Esc. The box is an ARIA combobox with a listbox and
  `aria-activedescendant`.
- **Chips.** An inserted variable reads as its name (*Selected row › ID*).
  Backspace deletes the whole chip. Hovering shows the placeholder and its
  sample value; with **Test a rule** open, it shows the value the test
  resolves.
- **Wrong-place warnings.** A variable that would come out empty where it's
  used is underlined, with the reason and a fix under the box. For example,
  `{{event.row_id}}` in a **Form loads** rule or a Button's step suggests
  `{{control.orders.selected_row_id}}`. Unknown columns, controls, fields,
  parameters and flags are flagged too.
- **Button steps** list the Controls and explain that event values aren't
  available there.
- **More boxes take variables:** a message's and a question's title, and a
  heading's text and description (they were already filled in at run time).

## Fixed

- **Esc in a placeholder box** closed the picker and also asked to discard
  the whole form design. Now it closes only the picker.

## Workflow designer

Email templates and other workflow placeholder boxes get the same `{x}`
button, search, keyboard and grouped list, with their existing groups.
