import type { DocPageDef } from '../types'

export const PDF_IMPORT_PAGE: DocPageDef = {
  slug: 'tasks/import-pdf',
  title: 'Import a PDF form',
  description: 'Upload a fillable PDF form: its fields, labels, choices, required fields, formats, show / hide scripts and printed "go to question …" instructions become a UserTasks form, with a report of what mapped. An optional AI assist reads flat and scanned PDFs with your own AI provider.',
  body: `
UserTasks reads fillable PDF forms and rebuilds them as UserTasks forms. The file is only read for the import and is never stored, and **scripts in the PDF are never run**: they are read as text and translated where they match a known pattern.

## What it reads

| PDF | What becomes of it |
|---|---|
| **Fillable PDF (AcroForm)** | Text boxes, multi-line boxes, checkboxes, radio buttons, drop-downs, list boxes and signature fields become fields |
| **Fillable PDF with an XFA template** (many government forms) | The same, with the template's captions, exclusive groups and required flags |
| **Dynamic XFA form** (Adobe LiveCycle / AEM Designer) | Fields, captions, sections, required fields, fields that start hidden and simple show / hide scripts |
| **Flat or scanned PDF** | The preview says **This PDF has no fillable fields**. Use the AI assist, or build the form by hand |

Labels come from the field's tooltip, then the XFA caption, then the text printed next to the field, then the field's internal name. The report says which one each label came from.

The importer also:

- turns Acrobat formats into field types: dates, currency (in its symbol's currency, US dollars by default), numbers, percentages, ZIP codes, phone numbers and social security numbers, ranges and masks;
- merges boxes that belong together: a date split into DD / MM / YYYY boxes, a social security number in three boxes, separate Yes / No checkboxes for one question, and checkboxes kept mutually exclusive by a script;
- marks fields as required when the PDF says so (its Required flag, which some PDF templates set on fields that show no asterisk), when the label has an asterisk, or when it says "(required)" or "An entry is required";
- turns show / hide scripts into form rules;
- turns calculated fields into calculated form fields: Acrobat's sum, average, product, minimum and maximum, and simple formulas such as "a + b × 2". The result is worked out as people type, checked again by the server and saved with the submission; the fields it adds up become number fields;
- reads printed routing such as "If No, go to question 10" or "Answer questions 4–5 only if you ticked Yes". When the answer and the questions are found, it makes a rule that hides the questions in between. Otherwise it makes the rule **turned off**, with the printed sentence in its description, for you to finish;
- puts each PDF page in a step (or everything on one page, if you choose), and "Part" / "Section" headings in sections.

## Tables become repeating lists

Many PDFs print a list as a grid of boxes: a rooming list with "Room #1" to "Room #16", an expenses table, a list of dependants. Imported box by box, a 16 × 6 grid would become 96 separate fields. Instead, the importer finds these tables and turns each one into **one repeating section**. Each column becomes a control in the section, and people add a row for each entry they need.

- **Columns** take their labels from the header printed above each column, such as "Name 1", "Bed Type" or "Special Requests/Notes". A header with examples ("For example, …") gives the label, and the examples become the help text. Each column keeps its type: text, date, number or currency, a checkbox, or a choice with the drop-down's options.
- **Row labels** such as "Room #1", "1." or "Item 3" are numbering, so they're dropped and the list is named after them ("Rooms", with an "Add room" button and "Room 1", "Room 2" … on each row). Row labels that carry meaning, such as fixed categories, become a choice column.
- **Rows**: the list starts with one empty row and allows as many rows as the PDF has (16 for the rooming list). Choose **No limit** in the preview to allow up to 200.
- **Totals**: a field that adds up a column (Acrobat's sum) becomes a calculated field that adds up the list's column.
- A table continued on the next page with the same columns becomes one list. A table whose columns are the entries ("Dependent 1", "Dependent 2" … over "First name", "Last name" …) is turned round. A repeating subform in an XFA form becomes a list too.
- **Show / hide rules** aimed at every box of a column now show or hide that column in every row. Rules that read a box in the table, or show or hide single boxes, are created turned off, and the report says why.

The preview lists the tables it found, with their columns and rows. Untick **Turn tables into repeating lists** to keep every box as its own field, or untick one table to keep just that one. Boxes kept this way are labelled with their column and row, such as "Bed Type (Room #4)". The mapping report shows each table, where each column's label came from, and the PDF fields it replaced.

A normal form layout, such as boxes side by side with their own labels, is never treated as a table. Neither is a grid of checkboxes (an availability calendar, for example).

Scripts it doesn't recognise (including calculations with conditions) and buttons are listed in the report. Nothing is dropped silently. A form holds up to 200 fields: a bigger PDF becomes several forms, split at page boundaries.

## Styling and images

With **Bring in styling and images** (on by default), the importer also brings across how the PDF looks. It reads the page's pictures, lines, coloured bands and text styles itself; no AI is needed.

- **Logo and pictures.** A picture at the top of page 1 (often repeated on every page) becomes the form header's image, once. Other pictures near the fields, such as a diagram or a map, become **Display images** where the PDF has them, with a width and alignment close to the PDF's. Full-page pictures and faint watermarks are left out unless you tick **Page backgrounds and watermarks**. Tiny pictures (bullets, ticks) and ornaments repeated on every page are left out. Pictures are decoded and saved again as new PNG files, so nothing of the original image files (or their metadata) is kept. They're stored with the form like any picture you add in the designer, and a picture used twice is stored once. An import brings in up to 20 pictures.
- **Theme.** A new form theme, named after the form, is made from the PDF's colours and fonts. The accent comes from the header band, the bands behind headings, the heading colour or the logo, and the header band's colour becomes the header's banner. A page tint becomes the background and a coloured body text becomes the text colour. Each colour is checked for contrast (WCAG AA, 4.5:1): a colour that's too light for white button text or links is darkened, and the report says so. The PDF's fonts are matched to the closest font the theme can use: for example Helvetica and Arial → Arimo, Times → Tinos, Calibri → Carlito, Cambria → Caladea. The PDF's own font files are never used. A plain black-on-white PDF in Helvetica or Arial gets no theme of its own, because the workspace theme suits it just as well. Choose **Workspace theme** to skip the theme.
- **Headings and sections.** Larger or bold text, and text on a coloured band, is read as a heading. A heading with fields under it becomes a section with that title: bordered when the PDF draws a box round the group, plain otherwise. Other headings become **Heading** elements, sized relative to the PDF's body text and in the heading's colour.
- **Instructions and notes.** Printed text that isn't a field's label, an option or a column header becomes read-only text in the right place: instructions, notes and legal text. Paragraphs are kept together, and bold, italic, colour and small print are kept. The text is plain text; it's never treated as a formula or as HTML.
- **Dividers.** Lines drawn across the page become **Dividers**. Lines under fields, table grids and the edges of bands are not dividers.
- **Headers, footers and page numbers.** Text repeated at the top or bottom of the pages, and page numbers, are left out. Tick **Keep the page footer once** to keep the footer at the end of the form.
- **Labels** printed bold, italic or in colour (when most labels aren't) keep that look.

Pages without fields (instruction pages, as many tax forms have) are left out, and the report lists what was skipped there. Styling isn't read from dynamic XFA forms, whose look is built when they open, and a flat PDF's printed text isn't brought in, because there it is the questions themselves.

The preview shows the form in the new theme, with its header. The report has an entry for the theme (the colours and fonts chosen, and any contrast changes), each font, the header, each picture (placed or left out, and why), each heading, the text blocks and the headers and footers left out. Untick **Bring in styling and images** for the plain import.

## Import a PDF form

1. Go to **Build › Forms** and select **Import → PDF form (.pdf)**.
2. Drop the PDF onto the box, or click to browse (up to 4 MB).
3. Check the preview. It shows the counts, a working copy of the form (nothing is saved while you try it) and the mapping report. You can download the report as Markdown or JSON.
4. Choose the form name, steps or one page, which tables become repeating lists, what styling to bring in, and whether to show the form in the Forms menu.
5. Select **Import as a form**, then **Open in the designer**. Review the labels marked for review and the rules that are turned off.

You need **forms.edit** to import.

## The AI assist (optional)

For the hard parts, such as flat and scanned PDFs, unclear labels, Yes / No grids and printed instructions the importer couldn't resolve, you can tick **Use AI for the hard parts**. It uses your workspace's own AI provider and key, the one set in **Settings › Agent**.

- It is **off by default**. An admin must first turn on **Let importers use AI for hard PDFs** in Settings › Agent. Without a provider, the option shows as unavailable with a link to set one up.
- Before anything is sent, the dialog says which provider will receive the PDF's content, and you confirm. The PDF's text (with positions) and its field list are sent. For scanned pages, the page images are sent if the model can see; otherwise the instance's OCR text is sent, when OCR is installed.
- The provider's answer is checked against the importer's format. An answer that doesn't fit is rejected; the importer never trusts it blindly. Everything it adds or changes is marked **AI — review** in the report.
- Usage counts towards the Agent's limits (daily messages and monthly cost caps). Each send is recorded in the audit log, with the file, provider, model and the number of pages and images.
- With the option off, nothing is sent anywhere.

## From the API

The importer is \`pdf\` on the importer endpoints: \`POST /api/v1/importers/pdf/analyze\` and \`POST /api/v1/importers/pdf/import\`, with the PDF as base64. Options: \`name\`, \`pages\` (\`steps\` or \`single\`), \`available_in_menu\`, \`tables\`, \`keep_tables\`, \`table_rows\`; for styling \`styling\` (default \`true\`), \`styling_images\`, \`styling_theme\` (\`new\` or \`workspace\`), \`styling_text\`, \`styling_backgrounds\` and \`styling_footer\`; and for the AI assist \`ai\`, \`ai_consent\` and, at import, \`ai_result\` (the \`report.details.ai.answer\` the analysis returned, so the provider isn't called twice).
`,
}
