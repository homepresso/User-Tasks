# Release notes: custom references

Integrations can now have **custom references**: tidy, reusable references
that you build yourself instead of taking every generated operation as it
is. You pick the source operation (or a database table or view), declare the
inputs, choose the columns that come back, and add filters, sort, distinct
and paging. Existing integrations and references are unchanged and nothing
is migrated.

## What's new

- **New custom reference** on an integration's page (Manage References)
  opens a guided builder:
  - **Kind**: **List** returns rows, optionally as `{ rows, total }`.
    **Read** returns one record. You pick its key input and what happens
    when nothing matches (return `null`, or fail with 404).
  - **Source**:
    - one of the integration's references;
    - a connector catalogue operation;
    - an operation from the imported OpenAPI file;
    - a method and path on the integration;
    - a database table or view.
  - **Inputs** are typed, and each is either **Ask callers** (required or
    optional, with a default and a description) or **Fixed value**. A
    Fixed value is a constant, or one of the integration's own settings or
    credentials. Fixed inputs are hidden from the Call reference step, form
    mappings, agent tools and the API/MCP/CLI, and a value a caller sends
    for one is ignored. A secret typed as a plain Fixed value is refused.
  - **Rows and columns**: **Load sample**, pick the rows list, then add
    columns, rename them, and use nested paths up to 3 levels deep.
  - **Filter** (AND/OR groups, values can be `{{input.x}}`), multi-column
    **sort**, **distinct** values, page size, max rows, and optional
    `page` / `limit` inputs.
  - **Where it runs** shows what the API or database does and what the
    server applies:
    - **REST**: filters, sort and paging can be mapped to operation
      parameters. Anything not mapped is applied by the server to at most
      1,000 fetched rows.
    - **Tables and views**: everything compiles to one parameterised SQL
      query.
  - **Test** runs the draft through the real executor and shows the shaped
    result, the timing and how many rows were fetched, matched and returned.
- The **response model is generated from the columns**. The workflow data
  picker, Data table columns, lookups and Loops show exactly the selected
  fields with their types.
- **Custom** tag in the reference pickers (workflow Call reference, form Data
  table, lookup, rules and table changes, and agent tools).
- **Duplicate as custom** on a generated reference starts a custom one from
  it.
- **Choose which references to create** when you enable a connector or
  import an OpenAPI/Postman file:
  - **Generate all**, as before.
  - **Start empty**.
  - **Generate selected**, a searchable list of operations.

  An import also keeps every parsed operation on the integration, so you
  can build custom references from them later.

## Behaviour

- Custom references run the same way everywhere: workflows, forms, agents,
  MCP, the REST API and the CLI. Every call goes through these stages in
  order: source call → rows → filter → distinct → sort → columns → page.
- Security is unchanged:
  - The source request is copied from the source on the server, so calls
    only go to the integration's base URL, under its egress rules.
  - Credentials stay on the server, and credentials used by Fixed inputs
    are masked in call logs.
  - Filter values are always data. For tables they are bound SQL parameters.
- **Regenerate references** on a connector never changes or deletes custom
  references.
- Custom references are stored in `request_config`
  (`{ "origin": "custom", "custom": { … } }`), so export/import, packages,
  config-as-code and GitHub sync carry them as they are.

## API, MCP and CLI

- Create or update a custom reference with
  `request_config: { origin: 'custom', custom }` through any of these:
  - `POST /api/v1/integrations/{id}/references` and
    `PATCH /api/v1/references/{id}`
  - MCP `references_create` / `references_update`
  - `usertasks references create|update`

  The server builds the public inputs, the outputs and the response model.
- `POST /api/v1/connectors` and MCP `connectors_create` take
  `reference_mode` (`all`, `none` or `selected`) and
  `reference_template_keys`. The catalogue lists the keys as
  `reference_templates`.

See [Integrations → References → Custom references](/docs/integrations/references).
