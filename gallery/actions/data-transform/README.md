# Data transform (`ut_data`)

Reshape lists of records in UserTasks workflows: JSON path selection, field mapping, filtering, multi-key sorting, group by with aggregates, pivot and unpivot, de-duplication, joins and CSV to JSON conversion in both directions.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### Select (JSON path) (`select`)

Read a value from an object or list by path: a.b[0].c, items[-1] for the last item, items[*].name for every item's name (wildcards return a list).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `data` | json | yes |  | The object or list to read from. |
| `path` | string | yes |  | For example order.lines[0].sku or order.lines[*].sku ($. prefix optional). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `value` | json | The value at the path (a list when the path has a wildcard; empty when not found). |
| `values` | list of jsons | Every value found, as a list. |
| `found` | boolean |  |
| `count` | integer | How many values were found. |

### Map fields (`map`)

Pick, rename and nest fields of every item: "customer.name as customer", "total" or { "from": "a.b", "to": "c", "default": 0 }.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `fields` | list | yes |  | One per field: source path, optionally "as" a new name (a dotted name creates nested objects), or objects { from, to, default }. |
| `keep_other_fields` | boolean | no | `false` | Keep fields not listed (renamed ones move). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | The mapped items. |
| `count` | integer | How many items were returned. |

### Filter (`filter`)

Keep the items that match conditions: eq, ne, gt, gte, lt, lte (numbers and dates compare as such), contains, not_contains, starts_with, ends_with, in, not_in, empty, not_empty; all must match or any.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `conditions` | list of objects | yes |  | List of { "field": "status", "operator": "eq", "value": "paid" }; in / not_in take a list or comma-separated text. |
| `combine` | choice: `all`, `any` | no | `"all"` | Whether every condition or any condition must match. |
| `case_sensitive` | boolean | no | `false` | Compare text exactly (off: ignore case). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | The matching items, in their original order. |
| `count` | integer | How many items matched. |
| `removed` | integer | How many items did not match. |

### Sort (`sort`)

Sort by one or more keys, ascending or descending, comparing as numbers, text or dates (auto: numbers when both values are numeric). Stable; empty values sort last.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `keys` | list | yes |  | In priority order: "amount desc", "-amount", "name asc text", or { "field", "direction": "asc" \| "desc", "type": "auto" \| "number" \| "text" \| "date" }. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | The sorted items. |
| `count` | integer | How many items were returned. |

### Group & aggregate (`group`)

Group items by one or more fields and compute aggregates per group: count, count_distinct, sum, avg, min, max, first, last or list. Each group row has the group fields, count and the aggregates.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `group_by` | list of strings | yes |  | The field(s) to group by. |
| `aggregates` | list | no |  | "sum:amount", "avg(amount) as average", "count_distinct:product" or { "op": "sum", "field": "amount", "as": "total" }. The default name is op_field (sum_amount). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `groups` | list of objects | One row per group, in order of first appearance: the group fields, count and each aggregate. |
| `count` | integer |  |

### Pivot (`pivot`)

Turn values of one field into columns: one row per Rows key, one column per distinct Column value, aggregating Value (sum, count, avg, min, max, first, last).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `rows` | list of strings | yes |  | Field(s) that identify an output row. |
| `column` | string | yes |  | Field whose values become columns. |
| `value` | string | no |  | Field to aggregate in each cell (not needed for count). |
| `aggregate` | choice: `sum`, `count`, `avg`, `min`, `max`, `first`, `last` | no | `"sum"` | How to combine several values in one cell. |
| `fill` | json | no |  | Value for a row/column with no items (default empty; e.g. 0). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | One row per Rows key with a property per column. |
| `columns` | list of strings | The column values, in order of first appearance. |
| `count` | integer | How many items were returned. |

### Unpivot (`unpivot`)

Turn columns into rows: for every item, one row per column with the column name and its value, keeping identifier fields.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects with one column per measure. |
| `keep_fields` | list of strings | no |  | Identifier fields copied to every row. |
| `columns` | list of strings | no |  | The fields to turn into rows (default: every field not kept). |
| `name_field` | string | no | `"name"` | Field that receives the column name. |
| `value_field` | string | no | `"value"` | Field that receives the value. |
| `skip_empty` | boolean | no | `false` | Leave out rows whose value is empty. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | One row per item and column. |
| `count` | integer | How many items were returned. |

### Remove duplicates (`dedupe`)

Remove duplicate items, comparing chosen fields (or whole items, which also works for lists of plain values), keeping the first or the last of each.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list | yes |  | A list of objects or plain values. |
| `fields` | list of strings | no |  | Fields that make an item unique (default: the whole item). |
| `keep` | choice: `first`, `last` | no | `"first"` | Which duplicate to keep (the order of the list is kept). |
| `case_sensitive` | boolean | no | `true` | Off: "A@x.io" and "a@x.io" are duplicates. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of jsons | The unique items. |
| `count` | integer | How many items were returned. |
| `removed` | integer | How many duplicates were removed. |

### Join (`join`)

Combine two lists on matching keys (inner, left, right or full outer). Right fields whose names clash with left fields get the prefix right_ (or your own prefix on every right field).

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `left` | list of objects | yes |  | The main list of objects. |
| `right` | list of objects | yes |  | The list to look up. |
| `left_key` | list of strings | yes |  | Key field(s) in the left list. |
| `right_key` | list of strings | no |  | Key field(s) in the right list, in the same order (default: the left key names). |
| `type` | choice: `inner`, `left`, `right`, `full` | no | `"inner"` | Which unmatched rows to keep. |
| `right_prefix` | string | no |  | Optional prefix for every field from the right list. |
| `case_sensitive` | boolean | no | `true` | Off: keys match ignoring case. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | The joined rows (one per match). |
| `count` | integer | How many items were returned. |
| `unmatched_left` | integer | Left rows with no match. |
| `unmatched_right` | integer | Right rows with no match. |

### CSV to JSON (`csv_to_json`)

Parse CSV text (RFC 4180: quoted fields, "" escapes, line breaks in quotes) into a list of objects, using the header row for field names and inferring numbers and true/false.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `csv` | text | yes |  | The CSV text. |
| `delimiter` | string | no | `"auto"` | auto (detect), comma, semicolon, tab, pipe or the character(s). |
| `header` | boolean | no | `true` | The first row holds the field names (off: column_1, column_2, …). |
| `infer_types` | boolean | no | `true` | Turn numbers and true/false into numbers and booleans, empty cells into empty values (numbers with leading zeros stay text). |
| `trim` | boolean | no | `true` | Trim spaces around values. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `items` | list of objects | One object per data row. |
| `columns` | list of strings | The field names. |
| `count` | integer | How many data rows. |

### JSON to CSV (`json_to_csv`)

Write a list of objects as CSV (RFC 4180 quoting, CRLF line endings by default), with chosen columns and headers. Text that a spreadsheet would run as a formula is escaped by default.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | list of objects | yes |  | A list of objects (rows), e.g. a data table query result or a JSON array. |
| `columns` | list of strings | no |  | Fields to write, optionally "field as Header" (default: every field, in order of appearance). |
| `delimiter` | string | no | `","` | Field separator (tab for tab-separated). |
| `header` | boolean | no | `true` | Write the column names first. |
| `line_ending` | choice: `crlf`, `lf` | no | `"crlf"` | CRLF (RFC 4180, Excel) or LF. |
| `escape_formulas` | boolean | no | `true` | Prefix text starting with = + - @ with ' so spreadsheets do not run it (CSV injection). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `csv` | text |  |
| `columns` | list of strings | The header names. |
| `count` | integer | How many data rows. |

## Capabilities

None: pure computation. The action cannot reach the network, data tables, files or secrets.

## Examples

**Totals per region** (`group`)

```json
{
  "items": [
    {
      "id": "SO-1",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 1200,
      "qty": 2
    },
    {
      "id": "SO-2",
      "region": "South",
      "product": "Chair",
      "status": "paid",
      "amount": 300,
      "qty": 3
    },
    {
      "id": "SO-3",
      "region": "North",
      "product": "Chair",
      "status": "open",
      "amount": 450,
      "qty": 5
    },
    {
      "id": "SO-4",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 600,
      "qty": 1
    },
    {
      "id": "SO-5",
      "region": "South",
      "product": "Lamp",
      "status": "void",
      "amount": 80,
      "qty": 2
    }
  ],
  "group_by": [
    "region"
  ],
  "aggregates": [
    "sum:amount",
    "avg:amount",
    "count_distinct:product"
  ]
}
```

**Paid orders of 500 or more** (`filter`)

```json
{
  "items": [
    {
      "id": "SO-1",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 1200,
      "qty": 2
    },
    {
      "id": "SO-2",
      "region": "South",
      "product": "Chair",
      "status": "paid",
      "amount": 300,
      "qty": 3
    },
    {
      "id": "SO-3",
      "region": "North",
      "product": "Chair",
      "status": "open",
      "amount": 450,
      "qty": 5
    },
    {
      "id": "SO-4",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 600,
      "qty": 1
    },
    {
      "id": "SO-5",
      "region": "South",
      "product": "Lamp",
      "status": "void",
      "amount": 80,
      "qty": 2
    }
  ],
  "conditions": [
    {
      "field": "status",
      "operator": "eq",
      "value": "paid"
    },
    {
      "field": "amount",
      "operator": "gte",
      "value": 500
    }
  ]
}
```

**Products as columns** (`pivot`)

```json
{
  "items": [
    {
      "id": "SO-1",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 1200,
      "qty": 2
    },
    {
      "id": "SO-2",
      "region": "South",
      "product": "Chair",
      "status": "paid",
      "amount": 300,
      "qty": 3
    },
    {
      "id": "SO-3",
      "region": "North",
      "product": "Chair",
      "status": "open",
      "amount": 450,
      "qty": 5
    },
    {
      "id": "SO-4",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 600,
      "qty": 1
    },
    {
      "id": "SO-5",
      "region": "South",
      "product": "Lamp",
      "status": "void",
      "amount": 80,
      "qty": 2
    }
  ],
  "rows": [
    "region"
  ],
  "column": "product",
  "value": "amount",
  "fill": 0
}
```

**Orders with their region manager** (`join`)

```json
{
  "left": [
    {
      "id": "SO-1",
      "region": "North",
      "product": "Desk",
      "status": "paid",
      "amount": 1200,
      "qty": 2
    },
    {
      "id": "SO-2",
      "region": "South",
      "product": "Chair",
      "status": "paid",
      "amount": 300,
      "qty": 3
    },
    {
      "id": "SO-3",
      "region": "North",
      "product": "Chair",
      "status": "open",
      "amount": 450,
      "qty": 5
    }
  ],
  "right": [
    {
      "region": "North",
      "manager": "Aroha"
    },
    {
      "region": "South",
      "manager": "Ben"
    }
  ],
  "left_key": [
    "region"
  ]
}
```

**Parse a CSV export** (`csv_to_json`)

```json
{
  "csv": "id,name,amount\n1,\"Smith, Jo\",12.50\n2,Ana,7"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Lists hold up to 100,000 items; CSV input up to 5,000,000 characters.
- Comparisons: when both values are numeric (numbers or numeric text) they compare as numbers; otherwise as text (case-insensitive unless Case sensitive is on). Empty values never satisfy gt / gte / lt / lte and sort last.
- JSON to CSV escapes text starting with = + - @ by default (CSV injection); turn Escape formulas off for data that is never opened in a spreadsheet.

## Build and test

```sh
node gallery/actions/scripts/build.mjs data-transform
npx vitest run __tests__/gallery-action-data-transform.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
