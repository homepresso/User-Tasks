# Release notes: Available forms in the side menu and the Forms dropdown

People can now open the forms they fill in straight from the side menu.
Turn on **Available forms** on a form and give people access to it; the
form shows up under **Forms** in their menu.

## Added

- **Available forms** checkbox in a form's **Details** (Forms library → ⚙):
  "Show this form in the Forms menu for people who have been given access
  to it." Every reusable form already has its own page (`/f/<id>`), so
  there is nothing else to publish. Library rows show **In the Forms menu**.
- **Access** on forms: the same grants as workflows and data tables, for
  people, teams and roles, with **View** and **Submit**. A person sees an
  available form in their menu when a grant names them, a team they're in
  or a role they hold, and they have **Submit forms**. Workspace-wide
  rights alone (Owner, Admin, the form's builder) don't list a form.
- **Forms menu**: an arrow next to **Forms** in the side menu expands the
  forms you were given access to, alphabetically (ignoring case and
  accents). With more than 10 there's a search box: type to filter (the
  match is highlighted), arrows to move, **Enter** to open, **Esc** to clear
  or close. The open / closed state is remembered per person. It works in
  the collapsed side menu (a panel beside the icon) and the phone menu, and
  people without the Forms library get a **Forms** item when they have
  available forms. No available forms: no arrow.
- **Forms dropdown** at the top of the side menu, where the workspace
  switcher used to be: **Forms** opens the same list of available forms
  (alphabetical; click a form to open its page). With 10 or more there's a
  search box (type-ahead, highlighted match, arrows, **Enter**, **Esc**). No
  available forms: "No forms have been shared with you yet". Collapsed side
  menu: the icon with a tooltip, the panel opens beside it. Phone menu: at
  the top of the drawer.
- **API, MCP and CLI**: `available_in_menu` on `POST /api/v1/forms` and
  `PATCH /api/v1/forms/{id}`, `forms_create` / `forms_update`, and the
  generated `usertasks forms create|update`. Forms in list and get
  responses carry it. It travels with exports, packages and GitHub sync;
  grants don't.

## Changed

- **Workspace switcher moved to the avatar menu** (top right of the top
  bar): your name and email, **Workspaces** (All organizations and each
  workspace, the current one ticked; pick one to switch), Profile, Settings
  and Sign out. The avatar's tooltip names the current workspace. On phones
  the switcher is now reachable too (it wasn't in the phone menu before).

- An object (workflow, data table, agent, integration, report, form) can
  now be shared with several people, teams and roles. The old unique
  constraints allowed only one grant row per object; now each grantee can
  be added once.

## Upgrading

Apply `supabase/migrations/20261209000000_available_forms.sql` before
deploying the code (the forms service reads the new column). It is additive
and idempotent: `forms.available_in_menu` (default off), the
`list_available_forms` function, `form` allowed in `object_permissions`,
and partial unique indexes in place of the one-grant-per-object
constraints. Nothing is migrated; no form is in anyone's menu until it is
marked and shared.
