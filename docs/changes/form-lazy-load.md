# Release notes: When to load (faster forms)

Each step / tab and each section of a form can now **load later**: when the
person first opens or scrolls to it, or when a rule loads it. A long form
then opens with only what the person sees first. Existing forms are
unchanged: they load everything on open, as before. Nothing is migrated
(no database change).

## What's new

- **When to load** in Step / Tab properties and Section properties:
  - **On form open** (the default, and today's behaviour);
  - **When first shown**: a tab or step loads when it is first opened, and
    a section when it is expanded or first scrolled into view;
  - **When a rule loads it**: the part loads when a rule runs **Load
    section / tab** on it.
- **What waits.** Until a part loads, its controls are not mounted. Its
  Data table queries, autocomplete lookups, custom control frames, file
  widgets and bound (dynamic) properties don't run, and neither do Label
  totals over its tables. A skeleton with the part's title stands in, and
  the controls fade in when it loads.
- **Preload in background** (lazy parts only). Once the visible part is
  idle, the form warms the part's custom control frames and resolves its
  bound properties, so it opens quickly.
- **Rules:**
  - a new action, **Load section / tab** (Then → Show / hide);
  - a new event, **Section / tab loaded**, with `{{event.part}}`;
  - new conditions, `section.<key>.loaded` and `step.<id>.loaded`;
  - new placeholders, `{{control.<section>.loaded}}` and
    `{{control.form.loaded.<step id>}}`.
- **A designer warning** on a "When a rule loads it" part that no rule or
  Button loads. The tab strip marks lazy tabs with an hourglass, and a
  section's header says how it loads.

## Correctness

- **Values don't depend on loading.** Defaults, prefilled values, task
  values and values rules set are in the form's values whether or not
  their controls ever mounted, and they are submitted the same way. A bound
  **default** still resolves on open.
- **Submit loads what it checks.** Submit (and a whole-form Validate) first
  loads every shown part that holds a required field, then validates, so
  errors show in real controls. An error on a field of an unloaded part
  (from Next, a rule, or the server) loads that part too. Hidden and
  left-out parts follow the existing rules.
- **The server is unchanged.** Validation doesn't look at what loaded:
  a lazy part's required field is still enforced, and the list of loaded
  parts (`__form_state.loaded`, presentation only, like a collapsed
  section) is never stored.
- **Read-only views** (completed tasks, the review step, Submissions) show
  everything. **Print** loads every part before the dialog opens. The
  accessibility checker reads the definition, so it checks lazy parts too.

## Compatibility

- Storage: `layout.pages[].load` and `layout.sections[].load` (`visible` or
  `rule`), plus `preload: true`. Absent means "On form open". The setting
  travels with versions, exports, packages, the REST API, MCP and the CLI.
- New rule action `load_part` (targets `section:<key>` / `page:<id>`) and
  new event `part_loaded` (target the part). Older readers ignore all of
  them and load everything.

See [Task forms → When to load](/docs/tasks/forms#when-to-load-faster-forms).
