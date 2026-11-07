# Saved report

`<ut-saved-report>` — shows a saved report from Reports inside a form, as a sortable, paginated
table or as the report's chart. The report runs with the permissions of the person filling in the
form: they see only their own or shared reports, with their row-level rules.

## Value

Empty (`null`) unless **Selectable rows** is on; then picking a row makes that row the value, an
object of the report's columns:

```json
{ "invoice": "INV-1042", "customer": "Kiwi Foods", "status": "Paid", "amount": 1088.5, "due": "2026-11-03" }
```

Picking the same row again clears it. The server checks the value is an object. Read-only views
show the row as JSON.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Saved report (`report_id`) | text, required | — | The report's id (from the address bar in Reports) |
| View (`view`) | Automatic / Table / Chart | Automatic | Automatic = the report's chart (bar, line, area, pie, horizontal or stacked bar), else a table |
| Rows per page (`page_size`) | number 1–200 | 10 | |
| Maximum rows (`max_rows`) | number 1–1000 | 100 | A note shows "Showing first 100 of 2,345 rows" when there are more |
| Chart height (`height`) | number 120–1000 | 280 | Pixels |
| Show the report's name (`show_title`) | yes / no | yes | Name and description above the table |
| Selectable rows (`selectable`) | yes / no | no | |

## Keyboard and screen readers

A real `<table>` with a caption (the report's name and current sort). Each column header is a
button: Enter or Space sorts ascending, again descending, announced through `aria-sort`. Previous /
Next page through the rows ("Rows 11-20 of 57"). With selectable rows each row starts with a toggle
button ("Select INV-1042", `aria-pressed`); clicking anywhere on the row also picks it. The chart
view has a text alternative listing the values and a Table switch. Loading sets `aria-busy`;
sorting, paging and selection are announced politely; errors from the host (for example "The
report is not shared with you") are shown inline as an alert. On a phone the table scrolls
sideways inside its own frame.

## Capabilities

`reports`: `request('report', { limit })` returns the report the designer chose. The control
cannot choose another report — the server reads `report_id` from the stored form and runs it as
the current user. No network access. Bundles Chart.js 4.5.1 (MIT, tree-shaken), @kurkle/color
0.3.4 (MIT) and Lit 3.3.3 (BSD-3-Clause).
