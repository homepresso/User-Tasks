# Release notes: Document actions

Seven new workflow steps work with documents inside a run: read Word,
Excel, PowerPoint, PDF and text files, compare two versions, convert
between formats, change PDFs, extract values, redact personal data and
inspect files. They run in the app's process with pure JavaScript
libraries; OCR for scanned PDFs and high-fidelity Office → PDF conversion
are optional. Docs: [Document actions](/docs/workflows/documents).

No database migrations.

## Added

- **Read Document** (`doc_read`): any supported file → plain text,
  Markdown, sanitised HTML, metadata (title, author, dates, page / slide /
  sheet counts, word and character counts, reading time), a structure for
  the format (headings, links, tables, sheets, slides, pages, comments,
  tracked changes, front matter, outline, form fields, parsed JSON / YAML /
  XML) and `rows` to loop over. Sheet, A1 range, header-row detection, page
  ranges, tracked changes as accepted or shown.
- **Compare Documents** (`doc_compare`): two files, texts, row lists or
  JSON values. Text by lines, words, characters or sentences; spreadsheets
  row by row and cell by cell, matched on key columns, with a number
  tolerance; JSON as a deep diff with paths. Ignore whitespace, case and
  punctuation. Statistics, similarity (0–100), a unified diff, a
  side-by-side HTML report that works as an email body, and optionally a
  Word redline (coloured, or real tracked changes), a PDF redline and an
  HTML or PDF report file.
- **Convert Document** (`doc_convert`): to PDF, Word, HTML, Markdown, text,
  CSV, Excel and JSON. Built-in converters, or an external
  Gotenberg-compatible service for Office → PDF.
- **PDF Tools** (`doc_pdf`): merge, split (ranges or every N pages),
  extract pages, count pages, watermark / stamp text, rotate, fill AcroForm
  fields (optionally flattened) and read them.
- **Extract from Document** (`doc_extract`): tables, named regular
  expressions, and finders for emails, URLs, phone numbers, dates (ISO),
  money amounts (value and currency) and percentages; optionally inserts
  the rows into a data table (column mapping or automatic by key / label;
  row-created workflows fire).
- **Redact Document** (`doc_redact`): presets for emails, phone numbers,
  card numbers (Luhn-checked), IBANs (mod-97-checked), US SSNs, IP
  addresses, URLs and dates, plus words and custom patterns; replaced with
  █ blocks, `[LABEL]`s or your text. Word, PowerPoint and Excel copies are
  redacted in place (formatting kept, author properties cleared); text
  formats keep their format; PDFs are rebuilt from the redacted text.
- **Inspect Document** (`doc_inspect`): file type from the content
  (extension mismatches flagged), SHA-256 / SHA-512 / SHA-1 / MD5,
  word / character / line counts and reading time, and search with line,
  page and context.
- **File inputs** for every document step: form attachments and files from
  other steps (a list → its first file; Merge takes them all), `storage://`
  references, URLs through the egress guard, base64 content and text.
  Output files are stored through the storage provider and returned as
  file objects (`name`, `url`, `size`, `mime_type`, `storage_ref`,
  `checksum_sha256`, …), the same shape as form attachments.
- **Data picker**: each step's outputs (for example `{{document.metadata.pages}}`,
  `{{comparison_html}}`, `{{extracted_<pattern>}}`) are listed with their
  fields.
- **OCR for scanned PDFs and images** (off by default; `auto` recognises
  only pages without a text layer, `force` every page), with a per-page
  confidence. Providers: tesseract.js (default, optional package) or Azure
  AI Document Intelligence (`DOCUMENT_OCR_PROVIDER`). Air-gapped installs
  provide the language data locally (`DOCUMENT_OCR_LANG_PATH`). See
  [Scanned PDFs and OCR](/docs/workflows/documents/ocr).
- **External converter** (optional): `DOCUMENT_CONVERTER_URL` points at a
  Gotenberg-compatible service on your network (LibreOffice for Office
  files, Chromium for HTML and Markdown); `DOCUMENT_CONVERTER_TOKEN` and
  `DOCUMENT_CONVERTER_TIMEOUT_SECONDS` (120). Convert Document's
  **Automatic** engine uses it for Office → PDF when it is set. It also
  converts Word / Excel / PowerPoint 97–2003 files to PDF.
- **Docs**: an overview, one page per step, OCR, and how-tos (Excel into a
  data table, contract redline by email, extract and redact, invoice PDFs
  into a table). To summarise or classify a document with AI, add a
  **Run Agent** step after Read Document with `{{document.text}}` in its
  prompt.

## Security

- **ZIP bombs:** Office and OpenDocument files are checked before
  unpacking (part count, declared sizes) and every part is inflated with a
  hard output cap; encrypted entries and ZIP64 are refused.
- **XML:** a document with a DOCTYPE is refused (no external entities, no
  entity expansion); depth and node count are bounded.
- **HTML** output is rebuilt from escaped text and passed through the
  allow-list sanitiser; HTML input is tokenised, scripts and active content
  dropped. Compare reports are built from escaped text only.
- **PDF** is read with pdf.js (unpdf) with `eval` off, no system fonts and
  no font faces. Encrypted PDFs are refused.
- **Regular expressions** in Extract, Redact and Inspect go through the
  ReDoS guard and run line by line (Extract, Redact).
- **Tenant scoping:** inputs are read for the run's workspace only
  (another workspace's file is "not found"), outputs are written to its
  workflow-files folder, and Extract writes only to its own data tables.
- **Network:** URL inputs go through the egress guard with redirects
  re-checked and the size limit applied while downloading. Files leave the
  instance only for a configured cloud OCR provider or external converter.

## Limits

Instance-wide, from the environment (see `.env.example`):

| Variable | Default |
|---|---|
| `DOCUMENT_MAX_MB` | 25 |
| `DOCUMENT_MAX_UNPACKED_MB` | 250 |
| `DOCUMENT_MAX_PDF_PAGES` | 500 |
| `DOCUMENT_TIMEOUT_SECONDS` | 60 |
| `DOCUMENT_OCR_MAX_PAGES` | 20 |
| `DOCUMENT_OCR_TIMEOUT_SECONDS` | 120 |
| `DOCUMENT_CONVERTER_TIMEOUT_SECONDS` | 120 |

Fixed: 2,000,000 spreadsheet cells, 2,000,000 characters of text per
output, merges of at most 50 files, and at most 5,000 rows written to a
data table per Extract run.

## New dependencies

| Package | Version | Licence | Used for |
|---|---|---|---|
| `unpdf` | 1.8.1 | MIT | Reading PDFs (pdf.js) |
| `@cantoo/pdf-lib` | 2.11.1 | MIT | PDF tools and PDF output |
| `marked` | 18.1.1 | MIT | Markdown → HTML |
| `diff` | 9.0.0 | BSD-3-Clause | Text comparison |
| `tesseract.js` (optional) | 7.0.0 | Apache-2.0 | OCR. WebAssembly, about 45 MB; left out of the Docker image unless built with `INCLUDE_OCR=true` (installed by `npm ci` / `npm install` and on Vercel) |

See [Optional drivers](../optional-drivers.md).

## Known limitations

- **Word / Excel / PowerPoint 97–2003** (`.doc`, `.xls`, `.ppt`) cannot be
  read; with the external converter they can be converted to PDF.
- **Built-in PDF output uses the standard PDF fonts**, which cover Latin
  (Windows-1252) characters only; other characters become "?" with a
  warning. Configure the external converter for other scripts.
- **Built-in DOCX → PDF** keeps text, headings, lists and tables, not the
  layout (fonts, columns, headers and footers, images).
- **PDF tables** are reconstructed from text positions: best effort, for
  simple grids, and not on OCR'd pages.
- **PDF redaction** rebuilds the PDF from the redacted text: nothing
  redacted remains, but the layout and images are not kept.
- **No OCR by default:** scanned pages are flagged with a warning until OCR
  is turned on in the step and a provider is available.
- **User regular expressions** (Extract and Redact patterns) match within
  one line.
- **Extract** writes at most **5,000 rows** to a data table per run.
