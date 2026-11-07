# Chart

`<ut-chart>` — a bar, horizontal bar, line, area, pie or doughnut chart (Chart.js) of static data,
another field's rows, lookup results or a saved report. Follows the form theme in light and dark
mode, and is fully usable from the keyboard and with a screen reader.

## Value

Display only by default: the value stays empty (`null`). With **Selectable points** on, clicking a
point (or Enter on it) makes it the value:

```json
{ "label": "Mar", "value": 18, "series": "Sales" }
```

`label` (string) and `value` (number) are required; `series` is the dataset name, or `null` for a
single unnamed series. Read-only views show "Mar: 18".

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Chart title (`chart_title`) | text | — | Heading and data-table caption (a report's name when empty) |
| Chart type (`chart_type`) | Bar / Horizontal bar / Line / Area / Pie / Doughnut | Bar | |
| Data source (`source`) | Static / Another field / Lookup / Saved report | Static | |
| Static data (`data`) | JSON | 4 sample months | `[{"label":"Jan","value":12}, …]` or `{"labels":[…],"datasets":[{"label":"Sales","data":[…]}]}` |
| Saved report (`report_id`) | text | — | For the Saved report source |
| Lookup query (`lookup_query`) | text | empty | Search text sent to the lookup |
| Label field (`label_field`) | text | first text field | Row field / report column for the labels |
| Value field (`value_field`) | text | first numeric field | |
| Series fields (`series_fields`) | list | — | Several numeric fields, one series each |
| Group by label (`aggregate`) | None / Sum / Count / Average | None | Groups rows with the same label |
| Show legend (`show_legend`) | yes / no | yes | Pie, doughnut and multi-series charts |
| Stack series (`stacked`) | yes / no | no | |
| Colours (`colors`) | list of #hex | theme primary + companions | |
| Chart height (`height`) | number 120–1000 | 280 | Pixels; the width follows the form |
| Selectable points (`selectable`) | yes / no | no | |

## Context

| Name | |
|---|---|
| `data` | For **Another field**: a field whose value is a list of rows (e.g. an editable table). |

## Data sources

- **Static** — the `data` property.
- **Another field** — rows from the `data` context field, with Label field / Value field / Series fields.
- **Lookup** — `request('lookup', { query })` against the field's lookup source (set Min characters
  to 0). Each item's `fields` (or `data`) give the columns; without them the item's label and
  numeric value are used.
- **Saved report** — `request('report')` runs the report chosen in `report_id` as the person filling
  in the form; the first text column is the label and the first numeric column the value unless set.

Loading shows a placeholder; a failed request shows the host's message inline (`role="alert"`).

## Keyboard and screen readers

The canvas is hidden from assistive technology. The plot is one Tab stop (a named group): Left /
Right move through the points (Up / Down for horizontal bars), Up / Down change series, Home / End
jump to the ends, Escape leaves the point. Each point is announced politely, e.g. "Mar: 18 (Sales),
3 of 5"; Enter selects it when points are selectable. **Show data table** renders every value in an
accessible table.

## Capabilities

`lookup` and `reports` (only used by those sources). No network access. Bundles Chart.js 4.5.1
(MIT, tree-shaken: bar, line, pie and doughnut controllers, category / linear scales, legend,
tooltip, filler), @kurkle/color 0.3.4 (MIT) and Lit 3.3.3 (BSD-3-Clause).
