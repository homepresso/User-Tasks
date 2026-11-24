# Release notes: sortable app data grids and personal saved views

## New

- **Sort by any column.** Click a column header of an app **Data grid** to
  sort by it: ascending, descending, then back to the grid's own order. The
  sort runs on the server over every row of the grid (not just the page you
  see) and the header shows the order (`aria-sort` for screen readers).
- **Default order.** Designers can give a grid a `sort` column and
  `sort_dir` (builder: **Sort by** / **Order**). Without one, rows open
  newest first, as before.
- **Personal saved views** (`personal_views: true`, builder switch
  **Viewers can save their own views**). A **View** menu next to the grid's
  search lets each person:
  - choose which of the grid's columns to show, and in which order;
  - add up to 5 "column equals value" conditions;
  - save the current sort, search, columns and conditions under a name
    (up to 12 views per grid), pick one again later, or delete it.
- Views belong to the person. Nobody else sees them, and they never widen
  what the grid shows: a view's conditions are added to the grid's own row
  conditions, and its columns are a subset of the grid's.
- Views are kept in the person's `users.preferences`, per workspace, app
  page and widget, so no migration is needed. The helpers are in
  `lib/apps/grid-views.ts`.

## API

- App widget data (`apps.widget`) takes `params.sort`, `params.dir`,
  `params.cols` and `params.eq`.
- The data grid result carries `sort`, `dir`, `grid_columns` and
  `personal_views`.
- Server actions: `listGridViews`, `saveGridView`, `deleteGridView`.
- OpenAPI, SDK and CLI are regenerated for the new `data_grid` settings.
