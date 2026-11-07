# Release notes: prefill a form from a URL parameter via an API, and the permissions panel fits

A form opened with `/f/<id>?customer_id=ALFKI` can now look the customer up
through an API reference and fill its fields, set up in the designer
without typing JSON paths. The governance object panel's **Add permission**
row no longer spills out of the panel. Existing forms and rules keep
working: nothing is migrated.

## What's new

- **Data tab: add a parameter by name and type.** Type the name
  (`customer_id`), pick the type and press **Add**. A reserved, invalid or
  taken name is explained under the box. Renaming works the same way:
  you can clear the box and type a new name.
- **Call an API reference, laid out in steps:**
  - **Inputs** list each of the reference's inputs, with **required**
    marked. An input with the same name as a parameter or field is
    mapped to it as soon as you choose the reference. Otherwise use
    `{x}` → **Parameters**.
  - **Then map the response** maps a response field to a form field or
    variable. **Load sample** runs the reference once and lists the
    response's fields with their types and examples. **Map matching
    names** fills in the obvious ones (`data.name` → *Customer name*).
    Lists read their first item as `[0]` (`[0].name`, `items[0].id`). Use
    **Type a path instead** when there is no sample. A note says when a
    value will be converted.
  - **If the call fails** has two choices. **Show a message** shows your
    text, with placeholders (*We couldn't find customer
    {{param.customer_id}}*), or else the service's own message. **Leave
    the fields unchanged** shows nothing, writes nothing and goes on with
    the rule's next step.
- **Rule template.** Once a form has a parameter, the Rules tab offers
  **Prefill from `{{param.<name>}}` via an API**. It adds the rule: Form
  loads → If the parameter is not empty → Call an API reference, with a
  "couldn't find" message. You only choose the reference.
- **Conditions say "is not empty" / "is empty"** (was "has a value"). They
  work the same on parameters, variables and fields:
  - a missing parameter, an empty text, an empty list and a blank field
    are empty;
  - `0` and *No* are values;
  - a parameter that isn't a valid number or date for its type is refused,
    so it reads as empty.
- **Governance → Object permissions** and a form's **Details → Access**:
  - the role / team / user switch and Cancel sit on their own line;
  - the picker is a searchable list (name and email) that fills the panel
    and opens above everything else;
  - **Add** wraps below it on narrow screens.

## Fixes

- **Add parameter did nothing.** It created a parameter named `param`. That
  name is reserved, so the parameter was dropped while the tab's count
  still went up.
- **A response mapped into a field kept its raw form.** For example, the
  text `"5000"` went into a number field as text. Values are now converted
  to the field's type on the server.
- **A path the response didn't have cleared its field.** Now it leaves the
  field as it is.
- **Lists in a response could not be mapped.** Paths now take `[0]`, read
  the response body the same way Data tables and lookups do, and accept
  keys like `@odata.count`.
- **An API that answered 404 showed "The service is not available right
  now".** It now says the service found nothing for these values, or shows
  your **If the call fails** message.

## Security

Nothing changes in who can call what. Parameters are still input from the
person filling in the form:

- The browser asks the server to run the rule's step by its rule id. The
  server reads the reference, its inputs and the response mapping from the
  **saved** form.
- The server checks the parameter against its declaration, and checks the
  rule's condition again.
- The parameter goes only into the inputs the author mapped, never into a
  URL, a header or another reference.
- The response is mapped on the server. Only the declared, editable fields
  and the declared variables the rule maps are written, each converted to
  its type. Read-only fields are never written by a response.

## Compatibility

- Saved rules keep working. A path saved as `data.0.name` is read as
  `data[0].name`.
- The new action options are `on_error` (`"ignore"` = leave the fields
  unchanged) and `error_text`.
- See [Forms → Prefill from a URL parameter via an API](/docs/tasks/forms#prefill-from-a-url-parameter-via-an-api).
