# Rating

`<ut-rating>` — a 1 to N rating with stars, hearts or circles, for satisfaction scores, priority
and quality checks. One Tab stop; the arrow keys change the rating like any radio group.

## Value

A whole number from 1 to the number of symbols, or empty (`null`) when nothing is chosen.
Required fields refuse an empty rating; the server checks the value is a whole number from 1 to 10.
Read-only views (completed tasks, mobile, submissions) show "4 of 5".

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Number of symbols (`max`) | number 2–10 | 5 | |
| Symbol (`symbol`) | Stars / Hearts / Circles | Stars | |
| Size (`size`) | Small / Medium / Large | Medium | 24 / 32 / 40 px |
| Labels (`labels`) | list | — | One per value, lowest first: Poor, Fair, Good, Very good, Excellent |
| Allow clearing (`allow_clear`) | yes / no | yes | Click the chosen symbol again or press Delete |
| Symbol colour (`color`) | colour | theme primary | |

## Keyboard and screen readers

A radio group named by the field label. Left / Right (or Up / Down) change the rating, Home / End
jump to the lowest / highest, Delete or Backspace clears it. Each symbol is announced as
"4 of 5: Very good".

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
