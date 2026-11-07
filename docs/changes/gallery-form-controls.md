# Release notes: form controls in the gallery

The gallery gets a **Form controls** section: official web components that
install into **Extensibility → Form controls** and appear in the form
designer's **Custom** palette. Existing forms and packages are unchanged.

## What's new

- **Official controls.** Chart (bar, line, area, pie from data, another
  field, a lookup or a saved report), Saved report (table or chart, sortable,
  paged), Address search (Google Places, the key stays on the server), Map
  (OpenStreetMap tiles, show or pick a location), Signature, Rating,
  Slider, Rich text (sanitised), Editable table, Likert / survey matrix,
  Progress, Info card and PDF viewer — plus a **Form controls starter pack**
  with all of them. Each is keyboard and screen-reader accessible, follows the
  form theme in light and dark, fits a phone and shows its value as text on
  completed tasks and on mobile. See
  [Gallery form controls](/docs/tasks/gallery-form-controls).
- **Gallery.** `/gallery/controls` lists them with filters (inputs, displays,
  what host services they use); each page has a **live preview** in the same
  sandboxed frame the app uses, the value it produces, its properties, value
  type, capabilities and network hosts, bundled libraries and licences, and
  install steps. `/gallery` has a Workflow packages / Form controls switch.
- **In the app.** **Extensibility → Form controls → Browse gallery** opens
  **Packages → Browse gallery** on the new **Form controls** tab. Controls from
  the signed gallery show **Signed package** with the signer's fingerprint.
- **Two new host services for controls.** `report` (capability `reports`):
  the rows of the saved report the designer chose, run as the person filling
  in the form. `file` (capability `files`): the bytes of a file the form
  already gives the control (its value, or an Attachments field mapped as
  context). `tile` (capability `network`): OpenStreetMap tiles fetched and
  cached by the server.
- **Bigger modules.** A control module may be up to 2 MB (was 1 MB), enough
  for a PDF renderer with its worker inlined.
- **Fix:** packages and config-as-code exports now carry form controls (the
  `form-controls/` folder); they were silently left out before.

## Security

- Controls run sandboxed as before (opaque origin, strict CSP, typed bridge).
- **Google Places:** no API key reaches the browser. The address control asks
  the UserTasks server for suggestions; the server calls Places API (New)
  through an API reference whose key is stored encrypted in an integration.
  (A sandboxed frame has an opaque origin and sends no referrer, so
  referrer-restricted browser keys could not work there anyway.)
- **Reports:** the report a control shows is read by the server from the
  stored form, never from the control; it runs with the viewer's own
  permissions and the own-or-shared rule. Rate limited.
- **Files:** a control can read only files already in its value or its
  mapped context, downloaded with the user's own session.
- **Map tiles** load only after an administrator approves `tile.openstreetmap.org`.
  They come through the server (`tile` request: fetched with an identifying
  User-Agent and Referer, cached, rate limited), because public tile servers
  refuse the sandboxed frame's referrer-less requests.
- Bundled libraries are permissive (MIT, BSD, Apache-2.0) and pinned; the
  gallery build refuses anything else. The community gallery still refuses
  packages with form controls: controls are official only.

## Upgrade

1. Apply `supabase/migrations/20261202000000_form_control_bundle_size.sql`
   (widens the module size check). Additive and idempotent.
2. Deploy. Nothing else to configure; to offer address search, install the
   Address search control and give it a Google Places API key.

## Processes built on the controls (Surveys & Assessments)

- **Six "No integrations needed" packages** use the official controls with
  forms (steps, tabs, review step, mini themes), data tables with sample rows,
  decision tables, SLAs, email templates, saved reports and dashboard form
  pages: Customer satisfaction (CSAT / NPS) survey, Employee pulse survey,
  Training feedback, quiz and certificate, Site inspection with corrective
  actions (new **Surveys & Assessments** category), Event registration with
  session choices (Workplace) and Contract and policy review with internal
  e-sign (Operations & Compliance). Each has a use-case page.
- **Workflow packages ship the official controls their forms use.** A field
  with `custom.tag` of an official control makes the package carry that
  control from `gallery/controls` (sources never copy a module); package pages
  list them and control pages show **Used in**.
- **Saved reports scoped to a workflow** (`source_inputs.workflow_id`) are
  pointed at the workflow the import just created; before, a package or
  config import left them on the source id ("Workflow not found").
- **Signatures and other file-valued controls on task forms** are re-read
  from the upload records like Attachments fields, so the stored value has
  the file's URL, type and checksum (and an upload from another task is refused).
- **Rich text 1.0.1:** fast typing no longer loses text when the form echoes
  an earlier keystroke back late.
- Read-only views show a Likert answer as one "Statement: answer" line per
  statement instead of JSON.
