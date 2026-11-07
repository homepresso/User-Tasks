# Progress

`<ut-progress>` — progress as a bar, a ring or named steps, from two mapped fields or fixed values.
Display only.

## Value

Value type `number`, but the control never sets it: the field stays empty (`null`) and nothing is
stored. Read-only views show the same progress.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Style (`appearance`) | Bar / Ring / Steps | Bar | |
| Current (`current_value`) | number | — | When the Current context entry is not mapped |
| Total (`total_value`) | number | 100 | When Total is not mapped; Steps uses the number of step names |
| Step names (`steps`) | list | — | For Steps, in order |
| Unit (`unit`) | text | — | e.g. tasks, hours |
| Show percentage (`show_percentage`) | yes / no | yes | |
| Label (`label_template`) | text | `{{current}} of {{total}} {{unit}}` | Also `{{percent}}`, `{{remaining}}`, `{{step}}`; plain text |
| Warn below (`warn_below`) | number 0–100 (%) | — | Error colour + "Needs attention" |
| Good from (`good_above`) | number 0–100 (%) | — | Success colour + "On track" |

## Context

| Name | |
|---|---|
| `current` | Progress so far: a number, a step number (1 = first) or a step name, or a list (its length counts) |
| `total` | The total or target: a number or a list (its length counts) |

Mapped context values win over the Current / Total properties.

## Keyboard and screen readers

Nothing to operate. Bar and ring are `role="progressbar"` named by the field label, with
`aria-valuemin` / `aria-valuemax` / `aria-valuenow` and the label, percentage and status as
`aria-valuetext` ("7 of 12 tasks, 58.3%"). Steps is an ordered list with `aria-current="step"` on
the current step and the heading "Step 2 of 5: Review"; on narrow screens the steps stack
vertically. The threshold colours always come with text.

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
