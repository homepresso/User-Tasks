# Release notes: pick a list from a nested API response

API responses rarely put their rows at the top. S3's list-objects call
returns the files under `contents`, Microsoft Graph under `value`, and other
APIs under paths like `data.result.items`. Wherever a reference feeds a
list, you can now load a sample of its response and pick the list from a
tree, at any depth.

## What's new

- **Load sample (test call).** The form Data table field, lookup fields, the
  workflow Loop and the Call reference step's response model each have
  **Load sample**. It runs the reference once with sample inputs. Fixed
  mappings and input defaults are filled in, and you type the rest. The
  response is merged into the reference's response model. You need **Test
  integrations** to run it. With **Manage references**, the model is saved
  on the reference. Without it, the model is used for your session only.
  The call takes the same path as a test on the integration page: egress
  rules, stored credentials and the call log.
- **A tree of the response.** Objects expand. Every list shows **list of N
  items** with a preview of its first item and **Use as rows**. That
  includes the response itself, lists a few levels deep and lists inside
  list items (`orders[].lines` reads every order's lines in turn). **Search
  keys** filters the tree.
- **Smart default.** When the response holds exactly one list of objects,
  that list is chosen. For S3, that is `contents`.
- **Typed paths.** `contents`, `data.items`, `value[0].children` or
  `orders[].lines`, checked against the model when there is one.
- **Item fields straight away.** Picking a list shows its items' fields,
  nested up to three levels (`owner.display_name`), with their types and an
  example. **Add** or **Add all** makes them columns. Each column starts
  with a format that suits it: dates and times from their examples,
  numbers, and **File size** for byte counts named `size` or `bytes`.
- **Paging hints.** Keys such as `next_continuation_token`, `is_truncated`,
  `@odata.nextLink`, `cursor` and `total` are listed under the picker.
  Totals are suggested for the Data table's **Total count path**.
- **Workflows.** The Loop step has **Pick a list from a step's response**.
  It sets the items to `{{<step>_response.contents}}`, and `orders[].lines`
  becomes a FLATTEN/PLUCK expression. A sample loaded there refreshes the
  step's model, so the data picker drills into the items
  (`contents[] › key`).

## Fixes

- **Connector references (S3 and others) offered no usable list.** A
  connector's model only names the top-level fields of the response. For
  S3 it declared `contents` and `common_prefixes` as lists with no item
  fields. Testing on the integration page never filled them in, because
  automatic capture skipped connector models. Now a test or a sample fills
  them in.
- Regenerating a connector's references no longer drops a response model
  captured from real calls.
- A reference with no stored model and several outputs with no path (as
  connectors generate them) read as "the whole response is a list". The
  only choice was the whole response, and it showed no rows. Those outputs
  are now read as top-level fields of that name.
- A sample whose top level contradicts the model (a list where the model
  said object) replaces the model instead of turning it into "any".

## Compatibility

Nothing to migrate. Saved `results_path` values keep working. The server now
also reads `[0]` and `[]` in them, through the same reader the designer
previews with.
