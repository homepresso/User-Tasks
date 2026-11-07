# Release notes: test a form's parameters and variables in the designer Preview

The form designer's **Preview** can now be opened as if the form were
opened with parameters, and shows the form's variables as they change.
Nothing is migrated and nothing changes in saved forms: the test values
live in the designer only.

## What's new

- **Inputs (n)** in the Preview toolbar, shown when the form declares
  parameters or variables (Data tab). It shows or hides a **Test inputs**
  panel above the form.
- **Parameters**: one input per parameter, by type (Yes / no and
  allowed values as a menu, dates as a date picker, lists
  comma-separated), with the default as the placeholder and required ones
  marked. Values are checked with the same rules as the form page
  (pattern, allowed values, min / max); a refused value is explained and
  the default applies. When a required parameter is missing, the panel
  says what the form page would show instead of the form.
- **Changing a parameter reopens the preview** the way opening
  `/f/<id>?name=value` would: field defaults with `{{param.x}}`,
  variables whose initial value comes from a parameter, and **Form
  loads** rules are worked out again.
- **Variables**: each variable's live value as rules change it, and what
  it starts as. Edit one to override it; **Reset** / **Reset all** go back
  to the initial values.
- The Rules and Data tabs' preview values (a label's **Preview value**,
  "for each changed row" dry runs) see the same parameters and variables.
- **Copy link with these parameters** (saved reusable forms with URL
  parameters): the form page link with the values filled in.
- Test inputs are remembered per form in this browser and never saved
  into the form definition.

## Under the hood

- `lib/forms/preview-inputs.ts` seeds the preview with the form page's
  own steps (`parseFormParams`, field defaults via `openingFieldDefaults`,
  now shared with `components/forms/standalone-form.tsx`).
