# Report summary charts

Reports can now carry up to 8 **summary charts** (number cards and chart cards above the table), and the form wizard's responses report gets a set of them, so a form's one report shows when people submitted, how many, and how they answered.

## What changed

### Reports

- **`config.charts`** (optional, max 8; `lib/report-charts.ts`). A chart is `{ id, title, type, dimension?, measure, filters?, top_n?, range_days?, window_field?, categories?, sort? }`:
  - `type`: `number` (KPI card), `line`, `area`, `column`, `bar`, `donut`, `pie`, `heatmap` (day of week × hour).
  - `dimension`: `{ field, bucket? }`: a categorical column, or a date column bucketed by `day`, `week` (Monday start), `month`, `day_of_week`, `hour_of_day`. Not on number cards; line / area need a bucket.
  - `measure`: `{ fn: count | sum | avg | min | max | nps, field? }` (NPS = % promoters 9–10 − % detractors 0–6, as the survey stats).
  - `filters` are ANDed with the report's own; `range_days` is a rolling "last N days" window on the dimension date (`window_field` on number cards); `top_n` folds the rest into *Other*; `categories` fixes the order and shows unused categories as zero.
  - Validated by a zod schema in the config normaliser: invalid charts are dropped on save, and reports without `charts` are unchanged (no key is added). MCP `reports_create` / `reports_update` / `reports_preview` reject invalid charts and charts on unknown columns with plain messages.
- **Server-side aggregation** (`lib/report-charts-server.ts`): each chart is aggregated from the report's own rows through the report engine (`executeReportPreview`) with the same source, source inputs, joins, filters and date range, so the same per-source permission checks (governance audit), API key table scope and, in the app, RLS apply. The report's grouping and row limit are not applied. Charts with the same extra filters share one read; the "last N days" window is applied in the query. Up to the newest 10,000 rows are aggregated (`truncated: true` beyond). Only the series leave the server.
- **Time zone**: buckets use the viewer's browser zone (`?timezone=` on `POST /api/v1/reports/preview`), else the user's profile zone, else UTC. MCP `reports_preview` takes `timezone` (default UTC).
- **Viewer**: the report page draws the cards above the table / main chart (number cards in a row; time series and heatmaps full width; a Table toggle on every card; loading, empty and error states; the time zone noted). They print with **Export → Print / PDF**.
- **Builder**: a **Charts** panel with presets in plain words (*Count of rows by day*, *by day of the week*, *by hour*, heatmap, *Count by <column>*, *Average of <column>*), editing (chart, show, split by, date grouping, largest N, last N days), reorder, remove, live validation, and the cards in the live preview.
- **Edit a saved report**: the report page's **Edit** (`/reports/builder?edit=<id>`) now opens the report in the builder (it used to open a blank builder) and **Save** updates it; someone else's report is saved as your own copy. `updateReport` returns `{ updated }`.
- The report engine now reads results larger than 1000 rows page by page (PostgREST's `max_rows`), with the row id as a tiebreaker, so a `row_limit` of 2500 / 5000 returns that many rows.
- `POST /api/v1/reports/preview` now applies an API key's data table scope (as `data_rows_*` and MCP already did).

### Form wizard

The ONE responses report (`buildReports` → `buildResponseCharts`) now has, within the 8-chart cap:

| Chart | When |
|-------|------|
| Total responses (number) | always |
| Responses over time (area, per day, last 90 days, `created_at`) | always |
| By day of the week / By hour of the day (columns) | always |
| By status (donut, review order) | with a review / approval |
| Average score (number) + Scores (columns) | quizzes |
| Up to 3 question charts: NPS card; rating / CSAT / agreement columns in scale order; yes-no(-maybe) / choice / picture choice donut (bars over 5 options, top 8); slider average | chart-worthy questions, NPS first, then scales, then choices |

New forms get them on create; existing wizard forms get them the next time they are saved with the wizard (no migration). Saving with the wizard resets the report's columns and charts to the wizard's.

### API / CLI / MCP

- OpenAPI: report `config` documents `charts`; `POST /reports/preview` documents `?timezone=` and the `charts` / `timezone` response. SDK and CLI regenerated.
- MCP: `reports_preview` returns `charts` and takes `timezone`; the `reports_create` description documents the chart shape (`MCP_REPORT_CHARTS_GUIDANCE`).

## Migration

None.

## Limitations

- Charts aggregate at most the newest 10,000 matching rows (flagged on the card).
- Multi-answer questions (several choices, rankings, grids) get no wizard charts; a grid's statements can still be charted one column at a time in the builder.
- OData `SavedReportResults` and the Excel export carry rows only, not chart series.
