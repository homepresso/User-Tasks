# Release notes: autocomplete / lookup fields

Task forms get an **Autocomplete / lookup** field: suggestions as the
assignee types, from a data table or an API reference. No migration;
existing forms are unchanged.

## What's new

- **Data table lookups.** Search one or more columns (contains or starts
  with), show one or more columns per suggestion, store the row id or any
  column, add fixed filters whose values can use other form fields
  (`{{task_data.<key>}}`), the task or workflow variables, sort, and limit
  the suggestions and the characters needed before searching.
- **API reference lookups.** Map the typed text (`{{search}}`) and other
  fields into the reference's inputs, choose the results list from its
  response model, then the fields to show and the value. Calls are
  debounced and responses can be cached for up to an hour.
- **Single or several, free text, fill other fields.** Several selections
  show as chips; free text can be allowed; picking an item can fill other
  fields (a customer's email and phone). The designer's preview runs the
  real lookup.
- **Downstream.** `{{task_data.<key>}}` holds the value (an array for
  several) and `{{task_data.<key>_item}}` the selected item's shown / value /
  fill fields, both in the data picker with the item model.
- **Accessible combobox.** ↑/↓, Enter, Esc, Backspace removes the last
  chip; loading, empty and error states are announced; it follows the form
  theme and works on phones.
- **API clients.** `POST /api/v1/tasks/{id}/lookup`, MCP `tasks_lookup`,
  `usertasks tasks lookup <id>`.

## Security

Suggestions are authorised by the task (Complete tasks, and the caller can
act on that open task), never by data-table or integration permissions,
and only the lookup stored on the task runs — configured source, columns
and filters, results trimmed to the configured fields, credentials kept on
the server, tenant-scoped, rate limited and with timeouts. Completion
re-checks the value against the source (unless free text is allowed) and
computes `<key>_item` on the server. See
[Task forms](/docs/tasks/forms#autocomplete-lookup-fields).

## Portability

The lookup's table, reference and integration are dependencies of the
form or workflow in exports and packages, and their ids are remapped on
import and install.
