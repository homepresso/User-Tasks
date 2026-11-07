# Release notes: read-only controls, sections, steps and forms from rules

Form rules can now make a control, a section, a step or tab, or the whole
form **read only**, and make it editable again. Existing forms are
unchanged and nothing is migrated (no database change): the action is
stored with the form's other rules in `layout.rules`.

## What's new

- **Make read only / editable**, a new action in the Rules tab (Then →
  Show / hide). Choose **Read only**, **Editable** or **Toggle**, then the
  targets: controls, sections, rows, steps / tabs, or **Whole form**.
  - It works on every event. With **When → Always** the targets are read
    only while the condition holds and editable again when it doesn't; with
    no condition they're always read only.
  - A control is read only when it, its section, its step / tab or the
    whole form is.
- **How a read-only control looks.** It keeps its value and normal look on
  a quiet background with a dashed border, not the greyed-out disabled
  look. It stays focusable, so the value can be selected and copied, and
  screen readers hear it's read only (`aria-readonly`).
  - Text, long text, number, currency, date and date-time inputs become
    read-only inputs.
  - Dropdowns, people pickers and autocompletes show their value in a
    read-only text box.
  - Checkboxes, radio buttons and multi-choice chips keep their state but
    ignore clicks and keys.
  - Data tables still page and search, but can't be edited, added to,
    deleted from or have their selection changed.
  - Attachments list the files, without add, remove or reorder.
  - Custom controls get their `readonly` state.
  - The required asterisk goes.
- **Values and validation.**
  - The value is still submitted and still read by rules, labels and
    validation. Rules can still change it.
  - A read-only control isn't required. The server works this out itself:
    it recomputes Always rules, and accepts an event rule's read-only claim
    in `__form_state` only when an enabled rule of the saved form could
    have made it (the same bound as hides). Other checks still run.
- **Buttons** aren't affected, even inside a read-only section or form.
  Use Enable / disable for them.
- **API, MCP and CLI.** The action is
  `{ "type": "read_only", "mode": "read_only" | "editable" | "toggle", "targets": [...] }`.
  Targets are `field:<key>`, `section:<key>`, `row:<key>`, `page:<id>`,
  or `form:*` for the whole form. The MCP `forms_create` / `forms_update`
  layout help describes it.

## Limits

- Like Enable / disable, a rule's read only is enforced in the browser:
  the server doesn't reject a changed value for a field a rule made read
  only. For a value the server keeps whatever is sent, use **Read-only**
  on the field itself.
- There's no static **Read only** setting for a section, step / tab or the
  whole form. Use an Always rule with no condition instead.
