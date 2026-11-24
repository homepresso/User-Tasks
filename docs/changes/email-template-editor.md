# Release notes: email template editor

Release note line: **Email templates get a full-screen editor — an HTML code
editor and a block-based Design tab beside a live, sandboxed preview
(desktop / mobile, light / dark), with variables, starters, CSS inlining and
"Send test to me" — and workflow steps map a template's variables in a table.**

## What's new

- **Full-screen editor** (Automations → Email templates → New / Edit): the
  editor on the left, the live preview on the right (one at a time on
  phones), subject and preheader above.
- **HTML tab**: CodeMirror code editor (syntax highlighting, line numbers,
  auto-closing tags, bracket matching, find / replace, folding), **Format**,
  `{{` variable autocomplete, and problems underlined as you type — unclosed
  or stray tags, markup common clients drop (flexbox, grid, `position`,
  external stylesheets, `@import`, scripts, forms, frames, video / audio,
  SVG, CSS variables), unknown variables, images without alt text, and the
  HTML size against Gmail's 102 KB clipping limit. The problems list jumps
  to the line.
- **Design tab**: blocks — header / logo, heading, rich text (bold, italic,
  underline, links, lists), button, image, two columns, divider, spacer,
  footer — plus accent / background / text colours and content width. The
  HTML they produce is email-safe: table layout, inline styles, a
  bulletproof button, columns that stack on phones without media queries
  (with an Outlook ghost table) and a `prefers-color-scheme: dark` block.
  The design travels inside the HTML; once the HTML is hand-edited beyond
  what blocks can show, the Design tab is read-only (restore the last design
  or start a new one) and the HTML is what is saved.
- **Live preview** in a sandboxed iframe (no scripts, no forms, no
  navigation; a CSP allows only inline styles and images): Desktop / Mobile
  width, Light / Dark email-client simulation (the template's dark-mode
  rules, or Gmail / Outlook-app style inversion when it has none), zoom,
  subject & preheader inbox header, remote images on / off, and sample data
  from built-in examples or a chosen form's fields.
- **Variables panel**: grouped built-in variables (Task, Workflow, Form,
  Person, Links, Workspace) with descriptions, the template's own variables
  (label, type, sample, description, required) and the sample form's fields;
  click to insert at the cursor in any tab, or drag into the editor. New
  built-ins filled automatically: `{{task_url}}` (link to the task) and
  `{{current_year}}`.
- **Plain text**: *Generate from HTML* (headings, paragraphs, lists, links as
  "text (url)", tables, alt text), or edit by hand. Template emails sent by
  Send Email now include this text part.
- **Starters**: task notification, approval request (with buttons), digest /
  summary and welcome — theme-neutral, branded with the workspace logo,
  accent colour and name.
- **Save**: `<style>` rules are inlined onto elements (dark-mode / responsive
  `@media` rules stay), then the usual sanitiser runs. ⌘S / Ctrl+S saves;
  closing with unsaved changes asks first.
- **Send test**: sends the draft with the preview's sample values to the
  signed-in person only (`[Test]` subject), through the configured provider.
  Needs workflow create / edit permission; 5 per 10 minutes per person, 30
  per hour per workspace; audited (`email_template` · `test_send`). If email
  is not configured, or the provider refuses (for example an unverified
  Resend domain), the editor explains it in plain words and shows the
  provider's message.

## Workflows: template variables on the step

- A **Send Email** step (and a User Task's **assignment notification
  template**) shows the chosen template's variables as a **mapping table**:
  each of the template's own variables gets a value or expression through
  the usual data picker; same-named form fields / task values / workflow
  variables are **auto-mapped**; built-in variables show as *filled
  automatically*; **Preview** renders the email with the mapped samples.
- Config: `template_variables` (Send Email) and
  `notification_template_variables` (User Task) — `{ name: "value or
  {{expression}}" }`. The step keeps a snapshot of the template's variables
  (`_template_variables` / `_notification_template_variables`).
- **Validation**: a variable the template declares *required* must be mapped
  (a publish problem). The designer's wiring check warns about unmapped
  variables nothing before the step sets.
- **Backwards compatible**: unmapped variables still read a same-named run
  value, exactly as before; steps without a snapshot are not checked.

## API / CLI / MCP

- `variables` (declarations: label, type, description, sample, required) on
  email template create / update / get. The variables a template uses are
  always detected from its content; declarations only add details.
- `POST /api/v1/email-templates/{id}/preview` accepts `mappings` (a step's
  `template_variables`) and renders like the engine, including `task_url`.

## Database

- `20270126120000_email_template_variables.sql` adds
  `email_templates.variables jsonb` (additive). Until it is applied,
  templates read as having no declarations (variables are still detected
  from the content) and saves skip storing them.

## Libraries

- CodeMirror 6 (`codemirror`, `@codemirror/*`, `@lezer/highlight`; MIT),
  loaded on demand only when the editor opens. The CSS inliner, HTML
  formatter, HTML → text converter and lint are small built-in modules
  (`lib/email-editor/`), no new server dependencies.

## Not in this release

- Template revision history (templates are not versioned today; the
  activity log records each save).
- Image upload from the Design tab (images are linked by https URL).
- Drag-and-drop reordering of blocks (use the up / down buttons).
