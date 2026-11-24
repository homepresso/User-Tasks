# Release notes: Grouping and child records in data tables

The **Rows** grid of a data table can group its rows and show related rows
under each row. Existing tables and views are unchanged until you choose a
grouping or add child records.

## What's new

- **Group rows** by one column, then optionally by a second one (**Group by**
  in the grid toolbar, or **Group rows by / Then by** in View settings).
  Each group header shows the value, the row count and the totals of the
  view's number and currency columns. Blank cells form an **(empty)** group.
  Groups are counted over the whole filtered result on the server, so the
  counts don't depend on the page. Open a group to load its rows, and use
  **Show more** for large groups. **Expand all** opens up to 50 groups and
  **Collapse all** closes them. Search, column sort, inline editing and
  **Edit all** keep working inside groups. **Save to view** stores the
  grouping with a saved view (`group_by` on the view).
- **Child records.** Under the **Schema** tab, **Child records** links rows
  of another table to this one through a **Lookup** column whose source is
  this table, for example Order lines linked by Order. A table can have up to
  five relations. Pick the table itself to build a hierarchy, such as Tasks
  linked by a Parent lookup. You can also list only top-level rows. Lookups
  may now point at their own table.
- In the grid, each row gets an expander with its child count per relation.
  Expanding loads the child rows inline in the child table's own columns.
  You can edit their cells in place, and **Add child** creates a child that
  is already linked to the row. Child rows that have child records of their
  own nest underneath, indented. Rows already shown above are not repeated,
  so loops stop. Open groups and open child panels are remembered per person
  and view in the browser.

## API, CLI and MCP

- `GET /api/v1/data-tables/{id}/rows/groups?group_by=status,region&sum=amount`
  (also `search`, `filters`, `group_order`): groups with counts, sums and
  second-level groups. Same as `usertasks rows groups` and the MCP tool
  `data_rows_groups`.
- `GET /api/v1/data-tables/{id}/rows/{rowId}/children?relation=<id>`: a
  relation's child rows with `link_value`. Without `relation`, it returns the
  counts per relation. Same as `usertasks rows children` and the MCP tool
  `data_rows_children`.
- `PATCH /api/v1/data-tables/{id}` takes `child_relations`, as does MCP
  `data_tables_update_schema`. `GET` returns the relations. Views take
  `group_by`.
- Both new MCP tools are reads and need `data.view`, like `data_rows_query`.

## Database

Migration `20270119090000_data_table_grouping.sql` adds
`custom_tables.child_relations` and the SECURITY INVOKER functions
`data_table_row_groups`, `data_table_rows_page` and `data_table_row_matches`.
RLS applies to them as it does to a plain read. Until the migration is
applied:

- groups are counted from the newest 2,000 rows, and the grid says so;
- child records can't be saved.
