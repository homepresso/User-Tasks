# Release notes: form rules, autocomplete labels and dropdowns on top

Forms get one place for their rules, autocompletes can store an id while
showing a name, and dropdowns no longer get stuck behind other inputs.
Existing forms keep working unchanged: nothing is migrated.

## What's new

- **Rules tab.** The form designer has a **Rules** tab next to **Field**
  and **Buttons & header**. Every rule reads **When** [event] → **If**
  [conditions] → **Then** [actions]. Events: form loads, a field's value
  changes, gets or loses focus, a button is clicked, a Data table row is
  clicked, selected, deselected or double-clicked, a cell is edited, a row
  is added or deleted, an autocomplete item is selected, the step or tab
  changes, before and after submit, a state flag changes — and **Always**
  for declarative show / hide / disable and validation. Conditions use the
  AND / OR builder on form values, flags, the current user and the event
  (`{{event.row.city}}`). Actions are grouped: Show / hide, Validate
  (field errors, block submit), Update values (set, calculate with
  `{{=…}}`, clear, flags), Transfer data (copy from the clicked row or the
  selected item, run a lookup, refresh a table), Navigate and
  Integrations / workflow (call an API reference, start a workflow, apply
  table changes). See [Rules](/docs/tasks/forms#rules).
- **Every rule in one list.** Visible when, Disabled when, Button On
  click steps, the bar buttons' behaviours and start-hidden targets show up
  in the tab with a "where it lives" badge and stay editable in both
  places. Rules run in list order (drag to reorder), have names, on / off
  switches, duplicate, search and an event filter; a note flags two rules
  that set the same thing; **Test a rule** simulates an event with a
  sample row and lists what would run.
- **Autocomplete: display value vs stored value.** **Display template**
  (`{{name}} ({{code}})`), **Secondary text in the list** and **Search also
  matches the stored value**. The value stays what is stored (an id, a
  code); the label shows in the input, read-only views, submissions and
  task data as `{{task_data.<key>_label}}` (in the data picker next to the
  value and `<key>_item`). A form that opens with a value resolves its label
  on the server from the field's own source (`resolve` on the lookup
  endpoints, REST, MCP `tasks_lookup` and the CLI).
- **Dropdowns on top.** Autocomplete suggestions, select menus and the
  date-time picker open in a layer above the form — over inputs below,
  grid rows, tabs, sticky headers, Data tables, custom-control frames and
  dialogs (Run, Save & Test, the designer preview). They flip up near the
  bottom of the screen, fit the width, scroll inside, follow scrolling and
  resizing, close on Escape or a click outside, keep the combobox / listbox
  semantics and the form's theme (light, dark, mini themes).

## Security

- Browser rules change only browser state. API calls, workflow starts and
  table writes run on the server, looked up by rule id in the saved form;
  adding them needs the same permissions as on buttons (checked at save).
- A rule's hide or flag is accepted by the server only when the rule's
  condition holds for the submitted values (or reads click / user context
  the server cannot see, like a button click); Always hides are recomputed
  on the server. Validate rules on Always, Before submit, value changes and
  focus loss run again at submit, so skipping the browser skips nothing.
- Autocomplete labels are computed on the server from the confirmed item,
  never taken from the client.

## Compatibility

- `layout.rules` is optional and older readers ignore it; forms without it
  behave exactly as before. `<key>_label` is added beside `<key>_item`
  only when no field already uses that key.
- The accessibility checker warns when a rule hides a required field and
  nothing shows it again.
