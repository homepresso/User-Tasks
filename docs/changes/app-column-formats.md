# Release notes: column formats in app data grids and record cards

App **Data grid** and **Record card** widgets can now show a column as a
number, money, a percentage, a date or a progress bar, the same formats card
view and Kanban fields already had. Before, a number column showed raw
(`202200` for an amount in USD).

## New

- `formats` on `data_grid` and `record_card` configs: an object keyed by
  column, each `{ format, currency?, decimals?, max? }`.
  - `number`: grouped digits (`12,500`).
  - `currency`: the format's ISO code, else the column's own currency, else
    USD (`$202,200` with `decimals: 0`).
  - `percent`: a 0–100 value (`40%`).
  - `date`: a calendar day, never moved by the viewer's time zone (`9 Jan 2027`).
  - `progress`: a bar with its percentage; `max` is the value that fills it
    (default 100).
  - Columns without a format, and `text`, show as written. A value that
    isn't a number or a date stays as written; an empty one is `—`.
- Builder: **Column formats** in the widget settings of both widgets.
- Editing a cell in place still edits the raw value.
- The formatting lives in `lib/apps/field-format.ts` (client-safe), shared
  by card views, Kanban cards, grids and record cards.

## API

The OpenAPI document and the SDK / CLI types include the new `formats`
setting (app specs, `apps_apply_spec`, `PATCH /apps/{id}/pages/{page}`).
No migration.

## Card footers

Card view and Kanban cards can format their footer too, with
`template.footer_format` (`date`, `number`, `currency` or `percent`). For
example, an activity's date reads `20 Nov 2026` instead of `2026-11-20`.
