# Release notes: workflow engine fixes

Eight workflow-engine bugs found while building the gallery packages are
fixed. Several of them change what an existing workflow does: a condition
that could never be true can now be true, a default decision rule now
matches, and so on. Each fix below says whether existing workflows can
change. Check your workflows before you upgrade.

## Fixes

- **Condition node operators.** `is_true`, `is_false`, `not_contains` and
  `matches` always read as "no match". They are now evaluated. `is_true` /
  `is_false` treat `true`, `"true"`, `1`, `"1"`, `"yes"` and `"on"` as true,
  and `false`, `"false"`, `0`, `"0"`, `""`, `"no"`, `"off"` and missing
  values as false, the same as form rules. The operator picker offers them.
  *Behaviour change:* a rule using one of these operators, which always
  failed before, can now match. Its branch (or the True port) can start to
  fire.
- **Decision tables: catch-all rules.** A rule with no conditions was
  skipped. It now always matches, which is what the documentation said.
  Blank condition rows with no input chosen are ignored. Rules still run
  top to bottom and the first match wins. *Behaviour change:* tables with
  such a rule now return its outputs where they returned "no match" before.
  A catch-all that isn't the last rule hides the rules after it.
- **`{{= }}` operators.** `==` / `!=` on strings were always true, plain
  arithmetic was not evaluated, and `"false"` counted as true in `IF`.
  These are now fixed:
  - `==` / `!=` compare numbers when both sides are numeric and otherwise
    compare text exactly.
  - `> < >= <=` use numeric or text order, and are false against a missing
    value.
  - `+ - * / %` and parentheses work as a whole expression
    (`{{= price * qty }}`) and in arguments (`ROUND(a / b, 2)`).
  - `+` joins text, and invalid arithmetic gives null.
  - `IF` / `AND` / `OR` / `NOT` treat `"false"`, `"0"`, `""`, `"no"`,
    `"off"`, null and empty lists as false.

  Unknown names and unquoted dates or ids (`2026-01-05`) are still plain
  text. See [Variables and expressions](/docs/workflows/expressions#operators-and-truthiness).
  *Behaviour change:* expressions using these operators, and `IF` on text
  values such as `"false"`, can give different results.
- **Data-table get and run variables.** A get copied every column into a
  top-level variable and could overwrite a workflow input or a run variable
  (`task_id`, `item`, …). Columns are always available as `{{row.<column>}}`
  and `{{<prefix>_<column>}}`. The top-level copy stays for older workflows,
  but it no longer replaces workflow inputs (trigger data and user
  variables), engine-owned variables or the node's own outputs. A warning
  lists any skipped columns. *Behaviour change:* after a get, `{{amount}}`
  keeps the input value when a column is also named `amount`. Use
  `{{row.amount}}` for the row's value.
- **Word / Excel / PowerPoint find & replace.** Each `find` was resolved as
  an expression. A `{{Name}}` placeholder (the documented form) became `""`
  and corrupted the document, and on large documents memory ran away. Now:
  - `find` is literal and only `replace` is resolved.
  - An empty `find` is skipped with a warning.
  - At most 1000 pairs are used.
  - A replacement that would grow a part past 100M characters fails with
    a clear error.

  *Behaviour change:* a `find` that was meant to be an expression is now
  matched as written.
- **Set SLA amounts.** `amount` and `warning_amount` accept expressions
  (`{{sla_days}}`) in the designer, in validation and at run time. A
  resolved value that is not a positive number fails the node with a clear
  message. Before, the run continued silently with no SLA. *Behaviour
  change:* only for amounts that resolve to non-numeric, zero or negative
  values.
- **Reference response samples.** Stored samples keep up to 20 items of
  each list instead of 3, within a 48 KB budget. Only samples captured from
  now on are affected.
- **Object inputs to references.** Objects and lists were sent as
  `"[object Object]"`. In body templates they are now real JSON, including
  a quoted `"{{x}}"`. In query parameters, headers and paths they are sent
  as JSON text. The Call Reference node's custom JSON body inserts object
  variables as JSON too. *Behaviour change:* only for calls that passed
  objects, which were broken before.

## Gallery

The gallery validator now accepts the condition operators above, catch-all
decision rules (it flags one that isn't last) and `{{PLACEHOLDER}}` finds in
document nodes. Existing gallery packages keep their workarounds.
