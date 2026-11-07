# Release notes: custom references can write

Custom references now cover the full set of record operations and actions.
Alongside **Read** and **List**, a custom reference can be **Create**,
**Update**, **Upsert**, **Delete** or **Execute**. Existing references are
unchanged.

## What's new

- **Kind** in the builder: Read, List, Create, Update, Upsert, Delete and
  Execute, each with a description. REST writes default to POST, PATCH,
  PUT, DELETE and POST, and you can change the method.
- **REST request body builder.** Map body fields (dotted paths build nested
  JSON) to inputs, constants or typed values, or send the whole input
  object. A live **Request preview** shows the method, path and JSON body
  with the Test sample values.
- **Database writes** on tables:
  - INSERT the chosen columns, with optional RETURNING (PostgreSQL) or
    OUTPUT (SQL Server);
  - UPDATE … SET … WHERE a key and/or conditions;
  - DELETE … WHERE a key and/or conditions;
  - upsert on chosen key columns: PostgreSQL `ON CONFLICT`, MySQL
    `ON DUPLICATE KEY UPDATE`, SQL Server, Oracle and Snowflake `MERGE`.

  Introspected column names only, quoted per database, every value a bound
  parameter.
- **Execute** a stored procedure or function picked from the database's
  own list, with its parameters mapped from inputs. Supported on
  PostgreSQL, SQL Server, MySQL and Oracle (Snowflake not yet).
  Free-form SQL is not allowed. REST Execute calls any operation,
  typically a POST with a body.
- **Output** of every write: `{ status, affected_rows, id, record }`, with
  the record projected through the column picker. You can set the success
  statuses for REST (default 200-299). For Update and Delete, choose
  whether "nothing matched" fails (404) or is a no-op.
- **Writes data** badge in the builder, the reference list and every
  picker: workflow Call reference, form rule actions and Buttons, "For each
  changed row" rules and agent tools.

## Safety

- Update and Delete always need a WHERE: key columns or conditions on a
  table, or a parameter that identifies the record on a REST operation.
  An unbounded update or delete is refused at save time, and at run time
  when a key is blank or every condition was skipped.
- **Max affected rows** (default 1, up to 1,000). Database writes run in a
  transaction, and going over the cap rolls back and fails with 409.
- **Dry run.** Test on a database write always rolls back. It shows the SQL
  with bound parameters (credentials masked) and the rows it would affect.
  Test on a REST write shows the request and sends it only after **Send
  for real** and a warning. Real sends are in the call log. Load sample
  is not offered for writes.
- **Idempotency key** (Create and Execute). It is sent as an
  `Idempotency-Key` header (or a header you name), and a server-side
  ledger returns the first result to a retry with the same key. A retried
  workflow step or a double click cannot write twice.
- Write references never run as reads. Data tables, lookups, Live
  Reference steps, report sources and the browser's reference endpoint
  refuse them, and the form designer leaves them out of the Data table
  and lookup pickers. Rule actions and Buttons that call one show a
  "Writes data" hint. The reference list's Test asks for confirmation.
- Agents: a write reference is a side-effecting tool and starts with
  **Requires approval** on.
- Creating or editing a custom reference still needs **Manage
  references**. The egress guard, credential masking and Fixed-input rules
  are unchanged.

## Forms

In a **For each changed row** rule, an Update, Upsert or Delete custom
reference is a per-row target. **Map row columns to inputs of the same
name** fills `order_id ← {{row.OrderID}}` and the like.

## API, MCP and CLI

`request_config.custom` takes the new `kind` values and a `write` object
(`method`, `body`, `idempotency`, `success_statuses`, `set`, `key`,
`returning`, `procedure`, `max_affected`, `not_found`, `id_field`), through
`POST /api/v1/integrations/{id}/references`, `PATCH
/api/v1/references/{id}`, MCP `references_create` / `references_update` and
`usertasks references create|update`. Export/import, packages,
config-as-code and GitHub sync carry it. Regenerate references never
touches custom references.

## Migration

`20261216000000_custom_reference_writes.sql` adds the idempotency ledger
(`custom_reference_writes`, service role only). It is additive and
idempotent. Until it is applied, writes run without the ledger, and the
key is still sent to the API as a header.

See [Integrations → References → Write references](/docs/integrations/references).
