# Equipment request

Order standard kit from a catalogue with cost-based approval, IT fulfilment and asset registration.

## What's inside

- **Equipment request form**: a standalone form page with a grid layout, header and mini theme. The item is a lookup into the **Equipment catalogue** that fills the category, unit cost and lead time; submitting shows a confirmation screen.
- **Equipment request** workflow, started by the form's **Form submitted** trigger (the fields arrive as `{{form.<key>}}`)
- **Equipment approval** decision table (total cost, category, role → automatic, manager, finance)
- **Equipment catalogue** data table with eight sample items
- **Asset management** REST integration with *Register asset*
- Three email templates: approved, ready and not approved

## After installing

1. Complete setup: the asset system base URL and API token, and the default manager, finance approver and IT fulfiller.
2. Edit the catalogue and approval rules. New catalogue rows show up in the form's item lookup straight away.
3. Open **Forms → Equipment request form** and share its page link (`/f/<id>`) on your intranet, or submit it from your IT portal through the forms API.

## How it works

- The employee picks the item; the category, unit cost and lead time fill in.
- The workflow prices the request, the decision table routes it, and the manager (and finance, for high value) get tasks with **Approve** / **Reject** buttons, a header and a grid.
- IT gets **Fulfilled** / **Cannot fulfil** buttons to record the asset tag, serial number and delivery date; the asset is registered and the requester is emailed.
