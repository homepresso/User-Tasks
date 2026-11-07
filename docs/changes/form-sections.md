# Release notes: form sections, a resizable designer and form width

Forms can now group fields into real **sections** (optional, collapsible,
targeted by rules), the form designer can be **resized and maximized**, and
a form can be **narrow, wide, full width or a custom percentage**. Four rule
engine gaps found while building gallery packages are fixed. Existing forms
are unchanged and nothing is migrated (no database change).

## What's new

- **Sections.** Choose **Section** in the designer's palette, then drop fields
  into it. A section has a title, a description, and these options:
  - **Optional:** the person presses **Add …** to fill it in, and **Remove**
    to take it out again.
  - **Collapsible**, and **Start collapsed**.
  - **Bordered** or **Plain**.
  - **Visible when**.

  Sections sit inside steps and tabs, and they don't nest.

  Storage: `layout.sections` declares each section, and `rows[].section`
  puts a row in one. Older readers ignore both and show the fields flat.
- **Optional sections in submissions.** A left-out section's fields are not
  required and not checked, and the server stores them **empty** (null,
  false or []). It also stores `<key>_included: true | false` for workflows
  to branch on.
  - API callers send `"<key>_included": true` to include a section.
  - `<key>_included: false` sent for a non-optional section is ignored.
- **Rules on sections:**
  - **Show / hide** and **Enable / disable** take `section:<key>`.
  - A new **Collapse / expand a section** action.
  - A new **Section added / removed** event.
  - New conditions: `section.<key>.included` and `section.<key>.visible`.
- **Older forms.** A `section:<heading key>` target still means "the heading
  and the rows under it, up to the next heading or divider". **Convert
  heading to section** upgrades a heading: it rewrites the heading's targets
  and carries over its description and Visible when.
- **Headings and dividers** can have **Visible when**. It used to be dropped
  on save.
- **Read-only views.** Task views, the review step and Submissions show each
  section's title, and **Not included** for a section left out.
- **Accessibility.** A section renders as a fieldset with its title as the
  legend. A collapsible section's toggle has `aria-expanded`. The checker
  flags:
  - a collapsed section that holds required fields;
  - a generic section title.
- **Resizable designer:**
  - Drag the dialog's edges or corners to resize it.
  - **Maximize** with the header button, or by double-clicking the header.
  - Hide the palette or the properties panel.
  - The designer remembers its size in this browser. On phones it is always
    full screen.
- **Form width.** **Form theme → Form width** offers Narrow, Normal, Wide,
  Full and **Custom %** (40–100 % of the available space, with a 320 px
  floor; always 100 % on phones). It applies on `/f/` pages, the task screen,
  Save & Test and the designer Preview.
- **Wide Data tables** scroll sideways inside the card, with the first column
  kept in place. **Full width** on a Data table gives the form a wide card.
- **Available forms hint.** A form's Access section says when people have
  access but **Available forms** is off, with a one-click **Turn on**. It
  also says when the reverse is true, and how many grants show the form.

## Fixes (form rules)

- **Before submit on steps.** A Before-submit rule no longer runs on a step's
  **Next**, unless the rule has **Also check on this step** ticked. Before,
  an error on a field of another step made **Next** refuse silently. When
  such a rule blocks the submission, the form now jumps to the step that
  holds the field and shows the error.
- **Bar-button targets on the server.** A Before-submit rule aimed at one bar
  button is now checked for that button only on the server, the same as in
  the browser. A task completed from its header counts as the bar buttons
  for its outcome.
- **Rules can write read-only fields.** Set / Copy / Clear values can now
  write a read-only field. The server keeps such a value only when a rule of
  the saved form could have produced it, under the same bound as the
  `__form_state` checks. When the server can compute the value, it must
  match exactly.
- **Visible when on headings** is kept (see above).
