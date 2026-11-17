-- Data grid views (lib/grid/column-model.ts GridViewConfig, lib/services/data-table-views.ts):
-- the saved views of a data table's grid — per view the columns shown, each
-- column's control (dropdown, autocomplete, signature pad, people, currency…),
-- its data binding (options from a data table or an API reference: filter,
-- sort, value / display), editable / read-only, required, width, and the
-- table-level switches (inline editing of all rows, add / delete rows, page
-- size). A jsonb array on the table row, like `columns`: it travels with the
-- table and RLS is the table's own. Added with a constant default (no table
-- rewrite); additive and re-runnable.
alter table public.custom_tables add column if not exists views jsonb not null default '[]'::jsonb;

comment on column public.custom_tables.views is
  'Saved grid views: [{ id, name, columns: [{ key, label, control, control_options, binding, editable, required, hidden, width, format }], inline_edit, allow_add, allow_delete, page_size, default }] — lib/grid/column-model.ts';
