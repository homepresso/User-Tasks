# Release notes: survey controls and survey charts

Forms get nine built-in survey controls and the form wizard's results page
gets a chart per question kind. No migration: the controls are new field
types inside the existing form / task JSON, and the charts read the
responses tables the wizard already writes.

## New: survey controls (field types)

`lib/forms/survey/controls.ts` (types, settings, validation, coercion,
column mapping), `components/forms/survey/survey-controls.tsx` (the
controls), `components/forms/designer/survey-properties.tsx` (inspector).

| Type | Stored value | Data table column(s) |
|---|---|---|
| `rating` | number 1…max (`max` 2–10, default 5; 0.5 steps with `survey.half`) | number |
| `nps` | integer 0–10 | number |
| `likert` | one of `options` (text, lowest first) | select |
| `matrix` | `{ <row key>: <option> }` (`survey.rows`, columns = `options`) | **one select column per row**: `<key>_<row key>` |
| `slider` | number in `min`…`max` by `survey.step` | number |
| `csat` | integer 1…3 / 1…5 (`survey.faces`) | number |
| `ranking` | `options` ordered best first (all of them) | text |
| `image_choice` | an option, or a list with `survey.multiple` (`min` / `max` count picks) | select / text |
| `yes_no_maybe` | one of 2–3 `options` (default Yes / No / Maybe) | select |

- **Designer**: a new **Survey** palette group; properties per control
  (scale and symbol, half stars, end labels, NPS bands, Likert presets,
  matrix statements and columns, slider range / step / unit, faces,
  picture icons or https images, pick several, cards per row). Switching a
  field's type to a survey control seeds sensible defaults.
- **Validation** (server and browser, `validateTaskFieldValues`): bounds and
  steps, options, a full ranking without repeats, pick counts; a required
  matrix needs every row. Coercion stores numbers / text / lists / objects.
- **Rules**: conditions work on the values (numbers compare numerically,
  lists support *contains*); each matrix row is a condition subject
  (`<key>.<row key>`) in the rules panel.
- **Read-only answers** (completed tasks, submission detail) render drawn:
  stars, an NPS band badge, a matrix table, a numbered ranking, picture
  chips.
- **CSV export** of submissions: a matrix expands to one column per row
  (`<key>.<row key>`); a ranking is written `A > B > C`.
- **Accessibility**: radiogroups with roving tabindex and arrow keys, 44px
  targets, labels / help / errors / required announced, Move up / down with
  announcements for the ranking, theme tokens for colour. A new audit rule
  `survey-controls` flags half-star targets, wide / long grids, a slider
  hiding its value without end labels, long rankings and unexplained NPS
  bands.
- **API / MCP**: the field type list and a `survey?` description in the
  MCP `forms_*` tools' field help; the wizard spec note in the OpenAPI
  document (regenerated SDK / CLI).

## Form wizard

- New question kinds with plain names: **Agreement scale**, **Grid of
  statements**, **Slider**, **Smiley faces**, **Rank in order**, **Picture
  choice**, **Yes / no / maybe**. **Star rating** and **Recommend score**
  are now the real controls (previously radio buttons / a dropdown); their
  stored values are unchanged (numbers in number columns).
- Question settings (`settings`, `rows`) in the spec:
  rating max / icon / half, slider min / max / step / unit, faces, NPS
  bands, end labels, picture icons and pick several; `rows` for a grid.
  The builder's kind list is grouped in a sensible order;
  `components/forms/wizard/question-settings.tsx` holds the editors.
- A grid can't be the source of a "Show this question only if…", nor a
  ranking; ratings / faces / recommend score offer their points as answers.
- Templates: **Survey** now has a star rating, a grid (quality, ease of
  use, support, value for money), a ranking and the recommend score with
  colour bands; **Feedback** has smiley faces and an agreement statement;
  **Quiz** ends with a confidence slider.
- The one saved responses report includes every survey question as a
  column (a grid: a column per statement). Per-question charts are on the
  results page only.
- "Describe it and we'll draft it" may now suggest agreement scales, smiley
  faces, yes / no / maybe and rankings.

## Survey charts

`lib/forms/survey-stats.ts` aggregates on the server (pure functions:
rating, NPS, Likert, matrix, slider, CSAT, ranking, choice and number
summaries, a 30-day trend and per-question completion);
`components/forms/survey-charts/*` draws them. The wizard results page
(`/forms/results/<id>`, `GET /api/v1/forms/wizard/{id}/results`) returns
`charts` as these summaries (`kind`: rating | nps | likert | matrix |
slider | csat | ranking | choice | number) plus `trend` and `completion`,
and shows:

- rating: average with filled symbols and the distribution;
- NPS: gauge (−100…+100), promoter / passive / detractor split, 0–10 columns;
- Likert: diverging stacked bar centred on neutral, agree / disagree shares;
- matrix: a diverging bar per statement with its average;
- slider: average, median, range and histogram;
- CSAT: satisfied % and the distribution per face;
- ranking: average position and first places;
- choices / picture choice / yes-no-maybe / checkboxes: bars or a split bar;
- number / money: average, lowest, highest, total;
- responses over time and answered per question.

Each chart has a Table toggle, a text alternative and theme colours from
the chart palette resolver (contrast- and CVD-checked, light and dark).

**API change**: the results payload's `charts[]` items changed shape (from
`{ counts, average, nps }` to the typed summaries above).

## Not included

- A display-only "live results" element inside forms / app pages, and
  survey widgets as report / dashboard widget types: reports render saved
  report configs (table / bar / pie …) without pluggable widgets, so the
  survey charts live on the wizard results page. Matrix statements are
  ordinary select columns, so saved reports can still group and count them.
