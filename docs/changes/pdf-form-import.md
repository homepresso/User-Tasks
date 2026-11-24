# PDF form import

**Forms → Import → PDF form (.pdf)** turns a fillable PDF into a UserTasks
form, with the same flow as the InfoPath importer: upload, a working preview
and the mapping report, then import.

## What changes for people

- Fillable PDFs (AcroForm), fillable PDFs with an XFA template (many
  government forms: captions, exclusive groups and required flags are read
  from it) and dynamic XFA forms (LiveCycle / AEM: fields, captions, sections,
  required, simple show / hide scripts) are read. Flat and scanned PDFs are
  detected: the preview says "This PDF has no fillable fields".
- Labels come from the tooltip, then the XFA caption, then the printed text
  next to the field, then the field name; the report says which.
- Acrobat scripts are **never run**: known patterns are translated (dates,
  currency, numbers, ZIP / phone / SSN, ranges, masks, show / hide, mutually
  exclusive checkboxes); the rest is listed in the report.
- Split date / SSN / EIN boxes and Yes / No checkbox pairs are merged;
  required is inferred from asterisks and "(required)" when the PDF's flag is
  not set; pages become steps.
- Printed routing ("If No, go to question 10", "Answer questions 4–5 only
  if …") becomes show / hide rules — enabled when the answer and the
  questions are found, otherwise created turned off with the sentence kept.
- PDFs over 200 fields become several forms, split at page boundaries.
- **AI assist (opt-in)**: an admin turns on **Settings → Agent → Let
  importers use AI for hard PDFs**; the person then ticks **Use AI for the
  hard parts** and confirms that the PDF's content goes to the workspace's own
  AI provider. The answer is validated (rejected when it doesn't fit), every
  AI-derived item is marked "AI — review", usage counts towards the Agent's
  limits and each send is audited. Off by default; nothing is sent when off.
- The public **/forms** page has a "Try a PDF form" preview (cloud edition;
  nothing stored, no AI).

## API, MCP, CLI

The importer is `pdf` on the generic importer endpoints
(`/api/v1/importers/pdf/analyze`, `/import`) and the MCP importer tools.
Options: `name`, `pages` (`steps` | `single`), `available_in_menu`, `ai`,
`ai_consent`, `ai_result` (import: the analysis's `report.details.ai.answer`),
`tables` (default true), `keep_tables` (comma-separated table ids from
`report.details.tables`), `table_rows` (`pdf` | `unlimited`).
`GET /api/internal/importers/pdf` tells the dialog whether the AI option is
available. Import report items may carry `origin: 'ai'`.

No migration: the admin setting lives in the Agent's settings
(`assistant_settings.capabilities.import_ai`); usage rows use the existing
"designer" capability.

## Calculations (2026-11-22)

Calculated PDF fields now become calculated form fields: Acrobat's SUM / AVG / PRD / MIN / MAX (AFSimple_Calculate) and plain arithmetic Calculate scripts on other fields (`event.value = getField("a").value + getField("b").value * 2`). The result is a stored Label field, recomputed in the browser and on the server; text fields it reads become number fields. Scripts with conditions or other calls stay in the report.

## Tables become repeating lists (2026-11-21)

Grids of boxes (rows × columns of the same inputs: a hotel rooming list, an expenses table, a list of dependants) are now found deterministically and imported as **one repeating section** instead of a field per box. A 16-row rooming list of 96 boxes now imports as 3 header fields and one "Rooms" list.

- Detection (`lib/importers/pdf/tables.ts`): boxes with matching left and right edges, height and type form columns; columns whose boxes sit on the same rows form a grid. A grid counts as a table only with no printed text between its boxes (a normal form labels every box), with cells that aren't separately named questions (distinct tooltips or name stems), at least 3 rows (a single column needs 4 numbered rows), and not mostly checkboxes. Field-name patterns (`Name 1.0.2`, `Row3.Col2`, `Text12`, `[n]`) count as evidence.
- Column labels come from the header text above each column (several lines are joined, and "For example …" becomes help); otherwise from a shared tooltip, otherwise from the field-name stem (marked for review). Numbered row labels ("Room #1", "1.", "Item 3") name the list ("Rooms", "Add room", "Room {{index}}"). Other row labels become a required choice column.
- Built as `repeating_section`: one control per column, typed and with options from the PDF, required only when every box in the column is required; `start_items: 1`, `max_items` = the PDF's rows (or 200 with `table_rows: unlimited`). A Calculate SUM over a column becomes a Label field `SUM({{form.<list>}}, "<column>")`. Tables continued on the next page are joined; a table whose columns are the entries (1040 dependents) is turned round; XFA repeating subforms (occur max) become lists.
- Rules: targets that cover every box in a column become `column:<list>.<control>` (kept on, noted in the report). Conditions on boxes, or targets that cover only some boxes, are created turned off with the reason.
- Preview: **Turn tables into repeating lists** (on), a switch per table and **Rows a list allows**. The report has one `table` item per table with its columns, label sources, row labels, totals and the PDF fields it absorbed. Boxes kept as fields are labelled "Column (row label)".
- Labels: a bare number is never a label any more. Field names keep their last segment that has letters (`Bed Type.3` becomes "Bed Type 3"), copy counters are dropped from tooltips ("Special Requests/Notes_1"), and doubled colons are cleaned.
- Required: header fields that come out required carry the PDF's own Required flag (field flag bit 2). The rooming list template sets it on Group Name, Contact Name and Arrival Date. This isn't an inference, and the report says "required in the PDF".
