# Release notes: the PDF importer brings in styling and images

Importing a PDF form now brings across how it looks, not only its fields.
**Bring in styling and images** is on by default in the import dialog; it
works without AI.

## New

- **Logo and pictures.** The logo at the top of the PDF becomes the form
  header's image (once, even when the PDF repeats it on every page).
  Pictures near the fields become Display images where the PDF has them.
  Page backgrounds and watermarks are left out unless you ask for them.
  Pictures are re-encoded as new PNG files (no original image bytes or
  metadata are kept), stored like any form picture and stored once when
  repeated. Up to 20 per import.
- **A theme from the PDF.** A new form theme named after the form: the
  accent from the header band, heading bands, heading colour or logo, the
  header band as the header's banner, a page tint as the background, and
  the PDF's fonts matched to the closest font the theme serves (Helvetica /
  Arial → Arimo, Times → Tinos, Calibri → Carlito …). Every colour is
  checked for WCAG AA contrast and adjusted when needed. Or keep the
  workspace theme.
- **Headings, instructions and dividers.** Styled headings with fields
  under them become sections (bordered when the PDF boxes the group); other
  headings become Heading elements sized like the PDF's. Instructions,
  notes and legal text become read-only text in the right place, with
  bold / italic / colour kept. Lines across the page become dividers.
- **Repeated headers, footers and page numbers** are left out (keep the
  footer once if you want it). Pages without fields — instruction pages —
  are left out too.
- **Preview and report.** The preview shows the form in its new theme with
  its header. The mapping report lists the theme's colours and fonts (and
  contrast changes), each font, the header, every picture (placed or left
  out, and why), headings, text blocks and what was skipped.
- **The public "Try a PDF form" preview** shows the styling too, with small
  inline pictures that are never stored.

## API

New options on the `pdf` importer: `styling` (default `true`),
`styling_images`, `styling_theme` (`new` | `workspace`), `styling_text`,
`styling_backgrounds`, `styling_footer`. `styling: false` gives the import
exactly as before.

## Safety

Scripts in the PDF are still never run. Pictures are decoded by the PDF
reader and written out again as plain PNGs (no SVG comes out of a PDF);
text is carried as plain text. Reading the styling counts towards the
import's time limit, and the fields always come first.
