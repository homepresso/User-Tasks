# Release notes: pick values from API responses

Reading values from a REST reference used to mean hand-writing JSON paths
and working out loops yourself. References now carry a **response model**,
and the workflow designer has a **data picker** that browses it.

## New

- **Response models on references.** The shape of a reference's response —
  nested objects, lists with their item fields, types, descriptions and
  example values — stored at `request_config.response_schema`. It comes
  from the OpenAPI/Swagger 2xx response schema on import (`$ref`s
  resolved), from **Test** in the reference builder (inferred from the real
  response; further samples merge in, so optional fields show up), from
  table columns for database references and from the connector catalogue.
  The builder shows it as a tree with **Capture from test response**,
  **Reset** and **+** to add a named output with the right path.
- **Data picker.** Every expression field in the node settings has an
  **Insert data** button, and **Variables → Data** shows the same tree:
  only steps upstream of the selected step, each with its outputs, following
  response models level by level (`Get Customers › response › data[] ›
  address › city`), plus **Current item** inside a loop body. Search, type
  icons, example values; arrow keys and Enter.
- **Single value vs collection.** A list or a field inside one offers
  *First item*, *Item at index…*, *Find item where…*, *All values of a field
  as a list*, *Count* and *Loop through each item* (wraps the step in a Loop
  For Each and inserts `{{item.<field>}}`).
- **Loop items autocomplete.** *Items to loop through* suggests every list
  available at that step (response lists, data-table rows, set-variable and
  split results, workflow variable lists, agent and custom-step list
  outputs, the current item's lists for nested loops), grouped by step with
  an example item. Free text still works; a value known not to be a list
  shows a warning.
- **HTTP Request response model.** Paste a sample response to make an HTTP
  Request's fields pickable.
- **Named outputs from the model.** In a Call Reference node, **+** on a
  field of the response model adds `custom_outputs` (`{ name, path }`).
- **Functions:** `FIND_WHERE(list, field, value[, return_field])` and
  `FILTER_WHERE(list, field, value)`; `PLUCK` accepts dotted paths
  (`"address.city"`).
- **Index paths:** `{{data[0].name}}` works as well as `{{data.0.name}}`.
- **API / MCP / CLI:** `GET /api/v1/references/{id}` and MCP
  `references_get` return `response_schema` (derived from outputs when none
  is stored); create/update accept `response_schema` (`null` clears it);
  `POST /api/v1/references/{id}/execute` and MCP
  `integrations_execute_reference` take `capture_schema: true` to fold the
  response into the model (`usertasks references execute <id> --set
  capture_schema:=true`).

## Unchanged

- Existing `output_mappings` and outputs keep working exactly as before.
- References without a model derive one from their outputs' paths until
  their next test. No database migration.
