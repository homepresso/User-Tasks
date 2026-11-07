# Slider

`<ut-slider>` — a range slider for numbers on a scale (scores, budgets, percentages), with a
value bubble, mark labels, a prefix or unit, and an optional number box for exact entry.
It is a styled native `<input type="range">`, so keyboard and screen-reader support are the
browser's own.

## Value

A number, or empty (`null`) until the person moves the slider. When a starting position is set,
the slider shows it with a dashed thumb and "not set" in the bubble, but nothing is stored until
the person moves the slider (or presses Enter / Space to accept the start) — so a Required field
can tell a deliberate answer from an untouched default.

The control reports itself invalid when the value is outside the minimum / maximum or not on a
step ("Choose a value from 0 to 100"). The server checks the value is a number.
Read-only views (completed tasks, mobile, submissions) show the number (`{{value}}`; the prefix
and suffix are not part of the stored value).

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Minimum (`min`) | number | 0 | |
| Maximum (`max`) | number | 100 | |
| Step (`step`) | number > 0 | 1 | 1, 5, 0.5, … |
| Prefix (`value_prefix`) | text | — | Shown before the value, e.g. `$` |
| Suffix (`value_suffix`) | text | — | Shown after the value, e.g. `%` or ` kg` |
| Show value bubble (`show_value`) | yes / no | yes | A bubble above the thumb with the formatted value |
| Mark labels (`marks`) | list | — | Spread evenly under the track, lowest first: Low, Medium, High. Without marks the minimum and maximum are shown |
| Show number box (`show_input`) | yes / no | no | Type an exact value beside the slider |
| Starting position (`default_value`) | number | minimum | Shown, not stored, until the person moves the slider |

(The prefix / suffix props are not called `prefix` / `suffix` because `prefix` is a built-in
read-only property of DOM elements.)

## Keyboard and screen readers

A native slider named by the field label. Left / Right (or Up / Down) move one step, Page Up /
Page Down move further, Home / End jump to the minimum / maximum; Enter or Space accepts the
starting position while the field is empty. The value is announced with its prefix, suffix and
mark ("100%, High"; "Not set, starts at 50%" while empty). The number box is labelled
"<label>, exact value". The thumb is 24 px and the touch area 32 px tall.

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
