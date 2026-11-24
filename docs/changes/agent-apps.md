# Release notes: the Agent builds apps

The Agent can now build a whole app — or change one — when you ask for it in
plain words, and other AI agents and scripts can do the same through MCP,
REST and the CLI.

## New

- **"Build me an expense desk for the finance team…"** The Agent finds the
  real forms, workflows, data tables, reports, teams and people to use, then
  drafts the whole app as **one plan**: pages, widgets and their settings,
  buttons and what they open (with form parameters), page filters, rules,
  navigation, the audience (viewers and contributors) and editors.
- **One plan card, one confirmation.** The card shows the app, every page,
  each new or changed widget with its size, who it is shared with and
  anything to look at (removed widgets, custom colours, untitled widgets).
  **Build app** / **Apply changes** applies it in one step; if any step
  fails nothing is kept (a new app is removed again, changes are undone).
- **Changes to existing apps.** "Add a chart of overdue tasks to the Team
  page", "make the SLA chart full width", "share it with Finance as
  contributors" — add, change, move, resize and remove widgets, add and
  delete pages, reorder them, change settings and the audience.
- **In the app builder.** Opened on an app (viewing or building), the Agent
  knows the app and the page on screen; it asks you to save unsaved changes
  first, and the page reloads after its change.
- **From a picture.** Attach a screenshot, mockup or PDF of a dashboard and
  the Agent proposes an app from it.
- **Access, after building.** The Agent checks who in the audience can't use
  a form or workflow the app shows and offers the form grants you may give
  (confirmed, audited on each form). It can also package the app when asked.
- **Checked before you see it.** Every widget is checked against the widget
  catalogue; page filters, page links, container widgets, the objects bound
  (they must exist and be visible to you) and the permissions some bindings
  need are checked too. Problems go back to the Agent in plain words to fix
  before a card is shown.
- **MCP, REST and CLI.** `apps_plan` / `apps_apply_spec` (MCP),
  `POST /api/v1/apps/spec/plan` and `/apply` (REST), `usertasks apps plan` /
  `apps apply` (CLI); plus `apps_spec_reference` (spec format, design
  guidance, starter templates, worked example), `apps_search` (objects to
  bind, without an app for people with Build apps) and `apps_object_details`
  (a form's fields and parameters, a table's columns, a workflow's trigger).

## Permissions

- Creating an app needs **Build apps**; changing one needs edit access (an
  editor of the app, or Build apps).
- Only objects you can see can be added; an API reference needs **View
  integrations**, letting app viewers see or run one needs **Manage
  references**, and a "Start a workflow" rule needs **Start workflows**.
  People, teams and roles must be in this workspace.
- Grants are only offered where you hold **Manage roles**.
- Every change is audited as you; changes made through the Agent are marked
  as such. Agent messages count towards the workspace's Agent limits.

## MCP read permissions

New read tools, all needing **apps.view**: `apps_plan`, `apps_search`,
`apps_object_details`, `apps_spec_reference`. `apps_apply_spec` needs
**apps.view** to call and checks Build apps / edit access itself.

## Known limitations

- (Since app drafts, migration 20270123090000) an applied change goes to the
  app's draft; its audience keeps the published version until someone
  publishes (the card says so; `publish: true` publishes in the same step).
- Undoing a failed change re-creates a deleted page with a new id (links by
  slug keep working).
- The routes `/api/v1/apps/spec/*` shadow an app whose slug is `spec` for
  `GET /api/v1/apps/{id}` (use its id).
