import type { DocPageDef } from '../types'

/**
 * Document actions (lib/documents): Read, Compare, Convert, PDF tools,
 * Extract, Redact and Inspect — overview, one page per node, OCR and how-tos.
 * Config keys, defaults and outputs follow lib/documents/handlers.ts and
 * lib/documents/schemas.ts; designer wording follows
 * components/automations/document-action-panels.tsx.
 */
export const DOCUMENT_PAGES: DocPageDef[] = [
  {
    slug: 'workflows/documents',
    title: 'Document actions',
    description: 'Read, compare, convert, split, extract from, redact and inspect Word, Excel, PowerPoint, PDF and text files inside a workflow run.',
    body: `
Seven workflow steps work with documents directly in the run: they read a file into text, rows and structure, compare two versions, convert between formats, change PDFs, pull values out, remove personal data and check what a file really is. They run in the app's own process with pure JavaScript libraries, so no external service is needed; scanned PDFs (OCR) and pixel-perfect Office → PDF conversion are optional add-ons.

::image documents-read | The workflow designer with the document actions in the palette and the Read Document settings open | Document actions in the palette; Read Document reads an uploaded workbook (OCR, pages, sheets and ranges are optional).

Find them in the designer's palette under **Operations**, next to Word Document, Excel Spreadsheet and PowerPoint Slides (which fill in templates).

## The document actions

| Node | Type | What it does |
|---|---|---|
| [Read Document](/docs/workflows/documents/read-document) | \`doc_read\` | Any supported file → plain text, Markdown, sanitised HTML, metadata (title, author, dates, pages, word counts), structure (headings, links, tables, sheets, slides, pages, comments, tracked changes, form fields) and rows to loop over |
| [Compare Documents](/docs/workflows/documents/compare-documents) | \`doc_compare\` | Two files, texts, row lists or JSON values → changes, statistics, similarity, a side-by-side HTML report and a redline (Word or PDF) |
| [Convert Document](/docs/workflows/documents/convert-document) | \`doc_convert\` | A file → PDF, Word, HTML, Markdown, plain text, CSV, Excel or JSON |
| [PDF Tools](/docs/workflows/documents/pdf-tools) | \`doc_pdf\` | Merge, split, extract pages, count pages, watermark or stamp text, rotate, fill and read form fields |
| [Extract from Document](/docs/workflows/documents/extract) | \`doc_extract\` | Tables, named values by regular expression, and emails, URLs, phone numbers, dates, amounts and percentages — optionally written straight into a data table |
| [Redact Document](/docs/workflows/documents/redact) | \`doc_redact\` | A copy without emails, phone and card numbers, IBANs, other personal data, chosen words or patterns |
| [Inspect Document](/docs/workflows/documents/inspect-document) | \`doc_inspect\` | File type from the content (not the name), checksums, word and character counts, reading time, search with context |

Scanned PDFs and images need OCR: see [Scanned PDFs and OCR](/docs/workflows/documents/ocr).

## Supported formats

The type of a file is detected from its content (magic bytes, the parts inside a ZIP container, text sniffing); the name and MIME type it claims are only a fallback, and a mismatch is reported as a warning.

| Format | Read | Convert from | Convert to |
|---|---|---|---|
| Word \`.docx\` (\`.docm\`, \`.dotx\`) | Yes: text, headings, lists, tables, links, comments, tracked changes, properties | Yes | Yes (headings, paragraphs, lists, tables, links) |
| Excel \`.xlsx\` (\`.xlsm\`, \`.xltx\`) | Yes: every sheet, typed values, formula results, header detection, ranges | Yes | Yes (sheets, a document's tables, JSON rows) |
| PowerPoint \`.pptx\` | Yes: slide titles, text and speaker notes | Yes | No |
| OpenDocument \`.odt\`, \`.ods\`, \`.odp\` | Yes (\`.ods\` as sheets) | Yes | No |
| PDF | Yes: text per page, metadata, outline, links, form fields, tables (best effort); scanned pages with OCR | Yes | Yes (built-in renderer, or the external converter) |
| Markdown | Yes, including front matter | Yes | Yes |
| HTML | Yes (scripts and active content dropped) | Yes | Yes (sanitised) |
| CSV, TSV | Yes (delimiter detected, quoted fields) | Yes | CSV |
| JSON | Yes (a list of objects becomes rows) | Yes | Yes |
| XML, YAML | Yes (parsed into \`structure.data\`) | Yes (as text) | No |
| Rich Text \`.rtf\` | Yes (text only) | Yes | No |
| Plain text | Yes | Yes | Yes |
| Images (PNG, JPEG, GIF, WebP, BMP, TIFF) | With OCR on | With OCR on | No |
| Word / Excel / PowerPoint 97–2003 (\`.doc\`, \`.xls\`, \`.ppt\`) | No | To PDF only, with the [external converter](#office-to-pdf-with-an-external-converter) | No |

Save a 97–2003 file as \`.docx\`, \`.xlsx\` or \`.pptx\` to read it, or convert it to PDF with the external converter and read the PDF.

## File inputs

Every document field (Document, Original, Revised, PDF, PDFs to merge) takes an expression, and accepts:

- **A file object** — a file from a form's [Attachments field](/docs/tasks/forms#attachments) (\`{{form.<key>}}\`, or \`{{task_data.<key>}}\` after a User Task), or a file another step produced (HTTP Request, Download File, the Word / Excel / PowerPoint template steps, and the document actions themselves).
- **A list of files** — the first file is used. PDF Tools → Merge uses every file, in order. Inside a Loop over a list of files, \`{{item}}\` is one file.
- **A \`storage://bucket/key\` reference** or a link to the app's own storage.
- **An http(s) URL** — fetched through the egress guard (private, loopback and cloud metadata addresses are blocked unless \`ALLOW_PRIVATE_EGRESS=true\`; redirects are checked again at every hop), with the size limit applied while it downloads.
- **Inline content** — \`{ "base64": "…", "name": "orders.csv" }\` (also \`content_base64\`, or a \`data:\` URL).
- **Text** — where the field says so, a plain string that is not a URL (or \`{ "text": "…", "name": "notes.md" }\`) is the content itself. All fields except PDF Tools take text.

\`\`\`json title="An inline file"
{ "source": { "base64": "T3JkZXJJRCxDdXN0b21lcgoxMDI0OCxWSU5FVAo=", "name": "orders.csv" } }
\`\`\`

**Workspace only.** Stored files are read for the run's workspace only: a reference to another workspace's workflow file, a form attachment of another workspace, a private bucket without an owner or an unknown bucket is reported as "file not found", and nothing is fetched.

## Output files

Converted documents, redlines, reports, merged, split, stamped, rotated and filled PDFs and redacted copies are saved through the configured storage provider in the workspace's workflow-files folder, and returned as **file objects** — the same fields as a form attachment, so the next step can email, attach, loop over or read them:

\`\`\`json
{
  "_file": true,
  "id": "6d2f0c1e-4b7a-4f43-9a51-2a8c7e0d9b14",
  "name": "Supply Agreement.pdf",
  "size": 48213,
  "mime_type": "application/pdf",
  "content_type": "application/pdf",
  "url": "https://tasks.example.com/files/task-files/workflow-files/<workspace-id>/6d2f0c1e-4b7a-4f43-9a51-2a8c7e0d9b14.pdf",
  "path": "workflow-files/<workspace-id>/6d2f0c1e-4b7a-4f43-9a51-2a8c7e0d9b14.pdf",
  "storage_ref": "storage://task-files/workflow-files/<workspace-id>/6d2f0c1e-4b7a-4f43-9a51-2a8c7e0d9b14.pdf",
  "uploaded_by": null,
  "uploaded_at": "2026-10-28T09:14:03.512Z",
  "checksum_sha256": "4f0c5b8e1d2a9c7f3e6b0a1d8c4e2f9b7a5c3e1d0f8b6a4c2e0d9b7f5a3c1e8d"
}
\`\`\`

The \`url\` depends on the storage provider. Output file names come from **Output file name** (\`output_name\`, expressions allowed); path separators and control characters are removed and the right extension is added.

## Variables and the run history

Each action writes its full result to its **Output variable** (\`output_var\`) and a few shortcuts next to it, such as \`{{document_text}}\` and \`{{document_rows}}\` for Read Document. The data picker shows these with their fields. Convert Document and the single-file PDF Tools operations also set \`{{file}}\` and \`{{file_url}}\` (latest wins), as older file steps do.

The run history shows a compact summary of each step (counts, file names, a short text preview), never the whole document; the full result is in the variables. Warnings — a page without a text layer, a truncated output, characters a PDF font cannot show — appear as warning lines in the run log.

## Limits

Instance-wide limits come from the environment, so self-hosters can raise or lower them (see [Environment variables](/docs/self-hosting/environment)):

| Variable | Default | Range | What it limits |
|---|---|---|---|
| \`DOCUMENT_MAX_MB\` | 25 | 1–200 | Largest input file, checked while it downloads (a merge: 4 × this in total) |
| \`DOCUMENT_MAX_UNPACKED_MB\` | 250 | 10–2000 | Total unpacked size of a Word, Excel, PowerPoint or OpenDocument file |
| \`DOCUMENT_MAX_PDF_PAGES\` | 500 | 1–10000 | PDF pages read |
| \`DOCUMENT_TIMEOUT_SECONDS\` | 60 | 5–900 | One step's time for reading a document (Convert Document gets twice this) |
| \`DOCUMENT_OCR_MAX_PAGES\` | 20 | 1–500 | Pages recognised by OCR in one step |
| \`DOCUMENT_OCR_TIMEOUT_SECONDS\` | 120 | 5–900 | Time for OCR (Read Document uses the longer of this and \`DOCUMENT_TIMEOUT_SECONDS\` when OCR is on) |
| \`DOCUMENT_CONVERTER_TIMEOUT_SECONDS\` | 120 | 10–900 | One call to the external converter |

Fixed limits:

| Limit | Value |
|---|---|
| Parts in one ZIP container / one part unpacked | 5,000 / 100 MB |
| Spreadsheet cells read (all sheets) | 2,000,000 |
| Characters kept in \`text\`, \`markdown\` and \`html\` | 2,000,000 (lower it per step with \`max_chars\`) |
| Compare: characters per side / in characters mode / rows per sheet | 2,000,000 / 100,000 / 200,000 |
| Compare: changes listed | 2,000 (\`changes_truncated\` is then true) |
| PDF Tools: files in one merge / files from one split | 50 / 500 |
| Extract: rows written to a data table per run | 5,000 |
| Extract: patterns / matches per pattern / finder results per kind | 100 / 1,000 / 1,000 |

## Security

- **ZIP bombs.** Word, Excel, PowerPoint and OpenDocument files are ZIP containers. The reader checks the central directory first (number of parts, declared sizes) and inflates every part with a hard output cap, so a header that lies about the size cannot make it allocate more. Encrypted entries and ZIP64 archives are refused.
- **XML: no XXE.** The XML reader refuses any document with a DOCTYPE (where external entities and entity-expansion bombs live), expands only the five predefined entities and numeric references, and bounds depth and node count.
- **Sanitised HTML.** HTML output (\`html\` from Read Document, converted and redacted HTML) is rebuilt from the document's escaped text (Markdown through the Markdown renderer) and always passed through the allow-list sanitiser: no scripts, event handlers, iframes or \`javascript:\` links. Compare reports are built from escaped text only. HTML input is tokenised, not rendered, and scripts, styles and other active content are dropped with their contents.
- **PDF.** PDFs are read with pdf.js (through unpdf) with \`eval\` turned off, no system fonts and no font faces, so a crafted font cannot run code. Encrypted (password-protected) PDFs are refused with a clear message.
- **Regular expressions.** Patterns you write in Extract from Document, Redact Document and Inspect Document go through the ReDoS guard (nested quantifiers and over-long patterns are rejected). Extract and Redact run them line by line, at most 100,000 characters of each line; a regular-expression search in Inspect Document scans the first 2,000,000 characters.
- **Network.** URL inputs go through the egress guard; files never leave the instance unless you configure an [OCR provider](/docs/workflows/documents/ocr) in the cloud or the [external converter](#office-to-pdf-with-an-external-converter).
- **Storage.** Inputs are read and outputs written for the run's workspace only (see [File inputs](#file-inputs)).

## Summarise or classify with AI

There is no separate AI document node: Read Document turns the file into text, and a [Run Agent](/docs/workflows/nodes#node-run-agent) step does the rest. Put \`{{document.text}}\` (or \`{{document.markdown}}\`, which keeps headings, lists and tables) in the agent's prompt:

\`\`\`json title="Read Document, then Run Agent"
[
  { "type": "doc_read", "label": "Read contract",
    "config": { "source": "{{form.contract}}", "max_chars": 60000, "output_var": "document" } },
  { "type": "run_agent", "label": "Summarise",
    "config": {
      "agent_id": "<agent-id>",
      "agent_name": "Contract reviewer",
      "user_message": "Summarise this supply agreement in five bullet points, then classify it as low, medium or high risk.\\n\\n{{document.markdown}}",
      "output_variable": "review"
    } }
]
\`\`\`

\`max_chars\` keeps the prompt within the model's limits; \`{{document.metadata.words}}\` tells you how long the document was. Give the agent declared outputs (for example \`risk\` and \`summary\`) and branch on \`{{risk}}\`; see [AI agents](/docs/agents).

## Office to PDF with an external converter

The built-in PDF output keeps the text, headings, lists and tables of a Word, Excel, PowerPoint or OpenDocument file, but not its layout. For a faithful copy, or for 97–2003 files, run a Gotenberg-compatible service on your own network and set \`DOCUMENT_CONVERTER_URL\` (for example \`http://gotenberg:3000\`). Convert Document's **Automatic** engine then sends Office files to it; HTML and Markdown go to it when the engine is **External converter**. Only the file being converted is sent. Never point it at a public service. Setup: [Self-hosting](/docs/self-hosting#document-converter-optional).

## How-to guides

- [Import an Excel file into a data table](/docs/workflows/documents/how-to/excel-to-data-table)
- [Redline two contract versions and email the changes](/docs/workflows/documents/how-to/contract-redline)
- [Extract contact details and redact a copy](/docs/workflows/documents/how-to/extract-and-redact)
- [Capture invoice PDFs into a table](/docs/workflows/documents/how-to/invoice-pdf)
`,
  },
  {
    slug: 'workflows/documents/read-document',
    title: 'Read Document',
    description: 'Turn a Word, Excel, PowerPoint, PDF, OpenDocument, Markdown, HTML, CSV, JSON, XML, YAML or text file into text, Markdown, HTML, metadata, structure and rows.',
    body: `
**Read Document** (\`doc_read\`) reads one file and gives the rest of the workflow everything in it: plain text, Markdown, sanitised HTML, metadata (title, author, dates, page / slide / sheet counts, word and character counts, reading time), a structure specific to the format, and **rows** — the first sheet of a workbook or the first table of a document — ready for a Loop.

::image documents-data-picker | The Data panel listing Read Document's outputs: text, markdown, html, rows, metadata and structure | A later step picks Read Document's outputs from the Data panel — text, rows, metadata and structure.

## Inputs

**Document** (\`source\`): a file object (a form's Attachments field, a file from another step), a list of files (the first is read), a \`storage://\` reference, a URL, base64 content or text. See [File inputs](/docs/workflows/documents#file-inputs) and [Supported formats](/docs/workflows/documents#supported-formats).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Pages / slides | \`pages\` | all | PDF pages or PowerPoint slides: \`3\`, \`2-5\` or \`4-\` (to the end) |
| Sheet | \`sheet\` | all sheets | A sheet name or 1-based number. With none, every sheet is read and \`rows\` holds the first |
| Range | \`range\` | the used range | An A1 range such as \`B2:F40\` or \`Orders!B2:F40\` |
| Header row | \`header_row\` | \`auto\` | \`auto\` detects the header (title and blank rows above the table are skipped), \`first\` uses the first non-empty row, \`none\` names the columns \`column_1\`, \`column_2\`…, or a 1-based row number within the range |
| Max rows | \`max_rows\` | all | Data rows kept per sheet |
| CSV delimiter | \`delimiter\` | detected | For CSV and TSV files (not shown in the designer; set it in the JSON) |
| Tables | \`include_tables\` | \`true\` | Tables of Word, HTML and Markdown files, and tables found in text PDFs |
| List embedded images | \`include_images\` | \`false\` | Names and sizes of images in Word and PowerPoint files (\`structure.images\`) |
| Tracked changes (Word) | \`tracked_changes\` | \`accept\` | \`accept\` reads the document as if every change were accepted; \`show\` keeps deletions and insertions in the text (struck through and underlined in \`html\`) |
| Max characters | \`max_chars\` | 2,000,000 | Characters kept in \`text\`, \`markdown\` and \`html\` (at least 1,000); \`truncated\` is true when it cut |
| OCR | \`ocr\` | \`off\` | \`off\`, \`auto\` (pages without a text layer, and images) or \`force\` (every page). See [OCR](/docs/workflows/documents/ocr) |
| OCR languages | \`ocr_languages\` | \`eng\` | Tesseract language codes, \`eng+deu\` for several (up to 5) |
| Output variable | \`output_var\` | \`document\` | Where the result goes |

## Outputs

| Variable | Contents |
|---|---|
| \`{{document}}\` | The whole result (below) |
| \`{{document_text}}\` | Plain text |
| \`{{document_rows}}\` | Rows of the first (or chosen) sheet, or of the first table: a list of objects keyed by the header |
| \`{{document_count}}\` | Number of rows |
| \`{{document_metadata}}\` | The metadata, also as \`{{<node label>_document_metadata}}\` |

With another **Output variable**, \`document\` is replaced by that name (\`{{invoice}}\`, \`{{invoice_text}}\`, …).

Reading a Word contract between Northwind Traders and Exotic Liquids:

\`\`\`json title="{{document}}"
{
  "file": { "name": "supply-agreement.docx", "size": 12840, "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  "type": { "format": "docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "extension": "docx", "label": "Word document", "detected_by": "content", "is_text": false, "extension_mismatch": false },
  "text": "Supply Agreement\\nBetween Northwind Traders and Exotic Liquids. See the terms.\\nTerm\\n- The term is 24 months.\\n- Contact: orders@northwind.example, +64 9 555 0100\\nProduct\\tPrice\\nChai\\t18.00\\nChang\\t19.00",
  "markdown": "# Supply Agreement\\n\\nBetween **Northwind Traders** and *Exotic Liquids*. See [the terms](https://northwind.example/terms).\\n\\n## Term\\n\\n1. The term is 24 months.\\n1. Contact: orders@northwind.example, +64 9 555 0100\\n\\n| Product | Price |\\n| --- | --- |\\n| Chai | 18.00 |\\n| Chang | 19.00 |\\n",
  "html": "<h1>Supply Agreement</h1>\\n<p>Between <strong>Northwind Traders</strong> and <em>Exotic Liquids</em>. See <a href=\\"https://northwind.example/terms\\" rel=\\"noopener noreferrer\\" target=\\"_blank\\">the terms</a>.</p>\\n<h2>Term</h2>\\n…",
  "metadata": {
    "title": "Supply Agreement", "author": "Andrew Fuller", "subject": null, "keywords": null,
    "created": "2026-09-01T10:00:00Z", "modified": "2026-10-02T11:00:00Z", "last_modified_by": "Nancy Davolio",
    "pages": 2, "slides": null, "sheets": null, "format": "docx", "format_label": "Word document",
    "words": 30, "characters": 196, "characters_no_spaces": 166, "lines": 8, "paragraphs": 1, "sentences": 7, "reading_time_minutes": 1
  },
  "structure": {
    "headings": [{ "level": 1, "text": "Supply Agreement" }, { "level": 2, "text": "Term" }],
    "links": [{ "text": "the terms", "href": "https://northwind.example/terms" }],
    "tables": [{ "header": ["Product", "Price"], "rows": [["Chai", "18.00"], ["Chang", "19.00"]], "records": [{ "Product": "Chai", "Price": "18.00" }, { "Product": "Chang", "Price": "19.00" }] }],
    "comments": [{ "id": "0", "author": "Nancy Davolio", "date": "2026-10-01T09:00:00Z", "text": "Check the term length" }],
    "tracked_changes": { "insertions": 1, "deletions": 1, "items": [{ "type": "deletion", "author": "Nancy Davolio", "date": "2026-10-02T10:00:00Z", "text": "12" }, { "type": "insertion", "author": "Nancy Davolio", "date": "2026-10-02T10:00:00Z", "text": "24" }] }
  },
  "rows": [{ "Product": "Chai", "Price": "18.00" }, { "Product": "Chang", "Price": "19.00" }],
  "truncated": false,
  "warnings": []
}
\`\`\`

What \`structure\` holds depends on the format:

| Format | \`structure\` |
|---|---|
| Word | \`headings\`, \`links\`, \`tables\`, \`comments\`, \`tracked_changes\`, \`images\` (when listed) |
| Excel, OpenDocument spreadsheet, CSV | \`sheets\` (each with \`name\`, \`range\`, \`row_count\`, \`column_count\`, \`header_row\`, \`headers\`, \`rows\`, \`values\`), \`sheet_names\`; Excel also \`defined_names\` |
| PowerPoint | \`slides\` (\`number\`, \`title\`, \`text\`, \`notes\`), \`images\` (when listed) |
| PDF | \`pages\` (\`number\`, \`text\`, \`characters\`, \`has_text_layer\`, \`image_count\`, \`width\`, \`height\`, \`ocr\`), \`outline\` (bookmarks), \`links\`, \`form_fields\`, \`tables\` |
| Markdown | \`front_matter\`, \`headings\`, \`links\`, \`tables\` |
| JSON, YAML, XML | \`data\` (the parsed value; a JSON list of objects is also \`rows\`) |

Spreadsheet values are typed: numbers stay numbers, dates become \`YYYY-MM-DD\`, formulas give their computed value. PDF table cells are text.

The run history shows a summary, not the text:

\`\`\`json
{ "variable": "document", "file": "supply-agreement.docx", "format": "docx", "pages": 2, "words": 30, "characters": 196, "rows": 2, "tables": 1, "truncated": false, "text_preview": "Supply Agreement Between Northwind Traders and Exotic Liquids. See the terms. Term - The term is 24 months. - Contact: orders@northwind.example, +64 9 555 0100 Product Price Chai 18.00 Chang 19.00" }
\`\`\`

## On the canvas

The node shows what it reads into, with the OCR mode, sheet and pages when set: \`→ document\`, \`sheet Orders → orders\`, \`OCR auto → invoice\`.

## Limits

- The file: \`DOCUMENT_MAX_MB\` (25 MB); unpacked Office files \`DOCUMENT_MAX_UNPACKED_MB\` (250 MB); 2,000,000 spreadsheet cells; \`DOCUMENT_MAX_PDF_PAGES\` (500) pages — a warning says when only part was read.
- Time: \`DOCUMENT_TIMEOUT_SECONDS\` (60), or \`DOCUMENT_OCR_TIMEOUT_SECONDS\` (120) when it is longer and OCR is on.
- Output: 2,000,000 characters of text, Markdown and HTML each (lower with **Max characters**).
- Word 97–2003 (\`.doc\`), Excel 97–2003 (\`.xls\`) and PowerPoint 97–2003 (\`.ppt\`) files cannot be read: save them in the current format, or convert them to PDF with the [external converter](/docs/workflows/documents#office-to-pdf-with-an-external-converter) first.
- PDF tables are found from the positions of text on the page — reliable for simple grids, not for merged cells or tables without aligned columns. A PDF page without a text layer is listed with \`has_text_layer: false\` and a warning until you turn OCR on.

## Security notes

The file is read for this workspace only, Office files are checked for ZIP bombs, XML parts with a DOCTYPE are refused, \`html\` is sanitised, and PDFs are read with \`eval\` off. See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json title="Read the Orders sheet of an uploaded workbook"
{
  "type": "doc_read",
  "label": "Read orders",
  "config": {
    "source": "{{form.workbook}}",
    "sheet": "Orders",
    "header_row": "auto",
    "max_rows": 5000,
    "output_var": "orders"
  }
}
\`\`\`

Canvas: \`sheet Orders → orders\`. Then loop over \`{{orders_rows}}\`; inside the loop \`{{item.OrderID}}\`, \`{{item.Customer}}\`… are the current row.

## Works well with

- [Loop For Each](/docs/workflows/nodes#node-loop) over \`{{document_rows}}\`, and a [Data](/docs/workflows/nodes#node-update-data-table) step to save each row — see [Import an Excel file into a data table](/docs/workflows/documents/how-to/excel-to-data-table).
- [Run Agent](/docs/workflows/documents#summarise-or-classify-with-ai) with \`{{document.text}}\` to summarise or classify.
- [Extract from Document](/docs/workflows/documents/extract) for named values and tables; [Compare Documents](/docs/workflows/documents/compare-documents) for two versions.
- A [Condition](/docs/workflows/nodes#node-condition) on \`{{document.metadata.pages}}\`, \`{{document_count}}\` or \`{{document.structure.tracked_changes.insertions}}\`.
`,
  },
  {
    slug: 'workflows/documents/compare-documents',
    title: 'Compare Documents',
    description: 'Diff two documents, spreadsheets, row lists or JSON values — changes, statistics, similarity, a side-by-side HTML report and a Word or PDF redline.',
    body: `
**Compare Documents** (\`doc_compare\`) compares an original and a revised version and reports what changed: a list of changes, statistics, a similarity score, a unified diff, a side-by-side HTML report you can use as an email body, and optionally a **redline** (Word or PDF) and a report file.

It compares four kinds of input:

- **Documents and text** (Word, PDF, PowerPoint, OpenDocument, HTML, Markdown, RTF, plain text) — by lines, words, characters or sentences.
- **Spreadsheets** (Excel, OpenDocument, CSV, or two lists of objects such as \`{{document_rows}}\` or a Data step's rows) — row by row, cell by cell, with rows matched on key columns.
- **JSON** (JSON or YAML files, or two objects) — a deep diff with the path of every change.

::image documents-compare | Compare Documents settings: original and revised contract, compare by words, Word redline with tracked changes | Comparing two contract versions word by word, with a Word redline in tracked changes.

## Inputs

**Original** (\`original\`) and **Revised** (\`revised\`): each a file (a file object, a list → its first file, a \`storage://\` reference, a URL or base64 content), text, a list of objects (rows) or a JSON object. See [File inputs](/docs/workflows/documents#file-inputs).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Compare | \`mode\` | \`auto\` | \`auto\`, \`lines\`, \`words\`, \`characters\`, \`sentences\`, \`sheet\` (spreadsheet rows, cell by cell) or \`json\` (deep, with paths). \`auto\` picks \`sheet\` when both sides are spreadsheets, CSV or row lists, \`json\` when both are JSON or YAML, \`words\` when either side is a document (Word, PDF, PowerPoint, ODT, HTML, Markdown, RTF), otherwise \`lines\` |
| Key columns | \`key_columns\` | row order | Spreadsheets: comma-separated columns that identify a row (\`ProductID\`, or \`CustomerID, OrderDate\`). Without keys, rows are compared by position |
| Only these columns | \`compare_columns\` | all | Spreadsheets: compare just these columns |
| Ignore columns | \`ignore_columns\` | none | Spreadsheets: columns to leave out, such as \`updated_at\` |
| Sheet | \`sheet\` | first sheet | Spreadsheets: a sheet name or number, used for both files |
| Number tolerance | \`numeric_tolerance\` | \`0\` | Spreadsheets: numbers that differ by no more than this are equal |
| Match list items by | \`array_key\` | position | JSON: a field that identifies list items (\`id\`, \`sku\`), so a reordered list is not a change |
| Ignore whitespace | \`ignore_whitespace\` | \`false\` | Runs of spaces and blank lines don't count |
| Ignore case | \`ignore_case\` | \`false\` | |
| Ignore punctuation | \`ignore_punctuation\` | \`false\` | Punctuation and symbols are removed before comparing |
| Context lines | \`context_lines\` | \`3\` | Unchanged lines around each change in the unified diff and the report (not shown in the designer) |
| Redline | \`redline\` | \`none\` | Text modes only: \`none\`, \`docx\` (Word), \`pdf\` or \`both\` |
| Redline style | \`redline_style\` | \`formatting\` | \`formatting\`: inserted text underlined in green, deleted text struck through in red. \`tracked\`: real Word tracked changes (author "UserTasks compare") that can be accepted or rejected in Word. PDF redlines always use colours |
| Report file | \`report\` | \`none\` | \`html\` (the side-by-side report as a file) or \`pdf\` (a summary of the changes) |
| Output file name | \`output_name\` | \`<revised>-comparison\` | Base name of the files: \`<name>.html\` / \`.pdf\` for the report, \`<name>-redline.docx\` / \`.pdf\` for the redline |
| Output variable | \`output_var\` | \`comparison\` | |

## Outputs

| Variable | Contents |
|---|---|
| \`{{comparison}}\` | The whole result (below) |
| \`{{comparison_identical}}\` | \`true\` when nothing changed (after the ignore options) |
| \`{{comparison_similarity}}\` | 0–100 |
| \`{{comparison_html}}\` | The side-by-side HTML report (inline styles, escaped text: ready for an email body) |
| \`{{comparison_redline_docx}}\`, \`{{comparison_redline_pdf}}\`, \`{{comparison_report}}\` | The files, as [file objects](/docs/workflows/documents#output-files), when you asked for them |

No redline is made when the two versions are identical.

::image documents-compare-report | Side-by-side comparison report with deleted words struck through in red and inserted words underlined in green | The HTML report ({{comparison_html}}) as it arrives in an email: changed lines side by side, word changes highlighted.

### Documents and text

Two versions of a supply agreement where the term changed from 24 to 36 months, compared by words with a Word redline and an HTML report:

\`\`\`json title="{{comparison}}"
{
  "mode": "words",
  "identical": false,
  "similarity": 97,
  "stats": { "added": 0, "removed": 0, "changed": 1, "unchanged": 2, "added_lines": 1, "removed_lines": 1, "added_words": 1, "removed_words": 1, "added_characters": 2, "removed_characters": 2 },
  "changes": [{ "type": "changed", "old_text": "24", "new_text": "36" }],
  "changes_truncated": false,
  "unified": "===================================================================\\n--- supply-agreement-v1.docx\\n+++ supply-agreement-v2.docx\\n@@ -1,7 +1,7 @@\\n Supply Agreement\\n Between Northwind Traders and Exotic Liquids. See the terms.\\n Term\\n-- The term is 24 months.\\n+- The term is 36 months.\\n …",
  "html": "<div style=\\"…\\"><p style=\\"…\\"><strong>supply-agreement-v1.docx → supply-agreement-v2.docx</strong><br>1 changed · 0 added · 0 removed · 97% similar</p><table …>…</table></div>",
  "inline_html": "Supply Agreement<br>…- The term is <del style=\\"…\\">24</del><ins style=\\"…\\">36</ins> months.<br>…",
  "original": { "name": "supply-agreement-v1.docx" },
  "revised": { "name": "supply-agreement-v2.docx" },
  "redline_docx": { "_file": true, "name": "supply-agreement-v2-comparison-redline.docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "size": 2311, "url": "…", "storage_ref": "storage://task-files/workflow-files/…", "checksum_sha256": "…" },
  "report": { "_file": true, "name": "supply-agreement-v2-comparison.html", "mime_type": "text/html", "size": 4180, "url": "…", "storage_ref": "storage://task-files/workflow-files/…", "checksum_sha256": "…" }
}
\`\`\`

- \`changes\` lists each change: \`changed\` (with \`old_text\` and \`new_text\`), \`added\` (\`new_text\`) or \`removed\` (\`old_text\`); in lines mode also \`old_line\` / \`new_line\`. At most 2,000 are listed (\`changes_truncated\`).
- \`similarity\` is the share of words both versions have in common (characters mode: characters).
- \`html\` is a side-by-side, line-aligned table with changed words highlighted and long unchanged stretches collapsed; \`inline_html\` is the whole text with \`<del>\` / \`<ins>\` marks.
- Documents are compared on their text (tracked changes read as accepted). The redline keeps unchanged paragraphs, word-diffs changed ones, marks inserted and deleted paragraphs, and shows a changed table cell with its previous value (\`19.50 [was: 19.00]\`).

### Spreadsheets and row lists

Two product lists keyed on \`ProductID\`:

\`\`\`json title="{{comparison}} in sheet mode"
{
  "mode": "sheet",
  "identical": false,
  "similarity": 25,
  "key_columns": ["ProductID"],
  "stats": { "rows_old": 3, "rows_new": 3, "added": 1, "removed": 1, "changed": 1, "unchanged": 1, "cells_changed": 2, "columns_added": [], "columns_removed": [] },
  "changes": [
    { "type": "changed", "key": { "ProductID": 2 }, "old_row": 2, "new_row": 2,
      "columns": [{ "column": "UnitPrice", "old": 19, "new": 19.5 }, { "column": "UnitsInStock", "old": 17, "new": 12 }] },
    { "type": "removed", "key": { "ProductID": 3 }, "old_row": 3,
      "old": { "ProductID": 3, "ProductName": "Aniseed Syrup", "UnitPrice": 10, "UnitsInStock": 13 } },
    { "type": "added", "key": { "ProductID": 77 }, "new_row": 3,
      "new": { "ProductID": 77, "ProductName": "Original Frankfurter grüne Soße", "UnitPrice": 13, "UnitsInStock": 32 } }
  ],
  "changes_truncated": false,
  "warnings": [],
  "html": "<div …>…</div>"
}
\`\`\`

Without key columns, \`key\` is the row number. A key that appears twice is matched in order, with a warning. \`similarity\` is the share of rows that are unchanged.

### JSON

\`\`\`json title="{{comparison}} in json mode, array_key: sku"
{
  "mode": "json",
  "identical": false,
  "similarity": 66.7,
  "stats": { "added": 0, "removed": 0, "changed": 2, "unchanged": 4 },
  "changes": [
    { "type": "changed", "path": "status", "old": "open", "new": "shipped" },
    { "type": "changed", "path": "lines[sku=\\"CHAI\\"].qty", "old": 10, "new": 12 }
  ],
  "changes_truncated": false,
  "html": "<div …>…</div>"
}
\`\`\`

The run history shows the mode, the result, the statistics, the number of changes and the file names:

\`\`\`json
{ "variable": "comparison", "mode": "words", "identical": false, "similarity": 97, "stats": { "added": 0, "removed": 0, "changed": 1, "unchanged": 2, "…": "…" }, "changes": 1, "files": { "redline_docx": "supply-agreement-v2-comparison-redline.docx", "report": "supply-agreement-v2-comparison.html" } }
\`\`\`

## On the canvas

The mode, the files it makes and the output variable: \`words diff + redline docx, html report → contract_diff\`, or \`auto diff → comparison\`.

## Limits

- Each side: 2,000,000 characters (characters mode: 100,000 — use words or lines for longer texts); spreadsheets 200,000 rows per side. Each file is also subject to \`DOCUMENT_MAX_MB\` and the other [read limits](/docs/workflows/documents#limits).
- A text diff gives up after 15 seconds of work with "too different to compare in time — try lines mode".
- At most 2,000 changes are listed; the HTML report stops at 5,000 lines and the PDF report at 500 changes.
- The redline is built from the documents' text and structure (headings, paragraphs, lists, tables), not their layout. PDF redlines and reports use the standard PDF fonts, so characters outside Latin (Windows-1252) are shown as "?".

## Security notes

The reports are built from escaped text only; nothing from the documents is inserted as HTML. Inputs are read for this workspace only. See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json
{
  "type": "doc_compare",
  "label": "Compare contract versions",
  "config": {
    "original": "{{form.current_contract}}",
    "revised": "{{form.proposed_contract}}",
    "mode": "words",
    "ignore_whitespace": true,
    "redline": "docx",
    "redline_style": "tracked",
    "report": "html",
    "output_name": "Exotic Liquids supply agreement",
    "output_var": "contract_diff"
  }
}
\`\`\`

Canvas: \`words diff + redline docx, html report → contract_diff\`.

## Works well with

- [Send Email](/docs/workflows/nodes#node-send-email) with \`{{contract_diff_html}}\` as the body and the redline as an attachment — see [Redline two contract versions](/docs/workflows/documents/how-to/contract-redline).
- A [Condition](/docs/workflows/nodes#node-condition) on \`{{comparison_identical}}\` (is true) to stop when nothing changed, or on \`{{comparison_similarity}}\` (less than 80) to ask for a full review.
- [Read Document](/docs/workflows/documents/read-document) (\`tracked_changes: show\`) to see who changed what inside one Word file.
- A [Loop](/docs/workflows/nodes#node-loop) over \`{{comparison.changes}}\` in sheet mode to update a [data table](/docs/data-tables) row by row.
`,
  },
  {
    slug: 'workflows/documents/convert-document',
    title: 'Convert Document',
    description: 'Convert a file to PDF, Word, HTML, Markdown, plain text, CSV, Excel or JSON, with the built-in converters or an external Gotenberg-compatible service.',
    body: `
**Convert Document** (\`doc_convert\`) turns a file into another format and saves the result as a new file. Documents (Word, PowerPoint, OpenDocument, PDF, HTML, Markdown, RTF, text) convert to PDF, Word, HTML, Markdown and text; spreadsheets (Excel, OpenDocument, CSV, a JSON list of objects) convert to CSV, Excel and JSON. The built-in converters are pure JavaScript; for a faithful Office → PDF copy, configure the [external converter](/docs/workflows/documents#office-to-pdf-with-an-external-converter).

## Inputs

**Document** (\`source\`): a file object, a list (the first file), a \`storage://\` reference, a URL, base64 content or text (converted as plain text). See [File inputs](/docs/workflows/documents#file-inputs).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Convert to | \`target\` | \`pdf\` | \`pdf\`, \`docx\`, \`html\`, \`markdown\`, \`text\`, \`csv\`, \`xlsx\` or \`json\` |
| Engine | \`engine\` | \`auto\` | PDF only. \`auto\`: the external converter for Office files (Word, Excel, PowerPoint, OpenDocument, RTF, and the 97–2003 formats) when \`DOCUMENT_CONVERTER_URL\` is set, otherwise the built-in renderer. \`builtin\`: always built in. \`external\`: always the external converter (also for HTML, Markdown, text and CSV) |
| Page size | \`page_size\` | \`A4\` | Built-in PDF: \`A4\` or \`Letter\` |
| Title | \`title\` | the document's title, else the file name | The heading of HTML output and the title of PDF and Word output (not shown in the designer) |
| Sheet | \`sheet\` | first sheet | CSV, Excel and JSON targets: which sheet to read |
| Range | \`range\` | used range | Spreadsheet range, as in Read Document (not shown in the designer) |
| Delimiter | \`delimiter\` | \`,\` | CSV output: \`,\`, \`;\`, tab or \`\\|\` |
| Pages | \`pages\` | all | PDF and PowerPoint inputs: the pages or slides to convert (not shown in the designer) |
| OCR | \`ocr\`, \`ocr_languages\` | \`off\`, \`eng\` | Scanned PDFs and images, as in Read Document (not shown in the designer) |
| Output file name | \`output_name\` | the source's name | The extension is added |
| Output variable | \`output_var\` | \`converted_file\` | |

### What converts to what

| Target | From | Notes |
|---|---|---|
| PDF | Every readable format | Built in: text, headings, lists, tables, links and code, in standard fonts. A PDF input is returned unchanged |
| Word (\`docx\`) | Every readable format | Headings, paragraphs, bold / italic, lists, tables and links |
| HTML | Every readable format | A complete page with the title as its heading; the content is sanitised |
| Markdown | Every readable format | A Markdown input is returned unchanged |
| Text | Every readable format | The plain text Read Document gives |
| CSV | Excel, ODS, CSV, TSV, a JSON list of objects, or the first table of a document | The first sheet unless you choose one (a warning says when there were more) |
| Excel (\`xlsx\`) | Spreadsheets (every sheet), a JSON list of objects, or every table of a document (one sheet per table) | |
| JSON | Spreadsheets (the rows; several sheets → an object keyed by sheet name), a JSON list of objects, or any document (\`{ metadata, text, structure }\`) | |

A document without a table cannot become CSV or Excel ("has no table to convert"), and the 97–2003 formats convert only to PDF, only with the external converter.

## Outputs

\`{{converted_file}}\` is the new file as a [file object](/docs/workflows/documents#output-files); \`{{file}}\` and \`{{file_url}}\` are set too.

\`\`\`json title="{{converted_file}}"
{
  "_file": true,
  "id": "0b7e4c2a-91d3-4f0e-8a65-3d2c1b9e7f40",
  "name": "Supply Agreement.pdf",
  "size": 5214,
  "mime_type": "application/pdf",
  "content_type": "application/pdf",
  "url": "https://tasks.example.com/files/task-files/workflow-files/<workspace-id>/0b7e4c2a-91d3-4f0e-8a65-3d2c1b9e7f40.pdf",
  "path": "workflow-files/<workspace-id>/0b7e4c2a-91d3-4f0e-8a65-3d2c1b9e7f40.pdf",
  "storage_ref": "storage://task-files/workflow-files/<workspace-id>/0b7e4c2a-91d3-4f0e-8a65-3d2c1b9e7f40.pdf",
  "uploaded_by": null,
  "uploaded_at": "2026-10-28T09:20:41.106Z",
  "checksum_sha256": "a3c91f0e7b2d4c6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d1e3f5a7b9c0d2e"
}
\`\`\`

The run history shows the conversion and the engine used:

\`\`\`json
{ "variable": "converted_file", "from": "docx", "to": "pdf", "engine": "builtin", "file": "Supply Agreement.pdf", "size": 5214, "warnings": ["Built-in PDF output keeps the text, headings, lists and tables but not the original layout; configure DOCUMENT_CONVERTER_URL for a faithful copy"] }
\`\`\`

## On the canvas

The target format, and \`(external)\` when the engine is forced: \`→ PDF\`, \`→ XLSX\`, \`→ PDF (external)\`.

## Limits

- **Built-in PDF output uses the standard PDF fonts**, which cover Latin text (Windows-1252) only. Other characters — Greek, Cyrillic, CJK, most symbols and emoji — are replaced with "?" and the run logs a warning. Use the external converter for other scripts.
- **Built-in Office → PDF keeps the content, not the layout:** text, headings, lists and tables come across; fonts, columns, headers and footers, images and page layout do not.
- Reading the source follows the [read limits](/docs/workflows/documents#limits); a conversion has twice \`DOCUMENT_TIMEOUT_SECONDS\`, and the external converter \`DOCUMENT_CONVERTER_TIMEOUT_SECONDS\` (120) per call.

## Security notes

HTML output is sanitised. The external converter receives only the file being converted, at the address an administrator configured (\`DOCUMENT_CONVERTER_URL\`, with an optional \`DOCUMENT_CONVERTER_TOKEN\`); its answer must be a PDF. Run it on your own network, never a public service.

## Example

\`\`\`json
{
  "type": "doc_convert",
  "label": "Contract to PDF",
  "config": {
    "source": "{{contract}}",
    "target": "pdf",
    "page_size": "A4",
    "output_name": "Supply agreement {{contract_number}}",
    "output_var": "contract_pdf"
  }
}
\`\`\`

Canvas: \`→ PDF\`.

## Works well with

- [Word Document](/docs/workflows/nodes#node-doc-word) (fill a template) → Convert Document (PDF) → [PDF Tools](/docs/workflows/documents/pdf-tools) (stamp "APPROVED") → [Send Email](/docs/workflows/nodes#node-send-email).
- [Read Document](/docs/workflows/documents/read-document) when you need the rows or text rather than a file.
- Convert a workbook to CSV for an [HTTP Request](/docs/workflows/nodes#node-http-request) to a system that only takes CSV.
`,
  },
  {
    slug: 'workflows/documents/pdf-tools',
    title: 'PDF Tools',
    description: 'Merge, split, extract pages, count pages, watermark or stamp text, rotate pages, and fill or read PDF form fields.',
    body: `
**PDF Tools** (\`doc_pdf\`) changes PDFs: one step runs one **operation**. Every operation except Count pages and Read form fields saves a new PDF and leaves the original untouched.

| Operation | \`operation\` | Result |
|---|---|---|
| Merge PDFs | \`merge\` | One PDF from several, in order |
| Split into files | \`split\` | A list of PDFs, by ranges or every N pages |
| Extract pages | \`extract_pages\` | A PDF with the chosen pages, in the order given |
| Count pages | \`page_count\` | A number |
| Watermark / stamp text | \`watermark\` | A PDF with text across or in a corner of each page |
| Rotate pages | \`rotate\` | A PDF with pages turned 90°, 180° or 270° |
| Fill form fields | \`fill_form\` | A PDF with its AcroForm fields filled, optionally flattened |
| Read form fields | \`read_form\` | The form's fields and values |

## Inputs

- **PDF** (\`source\`) for every operation except merge: a file object, a list (the first file), a \`storage://\` reference, a URL or base64 content. It must be a PDF ("not a PDF — use Convert document first"); text is not accepted.
- **PDFs to merge** (\`sources\`): a list of files — every file of an Attachments field (\`{{form.attachments}}\`), or a JSON list of file variables (\`[{{contract_pdf}}, {{terms_pdf}}]\`).

Page ranges (\`pages\`, \`ranges\`) are 1-based: \`1-3, 5, 8-\` (8 to the end), \`last\`, \`3-last\`; a reversed range (\`5-1\`) gives the pages backwards.

## Options

| Setting | Key | Default | Used by |
|---|---|---|---|
| Operation | \`operation\` | \`merge\` | |
| Pages | \`pages\` | all (extract: required) | \`extract_pages\`, \`watermark\`, \`rotate\` |
| Ranges | \`ranges\` | — | \`split\`: groups separated by \`;\`, such as \`1-3; 4-6; 7-\` |
| Every N pages | \`every_n\` | \`1\` | \`split\`, when there are no ranges |
| Text | \`text\` | — (required) | \`watermark\`: up to 500 characters, several lines allowed, expressions such as \`APPROVED {{=TODAY()}}\` |
| Position | \`position\` | \`center\` | \`watermark\`: \`center\` (diagonal across the page), \`top\`, \`bottom\`, \`top-left\`, \`top-right\`, \`bottom-left\`, \`bottom-right\` |
| Size | \`font_size\` | fitted to the page (centre), 12 (corners) | \`watermark\` |
| Opacity | \`opacity\` | 0.25 (centre), 0.8 (elsewhere) | \`watermark\`: 0.02–1 |
| Angle | \`angle\` | the page diagonal (centre), 0 (elsewhere) | \`watermark\`, in degrees (not shown in the designer) |
| Colour | \`color\` | \`#999999\` | \`watermark\`: a hex colour |
| Degrees | \`degrees\` | \`90\` | \`rotate\`: added to each page's current rotation (rounded to 90°) |
| Fields | \`fields\` | — | \`fill_form\`: a list of \`{ "name", "value" }\` pairs (values are expressions) |
| Or all values at once | \`field_values\` | — | \`fill_form\`: an object of field name → value (\`{{applicant}}\`); \`fields\` win where both name a field |
| Flatten | \`flatten\` | \`false\` | \`fill_form\`: make the filled form read-only |
| Fail when a field does not exist | \`strict\` | \`false\` | \`fill_form\`: otherwise unknown names are skipped with a warning |
| Output file name | \`output_name\` | see below | Every operation that writes a PDF |
| Output variable | \`output_var\` | \`pdf_file\`, \`pdf_files\` (split), \`page_count\`, \`form\` (read form) | |

Default file names: \`merged.pdf\`, \`<source>-pages.pdf\`, \`<source>-part1.pdf\`, \`-part2\`… (split), \`<source>-stamped.pdf\`, \`<source>-rotated.pdf\`, \`<source>-filled.pdf\`. With an output file name, split names its parts \`<name>-part1.pdf\`….

Form values: text fields take text, checkboxes \`true\` / \`false\` (also \`yes\`, \`on\`, \`1\`, \`x\`), radio groups and dropdowns one of their options, list boxes one option or a list. Use **Read form fields** first to see the names.

## Outputs

| Operation | Variables |
|---|---|
| merge, extract_pages, watermark, rotate, fill_form | \`{{pdf_file}}\`: the new PDF as a [file object](/docs/workflows/documents#output-files); also \`{{file}}\` and \`{{file_url}}\` |
| split | \`{{pdf_files}}\`: a list of file objects; \`{{pdf_files_count}}\` |
| page_count | \`{{page_count}}\`: a number |
| read_form | \`{{form}}\`: \`{ fields, values }\`; \`{{form_values}}\`: field name → value |

\`\`\`json title="{{form}} from Read form fields"
{
  "fields": [
    { "name": "approver", "type": "text", "value": "Nancy Davolio", "read_only": false, "required": false },
    { "name": "approved", "type": "checkbox", "value": true, "read_only": false, "required": false },
    { "name": "region", "type": "dropdown", "value": "Oceania", "options": ["Europe", "North America", "Oceania"], "read_only": false, "required": false }
  ],
  "values": { "approver": "Nancy Davolio", "approved": true, "region": "Oceania" }
}
\`\`\`

Field types: \`text\`, \`checkbox\`, \`radio\`, \`dropdown\`, \`list\`, \`signature\`, \`button\`.

The run history for a watermark:

\`\`\`json
{ "variable": "stamped", "operation": "watermark", "file": "Supply agreement 1042-stamped.pdf", "size": 9132, "pages_stamped": 3 }
\`\`\`

Merge adds \`pages\` and \`files\`, split \`files\` and \`ranges\`, fill \`filled\` and \`missing\`, read form \`fields\`, count \`pages\`.

## On the canvas

The operation and its main setting: \`Merge PDFs\`, \`Extract pages 1-3\`, \`Split 1-3; 4-6\`, \`Watermark "APPROVED"\` (the first 20 characters of the text as written), \`Fill form\`.

## Limits

- Merge: at most 50 files, together at most 4 × \`DOCUMENT_MAX_MB\` (100 MB by default). Split: at most 500 files.
- Encrypted (password-protected) PDFs cannot be changed.
- Watermark text uses Helvetica Bold, a standard PDF font: characters outside Latin (Windows-1252) are replaced with "?" and logged as a warning.
- Fill form works on standard (AcroForm) fields. Flattening can fail on unusual forms; that is logged as a warning and the form is left fillable.

## Security notes

PDFs are processed with \`@cantoo/pdf-lib\` in the app's process; nothing is sent elsewhere. Inputs are read for this workspace only. See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json title="Stamp an approved contract"
{
  "type": "doc_pdf",
  "label": "Stamp approved",
  "config": {
    "operation": "watermark",
    "source": "{{contract_pdf}}",
    "text": "APPROVED",
    "position": "top-right",
    "color": "#1B7F3B",
    "output_var": "stamped"
  }
}
\`\`\`

Canvas: \`Watermark "APPROVED"\`. For a dated stamp, use \`"text": "APPROVED {{=TODAY()}}"\`.

\`\`\`json title="Fill an application form and flatten it"
{
  "type": "doc_pdf",
  "label": "Fill credit application",
  "config": {
    "operation": "fill_form",
    "source": "{{credit_form_template}}",
    "fields": [
      { "name": "company", "value": "{{customer.company_name}}" },
      { "name": "contact", "value": "{{customer.contact_name}}" },
      { "name": "approved", "value": "{{approved}}" }
    ],
    "flatten": true,
    "output_name": "Credit application {{customer.customer_id}}"
  }
}
\`\`\`

Canvas: \`Fill form\`.

## Works well with

- [Convert Document](/docs/workflows/documents/convert-document) to make a PDF from Word, HTML or Markdown first.
- [Loop For Each](/docs/workflows/nodes#node-loop) over \`{{pdf_files}}\` after a split, to send each part on.
- [Read Document](/docs/workflows/documents/read-document) for the text of the pages; its \`structure.form_fields\` also lists form values.
- [Send Email](/docs/workflows/nodes#node-send-email) with \`{{pdf_file}}\` as an attachment.
`,
  },
  {
    slug: 'workflows/documents/extract',
    title: 'Extract from Document',
    description: 'Pull tables, named values (regular expressions), emails, URLs, phone numbers, dates, amounts and percentages out of a document, and optionally insert the rows into a data table.',
    body: `
**Extract from Document** (\`doc_extract\`) reads a file and picks out structured data:

- **Tables** — the tables of a Word, HTML, Markdown or text PDF file, or the sheets of a workbook or CSV — and their **rows**.
- **Key values** — named regular expressions, such as \`invoice_number\` or \`po_number\`.
- **Finders** — every email address, URL, phone number, date, money amount and percentage, normalised (ISO dates, numbers and currency codes).
- Optionally, it **inserts the rows into a [data table](/docs/data-tables)** in the same step.

## Inputs

**Document** (\`source\`): a file object, a list (the first file), a \`storage://\` reference, a URL, base64 content or text. See [File inputs](/docs/workflows/documents#file-inputs).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Tables | \`extract_tables\` | \`true\` | Include \`tables\` in the result (rows are found either way) |
| Rows from | \`table_index\` | first table | Which table \`rows\` comes from: empty for the first, a 1-based number (\`2\`), or \`all\` for the rows of every table one after the other |
| Key values | \`patterns\` | none | A list of \`{ "name", "pattern" }\`, optionally \`"all": true\` (every match, as a list), \`"group"\` (a capture group number or name) and \`"flags"\` (\`i\`, \`m\`, \`s\`, \`u\`) |
| Find | \`finders\` | none | Any of \`emails\`, \`urls\`, \`phones\`, \`dates\`, \`amounts\`, \`percentages\` |
| Date order | \`date_order\` | \`DMY\` | How \`03/04/2026\` is read: \`DMY\` (3 April) or \`MDY\` (4 March). Unambiguous dates (\`31/12/2026\`, \`2026-12-31\`, \`1 March 2026\`, \`March 1, 2026\`) are read either way |
| Insert the rows into a data table | \`to_table\` | \`false\` | Write \`rows\` into a data table |
| Data table | \`table_id\` | — (required with \`to_table\`) | The table to insert into |
| Column mapping | \`column_mapping\` | automatic | A list of \`{ "column": "<table column key>", "field": "<source header>" }\`. Without one, source headers that match a column's key or label (ignoring case, spaces and punctuation) are used |
| Sheet | \`sheet\` | all sheets | Spreadsheets: a sheet name or number |
| Pages | \`pages\` | all | PDF pages |
| OCR | \`ocr\`, \`ocr_languages\` | \`off\`, \`eng\` | Scanned PDFs and images (see [OCR](/docs/workflows/documents/ocr)) |
| Output variable | \`output_var\` | \`extracted\` | |

**Patterns** return the first capture group, or the whole match when there is none. They match **within one line** (a match never spans a line break) and are case-sensitive unless you add \`"flags": "i"\` (flags and groups are set in the JSON; the designer edits the name, the pattern and **Every match**). Each pattern goes through the ReDoS guard: one that could take exponential time (nested quantifiers such as \`(a+)+\`) is rejected, logged as a warning, and its value is \`null\`.

## Outputs

| Variable | Contents |
|---|---|
| \`{{extracted}}\` | The whole result (below) |
| \`{{extracted_rows}}\` | The rows: a list of objects keyed by the header |
| \`{{extracted_count}}\` | Number of rows |
| \`{{extracted_<name>}}\` | One per pattern, such as \`{{extracted_invoice_number}}\` |

From an invoice PDF from Exotic Liquids, with a pattern for the invoice number and the email, date and amount finders:

\`\`\`json title="{{extracted}}"
{
  "file": "INV-2026-0042.pdf",
  "tables": [
    { "header": ["Product", "Qty", "Amount"], "rows": [["Chai", "10", "$180.00"], ["Chang", "5", "$95.00"]],
      "records": [{ "Product": "Chai", "Qty": "10", "Amount": "$180.00" }, { "Product": "Chang", "Qty": "5", "Amount": "$95.00" }] }
  ],
  "rows": [{ "Product": "Chai", "Qty": "10", "Amount": "$180.00" }, { "Product": "Chang", "Qty": "5", "Amount": "$95.00" }],
  "values": { "invoice_number": "INV-2026-0042" },
  "found": {
    "emails": ["accounts@exotic.example"],
    "dates": [{ "text": "15 October 2026", "date": "2026-10-15" }, { "text": "2026-11-14", "date": "2026-11-14" }],
    "amounts": [
      { "text": "$180.00", "value": 180, "currency": "USD" },
      { "text": "$95.00", "value": 95, "currency": "USD" },
      { "text": "NZ$275.00", "value": 275, "currency": "NZD" }
    ]
  },
  "table_rows_inserted": 2
}
\`\`\`

\`found\` has one list per finder you chose: \`emails\`, \`urls\` and \`phones\` are strings; \`dates\` are \`{ text, date }\` (\`date\` is \`YYYY-MM-DD\`); \`amounts\` are \`{ text, value, currency }\`; \`percentages\` are \`{ text, value }\`. Duplicates are removed. \`table_rows_inserted\` is there when **Insert the rows into a data table** is on.

The run history counts what was found:

\`\`\`json
{ "variable": "extracted", "file": "INV-2026-0042.pdf", "tables": 1, "rows": 2, "values": 1, "found": { "emails": 1, "dates": 2, "amounts": 3 }, "inserted": 2, "table_columns": ["product", "quantity", "amount"] }
\`\`\`

### About the finders

- **Amounts** recognise currency symbols (\`$\`, \`€\`, \`£\`, \`¥\`, \`₹\`, \`NZ$\`, \`A$\`, \`AU$\`, \`C$\`, \`CA$\`, \`HK$\`, \`S$\`, \`US$\`) and ISO codes before or after the number (\`NZD 1,250.00\`, \`1.250,00 EUR\`), with either decimal separator. A plain \`$\` is read as \`USD\`: write \`NZ$\` or the code when it matters.
- **Phone numbers** are found by pattern (7–15 digits with spaces, dots, dashes, brackets or a leading \`+\`), so they can also pick up other grouped numbers, such as \`2026-0042\` in an invoice number. Check them, or use a pattern for the phone line instead.
- **Dates** cover ISO (\`2026-10-15\`), numeric (\`15/10/2026\`, \`15.10.26\`) and written forms (\`15 October 2026\`, \`Oct 15, 2026\`).

### Inserting rows into a data table

With **Insert the rows into a data table**, \`rows\` are inserted into the chosen table in the same step (in batches of 500), and each new row fires the table's row-created workflows like any other insert. Values are copied as they are: PDF and Word table cells are text, spreadsheet cells keep their type. Mapping to a column the table doesn't have, or no matching columns at all, fails the step with a message naming the columns. Only tables of the run's workspace can be written to.

## On the canvas

What it extracts and where rows go: \`tables · 1 pattern · emails, dates, amounts → Invoice lines\`.

## Limits

- At most **5,000 rows** are written to a data table per run (the rest are left out, with a warning).
- 100 patterns; 1,000 matches per pattern (with **Every match**); 1,000 results per finder.
- Reading follows the [read limits](/docs/workflows/documents#limits). The step's deadline is \`DOCUMENT_TIMEOUT_SECONDS\` (60) including any OCR: for long scans, read the file with [Read Document](/docs/workflows/documents/read-document) and OCR first.
- PDF tables are reconstructed from text positions (best effort).

## Security notes

User patterns go through the ReDoS guard and run line by line on at most 100,000 characters per line. Rows are written only to a data table of this workspace (another workspace's table is "Data table not found"). See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json
{
  "type": "doc_extract",
  "label": "Extract invoice lines",
  "config": {
    "source": "{{form.invoice}}",
    "patterns": [{ "name": "invoice_number", "pattern": "Invoice\\\\s+(INV-[\\\\d-]+)" }],
    "finders": ["emails", "dates", "amounts"],
    "to_table": true,
    "table_id": "<invoice-lines-table-id>",
    "table_name": "Invoice lines",
    "column_mapping": [
      { "column": "product", "field": "Product" },
      { "column": "quantity", "field": "Qty" },
      { "column": "amount", "field": "Amount" }
    ]
  }
}
\`\`\`

Canvas: \`tables · 1 pattern · emails, dates, amounts → Invoice lines\`.

## Works well with

- [Capture invoice PDFs into a table](/docs/workflows/documents/how-to/invoice-pdf) and [Import an Excel file into a data table](/docs/workflows/documents/how-to/excel-to-data-table).
- [Redact Document](/docs/workflows/documents/redact) to share a copy without the details you just extracted — see [Extract contact details and redact a copy](/docs/workflows/documents/how-to/extract-and-redact).
- A [Condition](/docs/workflows/nodes#node-condition) on \`{{extracted_invoice_number}}\` (is empty) to send unreadable documents to a person.
- [Run Agent](/docs/workflows/documents#summarise-or-classify-with-ai) for layouts too varied for patterns.
`,
  },
  {
    slug: 'workflows/documents/redact',
    title: 'Redact Document',
    description: 'Make a copy of a document without email addresses, phone and card numbers, IBANs, other personal data, chosen words or custom patterns.',
    body: `
**Redact Document** (\`doc_redact\`) makes a **redacted copy** of a file; the original is not changed. It removes what the presets detect, the words and phrases you list, and matches of your own patterns, and reports how many of each it replaced.

- **Word, PowerPoint and Excel** files are redacted **in place**: the text inside the file is replaced and the formatting, layout and images are kept. The author fields in the file properties are cleared too.
- **Text formats** (plain text, Markdown, CSV, TSV, JSON, XML, YAML) keep their format.
- **PDF, HTML and OpenDocument** files are **rebuilt from the redacted text**: a PDF (or HTML) with the text, headings, lists and tables, but not the original layout or images. Nothing redacted is left in the file — the original text layer is gone.

## Inputs

**Document** (\`source\`): a file object, a list (the first file), a \`storage://\` reference, a URL, base64 content or text. See [File inputs](/docs/workflows/documents#file-inputs).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Remove | \`presets\` | none | Any of the presets below |
| Words and phrases | \`terms\` | none | Comma-separated (or a list), matched anywhere, ignoring case: \`Project Falcon, {{customer.company_name}}\` |
| Patterns | \`patterns\` | none | A list of \`{ "pattern": "…" }\` regular expressions, matched line by line, ignoring case: \`ACC-\\d{6}\` |
| Replace with | \`replacement\` | \`block\` | \`block\`: █ for every character (spaces kept, so the length shows); \`label\`: the kind in brackets (\`[EMAIL]\`, \`[PHONE]\`, \`[CREDIT_CARD]\`, \`[IBAN]\`, \`[TERM]\`, \`[PATTERN]\`…); \`text\`: your own text |
| Replacement text | \`replacement_text\` | \`[REDACTED]\` | With \`replacement: "text"\` |
| Redacted copy | \`output\` | \`same\` | \`same\` (Word, PowerPoint, Excel and text formats keep their format; anything else becomes PDF, HTML stays HTML), \`pdf\`, \`html\` or \`text\` |
| Clear the author in the file properties | \`clear_author\` | \`true\` | Word, PowerPoint and Excel: empty the Author and Last modified by properties |
| Pages, OCR | \`pages\`, \`ocr\`, \`ocr_languages\` | all, \`off\`, \`eng\` | PDFs rebuilt from text: which pages, and OCR for scans (not shown in the designer) |
| Output file name | \`output_name\` | \`<source>-redacted\` | |
| Output variable | \`output_var\` | \`redacted\` | |

At least one preset, term or pattern is required.

### Presets

| Preset | \`presets\` value | Finds |
|---|---|---|
| Emails | \`email\` | Email addresses |
| Phone numbers | \`phone\` | 7–15 digits with spaces, dots, dashes, brackets or a leading \`+\` |
| Card numbers | \`credit_card\` | 13–19 digits (spaces or dashes allowed) that pass the Luhn check |
| IBANs | \`iban\` | IBANs that pass the mod-97 check |
| US SSNs | \`ssn\` | \`123-45-6789\` style numbers (invalid ranges excluded) |
| IP addresses | \`ip_address\` | IPv4 addresses |
| URLs | \`url\` | \`http\` and \`https\` links |
| Dates | \`date\` | ISO, numeric and written dates |

The checksums keep order numbers and other long numbers that merely look like card numbers or IBANs out of the result.

## Outputs

| Variable | Contents |
|---|---|
| \`{{redacted}}\` | \`{ file, text, counts, total }\` |
| \`{{redacted_file}}\` | The redacted copy as a [file object](/docs/workflows/documents#output-files) |
| \`{{redacted_text}}\` | The redacted text |
| \`{{redacted_count}}\` | Number of redactions |

\`\`\`json title="{{redacted}} for a Word file, replacement: label"
{
  "file": { "_file": true, "name": "customer-onboarding-redacted.docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "size": 14876, "url": "…", "storage_ref": "storage://task-files/workflow-files/…", "checksum_sha256": "…" },
  "text": "Customer onboarding\\nOrders: Nancy Davolio <[EMAIL]>, phone [PHONE].\\nAccounts: [EMAIL], [PHONE].\\nCard on file: [CREDIT_CARD]\\nBank account: [IBAN]",
  "counts": { "email": 2, "phone": 2, "credit_card": 1, "iban": 1 },
  "total": 6
}
\`\`\`

\`counts\` is keyed by preset, plus \`term\` and \`pattern\`. The run history shows the file name, \`redactions\` and \`counts\`, never the text.

## On the canvas

The presets (or the number of rules) and the output variable: \`email, phone, credit_card, iban → redacted\`.

## Limits

- **PDFs are rebuilt from their text**: the layout, fonts and images of the original are not kept (a warning says so), and the standard PDF fonts show only Latin (Windows-1252) characters — others become "?". Where the layout matters and you have the Word original, redact that (it is redacted in place) and [convert](/docs/workflows/documents/convert-document) the copy to PDF.
- Word, PowerPoint and Excel: the body, headers, footers, footnotes, endnotes and comments (Word), slides, notes and comments (PowerPoint), and text cells and comments (Excel) are redacted. Numbers stored as numeric Excel cells, text inside images and embedded objects, and the names of comment and tracked-change authors are not.
- Patterns match within one line. Text inside an image is only seen with OCR, and then only in the rebuilt PDF.
- Reading follows the [read limits](/docs/workflows/documents#limits).

> [!WARNING]
> Pattern-based detection finds what looks like personal data; it is not a guarantee. Check a sample of redacted copies before you rely on them, and add terms (names, account numbers) the presets cannot know.

## Security notes

Custom patterns go through the ReDoS guard. Redacted HTML is sanitised. The original file is not changed or moved. See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json
{
  "type": "doc_redact",
  "label": "Redact customer file",
  "config": {
    "source": "{{form.customer_file}}",
    "presets": ["email", "phone", "credit_card", "iban"],
    "terms": "{{customer.contact_name}}",
    "patterns": [{ "pattern": "ACC-\\\\d{6}" }],
    "replacement": "label",
    "output": "same",
    "clear_author": true
  }
}
\`\`\`

Canvas: \`email, phone, credit_card, iban → redacted\`.

## Works well with

- [Extract from Document](/docs/workflows/documents/extract) first, to keep the details you need in variables — see [Extract contact details and redact a copy](/docs/workflows/documents/how-to/extract-and-redact).
- [Inspect Document](/docs/workflows/documents/inspect-document) with \`search\` on \`{{redacted_file}}\` to check that a term is gone.
- [Send Email](/docs/workflows/nodes#node-send-email) with \`{{redacted_file}}\` as an attachment, or a storage connector upload.
`,
  },
  {
    slug: 'workflows/documents/inspect-document',
    title: 'Inspect Document',
    description: 'Check a file\'s real type from its content, compute checksums, count words and characters, estimate reading time, and search the text with context.',
    body: `
**Inspect Document** (\`doc_inspect\`) answers questions about a file without converting it: what it really is (from its content, not its name), its checksums, how long it is, and where a word or pattern occurs.

## Inputs

**Document** (\`source\`): a file object, a list (the first file), a \`storage://\` reference, a URL, base64 content or text. See [File inputs](/docs/workflows/documents#file-inputs).

## Options

| Setting | Key | Default | What it does |
|---|---|---|---|
| Inspect | \`operation\` | \`all\` | \`all\` (type, checksum, counts, and a search when **Search for** is set), \`detect\` (file type only), \`checksum\`, \`stats\` (counts and reading time) or \`search\` |
| Algorithms | \`algorithms\` | \`["sha256"]\` | \`checksum\` and \`all\`: any of \`sha256\`, \`sha512\`, \`sha1\`, \`md5\` |
| Search for | \`query\` | — (required for \`search\`) | Text, or a regular expression with **Regular expression** |
| Whole words | \`whole_word\` | \`false\` | Match whole words only (letters and digits around the match end it) |
| Match case | \`case_sensitive\` | \`false\` | |
| Regular expression | \`regex\` | \`false\` | Treat **Search for** as a regular expression (ReDoS-guarded) |
| Context characters | \`context_chars\` | \`60\` | Characters before and after each match (0–500) |
| Pages, sheet, OCR | \`pages\`, \`sheet\`, \`ocr\`, \`ocr_languages\` | all, all, \`off\`, \`eng\` | How the text is read, as in Read Document (not shown in the designer) |
| Output variable | \`output_var\` | \`inspection\` | |

## Outputs

| Variable | Contents |
|---|---|
| \`{{inspection}}\` | The result (below); which parts are there depends on the operation |
| \`{{inspection_matches}}\` | Search: the matches |
| \`{{inspection_match_count}}\` | Search: the number of matches |

A Word file uploaded as \`agreement.pdf\`, searched for the whole word "term":

\`\`\`json title="{{inspection}}"
{
  "file": { "name": "agreement.pdf", "size": 12840, "mime_type": "application/pdf" },
  "type": { "format": "docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "extension": "docx", "label": "Word document", "detected_by": "content", "is_text": false, "extension_mismatch": true },
  "checksums": { "sha256": "b1946ac92492d2347c6235b4d2611184e8c1b7a6f0d43e2b8f1c9a7d5e3b2a10" },
  "stats": { "words": 30, "characters": 196, "characters_no_spaces": 166, "lines": 8, "paragraphs": 1, "sentences": 7, "reading_time_minutes": 1, "pages": 2, "slides": null, "sheets": null },
  "metadata": { "title": "Supply Agreement", "author": "Andrew Fuller", "…": "…" },
  "search": {
    "query": "term",
    "count": 2,
    "matches": [
      { "text": "Term", "index": 78, "line": 3, "before": "xotic Liquids. See the terms.\\n", "after": "\\n- The term is 24 months.\\n- Co", "context": "xotic Liquids. See the terms. Term - The term is 24 months. - Co" },
      { "text": "term", "index": 89, "line": 4, "before": "ds. See the terms.\\nTerm\\n- The ", "after": " is 24 months.\\n- Contact: orde", "context": "ds. See the terms. Term - The term is 24 months. - Contact: orde" }
    ],
    "truncated": false
  }
}
\`\`\`

- \`type.extension_mismatch\` is true when the name says one type and the content another — here a Word document named \`.pdf\`. \`detected_by\` is \`content\`, or \`extension\` when the content gave no clue.
- \`stats\` and \`metadata\` are the same as [Read Document](/docs/workflows/documents/read-document)'s; with \`all\`, a file that cannot be read (an image without OCR, an unsupported type) still gets its type and checksum, with a warning.
- Each match has its \`line\`, its \`page\` for PDFs, the text \`before\` and \`after\` it, and a one-line \`context\`. At most 500 matches are listed (\`truncated\`), but \`count\` counts them all.

The run history shows the essentials:

\`\`\`json
{ "variable": "inspection", "format": "docx", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "extension_mismatch": true, "sha256": "b1946ac9…", "words": 30, "reading_time_minutes": 1, "matches": 2 }
\`\`\`

## On the canvas

The operation and output variable, or the search: \`all → inspection\`, \`Find "termination"\`.

## Limits

- Reading for \`stats\` and \`search\` follows the [read limits](/docs/workflows/documents#limits); \`detect\` and \`checksum\` only need the bytes, within \`DOCUMENT_MAX_MB\`.
- A regular-expression search scans the first 2,000,000 characters of the text.
- Reading time assumes 230 words a minute.

## Security notes

The type is decided from the content (magic bytes, the parts inside a ZIP container, text sniffing), so a PDF named \`.docx\` or a spreadsheet named \`.pdf\` is recognised for what it is. Binary content that matches no known format falls back to the name's extension (\`detected_by: "extension"\`), so check \`format\` against what you expect rather than trusting the name. Regular expressions go through the ReDoS guard. See [Security](/docs/workflows/documents#security).

## Example

\`\`\`json
{
  "type": "doc_inspect",
  "label": "Check upload",
  "config": {
    "source": "{{form.upload}}",
    "operation": "all",
    "algorithms": ["sha256", "md5"],
    "query": "termination",
    "whole_word": true,
    "context_chars": 80
  }
}
\`\`\`

Canvas: \`all → inspection\`.

## Works well with

- A [Condition](/docs/workflows/nodes#node-condition) on \`{{inspection.type.extension_mismatch}}\` or \`{{inspection.type.format}}\` to reject a file that is not what it claims.
- A [Data](/docs/workflows/nodes#node-update-data-table) step that stores \`{{inspection.checksums.sha256}}\`, to spot the same file being submitted twice.
- [Redact Document](/docs/workflows/documents/redact), then a \`search\` on the redacted copy to confirm a term is gone.
`,
  },
  {
    slug: 'workflows/documents/ocr',
    title: 'Scanned PDFs and OCR',
    description: 'Read scanned PDFs and images with OCR — automatic detection of pages without text, tesseract.js or Azure AI Document Intelligence, language data, air-gapped setup and limits.',
    body: `
A scanned PDF is a picture of a page: it has no text layer, so reading it gives nothing until the text is recognised (OCR). The document actions find such pages themselves and, when you turn OCR on, recognise them with the instance's OCR provider. OCR is **off by default** in every step.

## Turning it on

**Read Document** and **Extract from Document** have an **OCR (scanned PDFs and images)** setting; Convert Document, Redact Document and Inspect Document take the same keys in their JSON configuration. Compare Documents does not run OCR.

| \`ocr\` | Designer | What happens |
|---|---|---|
| \`off\` | Off | No OCR. A PDF page without a text layer is listed with \`has_text_layer: false\`, and the step logs "N page(s) have no text layer (scanned?) — turn on OCR to read them". Images cannot be read |
| \`auto\` | Pages without text | Only pages without a text layer are recognised; pages with text are read as usual. The OCR provider is only started when a page needs it |
| \`force\` | Every page | Every page is recognised. Pages that already have a text layer keep their own text; the OCR result adds its confidence |

**OCR languages** (\`ocr_languages\`, default \`eng\`) are Tesseract language codes; join several with \`+\` (\`eng+deu\`, \`eng+chi_sim\`, at most 5).

A page counts as having a text layer when it has at least 10 visible characters, or some text and no images. With \`auto\`, a page without a text layer is recognised when it contains an image (a scan is one large image per page): the largest image on the page is handed to the provider. Image files (PNG, JPEG, GIF, WebP, BMP, TIFF) are read as one page, and only with OCR on.

## What you get

The recognised text becomes the page's text, so \`text\`, \`markdown\`, patterns, finders and everything downstream work as for a text PDF. Each recognised page reports its provider and a **confidence** from 0 to 100 (\`null\` when the provider gives none):

\`\`\`json title="{{document.structure.pages}} for a two-page scan"
[
  { "number": 1, "text": "Exotic Liquids\\nInvoice INV-2026-0057\\n…", "characters": 412, "has_text_layer": false, "image_count": 1, "width": 595, "height": 842,
    "ocr": { "provider": "tesseract", "confidence": 91.4, "characters": 412 } },
  { "number": 2, "text": "Terms: payment within 30 days …", "characters": 188, "has_text_layer": false, "image_count": 1, "width": 595, "height": 842,
    "ocr": { "provider": "tesseract", "confidence": 88.2, "characters": 188 } }
]
\`\`\`

Branch on it: a [Condition](/docs/workflows/nodes#node-condition) on \`{{=MIN(PLUCK(document.structure.pages, "ocr.confidence"))}}\` less than 70 can send a poor scan to a person instead of extracting from it. Tables are not detected on OCR'd pages; use patterns or [Run Agent](/docs/workflows/documents#summarise-or-classify-with-ai) for their contents.

## Providers

The provider is an instance setting, \`DOCUMENT_OCR_PROVIDER\`:

| Value | Provider | Where the page images go |
|---|---|---|
| \`tesseract\` (default) | [tesseract.js](https://github.com/naptha/tesseract.js) in the app's process — WebAssembly, no native code | Nowhere: OCR runs on the server |
| \`azure_document_intelligence\` (or \`azure\`) | Azure AI Document Intelligence, the \`prebuilt-read\` model | Your Azure resource |
| \`none\` (or \`off\`) | OCR turned off for the instance; a step that needs it fails with "OCR is turned off on this instance" | — |

### tesseract.js (default)

\`tesseract.js\` 7 (Apache-2.0, about 45 MB with its WebAssembly core) is an **optional package**:

- **From source and on Vercel**, \`npm install\` / \`npm ci\` install it with the other optional packages.
- **The Docker image leaves it out** unless you build with \`INCLUDE_OCR=true\` (default \`false\`): \`docker build --build-arg INCLUDE_OCR=true …\`, or \`INCLUDE_OCR=true\` in \`.env\` for Docker Compose.

Without it, a step that needs OCR fails with a message that names the package, the version, the rebuild and the build arg; text PDFs are not affected. See [Optional drivers](/docs/self-hosting/optional-drivers#ocr-tesseractjs).

**Language data.** Each language needs a trained-data file. On first use, tesseract.js downloads \`<lang>.traineddata.gz\` from the tesseract.js language data on the jsDelivr CDN (\`https://cdn.jsdelivr.net/npm/@tesseract.js-data/<lang>/4.0.0_best_int/\`) and caches it in \`DOCUMENT_OCR_CACHE_DIR\` (default \`<system temp folder>/usertasks-ocr\`). Allow that host through your egress firewall, or provide the files yourself as below. In containers, point the cache at a volume so the download happens once.

### Air-gapped and locked-down installs

Download the language files on a connected machine and serve them from inside your network:

\`\`\`bash
# connected machine: one file per language you will use
mkdir tessdata && cd tessdata
curl -fLO https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz
curl -fLO https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz
\`\`\`

Copy the folder to the server (or a volume mounted into the container) and set:

\`\`\`bash
DOCUMENT_OCR_LANG_PATH=/opt/usertasks/tessdata     # a local folder holding <lang>.traineddata.gz
# or an internal web server:
# DOCUMENT_OCR_LANG_PATH=https://files.corp.example/tessdata
\`\`\`

With \`DOCUMENT_OCR_LANG_PATH\` set, nothing is downloaded from the internet. The same files are published as the npm packages \`@tesseract.js-data/<lang>\`, so an internal npm mirror is another source. Build the image with \`INCLUDE_OCR=true\` before you carry it across: an optional package cannot be added offline. See [Air-gapped installs](/docs/self-hosting/air-gapped).

### Azure AI Document Intelligence

\`\`\`bash
DOCUMENT_OCR_PROVIDER=azure_document_intelligence
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://northwind-ocr.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<key>
# AZURE_DOCUMENT_INTELLIGENCE_API_VERSION=2024-11-30       # default
\`\`\`

Each page image is posted to the \`prebuilt-read\` model and the result polled until it is ready; the confidence is the mean of the word confidences. The endpoint must be \`https://\`. No optional package is needed. Azure detects the language itself; when the first OCR language is not \`eng\`, its first two letters are sent as a locale hint. Page images leave the instance for your Azure resource: choose the region and resource accordingly.

### Google Document AI, AWS Textract and others

Not built in. Only tesseract.js and Azure AI Document Intelligence ship today. Another service can be added in code: providers implement the small \`OcrProvider\` interface in \`lib/documents/ocr.ts\`:

\`\`\`ts
export interface OcrProvider {
  id: string
  recognize(image: Buffer, options: { languages: string }): Promise<{ text: string; confidence: number | null; provider: string }>
  close?(): Promise<void>
}
\`\`\`

\`recognize\` receives one page as a PNG image. Add the provider next to \`azureProvider\`, a value for it in \`configuredOcrProvider\` and a case in \`openOcrProvider\`, then rebuild. Everything else — page detection, limits, confidence in the output — works unchanged.

## Limits

| Variable | Default | What it limits |
|---|---|---|
| \`DOCUMENT_OCR_MAX_PAGES\` | 20 (1–500) | Pages recognised in one step; later pages are skipped with the warning "OCR stopped after N pages" |
| \`DOCUMENT_OCR_TIMEOUT_SECONDS\` | 120 (5–900) | Starting OCR (including a language download), and Read Document's overall time when it is longer than \`DOCUMENT_TIMEOUT_SECONDS\` |

- Extract from Document, Convert Document, Redact Document and Inspect Document keep their usual deadline (\`DOCUMENT_TIMEOUT_SECONDS\`, twice that for Convert) including OCR. For long scans, read them once with Read Document and work from \`{{document.text}}\`.
- A page image larger than 60 megapixels is refused. A page with no image to recognise is skipped with a warning.
- OCR is CPU-heavy: tesseract.js takes seconds per page. Keep \`DOCUMENT_OCR_MAX_PAGES\` modest on small instances.
- Recognition quality depends on the scan: 300 dpi, straight pages and good contrast work best. tesseract.js does not read handwriting well.
`,
  },
  {
    slug: 'workflows/documents/how-to/excel-to-data-table',
    title: 'Import an Excel file into a data table',
    description: 'Upload a workbook on a start form, read its rows with Read Document, and insert them into a data table — with a Loop and a Data step, or in one Extract step.',
    body: `
Northwind's sales team sends a monthly order export as an Excel workbook. This workflow takes the file from a start form, reads the **Orders** sheet and adds every order to an **Orders** [data table](/docs/data-tables).

The workbook has a title row and a blank row above the table, a formula column and a date column:

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | Northwind orders — October | | | | | |
| 2 | | | | | | |
| 3 | OrderID | Customer | Qty | UnitPrice | Total | OrderDate |
| 4 | 10248 | VINET | 12 | 14 | \`=C4*D4\` | 01/10/2026 |
| 5 | 10249 | TOMSP | 9 | 18.6 | \`=C5*D5\` | 02/10/2026 |
| 6 | 10250 | HANAR | 10 | 7.7 | \`=C6*D6\` | 03/10/2026 |

::image documents-test-run | Test run logs: Read Document read 3 rows from 2 sheets of the workbook, then the loop logged each order | Save & Test: Read Document reports the format, sheets and rows; the loop runs once per row.

## 1. Create the data table

In **Data tables**, create **Orders** with the columns \`order_id\` (number), \`customer\` (text), \`quantity\` (number), \`unit_price\` (number), \`total\` (number) and \`order_date\` (date).

## 2. Add a start form with a file field

Open the workflow's settings (nothing selected on the canvas) and **Design start form**. Add an **Attachments** field with the key \`workbook\`, allowed types **Spreadsheets**, at most 1 file, required. See [Task forms](/docs/tasks/forms).

When the workflow runs, \`{{form.workbook}}\` is a list with the uploaded file. Read Document uses the first file of a list, so you can pass it as it is.

## 3. Read the sheet

Add **Read Document** after the trigger:

\`\`\`json title="Read Document"
{
  "type": "doc_read",
  "label": "Read orders",
  "config": {
    "source": "{{form.workbook}}",
    "sheet": "Orders",
    "header_row": "auto",
    "output_var": "orders"
  }
}
\`\`\`

The canvas shows \`sheet Orders → orders\`. **Header row: Detect** skips the title and blank rows and uses row 3 as the header; formulas give their computed values and dates become \`YYYY-MM-DD\`. After a test run, \`{{orders_rows}}\` is:

\`\`\`json title="{{orders_rows}}"
[
  { "OrderID": 10248, "Customer": "VINET", "Qty": 12, "UnitPrice": 14, "Total": 168, "OrderDate": "2026-10-01" },
  { "OrderID": 10249, "Customer": "TOMSP", "Qty": 9, "UnitPrice": 18.6, "Total": 167.4, "OrderDate": "2026-10-02" },
  { "OrderID": 10250, "Customer": "HANAR", "Qty": 10, "UnitPrice": 7.7, "Total": 77, "OrderDate": "2026-10-03" }
]
\`\`\`

and the step's output in the run is:

\`\`\`json
{ "variable": "orders", "file": "orders-october.xlsx", "format": "xlsx", "sheets": 2, "words": 25, "characters": 155, "rows": 3, "tables": 1, "truncated": false, "text_preview": "Orders OrderID Customer Qty UnitPrice Total OrderDate 10248 VINET 12 14 168 2026-10-01 10249 TOMSP 9 18.6 167.4 2026-10-02 10250 HANAR 10 7.7 77 2026-10-03" }
\`\`\`

\`sheets\` is the number of sheets in the workbook. \`{{orders_count}}\` is 3; \`{{orders.structure.sheets.0.header_row}}\` is 3.

> [!TIP]
> If the header is not detected (for example, a header row that contains numbers), set **Header row** to the row number (\`3\`), or to **First row** after choosing a **Range** such as \`A3:F500\`.

## 4. Loop over the rows

Add **Loop For Each** with the rows as its items:

\`\`\`json title="Loop For Each"
{ "type": "loop", "label": "Each order", "config": { "items": "{{orders_rows}}", "item_var": "order" } }
\`\`\`

Inside the loop, \`{{order.OrderID}}\`, \`{{order.Customer}}\`… are the current row; the data picker shows them under Current item.

## 5. Insert each row

In the loop body, add a **Data** step that inserts into **Orders**:

\`\`\`json title="Data (insert)"
{
  "type": "update_data_table",
  "label": "Save order",
  "config": {
    "table_id": "<orders-table-id>",
    "table_name": "Orders",
    "operation": "insert",
    "column_values": {
      "order_id": "{{order.OrderID}}",
      "customer": "{{order.Customer}}",
      "quantity": "{{order.Qty}}",
      "unit_price": "{{order.UnitPrice}}",
      "total": "{{order.Total}}",
      "order_date": "{{order.OrderDate}}"
    }
  }
}
\`\`\`

## 6. Run it

Run the workflow and upload the workbook. The run shows Read orders with 3 rows, then Each order three times with a Save order step in each iteration; the **Orders** table has three new rows. Each insert fires the table's row-created workflows, as any insert does.

The loop is the right choice when each row needs more work: a lookup, a [Condition](/docs/workflows/nodes#node-condition) (skip zero quantities), a User Task for large orders.

## The shortcut: one Extract step

When the rows go into the table as they are, **Extract from Document** reads and inserts in one step, without a loop:

\`\`\`json title="Extract from Document"
{
  "type": "doc_extract",
  "label": "Import orders",
  "config": {
    "source": "{{form.workbook}}",
    "sheet": "Orders",
    "to_table": true,
    "table_id": "<orders-table-id>",
    "table_name": "Orders",
    "column_mapping": [
      { "column": "order_id", "field": "OrderID" },
      { "column": "customer", "field": "Customer" },
      { "column": "quantity", "field": "Qty" },
      { "column": "unit_price", "field": "UnitPrice" },
      { "column": "total", "field": "Total" },
      { "column": "order_date", "field": "OrderDate" }
    ]
  }
}
\`\`\`

In the designer: **Insert the rows into a data table**, choose **Orders**, then **Map a column** for each column. Without a mapping, headers that match a column's key or label (ignoring case, spaces and punctuation) are used, so a table whose column labels are \`OrderID\`, \`Customer\`… needs none. The run shows:

\`\`\`json
{ "variable": "extracted", "file": "orders-october.xlsx", "tables": 1, "rows": 3, "inserted": 3, "table_columns": ["order_id", "customer", "quantity", "unit_price", "total", "order_date"] }
\`\`\`

Extract writes at most 5,000 rows per run; the rest are skipped with a warning. Split bigger files, or use the loop.

## Variations

- **CSV instead of Excel:** the same steps work; the delimiter is detected.
- **Every sheet:** leave **Sheet** empty in Extract and set **Rows from** to \`all\` to import the rows of every sheet one after the other.
- **Check before importing:** add [Compare Documents](/docs/workflows/documents/compare-documents) in sheet mode against last month's \`{{orders_rows}}\`, keyed on \`OrderID\`, and only insert \`added\` rows.
`,
  },
  {
    slug: 'workflows/documents/how-to/contract-redline',
    title: 'Redline two contract versions and email the changes',
    description: 'Compare the current and proposed versions of a Word contract, make a tracked-changes redline and an HTML report, and email them — or stop when nothing changed.',
    body: `
Exotic Liquids has sent back Northwind's supply agreement with changes. This workflow compares the two Word files, emails the legal team a side-by-side report in the message body with a redline attached, and ends quietly when the versions are identical.

**Steps:** start form → Compare Documents → Branch by Condition → Send Email.

## 1. Start form

In the workflow's start form add two **Attachments** fields, \`current_contract\` and \`proposed_contract\`, each **Documents**, at most 1 file, required. The files arrive as \`{{form.current_contract}}\` and \`{{form.proposed_contract}}\` (lists of one file; the first file is used).

## 2. Compare the versions

\`\`\`json title="Compare Documents"
{
  "type": "doc_compare",
  "label": "Compare versions",
  "config": {
    "original": "{{form.current_contract}}",
    "revised": "{{form.proposed_contract}}",
    "mode": "words",
    "ignore_whitespace": true,
    "redline": "docx",
    "redline_style": "tracked",
    "report": "html",
    "output_name": "Supply agreement — Exotic Liquids",
    "output_var": "comparison"
  }
}
\`\`\`

The canvas shows \`words diff + redline docx, html report → comparison\`.

- **Compare: Words** shows a changed number or name as one change rather than a whole changed line. Use **Sentences** for long clauses, **Lines** for plain text files.
- **Redline: Word** with **Word tracked changes** gives a \`.docx\` in which every change is a real tracked change by "UserTasks compare": lawyers can accept or reject them in Word. **Coloured** marks insertions in green underline and deletions in red strikethrough instead.
- **Report file: HTML** saves the side-by-side report as a file as well; it is also in \`{{comparison_html}}\`.

When the term changed from 24 to 36 months and Chang's price from 19.00 to 19.50, the run shows:

\`\`\`json
{ "variable": "comparison", "mode": "words", "identical": false, "similarity": 93.9, "stats": { "added": 0, "removed": 0, "changed": 2, "unchanged": 2, "…": "…" }, "changes": 2, "files": { "redline_docx": "Supply agreement — Exotic Liquids-redline.docx", "report": "Supply agreement — Exotic Liquids.html" } }
\`\`\`

and \`{{comparison.changes}}\` is:

\`\`\`json
[
  { "type": "changed", "old_text": "24", "new_text": "36" },
  { "type": "changed", "old_text": "00", "new_text": "50" }
]
\`\`\`

Word mode splits \`19.00\` into \`19\`, \`.\` and \`00\`, so only the changed part is listed; the report and the redline show it in context.

## 3. Stop when nothing changed

Add **Branch by Condition** with one branch for identical versions:

\`\`\`json title="Branch by Condition"
{
  "type": "condition",
  "label": "Any changes?",
  "config": {
    "branches": [
      { "label": "Identical", "logic": "AND", "rules": [{ "field": "{{comparison_identical}}", "operator": "is_true", "value": "" }] }
    ],
    "has_else": true
  }
}
\`\`\`

Leave **Identical** unconnected (or add a Log step), and connect **Else** to the email. To ask for a full review only when a lot changed, add a branch on \`{{comparison_similarity}}\` with **less than** \`80\`.

## 4. Email the report and the redline

\`\`\`json title="Send Email"
{
  "type": "send_email",
  "label": "Send redline to legal",
  "config": {
    "to": "legal@northwind.example",
    "subject": "Supply agreement: {{comparison.stats.changed}} changes from Exotic Liquids ({{comparison_similarity}}% similar)",
    "body": "<p>Andrew, Exotic Liquids returned the supply agreement. The changes are below; the tracked-changes copy is attached.</p>{{comparison_html}}",
    "attachments": "{{comparison_redline_docx}}, {{comparison_report}}"
  }
}
\`\`\`

\`{{comparison_html}}\` uses inline styles only and escaped text, so it renders in mail clients and cannot inject markup from the documents. Several attachments separated by commas are all attached.

## What the reader gets

- The email body: a header with both file names and "2 changed · 0 added · 0 removed · 93.9% similar", then a two-column table — old on the left, new on the right, changed words highlighted, and long unchanged stretches collapsed to "… N unchanged lines …".
- \`Supply agreement — Exotic Liquids-redline.docx\`: the revised text with the changes as tracked changes, opening with a "Redline: …" heading and the statistics.
- \`Supply agreement — Exotic Liquids.html\`: the same report as a standalone page.

## Variations

- **PDF instead of Word:** \`"redline": "pdf"\` (always coloured) or \`"both"\`; \`"report": "pdf"\` gives a printable list of the changes. PDFs use the standard fonts (Latin characters only).
- **Store the history:** add a [Data](/docs/workflows/nodes#node-update-data-table) step that saves \`{{comparison_similarity}}\`, \`{{comparison.stats.changed}}\` and \`{{comparison_redline_docx.url}}\` per round.
- **Summarise for the business owner:** add [Run Agent](/docs/workflows/documents#summarise-or-classify-with-ai) with "Explain these contract changes in plain English: {{comparison.unified}}".
- **One document with tracked changes:** to list the changes already tracked inside a single Word file, use [Read Document](/docs/workflows/documents/read-document) and \`{{document.structure.tracked_changes}}\`.
`,
  },
  {
    slug: 'workflows/documents/how-to/extract-and-redact',
    title: 'Extract contact details and redact a copy',
    description: 'Pull tables, email addresses, phone numbers and amounts out of a customer document, then share a copy with emails, phone and card numbers and IBANs removed.',
    body: `
A new customer's onboarding form arrives as a Word file. The account team needs the contact details and the credit terms in the CRM; the warehouse team needs the document too, but without personal data or payment details. Two steps do it: **Extract from Document** keeps what you need in variables, **Redact Document** makes the shareable copy.

The document (\`customer-onboarding.docx\`) reads:

\`\`\`text
Customer onboarding — Exotic Liquids
Orders: Nancy Davolio <nancy.davolio@northwind.example>, phone +64 21 555 0100.
Accounts: accounts@exotic.example, (171) 555-2222.
Credit limit NZ$25,000.00; discount 2.5% on orders over $1,500.
Card on file: 4111 1111 1111 1111
Bank account: GB82 WEST 1234 5698 7654 32
See https://northwind.example/terms (updated 1 March 2026).
\`\`\`

followed by a table of delivery addresses.

## 1. Extract the details

\`\`\`json title="Extract from Document"
{
  "type": "doc_extract",
  "label": "Extract details",
  "config": {
    "source": "{{form.onboarding_form}}",
    "extract_tables": true,
    "finders": ["emails", "phones", "amounts", "percentages", "urls", "dates"],
    "patterns": [{ "name": "customer", "pattern": "Customer onboarding — (.+)" }],
    "output_var": "details"
  }
}
\`\`\`

The canvas shows \`tables · 1 pattern · emails, phones, amounts, percentages, urls, dates\`. \`{{details}}\` is:

\`\`\`json title="{{details}}"
{
  "file": "customer-onboarding.docx",
  "tables": [{ "header": ["Site", "Address", "City"], "rows": [["Head office", "12 Orchestra Terrace", "London"]], "records": [{ "Site": "Head office", "Address": "12 Orchestra Terrace", "City": "London" }] }],
  "rows": [{ "Site": "Head office", "Address": "12 Orchestra Terrace", "City": "London" }],
  "values": { "customer": "Exotic Liquids" },
  "found": {
    "emails": ["nancy.davolio@northwind.example", "accounts@exotic.example"],
    "urls": ["https://northwind.example/terms"],
    "phones": ["+64 21 555 0100", "(171) 555-2222", "1234 5698 7654 32"],
    "dates": [{ "text": "1 March 2026", "date": "2026-03-01" }],
    "amounts": [{ "text": "NZ$25,000.00", "value": 25000, "currency": "NZD" }, { "text": "$1,500", "value": 1500, "currency": "USD" }],
    "percentages": [{ "text": "2.5%", "value": 2.5 }]
  }
}
\`\`\`

Use them in later steps: \`{{details_customer}}\`, \`{{details.found.emails.0}}\`, \`{{=FIRST(PLUCK(details.found.amounts, "value"))}}\` for the credit limit, \`{{details_rows}}\` for the addresses. Note that a plain \`$\` is read as US dollars; the finders return what they see, so check the values that matter.

> [!NOTE]
> The phone finder works by pattern, so other grouped digits can turn up in \`found.phones\` — here the digits of the IBAN (\`1234 5698 7654 32\`); an order reference such as \`2026-0042\` can too. Use \`{{details.found.phones.0}}\` only when you know the layout, or a pattern for the phone line (\`phone\\s+(\\+?[\\d ()-]{7,})\`). Redaction is not affected: the IBAN check claims those digits first.

## 2. Redact a copy

\`\`\`json title="Redact Document"
{
  "type": "doc_redact",
  "label": "Redact for warehouse",
  "config": {
    "source": "{{form.onboarding_form}}",
    "presets": ["email", "phone", "credit_card", "iban"],
    "terms": "Nancy Davolio",
    "replacement": "label",
    "output": "same",
    "clear_author": true,
    "output_var": "redacted"
  }
}
\`\`\`

The canvas shows \`email, phone, credit_card, iban → redacted\`. Because the source is a Word file and **Redacted copy** is **Same format**, the copy is a \`.docx\` with its formatting kept and the text replaced inside it; the Author and Last modified by properties are cleared. \`{{redacted_text}}\` is:

\`\`\`text
Customer onboarding — Exotic Liquids
Orders: [TERM] <[EMAIL]>, phone [PHONE].
Accounts: [EMAIL], [PHONE].
Credit limit NZ$25,000.00; discount 2.5% on orders over $1,500.
Card on file: [CREDIT_CARD]
Bank account: [IBAN]
See https://northwind.example/terms (updated 1 March 2026).
\`\`\`

and the run shows:

\`\`\`json
{ "variable": "redacted", "file": "customer-onboarding-redacted.docx", "redactions": 7, "counts": { "term": 1, "email": 2, "phone": 2, "credit_card": 1, "iban": 1 } }
\`\`\`

The card number passed the Luhn check and the IBAN the mod-97 check, so other long numbers are left alone. With **Replace with: █████** (\`block\`) each character becomes █ and the length stays visible; with **Custom** (\`text\`) every match becomes your text, such as \`[REMOVED]\`.

## 3. Share it

Attach \`{{redacted_file}}\` to a [Send Email](/docs/workflows/nodes#node-send-email) to the warehouse, or upload it with a storage connector. To double-check, add [Inspect Document](/docs/workflows/documents/inspect-document) with **Search with context** for \`@\` on \`{{redacted_file}}\` and branch when \`{{inspection_match_count}}\` is not 0.

## PDFs and other formats

A PDF cannot be edited in place safely, so Redact Document **rebuilds it from the redacted text**: the new PDF has the text, headings, lists and tables, and none of the redacted text, but not the original layout, fonts or images. The run logs: "The redacted PDF is rebuilt from the text: the original layout and images are not kept, and no redacted text remains in it". Its standard fonts show Latin (Windows-1252) characters only; others become "?". HTML stays HTML; OpenDocument files become PDF; **Redacted copy** can force \`pdf\`, \`html\` or \`text\` for any input.

For a scanned PDF, add \`"ocr": "auto"\` to the Redact step's configuration so the scanned pages have text to redact.
`,
  },
  {
    slug: 'workflows/documents/how-to/invoice-pdf',
    title: 'Capture invoice PDFs into a table',
    description: 'Read supplier invoices (text or scanned PDFs), extract the invoice number, dates and total, and insert them into an Invoices data table.',
    body: `
Suppliers email Northwind their invoices as PDFs — most generated by their accounting system, a few scanned. This workflow reads each invoice, picks out the invoice number, the dates and the total, and adds a row to an **Invoices** [data table](/docs/data-tables). Invoices it cannot read are sent to a person.

**Steps:** start form → Read Document (OCR for scans) → Extract from Document → Branch by Condition → Data (insert), or a User Task.

The invoice from Exotic Liquids reads:

\`\`\`text
Invoice INV-2026-0042

Date: 15 October 2026
Bill to: Exotic Liquids, accounts@exotic.example

Product Qty Amount
Chai 10 $180.00
Chang 5 $95.00

Total due: NZ$275.00 by 2026-11-14
\`\`\`

## 1. Data table and start form

Create **Invoices** with the columns \`invoice_number\` (text), \`supplier_email\` (text), \`invoice_date\` (date), \`due_date\` (date), \`total\` (number), \`currency\` (text) and \`pages\` (number). Give the workflow a start form with an **Attachments** field \`invoice\` (**PDF only**, at most 1 file).

## 2. Read the invoice

\`\`\`json title="Read Document"
{
  "type": "doc_read",
  "label": "Read invoice",
  "config": {
    "source": "{{form.invoice}}",
    "ocr": "auto",
    "ocr_languages": "eng",
    "output_var": "invoice"
  }
}
\`\`\`

The canvas shows \`OCR auto → invoice\`. With **OCR: Pages without text**, a PDF from an accounting system is read from its text layer (OCR never starts), and a scan is recognised page by page. For a text PDF the run shows:

\`\`\`json
{ "variable": "invoice", "file": "INV-2026-0042.pdf", "format": "pdf", "pages": 2, "words": 33, "characters": 219, "rows": 2, "tables": 1, "truncated": false, "text_preview": "Invoice INV-2026-0042 Date: 15 October 2026 Bill to: Exotic Liquids, accounts@exotic.example Product Qty Amount Chai 10 $180.00 Chang 5 $95.00 Total due: NZ$275.00 by 2026-11-14 Page two: terms and conditions apply." }
\`\`\`

For a scan, each page in \`{{invoice.structure.pages}}\` has \`has_text_layer: false\` and an \`ocr\` entry with its confidence. OCR needs a provider on the instance; see [Scanned PDFs and OCR](/docs/workflows/documents/ocr).

## 3. Extract the values

Extract from Document takes text as well as files, so give it the text Read Document already has — the PDF is not read, or recognised, a second time:

\`\`\`json title="Extract from Document"
{
  "type": "doc_extract",
  "label": "Extract invoice fields",
  "config": {
    "source": "{{invoice_text}}",
    "extract_tables": false,
    "patterns": [
      { "name": "invoice_number", "pattern": "Invoice\\\\s+(INV-[\\\\d-]+)" },
      { "name": "total_text", "pattern": "Total due:\\\\s*(\\\\S+)" }
    ],
    "finders": ["emails", "dates", "amounts"],
    "date_order": "DMY",
    "output_var": "invoice_data"
  }
}
\`\`\`

The canvas shows \`2 patterns · emails, dates, amounts\`. The result:

\`\`\`json title="{{invoice_data}}"
{
  "file": "text.txt",
  "rows": [],
  "values": { "invoice_number": "INV-2026-0042", "total_text": "NZ$275.00" },
  "found": {
    "emails": ["accounts@exotic.example"],
    "dates": [{ "text": "15 October 2026", "date": "2026-10-15" }, { "text": "2026-11-14", "date": "2026-11-14" }],
    "amounts": [
      { "text": "$180.00", "value": 180, "currency": "USD" },
      { "text": "$95.00", "value": 95, "currency": "USD" },
      { "text": "NZ$275.00", "value": 275, "currency": "NZD" }
    ]
  }
}
\`\`\`

- \`{{invoice_data_invoice_number}}\` is \`INV-2026-0042\`.
- The **amounts finder** turns \`NZ$275.00\` into a number and a currency. The total is the last amount on this layout: \`{{=LAST(PLUCK(invoice_data.found.amounts, "value"))}}\` is \`275\` and \`{{=LAST(PLUCK(invoice_data.found.amounts, "currency"))}}\` is \`NZD\`. The line items before it are read as \`USD\` because a plain \`$\` is US dollars — another reason to take the total from the "Total due" line.
- The **dates finder** gives ISO dates in the order they appear: the invoice date first, the due date last. **Date order: Day first** reads \`03/04/2026\` as 3 April.

Patterns match within one line and go through the ReDoS guard. Adjust them to each supplier's wording (\`Invoice No\\.?\\s*(\\S+)\`, \`Amount due\\s*(\\S+)\`), or add one Extract step per supplier behind a condition on \`{{invoice_data.found.emails.0}}\`.

## 4. Check, then insert

Add **Branch by Condition**: when \`{{invoice_data_invoice_number}}\` **is empty**, the invoice could not be read — send it to a [User Task](/docs/tasks) for manual entry. You can also route scans with low OCR confidence there: \`{{=MIN(PLUCK(invoice.structure.pages, "ocr.confidence"))}}\` **less than** \`70\`.

On the **Else** path, insert the row:

\`\`\`json title="Data (insert)"
{
  "type": "update_data_table",
  "label": "Save invoice",
  "config": {
    "table_id": "<invoices-table-id>",
    "table_name": "Invoices",
    "operation": "insert",
    "column_values": {
      "invoice_number": "{{invoice_data_invoice_number}}",
      "supplier_email": "{{invoice_data.found.emails.0}}",
      "invoice_date": "{{=FIRST(PLUCK(invoice_data.found.dates, \\"date\\"))}}",
      "due_date": "{{=LAST(PLUCK(invoice_data.found.dates, \\"date\\"))}}",
      "total": "{{=LAST(PLUCK(invoice_data.found.amounts, \\"value\\"))}}",
      "currency": "{{=LAST(PLUCK(invoice_data.found.amounts, \\"currency\\"))}}",
      "pages": "{{invoice.metadata.pages}}"
    }
  }
}
\`\`\`

The run ends with a new **Invoices** row: \`INV-2026-0042\`, \`accounts@exotic.example\`, 2026-10-15, 2026-11-14, 275, \`NZD\`, 2.

## Line items too

To store the lines as well, add a second Extract step on the file itself (\`"source": "{{form.invoice}}"\`, \`"to_table": true\`) into an **Invoice lines** table: the table \`Product / Qty / Amount\` is found from the positions of the text on the page. That works for text PDFs only — tables are not detected on OCR'd pages — and, being best effort, for simple grids. See [Extract from Document](/docs/workflows/documents/extract#inserting-rows-into-a-data-table).

## Messy layouts: use an agent

When suppliers' layouts vary too much for patterns, replace step 3 with [Run Agent](/docs/workflows/documents#summarise-or-classify-with-ai): put \`{{invoice.markdown}}\` in the prompt ("Return the invoice number, invoice date, due date, total and currency of this invoice") and give the agent declared outputs \`invoice_number\`, \`invoice_date\`, \`due_date\`, \`total\` and \`currency\`. They become workflow variables you map in the Data step the same way. Keep the condition in step 4: check that the values are there before you insert them.
`,
  },
]
