# Likert scale

`<ut-likert>` — a survey matrix: several statements rated on the same scale. A matrix with the
scale across the top on wide forms; one card per statement, with the labels spelled out, on phones.

## Value

An object with one entry per answered statement, or empty (`null`) when nothing is answered:

```json
{ "the_request_was_handled_quickly": 4, "the_staff_were_helpful_and_courteous": 5, "i_would_recommend_us_to_a_colleague": 0 }
```

- Keys are made from the statement text: lowercase, every run of other characters becomes `_`
  (duplicates get `_2`, `_3`, …). Renaming a statement changes its key.
- Values are the point on the scale, 1 = the first label (e.g. Strongly disagree), and 0 for N/A.
- The server checks it is an object of whole numbers from 0 to 10. Read-only views show the JSON.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Statements (`statements`) | list | three sample statements | One row each |
| Scale (`scale`) | Agree (5) / Agree (7) / Satisfaction (5) / Frequency (5) / Custom | Agree (5) | |
| Custom scale labels (`scale_labels`) | list | — | 2–10 labels, lowest first |
| Offer N/A (`show_na`) | yes / no | no | Stored as 0 |
| Every statement must be answered (`all_required`) | yes / no | no | "Answer every statement (2 left)" until done |

Scales: Strongly disagree · Disagree · Neutral · Agree · Strongly agree; the 7-point version adds
Somewhat disagree / Somewhat agree; Very dissatisfied … Very satisfied; Never · Rarely · Sometimes ·
Often · Always.

## Keyboard and screen readers

Each statement is a radio group labelled by the statement, with one Tab stop: Tab / Shift+Tab move
between statements, the arrow keys choose within a statement (like native radio buttons), Home /
End jump to the ends, Space or Enter chooses the focused point and Delete clears that statement.
Each option is announced by its label ("Agree"). Targets are at least 40 px tall.

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
