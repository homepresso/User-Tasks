# Release notes: Apps (app builder, Phase 1)

Builders can now give a team its own landing page: an **app** with a name,
subtitle, icon, colour and address (`/apps/<slug>`), pages built from
widgets, its own menu, and an audience of people, teams and roles.

## New

- **Apps in the side menu.** People with at least one app shared with them,
  and everyone who designs apps, see **Apps**. The label opens the **Apps**
  page (`/apps`) — a card per app (icon in the app colour, name, subtitle,
  description) with search; designers also get **Apps I design** with
  Edit / Settings, **New app** and **Create your first app**. The arrow
  beside the label opens a quick, searchable list with recently opened apps
  first. People with no apps don't see the item.
- **Page builder** (`?edit=1`, editors only): add widgets from a catalogue,
  drag and resize them on Home's grid (12 / 6 / 1 columns, keyboard
  supported), configure each in a side panel with live data, page filters
  (person, team, form, workflow, data table, date range, status) that drive
  several widgets at once, add / reorder / delete pages, app settings
  (audience, editors, menu entries).
- **Widgets:** Buttons (open a form in a dialog or on its own page, start a
  workflow, open a page, open a link), Task list (mine, queue, team, all;
  Claim; due / SLA chips), SLA (on track / at risk / breached with a
  breakdown), Metric (count / sum / avg, previous-period comparison),
  Chart (bar, line, area, pie, donut; by time or field; the theme's
  palette), Data table / report (read-only), Recent submissions / runs,
  Heading, Rich text (sanitised), Image and Link list.
- **Theme-aware:** everything uses the workspace theme in light and dark;
  the app colour is an accent layered on top.
- **Full screen / embed:** `/embed/apps/<slug>/<page>` (optionally
  `?menu=0`) shows a page without the UserTasks shell for signed-in people,
  framable from the trusted-embedding origins like every `/embed/` page.
- **Apps and permissions.** An app never grants access by itself. Every
  button, menu entry and widget tied to a form, workflow, data table or
  report is shown only when the viewer may use that object under the
  existing rules, and is removed from the page the server sends otherwise.
  Audience entries are **viewers** (read-only) or **contributors** (may use
  action buttons). The builder's **Access issues** check lists everyone in
  the audience who can't use what the app shows them and offers **Grant
  access** (form View + Submit grants, audited) when the designer can
  manage roles, or says whom to ask.
- **REST, CLI, MCP:** `/api/v1/apps…` (apps, pages, widget catalogue,
  access issues and grants), `usertasks apps …`, `apps_*` tools. See
  [Build apps](/docs/tasks/apps).

## Permissions

- `apps.view` (**Use apps**): open the apps shared with you. Every role,
  including existing custom roles (the migration adds it).
- `apps.manage` (**Build apps**): create apps, edit and delete every app.
  Owner, Admin and Manager.
- Per app, **editors** edit that app without `apps.manage`.

## Upgrade notes

- Migration `20270120090000_apps.sql` (additive). Apply it before deploying
  the code.
- `/apps` and `/apps/*` used to redirect permanently (308) to
  `/automations` (the retired apps). Those redirects are gone. A browser
  that followed the old redirect may have cached it: such a person lands on
  Workflows from `/apps` until they clear their cache.
- Not yet: the SharePoint web part (Phase 2, private extension), more
  widgets, cross-widget filtering and click-through, templates and a
  gallery, editable data widgets, and apps in config export / packages.

# Release notes: Apps, Phase 2

## New

- **Searchable pickers everywhere.** Every object or person input — widget
  settings, page filters, menu entries, buttons, tiles, card actions, app
  settings — is a searchable picker with server-side search and paging and a
  second line of detail (workflow status and runs, form owner, table row
  count, team size, email and avatar). Builder pickers list what the
  designer can see; the filter bar lists what the viewer can see. "Me",
  "My teams" and page-filter bindings stay available; audiences and editors
  pick several at once.
- **About 40 new widgets:** Kanban board (drag to change status), task
  calendar, my workload, overdue tasks, team workload, a quick-view task
  drawer from every task list; SLA trend and breakdown, cycle time (median,
  p90), bottlenecks, throughput; run status, recent failures, run timeline,
  start workflow; an inline **Form** widget (edge to edge, prefill, after-
  submit options), submissions trend, my submissions, field analytics; data
  grid (editable for contributors with Manage rows), **Card view** (data
  table, report or API reference), record card, filtered list, pivot table;
  more chart types (horizontal / stacked bar, combo, funnel, scatter), KPI
  with sparkline, goal progress, gauge, heatmap; team members with presence,
  org chart, people directory; activity feed, announcement, embed (admin
  allow-list), video, divider, spacer, tabs and collapsible sections; tile
  menu, page header, quick search, **navigation bar**; ask an agent.
- **Chromeless widgets:** any widget can drop its card, border, padding and
  title; the form, embed, video and nav bar widgets start that way.
- **Cross-filtering:** clicking a chart segment, KPI, row, person or card
  sets a page filter (or opens another page with it set); filters stay in
  the address so views can be shared. New **text / value** filter kind.
- **Buttons:** variants, theme colours, sizes, shapes, icon position,
  badges, descriptions, disabled-with-reason, confirmations, shortcuts,
  row / column / grid / split layouts, alignment, visibility by app role,
  team or role, and new actions (open / download report, open record, claim
  next task, copy link, set filter).
- **Open modes and the panel stack:** modal, slide-in panel, bottom sheet,
  full screen, inline, this tab or new tab, with motion (reduced-motion
  aware). Panels stack (up to five) with a breadcrumb, Esc / back, focus
  return and an unsent-form warning, and are kept in the URL.
- **Panel sizes:** S / M / L / XL / Full or percentages of the window,
  resizable (handles, keyboard, maximise, double-click) with the size
  remembered per target; phones full screen. Forms open edge to edge in
  panels with their actions in the panel header and their real title.
- **Form parameters:** map a form's declared parameters to fixed values,
  page filters, the viewer, today, the app / page, URL parameters or the
  clicked row / card, everywhere an app opens a form; unmapped required
  parameters are flagged in Access issues.
- **Design pass:** KPI tiles, one widget header style, charts that fit
  their card (short axis labels, no clipping), donut with total and value
  legend, a vivid theme-aware palette and consistent status colours,
  compact default sizes and dense packing.
- **Pages:** hidden from the menu (opened from buttons only) and a minimum
  app role per page (contributors-only or editors-only config pages).
- **Navigation styles** per app: top bar, sidebar (icon rail), drawer,
  tabs, bottom bar, mega-menu or none, with phone fallback; menu groups,
  sub-groups, headings, dividers, badges and new entry kinds; header style,
  density and an app-only full-window mode. The nav bar widget shares the
  same navigation.
- **Tabs with targets:** a tab can show a form, another page, a report, a
  data table or a website directly; tab icons, badges, styles (underline,
  pills, segmented, vertical), lazy loading and remembered tab.
- **Templates:** Team dashboard, Requester portal, Manager approvals and
  Operations SLA; duplicate widgets and pages; copy and paste widgets
  between pages and apps.
- **Custom SVG icons:** upload (≤ 100 KB, sanitised, editors only) into a
  workspace icon library; drawn as images or tinted with the theme colour.
- **Settings → Embedding** gains **Sites app pages may embed** (the Embed
  widget's allow-list).

## Permissions

An app still never grants access. New object-bound widgets are hidden (or
read-only) when the viewer can't use their objects; viewers never get the
form widget, start workflow, agent chat, Kanban drag or grid editing; menu
entries and nav bar items are filtered the same way. API reference cards
need View integrations, or a designer with Manage references allowing app
viewers (audited). The access-issues analysis covers every new widget.

## API, CLI and MCP

`GET /api/v1/apps/widget-types` (and `apps widget-types`,
`apps_widget_types`) list the new widgets and their config schemas. Apps
accept `nav`; menus accept the new entry kinds and groups; page options go
in `layout.options`. No database migration.

# Apps — Phase 3: parameters, variables and app rules (Nov 2026)

- **Parameters** on the app and on each page (name, type — text, number,
  yes / no, date, list, record — default, required): filled from whatever
  opens the page (buttons, tiles, menu entries and rules pass values into
  panels, modals and sheets), from `?p.<name>=` on the page or embed
  address, or the default (which may be a template). Typed and validated;
  invalid or missing required values are reported on the page.
- **Variables** on the app (kept across pages for the session) and on each
  page (in memory, or in the URL as `?v.<name>=` when marked shareable).
- **System variables**, read-only and everywhere: the viewer (id, name,
  email, avatar, teams, roles, manager, timezone), today / now / start of
  week / start and end of month in the viewer's timezone, workspace, app,
  page, URL parameters, device and app role.
- **Bind everywhere**: widget inputs follow parameters, variables or system
  values (and re-read when they change); form parameter mapping gains
  parameters, variables, all system values and expressions; headings, text,
  announcements and widget titles fill `{{…}}` placeholders and
  `{{= expressions }}` (the form label expression language); text filter
  defaults may be templates.
- **App rules** (builder → Rules): When (page loaded, parameter / variable
  changes with old and new value, filter changed, button / row / card /
  chart segment clicked, tab changed, form submitted — from any form the app
  opened — panel closed, timer ≥ 30 s while visible, API reference
  returned) → If (the form rules' condition builder) → Then ordered actions:
  set variables, set / clear filters, open a form / page / report / record /
  workflow / URL in any mode passing values, close panel, go to page,
  refresh / show / hide widgets, enable / disable buttons, message, confirm
  with branches, call an API reference, look up / create / update data table
  rows, start a workflow, copy, download a report. Results go into variables
  (`{{result}}` for the next action); per-action error handling (stop /
  continue / on-error actions); cascades stop after 5 levels; a Debug panel
  shows events, conditions and action results, and runs sample events.

## Permissions

Server actions run through one audited, rate-limited endpoint
(`POST /api/v1/apps/{id}/actions`) that reads the action from the saved app
by rule id and position, takes only its declared inputs' values, and
re-checks governance per action: viewers never write or start work; data
table actions run with the viewer's permissions and RLS; API references need
View integrations unless a designer with Manage references allowed app
viewers (audited); adding a reference call needs View integrations and a
workflow start needs Start workflows. Actions a viewer can't use are removed
from the page sent to them. Access issues cover rule objects and warn about
unknown variables / parameters / widgets / filters / pages and unmapped
required page parameters.

## API, CLI and MCP

`GET /api/v1/apps/rule-types` (`apps rule-types`, `apps_rule_types`): triggers,
actions, system variables and the rule / parameter / variable JSON schemas.
`POST /api/v1/apps/{id}/actions` (`apps run-action`, `apps_run_rule_action`).
Apps accept `params`, `variables` and `rules`; page layouts accept
`layout.params`, `layout.variables` and `layout.rules`. A single reference
walker (`lib/apps/references.ts`) lists and rewrites every object id in an
app's config, rules included, for packaging. No database migration (app
settings and page layouts are JSON).

## Styling widgets

- A **Style** tab per widget: optional colours for background, border,
  header, title / body / muted text, accent, KPI value, buttons, table
  header / stripe / hover, tabs and nav bars — theme tokens first, custom
  hex / rgb / hsl with opacity and an eyedropper, optional dark-mode values
  (derived when only one is given) and a live WCAG AA contrast warning; chart
  palettes and per-value colours (categories, statuses, badges); corners,
  border, shadow, padding, background image or gradient, title / value type
  and alignment; per-button colours.
- **Named styles** (save, apply, copy / paste), an **app default** every
  widget inherits, and **Reset to theme**.
- Stored as typed, validated `style` settings (no CSS text) and applied as
  CSS custom properties scoped to the widget, so it works in panels and
  embeds and travels with app packages. API: `style` on widgets, buttons
  (`colors`) and apps (`style: { default, presets }`).
