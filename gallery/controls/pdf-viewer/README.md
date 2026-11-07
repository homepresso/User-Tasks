# PDF viewer

`<ut-pdf-viewer>` — shows a PDF inside the form (a contract, a quote, a policy, an invoice), from
an Attachments field the designer maps or from an upload, one page at a time with zoom, fit to
width and rotation. Each page's text is available to screen readers.

## Value

Type `files`: `[{ "id", "name", "size", "type" }]` (at most one file), or empty (`null`).
The value is only set when uploads are allowed and the person uploads a PDF; a document shown
from the mapped Attachments field is not copied into this field. Read-only views (completed
tasks, mobile, emails) list the uploaded file's name.

Which PDF is shown:

1. the control's own value (an uploaded PDF), if there is one;
2. otherwise the first PDF (by type `application/pdf`, or a `.pdf` name) in the `document`
   context entry;
3. otherwise an empty state: "No document yet — map an Attachments field in the designer, or
   allow uploads".

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Allow uploading a PDF (`allow_upload`) | yes / no | no | Shows "Choose a PDF"; the upload becomes the value (Replace / Remove once set). Up to 25 MB; the file must start with a PDF header |

## Context

| Name | | |
|---|---|---|
| `document` | Document | An Attachments field of the form; the first PDF in it is shown |

## Keyboard and screen readers

- The toolbar has Previous page / Next page, "Page 2 of 7" (announced politely when it changes),
  Zoom out / Zoom in, Fit to width (a toggle) and Rotate clockwise.
- The page area is a focusable region named "<label>: <file name>". In it: Page Down / Page Up
  turn pages (on a zoomed page they scroll first, then turn), Home / End go to the first / last
  page, Left / Right turn pages when the page isn't scrolled sideways, + / - zoom, 0 fits the width.
- The page canvas is an image named "Page 2 of 7, contract.pdf", followed by the page's text
  (from `page.getTextContent()`) in a visually hidden element. Scanned pages without a text layer
  say so.
- Loading is announced (`role="status"`); errors (not a PDF, damaged, password-protected, the
  request refused) are shown inline with `role="alert"`.

## Capabilities

`files`:

- `request('file', { id })` reads the bytes of the mapped Attachments field's PDF (the host only
  hands over files that are in the control's own value or its context values);
- `request('upload', { name, type, bytes })` stores an uploaded PDF (when uploads are allowed).

No network access. Bundles Lit 3.3.3 (BSD-3-Clause) and PDF.js (`pdfjs-dist` 5.4.624,
Apache-2.0), including its worker code. The module is about 1.4 MB.

## Security and sandbox notes

The form's sandbox forbids Workers and `eval`, so PDF.js runs its worker code in the main thread
(the "fake worker": the bundled `pdf.worker.min.mjs` is exposed as `globalThis.pdfjsWorker`) and
documents are opened with `isEvalSupported: false`, no URLs (`data` only, no range or stream
requests) and no `standardFontDataUrl` / `cMapUrl` / `wasmUrl`. Consequences: fonts a PDF doesn't
embed use the system's fonts (`useSystemFonts`), some CJK text in PDFs relying on external CMaps
may not render, and JPEG 2000 images (which need PDF.js's WebAssembly decoder) may be missing.
Only the current page is rendered (canvas capped at about 16 million pixels) to keep memory low.
Annotations, forms and links inside the PDF are not interactive.
