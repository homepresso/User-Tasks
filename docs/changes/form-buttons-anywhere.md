# Release notes: Application mode and buttons anywhere on a form

Forms can hide their Submit and Cancel buttons, and get buttons you place
anywhere on the grid. Existing forms are unchanged: Application mode is off
by default and no form has in-form buttons until you add one.

## What's new

- **Application mode** (form designer → **Buttons & header**): one switch
  that hides the bottom button bar — Submit, Cancel, outcomes, Save draft — on
  every page and surface (task forms, `/f/` pages, start forms, the Run dialog,
  Save & Test, the preview). With no in-form Submit the form is an
  information page: nothing is validated or sent. A **task** form in
  Application mode with no in-form Submit is completed with the task's own
  outcome buttons; the designer and the accessibility checker
  (`submit-path`) say so.
- **Button** field type (palette → Layout): drag it into any cell on any step
  or tab. Style, size, icon, alignment, full width, tooltip, an **Ask first**
  prompt, Visible when / Disabled when, and an ordered **On click** list:
  show / hide fields, sections, rows and whole steps / tabs; set state flags;
  go to / next / back; set or clear values; validate; **Submit** (presses a bar
  button so its message, success screen, start workflow, redirect and close
  still run — Application mode included); save draft; print; open an allowed
  link; show a message.
- **Form state flags** (`state.<flag>` in Visible when): declare yes/no flags,
  let buttons set them, and show fields and steps declaratively. A button
  hide wins over a rule; hidden elements are not required.
- **Server-checked.** The state rides with the values (`__form_state`, never
  stored); the server accepts only declared flags and targets and only what
  the form's own buttons can produce, so a crafted request cannot skip a
  required field the form always shows.
- **Accessible.** Real buttons, `aria-expanded` / `aria-controls` on toggles,
  focus moves to the new step, inline confirm dialog, polite messages, theme
  tokens in light and dark. Read-only views ignore button hides.

## Notes

- Stored on the layout (`application_mode`, `state`) and on the field
  (`button`), so versions, exports and packages carry them. No migration.
- On a steps form in Application mode with in-form Next / Back buttons, the
  wizard's own Back / Next are not drawn.
- See [Forms → Application mode](/docs/tasks/forms#application-mode-hide-submit-and-cancel)
  and [Buttons anywhere and form state](/docs/tasks/forms#buttons-anywhere-and-form-state).
