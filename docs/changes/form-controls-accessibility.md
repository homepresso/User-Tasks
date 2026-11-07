# Release notes: custom form controls and the accessibility checker

Forms get **custom controls** — your own web components as field types —
and an **Accessibility** panel that checks every form against WCAG 2.2 AA.
Existing forms are unchanged.

## What's new

- **Custom form controls.** Upload a web component (Lit, plain JavaScript or
  anything that compiles to a custom element) with a `manifest.json` in
  **Extensibility → Form controls**: a zip, a module plus its manifest, or
  an `https://` URL fetched once. Enabled controls appear in the designer's
  palette under **Custom**, with a properties panel generated from the
  manifest, a version picker and a mapping of the context fields they read.
- **Everywhere forms render.** The designer preview, task forms, form pages,
  start forms, Save & Test and Run, with grids, Visible when, required,
  themes and steps. Read-only views show the manifest's display template
  (for example "4 of 5 stars").
- **Values like any field.** `{{task_data.<key>}}` / `{{form.<key>}}`, typed
  by the manifest (`string`, `number`, `boolean`, `date`, `json`, `array`,
  `files`) and validated on the server against its JSON Schema.
- **Starter kit.** [form-control-starter.zip](/downloads/form-control-starter.zip):
  a star rating in Lit + TypeScript and in plain JavaScript, a dev harness
  that mocks the host and logs every event, and build / package scripts.
- **Accessibility checker.** A score, findings by severity with their WCAG
  success criteria, **Fix** buttons for safe fixes (labels, autocomplete
  tokens, theme contrast, alt text), an axe-core scan of the live preview,
  CSV / PDF reports (background job) and a workspace setting (**Settings →
  Forms**: off / warn / block below a minimum score) checked when a form is
  saved. New field property **Autocomplete (input purpose)** and header
  **Image description**.
- **API clients.** `/api/v1/form-controls`, MCP `form_controls_*`,
  `usertasks form-controls …`; `usertasks forms check-accessibility <id>`,
  MCP `forms_check_accessibility` and `POST /api/v1/forms/{id}/accessibility`.

## Security

Each control runs in a sandboxed frame with an opaque origin and a strict
Content Security Policy: no access to the app's cookies, storage or page,
no network unless the manifest asks for hosts **and** an admin approves
them, and lookups and uploads go through the form with the user's own
permissions. Modules are snapshotted with a SHA-256 checksum and never
loaded from their source at runtime; versions are immutable. Rendering a
control inline (*trusted*) is an instance-admin opt-in. See
[Custom form controls](/docs/tasks/custom-form-controls#security-model).

## Portability

Controls are the asset type `form_control` in exports, packages and config
as code, and travel with the forms and workflows that use them (identity
is the tag; versions a workspace lacks are added, checksums verified).
Community gallery packages can't contain them (custom code).

## Upgrade

Apply `supabase/migrations/20261201000000_form_controls.sql` (additive).
The accessibility setting lives in the existing workspace settings; no
migration.
