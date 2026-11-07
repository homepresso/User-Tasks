# Release notes: Dynamic properties on form fields and custom controls

Form field settings and custom control props can now take their value from a **dynamic source** instead of a fixed value. Select options can come from a data table, chart data from an API, and a maximum from a variable.

## What's new

- A **Static / Dynamic** switch next to each bindable property in the form designer. **Dynamic** opens a binding editor with three tabs:
  - **Expression**: `{{param.x}}`, `{{var.x}}`, `{{form.x}}`, `{{control.x.*}}`, `{{user.*}}`, dates.
  - **Data table**: a table query with value / label or item columns, a filter that can use placeholders, a sort and a limit.
  - **API reference**: any reference, including custom references, with inputs mapped from placeholders, the rows list picked with **Load sample**, and the fields to keep.
- A **live preview** of the resolved value, type-checked against what the property expects: text, a number, yes / no, a date, a list of options, a list of objects or an object.
- **Bindable built-in properties**:
  - options of single and multi-select fields;
  - default value;
  - minimum / maximum;
  - earliest / latest date;
  - placeholder, help text and label;
  - Required.
- **Custom controls**: any manifest prop. A manifest prop can say `"bindable": true` or `false`. Without it, text, number, yes / no, list and JSON props are bindable. The host resolves the binding and sends the result through the bridge as an ordinary prop value, so the control needs no network capability.
- **Official controls 1.2.0** (starter pack 1.2.0):
  - Chart **data** and title;
  - a new Map **markers** prop (`[{ lat, lng, label }]`);
  - Likert **statements**;
  - Table **default rows**;
  - Info card text, title and labels;
  - Rating **max**;
  - Progress values and steps;
  - Slider min / max.
- **At run time**, expressions re-resolve as their inputs change. Table and API sources load from the server, debounced and cached per form, field, property and inputs, and load again when a parameter, variable or field they read changes. Options show *Loading options…* while they load and *Couldn't load options* if the source fails.

## Security

- Sources run on the server, and only as declared in the saved form. The request names a field and a property, never a source, a projection or a filter.
- Data tables are read with your own access (*View data*, row-level security) unless the binding has **Open access**.
- Placeholders are quoted values that only narrow the filter.
- At most 500 options or 1,000 rows. Only the declared columns leave the server.
- Anonymous links resolve a source only when **Allow anonymous read** is on for that binding. The designer warns when it isn't.
- **On submit** the server resolves the options, bounds and Required flag again for that submission and validates against them, never against the browser's list.

## Upgrading

Nothing to do. Forms without dynamic properties are unchanged. `options_source` ("Load options from a data table column") still works. Bindings are stored on the field (`dynamic`), so they travel with versions, exports, packages, the REST API, MCP and config-as-code. To use the new Map markers prop or the bindable props of the official controls, upgrade the controls to 1.2.0 (Extensibility → Form controls, or reinstall the starter pack), then pick the new version on the placed control.
