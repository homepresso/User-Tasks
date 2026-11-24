import type { DocPageDef } from '../types'

export const APPS_PAGE: DocPageDef = {
  slug: 'tasks/apps',
  title: 'Build apps',
  description: 'Give a team its own app: pages of widgets (buttons, tiles, task lists, Kanban, calendars, SLA and performance, workflow runs, inline forms, data grids, card views, charts, people, activity, navigation, agent chat), its own navigation and an audience of people, teams and roles.',
  body: `
An **app** is a named place for one kind of work — an expense desk, an onboarding hub, a service queue. It has a name, subtitle, icon, colour and address (\`/apps/<slug>\`), one or more **pages** built from widgets, its own **menu**, and an **audience**: the people, teams and roles who can open it.

Everything an app shows is read **as the person viewing it**. A task list shows the tasks *they* can see, a metric counts what *they* may count, a button opens a form only if *they* may submit it. Sharing an app never shares data the viewer couldn't already open.

## Who sees what

| Who | What they get |
|---|---|
| **Audience** — named people, members of a named team, holders of a named role | The **Apps** item in the side menu, the app on the **Apps** page (**My apps**), and its pages. Each entry is a **viewer** (read-only) or a **contributor** (may also use its buttons). They also need **Use apps** (\`apps.view\`), which every role has by default. |
| **Editors** of an app | Everything the audience gets for that app, plus **Edit** and **App settings** — pages, widgets, menu, audience and editors. |
| **Build apps** (\`apps.manage\`) — Owner, Admin and Manager by default | Create apps, edit and delete every app in the workspace. They always see the **Apps** item and the **Apps I design** tab, even before any app exists. |
| Anyone else | Nothing: the app doesn't exist for them (opening its address says it isn't available). Apps never cross workspaces. |

People with no app shared with them, who don't design any, don't see the **Apps** item at all.

## The Apps menu and the Apps page

- **Apps** in the side menu opens the **Apps** page (\`/apps\`): a card for every app shared with you — icon in the app's colour, name, subtitle and description. Search filters by name, subtitle and description.
- The arrow beside **Apps** opens a quick list of your apps with search (type, then ↑ / ↓ and Enter), your recently opened apps first.
- Designers also get the **Apps I design** tab: every app they can edit, with **Edit** and **Settings**, and **New app**. An app you both use and design is one card with **Open** and **Edit**. A designer with no apps yet sees **Create your first app**.

## Create an app

1. **Apps → New app** (or the **New app** card).
2. Give it a name, an optional subtitle and description, and pick an icon and colour (or keep the workspace theme's colour).
3. **Create app** opens its first page, **Home**, in the builder.
4. Add widgets, then **Save**.
5. **App settings → Audience**: choose the people, teams and roles who may open it, and **Save**.

The app colour is an accent layered on the workspace theme: the app's icon, the active page in its menu, its cards and its primary buttons use it. Everything else — light and dark, fonts, chart colours — follows the [workspace theme](/docs/governance).

## The builder

Open a page and choose **Edit** (editors only).

- **Add widget** opens the catalogue (search it, or browse by group). The widget is added after the selected widget (or at the end of the page) and its settings open on the right. Data widgets start with a plain title ("My tasks", "Team queue") you can change.
- **Templates** adds a starter layout (below); **Page** can also start a new page from one.
- On a widget's handle: **duplicate**, **copy** (paste it on any page of any app you edit with **Paste widgets** in the toolbar; **Copy all widgets** copies the page) and **settings**. The list button shows every widget on the page — including ones inside tabs and sections — so you can select any of them.
- **Duplicate this page** copies the page with its widgets and filters. **Page options**: *Hidden from the menu* (the page opens only from buttons, tiles, cards and menu entries — handy for config pages) and *Who can open it* (everyone in the audience, contributors and editors, or editors only; anyone below gets "page not found").
- **Drag** a widget by its handle to move it; drag its right edge, bottom edge or corner to resize it (the page uses a 12-column grid that becomes 6 columns on a tablet and one column on a phone). With the keyboard: arrow keys move, Shift + arrow keys resize.
- The **sliders** button on a widget opens its settings; the **×** removes it.
- While you edit, widgets show real data **with your unsaved settings**, read as you.
- **Filters** edits the page filters (below). **Page** adds a page, the arrows move the current page earlier or later in the app menu, and the bin deletes it (an app keeps at least one page).
- **Checks** lists what would make the page look unfinished to the people using it — placeholder labels ("Link", "Page"), a page listed twice in a nav bar, a nav bar and the app's tabs showing the same pages, a page header that isn't at the top, data widgets without a title, a list much taller than its rows, nav entries whose icon differs from their page's — each with a one-click fix where it is safe, and **Fix all**. Publishing lists the same warnings (they never block it).
- **Height** (lists, cards and people widgets): *Auto* grows and shrinks with the content up to a number of rows, then scrolls inside; *Fixed* keeps the size you drag it to and shows the rows that fit with **View all (n)**. Cards on the same row line up (turn it off in **Page options**), and a row that ends short of the right edge is stretched to it.
- The **desktop / tablet / phone** buttons preview the page at those widths; the icon picker beside the page title sets the page's icon (the menu, nav bars and the page header use it).
- **Save** writes the page; **Discard** drops your changes.

## Page filters

Page filters are inputs at the top of a page — a person, team, form, workflow, data table, date range, status or a free **text / value** (a search term, a column value, a row id). In a widget's settings, choose **From page filter: …** for an input and that filter drives it, so one filter can drive several widgets: pick a team once and the task list, SLA and chart all follow.

Filter values live in the page address (\`?f.team=…\`), so a filtered page can be bookmarked or shared. **Me** and **My teams** always mean the person viewing the page.

## Widgets

| Widget | What it shows | Inputs |
|---|---|---|
| **Buttons** | Buttons that open a **form** in a dialog or on its own page ("New submission"), **start a workflow**, open another **page** of the app, or open a **link**. | Form, workflow, page or address; style; icon |
| **Task list** | **My tasks**, the **queue** (waiting for you or your teams to claim or accept), a **team's** tasks, or every task you can see — with due / SLA chips and **Claim** on unassigned team tasks. | Show, team, assignee, workflow, status, created, rows |
| **SLA** | **On track**, **at risk** and **breached** counts with a bar and a breakdown by workflow, for open tasks (due dates and run SLAs) or running workflows (workflow SLAs). | Measure, assignee, team, workflow, "at risk when due within" hours |
| **Metric** | A count of tasks, workflow runs or form submissions, or a count, sum or average of a data table column — optionally against the previous period. | Data, value, filters, period, format (number, currency — USD by default — or percent) |
| **Chart** | Bar, line, area, pie or donut over tasks, runs, submissions or data table rows, grouped by time (day, week, month) or a field (status, workflow, form, person, a column). | Data, chart, group by, interval, value, filters, period |
| **Data table / report** | The first rows of a data table (choose the columns), or a saved report's chart and rows — read-only. | Table or report, columns, rows |
| **Recent activity** | The latest form submissions or workflow runs. | Form or workflow, person, period, rows |
| **Heading**, **Rich text**, **Image**, **Link list** | Static content. Rich text is sanitised (paragraphs, headings, lists, links, emphasis); images and links must be \`https://\` addresses or paths in the app. | — |

### What each data widget can see

- **Tasks:** with **View all tasks** (\`tasks.view_all\`) every task in the workspace; otherwise only tasks assigned to the viewer or queued for a team they are in.
- **Workflow runs:** the same rule as the run lists — **View all runs**, or the runs the viewer is involved in or holds a View grant on; without either, the runs they started.
- **Form submissions:** with **Edit forms** every submission; otherwise the viewer's own.
- **Data tables and reports:** the table's and report's own access (\`data.view\`, \`reports.view\` and sharing).

Charts, sums and SLA counts aggregate at most the newest 5,000 items and say so when they hit that limit.

## Pickers

Every input that points at an object or a person — in widget settings, page filters, menu entries, buttons, tiles, card actions and app settings — is a **searchable picker**. Type to search; results come from the server a page at a time (**Load more**, or keep scrolling), so large workspaces stay fast. Each option shows a second line: a workflow's status, trigger and run count; a form's owner and version; a data table's row and column counts; a team's size; a person's email and avatar; a report's category and sharing.

- Builder pickers list only what **you** (the designer) can see; the page filter bar lists only what the **viewer** can see. Without the permission for a kind, the picker says which one is missing.
- **Me (whoever is viewing)** and **My teams** are offered for people and teams; **From page filter: …** binds the input to a filter.
- People, teams and roles in **App settings** pick several at once (chips; Backspace removes the last one).
- Keyboard: ↑ / ↓, Home / End, Enter to choose, Escape to close.
- Data table columns and saved views are picked from the chosen table. Task statuses, priorities and date ranges stay small lists.

## Widget reference (Phase 2)

Inputs marked *bindable* can come from a page filter. Click-through (below) is available where noted.

| Group | Widget | What it shows | Inputs |
|---|---|---|---|
| Tasks | **Kanban board** | Tasks in columns by status. Contributors who may complete tasks drag a card to change its status (or use its *Move to* list with the keyboard); completing a standard task records "Completed". Cards open the quick-view drawer. | Show (mine / team / all), team, assignee, workflow, created (*bindable*); columns; cards per column; drag |
| Tasks | **Task calendar** | Tasks on a month or week calendar by due date (overdue in red). | Show, team, assignee, workflow, status (*bindable*); month / week |
| Tasks | **My workload** | The viewer's open, overdue, due today, due this week, at risk and done this week. | At-risk hours |
| Tasks | **Overdue tasks** | Open tasks past due, oldest first. | Show, team, assignee, workflow; rows; open in drawer / page |
| Tasks | **Team workload** | Open and overdue tasks per person for a team: tasks in its queue and tasks assigned to its members. Click-through: a person filter. | Team, workflow (*bindable*); people |
| Tasks | **Task list** (Phase 1) | Now opens tasks in a **quick-view drawer** (details, fields, actions as the viewer may use them) unless set to open the task page. | + Open in |
| SLA | **SLA trend** | Share finished on time per day / week / month (due date, or the run SLA). | Measure (tasks / runs), filters (*bindable*), interval |
| SLA | **SLA breakdown** | On track / at risk / breached by workflow, team, assignee or form. Click-through. | Measure, break down by, filters, at-risk hours, rows |
| SLA | **Cycle time** | Time to complete — median and 90th percentile — with its trend. | Measure, filters, interval |
| SLA | **Bottlenecks** | Where work waits: open tasks by workflow step with the average and oldest wait, plus runs paused or waiting for an event. | Workflow, team |
| SLA | **Throughput** | Created versus completed over time. | Measure, filters, interval |
| Workflows | **Run status** | Running, waiting, completed and failed runs. Click-through: a status filter. | Workflow, started by, period |
| Workflows | **Recent failures** | The latest failed runs with their error. | Workflow, period, rows |
| Workflows | **Run timeline** | The step-by-step timeline of the latest run (the viewer's by default). | Workflow, started by |
| Workflows | **Start workflow** | A card whose button opens the workflow's start form (its inputs) in a dialog. Contributors only. | Workflow, button label, description |
| Forms | **Form** | The form itself on the page, edge to edge (chromeless): the form's own theme fills the widget, scrolls inside it and resizes with it. Prefill from the viewer (name, email, id), page filters or fixed values — for fields the form declares as URL parameters. After submit: the form's thank-you, reset for another, a message, or another page. Hidden from viewers and anyone who can't submit (or a short notice, if you choose). | Form, prefill, after submit, hide header, when unavailable |
| Forms | **Submissions** | Submission count with change and trend. | Form, submitted by, period, interval |
| Forms | **My submissions** | The viewer's submissions with the status of the run or task they started. | Form, period, rows |
| Forms | **Field analytics** | Answer distribution of choice, rating and number fields (the survey charts). | Form, field, period |
| Data | **Data grid** | A data table (optionally one of its saved views) with search, grouping and paging. Contributors with **Manage rows** edit cells in place (Enter saves, Escape cancels); everyone else reads it. | Table, view, columns, search (*bindable text*), group by, rows per page, editable |
| Data | **Card view** | Records as cards — see *Card view* below. | Source, template, actions, layout, sort, search, paging, click-through |
| Data | **Record** | One row as a detail card — a fixed row id, or a text filter holding one. | Table, row (*bindable*), fields |
| Data | **Filtered list** | Rows as a searchable list; click a row to set a filter. | Table, title / subtitle columns, search, rows, click value |
| Data | **Pivot table** | Rows (and optionally columns) by time, status, workflow, form, person or a column, with count / sum / average and totals (optional). **Heat map** shades each cell by its value; a sum or average with no numbers shows a dash. Click-through on rows. | Source, dimensions, value, filters |
| Data | **Row conditions** (any widget over data table rows) | Charts, KPIs, goals, gauges, pivots, card views, grids and lists take up to four conditions: a column *equals* / *is not* / *contains* a fixed value or a page filter, parameter, variable or system value (e.g. the viewer's email for “my rows”). A condition whose value is empty — its filter set to *Any* — is skipped. Text page filters can list their **choices** (a dropdown). | Column, comparison, value (*bindable*) |
| Charts | **Chart** (more types) | Adds **horizontal bar**, **stacked bar** and **combo bar + line** (with a series dimension), **funnel** and **scatter** (two number columns). Click a bar or slice to filter. | + Series, X / Y columns, click-through |
| Charts | **KPI with sparkline** | A number with its change and sparkline, optionally against a target. Click-through. | Source, value, filters, interval, target, format |
| Charts | **Goal progress** | Progress to a target as a bar. | Source, value, target, label, format |
| Charts | **Gauge** | A value on a dial with warning and danger bands. | Source, value, min / max, bands, higher is better |
| Charts | **Heatmap** | Activity by day of week × hour (UTC). | Source, created / completed, filters |
| People | **Team members** | A team's members with presence (online in the last 10 minutes, else last seen) and open / overdue counts. Click-through: a person filter. | Team (*bindable*), workload, presence |
| People | **Org chart** | A person's managers, peers and reports (1–3 levels). Needs **View org chart**. | Person, levels |
| People | **People directory** | Search people by name or email; job title and department. | Team, per page |
| Activity | **Activity feed** | Task, run and submission events the viewer may see — and the audit log for people with View settings. | Sources, workflow, person, period |
| Content | **Announcement** | A highlighted note (sanitised rich text), optionally only between two dates. Editors keep it up to date in the builder. | Text, tone, from / until |
| Content | **Embed** | Another site in a frame — only sites an admin lists under **Settings → Embedding → Sites app pages may embed**. | Address, title |
| Content | **Video** | YouTube (privacy-enhanced player), Vimeo, or an \`https://\` video file. | Address, caption |
| Layout | **Divider**, **Spacer** | A labelled line; empty space. | Label |
| Layout | **Tabs** | Each tab holds widgets of the page, **or** shows a target directly: a form (filled in place, edge to edge), another page of the app, a report, a data table, or a website (only sites on the embed allow-list; others show an *open in a new tab* link). Tabs have a label, icon (uploaded SVGs too) and live badge; they load on first open and reopen the person's last tab (also kept in the address, \`?t.<widget>=n\`). Styles: underline, pills, segmented, vertical. Tabs whose form, report or table a viewer can't use are hidden for them. | Tabs, their content or target, style, lazy, remember |
| Layout | **Collapsible section** | Group other widgets under a heading that collapses. The chosen widgets move into the container. | Heading, widgets, collapsed at first |
| Navigation | **Tile menu** | Icon tiles that open pages, forms, workflows, reports, records or links (each with its open mode). | Tiles, columns |
| Navigation | **Page header** | Breadcrumb, app icon and the page title. | Icon, breadcrumb, subtitle |
| Navigation | **Quick search** | Searches this app's pages and the forms, workflows, tables and reports its pages show the viewer, plus their tasks. | What to search |
| Navigation | **Navigation bar** | A menu docked flush to the left, right or top of the page (below). | Edge, entries, style |
| Agents | **Ask an agent** | Chat with a chosen agent. Contributors with **View agents** and **Run agents**; each message runs the agent as the viewer. | Agent, greeting, placeholder |

Every widget has loading, empty and error states, follows the theme in light and dark, and resizes with the grid (12 / 6 / 1 columns). **Chromeless** (in any widget's settings) drops the card, border, padding and title so the content fills the area; in the builder a chromeless widget's handle appears on hover.

## Cross-filtering

Charts (bars, slices), KPIs and metrics, SLA breakdowns, run status, team workload, team members, pivot rows, filtered lists and card views can **set a page filter when clicked**: choose the filter under **Click-through** in the widget's settings. Click the same value again to clear it. Time buckets set a date range filter; statuses a status filter; people, teams, workflows and forms their filters; anything else a **text** filter.

Click-through can instead **open another page with the filter set** (\`/apps/<app>/<page>?f.<filter>=<value>\`). Buttons, tiles and menu entries that open a page can pass values too (\`region={{filter:region}}, status=open\`). Because filters live in the address, every filtered view can be bookmarked and shared.

## Templates, duplicate and copy

**Templates** drop a pre-configured layout with its page filters:

- **Team dashboard** — workload, SLA, KPI, team workload (sets the person filter), throughput, Kanban, members; driven by a team filter.
- **Requester portal** — welcome, announcement, tiles, the request form on the page, my requests and progress.
- **Manager approvals** — the approval queue (quick-view drawer), overdue, team workload, cycle time, SLA by person.
- **Operations SLA** — SLA, a gauge, run status, SLA trend and breakdown (sets the workflow filter), bottlenecks, failures, heatmap.

Templates never point at a form, workflow or table: pick them in each widget with the pickers (Access issues lists what's still missing). Duplicate a widget or page, or copy widgets and paste them on another page (the clipboard works across apps you edit).

## Buttons

Each button has a label, an icon (left, right or icon-only with a tooltip), a **variant** (primary, secondary, outline, ghost, link, destructive), a **colour** (theme accent, app colour, or the theme's success / warning / danger / info), a **size** (small to extra large), a **shape** (rounded, pill, square), full width, a description line, a live **badge** (my tasks, queue, overdue, my submissions, running runs), *disabled with a reason*, a **confirmation** and a **keyboard shortcut** (\`alt+n\`). Buttons are laid out in a row, a column, grid tiles or a **split button** ("New ▾"), aligned left / centre / right / spread, with a small to large gap.

Actions: open a form, start a workflow (its start form), open a page (with filter values), open a link, open a report, download a report (CSV, as the viewer may run it), open a data table record or a new record, **claim the next task** from a team queue, copy a link, set a page filter.

**Who sees it** narrows a button to app roles and to teams or roles; it never widens — the server still drops buttons whose target the viewer can't use, and viewers never get buttons that submit, start, claim or create.

## Opening things: modals, panels and the panel stack

Forms, pages, reports, records and workflow start forms open in an **open mode**: centred **modal**, slide-in **panel** from the right or left (narrow, medium, wide, full), bottom **sheet**, **full screen**, **inline** (under the button — forms and reports), this tab, or a new tab — with slide, fade or scale motion (none with *reduce motion*).

Panels **stack**: opening something from inside a panel slides a new one over, the earlier ones stay open and peek out, and the header shows the trail (*Settings › Pricing › New item*) — click a step to go back to it. Escape closes the top panel, focus returns to what opened it, and closing a form with unsent answers asks first. Up to five panels; beyond that the target opens as a page. On a phone panels become full-width sheets. The stack is kept in the address (\`?panel=…\`), so refreshing or sharing the link reopens it.

**Size and resizing.** For a modal, panel or sheet the designer picks a size — **S / M / L / XL / Full**, or exact percentages of the window (modal width × height, panel width, sheet height) — and whether people may **resize** it (on by default). People then drag its edges or corner (or focus an edge and use the arrow keys), **maximise / restore** from the header or by double-clicking it, and their size is remembered per target in this browser. Phones always open it full screen. A custom header title can replace the form's or page's own.

Forms open edge to edge in a panel (no second card inside), titled with the form's name — never an internal page id — with the form's favourite and Save draft buttons in the panel's header row beside maximise and close.

Hidden pages (Page options) are made for this: build config or admin pages in the app and open them in panels from buttons or the menu.

## Passing values to forms

Wherever an app opens a form — the **Form** widget, a button or tile, a menu or nav entry, a tab, a card action — its settings list the form's declared **parameters** (required ones starred) and its variables, and each parameter gets a value from:

- a **fixed value**, a **page filter**, the **viewer** (id, name, email, team), **today / now**, the app, the page or a **URL parameter**;
- the **clicked row or card** (card actions);
- an **app variable** — reserved for app rules, coming next.

The values reach the form like its own URL parameters: the form checks them against its declarations (types, allowed values, patterns) and the server recomputes anything it relies on. **Access issues → Settings to check** lists every place a form's required parameter is passed nothing. When a form widget submits, the submission id and values are raised as a *form submitted* event (the hook app rules will use).

## Events (for builders who script apps)

Widgets don't act on clicks themselves: they raise events — *row clicked*, *card clicked*, *chart segment clicked*, *button clicked*, *form submitted*, *tab changed*, *filter changed* — and the page turns each into actions (open a target in a mode, set a filter, open a page, open a link, copy a link, claim the next task, download a report) from the widget's own settings. App rules will add their own event → condition → actions on the same model.

## Navigation

**App settings → Navigation** chooses how the app's pages and menu are shown, with a preview of each:

- **Top bar** (what doesn't fit goes into *More*), **left sidebar** (icons and labels, collapses to an icon rail), **menu button** (a hamburger drawer), **page tabs** (the default), **bottom bar** (a tab bar on phones), **mega-menu** (groups open as columns) or **no navigation**.
- On phones every style opens from a menu button (the bottom bar stays a bottom bar). Embeds follow the style; \`?menu=0\` still hides it.
- Header: show or hide the icon, title and subtitle; plain, app-colour or image-banner header; comfortable or compact density; and whether the UserTasks shell is shown around the app or the app fills the window.
- **Collapse the UserTasks menu in this app** (on by default): opening the app folds the UserTasks side menu to its icon rail, so the app gets the room — in the builder too. The expand button at the bottom of the rail brings the menu back for that visit; leaving the app shows the menu as you left it. Phones keep their menu button, and full screen has no UserTasks menu.

**An app, not a set of pages.** Moving between the app's pages keeps its header and navigation exactly where they are — only the page content changes, with a short fade (none with *reduce motion*) and a thin progress line while the next page loads. Page entries are real links: they open in a new tab with Ctrl / ⌘-click, and Back and Forward move between pages with their filters. Each page is still checked on the server as it opens (published or draft, the page's lowest app role). Full screen and embedded apps work the same way.

**App settings → Menu** holds entries after the pages: pages (hidden ones too, with filter values), forms, reports, data table records, workflows, task views and links, plus **groups** (one level of sub-groups), **headings** and **dividers** — each with an icon, a live badge, an open mode and *Who sees it*. Entries the viewer can't use are dropped by the server, and so are groups left empty.

The **Navigation bar widget** is the same menu docked to a page edge — left or right (full height) or top (full width) — flush, with no gutter: search (optionally also finding the app's objects), groups that remember being open or closed per person, collapse to an icon rail, a footer with the viewer and a help link, surface / app colour / dark background, width or height, density, icon size and labels. One bar per edge; on phones side bars become a menu button.

## Card view

A **Card view** shows records as cards from:

1. **A data table** — optionally one of its saved views; searched, sorted and paged on the server, as the viewer may read it.
2. **A report's rows** — the saved report as the viewer may run it (shared, or theirs).
3. **An API reference** — the same references data tables and forms use, called on the server with the workspace's connection. The browser only ever gets the card values: never credentials, addresses or request details.

The **card template** maps fields to the title, subtitle, description, image (cover or avatar), a badge with colours by value (\`Open=success\`), up to eight extra fields with labels and a footer. **Card actions**: record detail, open a page with the card's value as a filter, open a URL (\`{{field}}\` placeholders), start a workflow, open a form (contributors who may use them). Layout (grid, list, compact), card size, sort, search box, page size (**Load more**), empty text and click-through.

API references and governance:

- Only designers with **View integrations** can bind (or re-bind) a reference; only read references are accepted.
- People with **View integrations** see the cards. Other app viewers see them only after a designer with **Manage references** turns on **Allow app viewers to see this API data** — recorded in the audit log. Access issues lists everyone who would otherwise miss them.
- Inputs go only to the reference's **declared inputs**, from fixed text, the viewer (\`{{me_email}}\`, \`{{me_id}}\`) or a page filter (\`{{filter:<id>}}\`).
- Responses are cached per widget for its TTL (60 seconds by default) and calls are rate-limited per viewer and widget.

## Icons

App, page, menu, nav, button and tile icons come from the built-in set or the workspace's **uploaded icons**: **Upload SVG** in the icon picker (editors; up to 100 KB). Uploads are cleaned on the server — scripts, event handlers, foreign objects, external references, CSS \`url()\` and non-image data URLs are removed — stored with the workspace's files, served with \`nosniff\` and a sandboxing policy, and always drawn as an image, never inlined. **Use theme colour** draws a single-colour icon in the current text or app colour so it works in light and dark. The picker previews the icon at card, menu and rail size; uploaded icons are shared by every app in the workspace.


## Apps and permissions

**An app never grants access by itself.** It shows each person only what they could already open and do elsewhere in UserTasks, and the actions it offers are authorised by the same services as everywhere else.

### What each person sees

- Every **button**, **menu entry** and **widget** tied to a form, workflow, data table or report is shown only when the person may use that object under the existing rules. Otherwise it is left out of the page the server sends — nothing about it (not even its name or id) reaches their browser.
- Their **app role** narrows further:
  - **Viewer** — pages, lists, charts and tables; **no** buttons that open a form or start a workflow, no form entries in the app menu, no **Claim**.
  - **Contributor** — also the action buttons, form menu entries and **Claim**, where the objects allow it.
  - **Editors** (and **Build apps**) act like contributors when they use the app.
  If a person is in the audience more than once (themselves, a team, a role), the widest role wins. A role can only narrow what their permissions allow, never widen it.
- Whatever the page shows, the action itself is checked again when it happens: submitting a form, starting a workflow, claiming a task or reading data goes through its own permission checks.

| Object | Who may use it (the existing rules) |
|---|---|
| Form (open / submit) | **Edit forms**, or **Submit forms** plus a View or Submit grant on the form for them, a team of theirs or a role they hold — the same rule as the Forms menu |
| Workflow (start) | **View workflows** and **Start workflows** (\`workflows.activate\`), as for starting it anywhere |
| Data table | **View data** |
| Report | **View reports**, and the report is shared with the workspace or theirs |
| Task widgets | **View own tasks** (their tasks and their teams' queue) or **View all tasks** |
| Submission widgets | **Submit forms** (their own) or **Edit forms** (all) |
| Data grid editing, new records | **Manage rows** (\`data.manage_rows\`); contributors only — others get the grid read-only |
| Kanban drag | **Complete tasks**; contributors only |
| Agent chat | **View agents** and **Run agents** (\`agents.test\`); contributors only |
| Org chart | **View org chart** |
| API reference cards | **View integrations**, or *Allow app viewers* set by a designer with **Manage references** |
| Page with *Who can open it* | The app role it names (contributors, or editors) |

### Access issues in the builder

The builder checks the app as you build it (unsaved widgets included) and again when you save: for each audience entry and each form, workflow, data table or report the app uses, can everyone in it do what their app role needs — **see** it (viewers and contributors) and **submit / start** it (contributors)?

**Access issues** in the builder's toolbar lists the gaps, for example *“Team Finance (contributors) can't submit form ‘Expense claim’: no View or Submit grant on it.”* The audience tab of **App settings** shows the same check for the audience you are editing, and the app's card under **Apps I design** shows a badge while issues remain.

For each gap:

- **Grant access** — when the fix is a grant on a form and you may change grants (**Manage roles**, \`team.change_roles\`, as in a form's Access panel). It adds the least the entry needs — View and Submit on that form for that person, team or role — through the same service as the Access panel, and the grant is recorded in the form's audit history. **Grant all I can** does every such gap at once. Both ask you to confirm first; nothing is ever granted automatically.
- **Ask …** — when you can't fix it here: a role permission (ask an admin who can manage roles), a report that isn't shared (ask its owner), or something you can't grant. The issue stays listed until it is fixed.

Widgets whose inputs come from page filters are checked when they are read, as the person viewing them.

## Styling widgets

Every widget follows the workspace theme. To change how one widget looks, select it in the builder and open **Style**:

- **Colours** — background, border, header bar, title, body and muted text, accent (buttons, links, active states), KPI value, button background / text / border, table header / row stripe / row hover, active and inactive tabs, nav bar background / items / active item. Each is optional (*Theme default*). Pick a **theme colour** first (primary, success, warning, danger, surface, text, the chart colours…) so the widget keeps following light and dark mode and the workspace theme, or a **custom colour** (hex, rgb, hsl, with opacity; an eyedropper where the browser has one). **Dark value…** sets a separate dark-mode colour; with one value, dark mode reuses it, and light backgrounds / dark text are adjusted so they stay readable.
- **Contrast check** — when text on the background (or button text on the button) falls below WCAG AA (4.5:1, or 3:1 for titles and big numbers), the Style tab says so for the mode concerned.
- **Chart colours & value colours** — a palette preset (vivid, pastel, warm, cool, mono) or your own series colours, and a colour per value (a chart category, a status, a card badge such as *Approved*).
- **Shape, spacing & type** — corners, border width and style, shadow, padding, text alignment, title size and weight, KPI value size and weight.
- **Background** — an image (an \`https://\` address or a \`/path\`) or a gradient between two colours.
- **Buttons** — each button of a Buttons widget can have its own colours too (**Button colours** in its settings).

**Named styles and the app default.** **Save** keeps a widget's style as a named style of the app; choose it under **Start from** on other widgets, then change what differs. **Copy style / Paste style** move a style between widgets and pages. **App default** (in the Style tab) is the style every widget inherits — app default, then the named style, then the widget's own changes. **Reset to theme** clears a widget's own style.

Styles are plain settings — validated colours and choices, never CSS text — applied as theme values inside the widget, so they work in panels, full screen and embedded pages, travel with app packages, and are part of the API (\`style\` on a widget, \`style: { default, presets }\` on the app).

## Full screen and embedding

**Full screen** opens the page without the UserTasks side menu and top bar at \`/embed/apps/<slug>/<page>\`. Add \`?menu=0\` to hide the app's own menu too.

The same address is what a site the operator trusts can show in a frame (an intranet page, a SharePoint page): it follows the [trusted embedding](/docs/sharepoint) rules for \`/embed/\` pages — framing only from approved origins, and the person must be signed in (they are signed in automatically where single sign-on allows). The app itself still shows only to its audience and editors.

## Share links and sign-in

**App settings → Share & sign-in** shows the app's addresses, each with **Copy**:

- **Friendly link** — \`/app/<slug>\` (or \`/app/<slug>/<page>\`): the address to send people. On a workspace address it is \`https://acme.usertasks.com/app/<slug>\` and opens only that workspace's app. A workspace without its own address gets \`https://<main address>/app/<slug>?org=<workspace>\`: the \`org\` part names the workspace for the sign-in page and, after signing in, opens that workspace for its members. Without \`org\`, the main address opens the app in the person's current workspace, as \`/form/<name>\` does. Signed-in visitors go on to \`/apps/<slug>\` (the query is kept; \`?embed=1\` opens the full-screen view instead).
- **Full screen (embed)** — \`/embed/apps/<slug>\` (see below).
- **Inside UserTasks** — \`/apps/<slug>\`.

People who aren't signed in see the workspace's [sign-in page for forms and apps](/docs/tasks/forms#sign-in-page-for-forms-and-apps) first — the same branded page form links use — and come straight back to the app. Then the usual checks apply: someone outside the audience sees **This app isn't available**, with the sign-in page's support link when it has one; the audience sees the published version. The sign-in page never says whether an app exists.

**Sign-in page** (same tab) chooses, for this app: the **workspace setting** (the default: Settings → Sign-in page → *Use this page for apps*), always **the workspace sign-in page**, or **the standard UserTasks sign-in**. Like the audience it takes effect at once and isn't part of the draft. REST / MCP / CLI: \`sign_in_page\` on the app (\`workspace\`, \`standard\` or \`null\`).

Embedded apps sign people in automatically where single sign-on allows; otherwise the sign-in opens at the top level (or in a new tab from a frame) on the workspace sign-in page and comes back to the \`/embed/apps/\` page.

## Drafts and publishing

Apps work like forms: what you change in the builder is a **draft**, and the people who use the app keep seeing the **published version** until you publish.

**Who sees what.**

- **The app's audience** always sees the latest published version — its pages, widgets, menu and navigation, rules (including the actions rules run on the server), its card in the Apps menu and the full-screen / embedded page. Nothing you change shows for them until it is published.
- **Editors** (the app's named editors and people with **Build apps**) edit the draft in the builder. When they simply open the app they see the published version, like everyone else, with a note when the draft has unpublished changes.
- **An app that was never published** is visible to its editors only — its card says **Unpublished**, and it doesn't appear for anyone in its audience yet.

**What is versioned.** Everything that makes up the app's design: its name, subtitle, description, icon and colour, navigation and header, style, menu, parameters, variables and app rules, and every page — order, title, icon, widgets, filters, page parameters, variables and rules, and the page options (hidden, who can open it). **Not versioned**, because they are about access and take effect at once: the app's address (slug), its **audience**, its **editors** and its **sign-in page** choice — just as form permissions take effect at once while form content is drafted.

**In the builder.** The builder's toolbar shows the app's state — **Unpublished**, **Changes not published** or **Published vN** — with:

- **Preview** — the draft exactly as the audience would see it. Choose **as a contributor** or **as a viewer** at the top to check what a lower app role gets (pages limited to contributors disappear, action buttons hide). Preview still uses your own permissions on the forms, workflows and data it shows.
- **Publish** — shows what publishing changes against the published version (pages added and removed, widgets and rules changed, menu, navigation and style), anything that blocks publishing (an app with no pages, widgets that are no longer valid) and any **access issues** as a warning. Add an optional note; the draft becomes the next version.
- **⋯ → Compare with published**, **Version history** and **Discard draft**. Version history lists every published version with who published it, when and the note; **Compare with draft** and **Compare versions** compare any two; **Restore** copies a version into the draft (nothing changes for the audience until you publish). **Discard draft** throws away every unpublished change and goes back to the published version.

Save your page changes before you publish: Publish publishes what is saved. Publishing, discarding and restoring are recorded in the audit log.

**Existing apps.** When drafts were introduced every existing app was published as **version 1**, so nothing changed for the people using it.

**The Agent.** Apps the [Agent](/docs/ai-assistants) builds or changes are saved to the **draft** — the plan card says so. Afterwards you get **Publish now** and **Keep it as a draft** buttons, plus a link to preview the draft; publishing shows its own confirmation card with what will change. If you ask the Agent to "build it and make it live", it can publish in the same confirmed step.

**Packages, config as code and GitHub sync** carry the **published** version of each app (an app never published travels as its draft). **Package / Export** offers **Export the draft instead** when the draft has unpublished changes. Installing a package publishes the app as version 1 (its audience starts empty). Upgrading publishes the update as the next version — unless the app has unpublished changes in this workspace: then the upgrade is saved to its draft for you to review and publish.

**From the API, CLI and MCP.** \`GET /api/v1/apps/{id}\` (and the page reads) return the draft to editors and the published version to everyone else; add \`?version=published\` or \`?version=draft\` to choose (editors). Publish with \`POST /api/v1/apps/{id}/publish\` (\`usertasks apps publish\`, \`apps_publish\`); discard with \`DELETE /api/v1/apps/{id}/draft\` (\`apps draft-discard\`, \`apps_draft_discard\`); list and read versions with \`GET /api/v1/apps/{id}/versions\` and \`/versions/{version}\` (\`apps versions\`, \`apps version\`, \`apps_versions\`, \`apps_version_get\`); compare with \`GET /api/v1/apps/{id}/compare?from=published&to=draft\` (\`apps compare\`, \`apps_compare\`; \`from\` / \`to\` take \`draft\`, \`published\` or a version number); restore with \`POST /api/v1/apps/{id}/versions/{version}/restore\` (\`apps version-restore\`, \`apps_version_restore\`). \`POST /api/v1/apps/spec/apply\` saves to the draft and returns \`saved_as\` and \`preview_href\`; send \`"publish": true\` (with an optional \`publish_note\`) to publish right after.

## Build an app with the Agent

The [Agent](/docs/ai-assistants) can build a whole app for you, or change one, when you ask in plain words. It works with your permissions only: creating an app needs **Build apps**; changing one needs edit access to it (one of its editors, or Build apps); it can only show forms, workflows, data tables, reports and people you can see.

**How it works.**

1. You describe the app (or attach a screenshot, mockup or PDF of a dashboard you like).
2. The Agent looks up the real forms, workflows, tables, teams and people to use, then drafts the **whole app as one plan**: pages, widgets with their settings, buttons and what they open, page filters, rules, the audience (viewers and contributors) and editors.
3. You see a **plan card**: the app, each page, every new or changed widget with its size, who it is shared with and anything to look at (removed widgets, custom colours, missing titles). Nothing is created until you choose **Build app** (or **Apply changes** for an existing app).
4. It is applied in one step, to the app's **draft** (see [Drafts and publishing](#drafts-and-publishing)): a new app is visible to its editors only, and the audience of an existing app keeps the published version. If any step fails, nothing is kept — a new app is removed again, and changes to an existing app are undone. Choose **Publish now** (or ask the Agent to publish) to make it live.
5. Afterwards the Agent checks **Access issues**: if people in the audience can't use a form or workflow the app shows, it offers the form grants you are allowed to give (each one confirmed and audited on the form).

Every change is recorded in the audit log as you, marked as made through the Agent. Agent messages count towards your workspace's Agent limits as usual.

**Example prompts.**

- *Build me an expense desk for the finance team: a New claim button, my claims, an approvals queue for managers, and an SLA chart.*
- *Make a requester portal for IT: tiles for the three request forms, my open requests and their progress.*
- *Build a team dashboard for Support with workload, SLA, a Kanban board and who is on the team — driven by a team filter.*
- *Add a chart of overdue tasks by person to the Team page.* (in an app, or naming it)
- *Move the SLA chart under the queue and make it full width.*
- *Share this app with the Finance team as contributors and Leadership as viewers.*
- *Here's a screenshot of our old dashboard — rebuild it as an app.*

**In the app builder.** Open the Agent while you are on an app (viewing or building it): it knows the app and the page on screen, so "this page" and "this app" mean them. Save your own unsaved changes first — the Agent asks you to, because its change reloads the page. If something the app needs doesn't exist yet (say, the expense claim form), the Agent offers to build it first and then the app.

**Good defaults it follows.** Primary actions first, then a row of metrics, then lists and charts side by side; titles on every data widget; the workspace theme and the app's accent colour (no custom colours unless you ask); viewers for people who only look and contributors for people who submit or approve; pages for one group limited by app role.

**From your own tools.** The same one-step plan is available to other AI agents and scripts: \`apps_plan\` / \`apps_apply_spec\` over MCP, \`POST /api/v1/apps/spec/plan\` and \`/apply\` over REST, and \`usertasks apps plan\` / \`apps apply\` in the CLI (see the table below). \`apps_spec_reference\` (\`GET /api/v1/apps/spec/reference\`) returns the spec format, the design guidance, the starter templates and a worked example; \`apps_search\` finds the objects to bind.

## Package and share an app

An app can travel to another workspace — test to production, one team's workspace to another's, or a vendor to its customers — as a signed [package](/docs/packages) (\`.utpkg\`).

**Package / Export.** On **Apps → Apps I design**, **Package** on the app's card (or **App settings → General → Package / Export**) lists what the package will contain:

- the app: name, subtitle, description, icon and colour, its navigation and settings, every page (widgets, filters, options, hidden and minimum-role flags) and its menu;
- the **uploaded SVG icons** it uses, carried as files (they are sanitised again when installed);
- everything it uses, found automatically by following every widget, button, tile, tab, card action, menu and nav entry and page filter: forms, workflows, data tables (with their views), reports, API references with their integration, agents, other apps it links to — and what those use in turn (decision tables, email templates, sub-workflows, connectors).

Leave out anything that already exists where the package will be installed (the × on a row), and pick **Sample data** for a data table to include its rows. **Download package** builds the next signed version and downloads it; the package is also kept under **Settings → Packages → Authored here**, so packaging the app again publishes the next version.

**Never in a package:** the app's audience and editors (whoever installs it chooses who can use it), credentials (integrations travel as definitions — the install asks for the token or password), the workspace's embed allow-list, and usage data.

**Install.** **Apps → Install app** (or **Settings → Packages**) — drop the \`.utpkg\`, or pick a package from the gallery. The preview shows what will be created or updated (with field differences on an upgrade), credentials to provide, the permissions needed (installing an app needs **Build apps**), and the sites its Embed widgets frame that **Settings → Embedding** doesn't allow yet (they show as blocked until an admin adds them). Then:

- the app is created with a free address (\`/apps/ops-hub-2\` when \`ops-hub\` is taken), its pages, and every form, workflow, table and report remapped to the copies just installed;
- **you are its editor and its audience is empty** — use **Choose who can use it** after the install (it opens **App settings → Audience**); the access-issues check runs for the new app;
- people, teams and roles named in page filters or visibility rules that don't exist in this workspace are removed (the install says how many);
- a card view's **Allow app viewers** stays on only when the installer has **Manage references**.

**Upgrade.** Install a newer version of the same package to upgrade in place: the preview shows the difference per item. The app keeps its address, audience and editors and any pages you added in this workspace; the package's pages, menu and settings are updated. Tick **Keep assets changed in this workspace** to leave an app you changed locally as it is.

From the API, CLI and MCP: \`POST /api/v1/apps/{id}/package/preview\` and \`POST /api/v1/apps/{id}/package\` (\`usertasks apps package-preview\`, \`usertasks apps package\`; \`apps_package_preview\`, \`apps_package\`), then install with \`POST /api/v1/package-installs\` (\`usertasks packages install\`, \`packages_install\`). Apps are also part of [config as code](/docs/config-as-code) and [GitHub sync](/docs/config-as-code#github-sync): one file per app in \`apps/\`, with its pages and icons.

## Parameters

**Parameters** are values a page (or the whole app) takes in. Declare them in the builder under **Variables → Parameters** — on **This page** or the **Whole app** — each with a name, a type (text, number, yes / no, date, list, record), an optional default and **Required**.

A parameter is filled from, in order:

1. **Whatever opened the page** — a button or tile (**Open a page**), a menu or nav bar page entry, a tab, or a rule that opens the page in a panel, modal, sheet or this tab passes values (**Page parameters to pass**), from a fixed value, a filter, another parameter, a variable, a system value, the clicked row or card, or an expression.
2. **The URL**: \`/apps/<app>/<page>?p.customer=C-104\` — also on the embed address, \`/embed/apps/<app>/<page>?p.customer=C-104\`.
3. Its **default**, which may itself be a template such as \`{{sys.user.id}}\`.

Values are typed and checked: a number parameter given “abc” is ignored (its default stands) and the page shows a short notice; a required parameter with no value is reported the same way. Read a parameter anywhere as \`{{param.customer}}\`.

## Variables

**Variables** hold values while the app is open. Declare them under **Variables → Variables**, with a type and an optional default:

- **Page variables** start from their default each time the page opens. Turn on **In URL** to keep the value in the address (\`?v.rowId=…\`) so the view can be bookmarked and shared.
- **App variables** are kept while the person moves between the app's pages (in this browser tab).

Rules set variables (**Set variable(s)**, or **Store the result in** on any action), and widgets bound to them read again when they change. Read a variable anywhere as \`{{var.rowId}}\` — a record's fields as \`{{var.customer.name}}\`.

## System variables

Read-only values available everywhere — widget inputs, filter defaults, form parameter mapping, rule conditions and actions, headings and text:

| Path | Value |
|---|---|
| \`sys.user.id\`, \`.name\`, \`.email\`, \`.avatar\` | The person viewing the app |
| \`sys.user.teams\`, \`.team_ids\`, \`.roles\`, \`.role_ids\` | Their teams and roles in this workspace (names and ids) |
| \`sys.user.manager.id\`, \`.name\`, \`.email\` | Their manager |
| \`sys.user.timezone\` | Their timezone (UTC when not set) |
| \`sys.today\`, \`sys.now\` | Today's date and the current time — **today in the viewer's timezone** |
| \`sys.start_of_week\`, \`sys.start_of_month\`, \`sys.end_of_month\` | Dates in the viewer's timezone (weeks start on Monday) |
| \`sys.workspace.id\`, \`.name\` | The workspace |
| \`sys.app.id\`, \`.slug\`, \`.name\` · \`sys.page.id\`, \`.slug\`, \`.name\` | This app and page |
| \`sys.url.<name>\` | A parameter of the page's address (\`?ref=…\` → \`sys.url.ref\`) |
| \`sys.device.mobile\` | Whether the screen is phone-sized |
| \`sys.app_role\` | The viewer's app role: \`viewer\`, \`contributor\` or \`editor\` |

## Using values everywhere

- **Widget inputs**: every input that can follow a page filter can also follow a parameter, a variable or a system value (“Parameter: customer”, “Variable: rowId”). When the value changes, the widget reads again.
- **Text and headings**: write \`Hello {{sys.user.name}}\` in a Heading, Text, Announcement or a widget's title. Values put into rich text are escaped.
- **Expressions**: \`{{= … }}\` uses the same formula language as form label fields: \`{{= var.qty * param.price }}\`, \`{{= CONCAT(sys.user.name, " – ", sys.today) }}\`.
- **Page filter defaults**: a text filter's default may be a template (\`{{param.region}}\`).
- **Form parameters**: in every form parameter mapping (form widget, buttons, tiles, tabs, card actions, menu entries, rules) choose **Parameter**, **Variable**, any system value, the clicked row / card, or **Expression / template**. A form's own variables are listed for reference — the form computes them.

## App rules

**Rules** make a page react: **When** something happens, **If** conditions hold, **Then** run actions in order. Open **Rules** in the builder's toolbar. Rules on **This page** are saved with the page; **Whole app** rules run on every page.

**When** — the trigger, and what it carries as \`{{event.*}}\`:

| Trigger | Carries |
|---|---|
| Page loaded | \`event.page\` |
| Parameter or variable changes (one, or any) | \`event.name\`, \`event.value\`, \`event.previous\` |
| Filter changed | \`event.filter\`, \`event.value\`, \`event.previous\` |
| Button clicked (a widget, a button) | \`event.index\`, \`event.label\` |
| List / grid row clicked | \`event.value\`, \`event.row.id\`, \`event.row.<column>\` |
| Card clicked | \`event.card.id\`, \`event.card.<key>\` (also \`event.row\`) |
| Chart segment clicked | \`event.value\` |
| Tab changed | \`event.tab\` |
| Form submitted — from a form widget or any form the app opened (modal, panel, sheet) | \`event.form_id\`, \`event.submission_id\`, \`event.values.<field>\` |
| Panel closed | \`event.kind\`, \`event.id\` |
| Timer — every 30 seconds or more, only while the page is visible | \`event.at\` |
| API reference returned | \`event.reference_id\`, \`event.result\` |

**If** — the same condition builder as form rules (all / any, one nested group), over the event, parameters, variables, filters, system values and widget state (\`widget.<id>.selected\`, \`widget.<id>.tab\`).

**Then** — actions run in order:

| Action | What it does |
|---|---|
| Set variable(s) | One or more variables, from values or expressions (\`rowId = {{event.row.id}}\`) |
| Set a page filter · Clear filters | Change the filter bar |
| Open | A form, page, report, record, workflow start or web address — in a modal, slide-in panel, sheet, full screen, this tab or a new tab — **passing values** (form parameters, page parameters) |
| Close panel · Go to page | Close the top (or every) panel; open another page with parameters |
| Refresh widgets · Show / hide widgets · Enable / disable a button | Change the page |
| Show a message · Ask to confirm | A short message; a question whose **If they confirm / Otherwise** branches run different actions |
| Call an API reference *(server)* | Runs a read-only API reference with the workspace connection |
| Look up / create / update data table rows *(server)* | As the viewer, with their permissions |
| Start a workflow *(server)* | As the viewer, with inputs |
| Copy to clipboard · Download report (CSV) | |

Each action can **store its result in a variable**, and the next action reads the previous result as \`{{result}}\` (\`{{result.name}}\`). **If it fails**: stop the rule (default), continue, or run the rule's **On error** actions (\`{{event.error.message}}\`). A rule that changes a variable may trigger another rule; chains stop after 5 levels so two rules can't loop.

**Example — a credit check from a customer list.** Declare page variables \`rowId\` (text), \`customer\` (record) and \`credit\` (record). Then:

1. **When** *List / grid row clicked* on the Customers grid.
2. **Then** *Set variable(s)*: \`rowId = {{event.row.id}}\`.
3. *Look up data table rows*: table *Customers*, row id \`{{var.rowId}}\`, store the result in \`customer\`.
4. *Call an API reference*: *Credit check*, input \`company = {{var.customer.name}}\`, results path \`data\`, store the result in \`credit\`.
5. *Open* the form *Credit review* in a **slide-in panel**, passing \`customer_id = Variable: rowId\` and \`limit = Expression: {{var.credit.limit}}\` (for example USD 25,000).

**Debug** (in the Rules dialog) lists the last events, each rule's evaluated conditions and every action's result from the live preview; **Run** fires a rule with a sample event. Server actions run from the saved page.

### Rules and permissions

Rules never grant access:

- **Server actions** go through one endpoint, \`POST /api/v1/apps/{id}/actions\`, which reads the action from the **saved** app by rule id and position and takes only the values of its declared inputs from the browser. Each run is checked again as the page would be shown to that person, rate limited (60 a minute per person) and recorded in the audit log.
- **Viewers** (read-only app role) never run actions that write or start work (create / update rows, start a workflow, open a form). Data table actions use the viewer's own permissions (**View data**, **Manage rows**) and row-level security.
- **API references** run with the workspace's connection, so — as for Card view API sources — only people with **View integrations** run them, unless a designer with **Manage references** turns on **Allow app viewers** for that action (recorded in the audit log). Only the reference's declared inputs are sent, and only read-only references can be called. Adding an API reference call needs **View integrations**; adding *Start a workflow* needs **Start workflows**.
- Actions someone can't use are removed from the page the server sends them (the rest of the rule still runs). **Access issues** lists audience members who can't use what rules use, and warns about rules that refer to variables, parameters, widgets, filters or pages that don't exist, or open a page without a required parameter.

## API, CLI and MCP

| Task | REST | CLI | MCP |
|---|---|---|---|
| List / get apps | \`GET /api/v1/apps\`, \`GET /api/v1/apps/{id}\` | \`usertasks apps list\`, \`apps get\` | \`apps_list\`, \`apps_get\` |
| Create / update / delete | \`POST /api/v1/apps\`, \`PATCH\`, \`DELETE /api/v1/apps/{id}\` | \`apps create\`, \`apps update\`, \`apps delete\` | \`apps_create\`, \`apps_update\`, \`apps_delete\` |
| Pages | \`GET\` / \`POST /api/v1/apps/{id}/pages\`, \`GET\` / \`PATCH\` / \`DELETE /api/v1/apps/{id}/pages/{pageId}\`, \`POST /api/v1/apps/{id}/pages/reorder\` | \`apps pages\`, \`apps page\`, \`apps add-page\`, \`apps update-page\`, \`apps delete-page\`, \`apps reorder-pages\` | \`apps_pages_list\`, \`apps_page_get\`, \`apps_page_create\`, \`apps_page_update\`, \`apps_page_delete\`, \`apps_pages_reorder\` |
| Widget catalogue (types, sizes, config JSON schema) | \`GET /api/v1/apps/widget-types\` | \`apps widget-types\` | \`apps_widget_types\` |
| Access issues / grant | \`GET /api/v1/apps/{id}/access\`, \`POST /api/v1/apps/{id}/access/grant\` | \`apps access\`, \`apps grant-access\` | \`apps_access_check\`, \`apps_access_grant\` |
| Package / Export | \`POST /api/v1/apps/{id}/package/preview\`, \`POST /api/v1/apps/{id}/package\` | \`apps package-preview\`, \`apps package\` | \`apps_package_preview\`, \`apps_package\` |
| Publish the draft / discard it | \`POST /api/v1/apps/{id}/publish\`, \`DELETE /api/v1/apps/{id}/draft\` | \`apps publish\`, \`apps draft-discard\` | \`apps_publish\`, \`apps_draft_discard\` |
| Versions, compare, restore into the draft | \`GET /api/v1/apps/{id}/versions\`, \`GET /api/v1/apps/{id}/versions/{version}\`, \`GET /api/v1/apps/{id}/compare\`, \`POST /api/v1/apps/{id}/versions/{version}/restore\` | \`apps versions\`, \`apps version\`, \`apps compare\`, \`apps version-restore\` | \`apps_versions\`, \`apps_version_get\`, \`apps_compare\`, \`apps_version_restore\` |

| Rules reference (triggers, actions, system variables, rule / parameter / variable JSON schemas) | \`GET /api/v1/apps/rule-types\` | \`apps rule-types\` | \`apps_rule_types\` |
| Run a rule's server action | \`POST /api/v1/apps/{id}/actions\` | \`apps run-action\` | \`apps_run_rule_action\` |
| Build or change a whole app in one step (check, then apply; nothing kept if a step fails) | \`POST /api/v1/apps/spec/plan\`, \`POST /api/v1/apps/spec/apply\` | \`apps plan\`, \`apps apply\` | \`apps_plan\`, \`apps_apply_spec\` |
| Spec format, design guide, templates, example | \`GET /api/v1/apps/spec/reference\` | \`apps spec-reference\` | \`apps_spec_reference\` |
| Find objects to bind; a form's parameters, a table's columns, a workflow's trigger | \`GET /api/v1/apps/spec/search\`, \`GET /api/v1/apps/spec/object\` | \`apps search\`, \`apps object\` | \`apps_search\`, \`apps_object_details\` |

\`{id}\` and \`{pageId}\` accept the id or the slug. Audience entries are \`{ type, id, role }\` with \`role\` \`viewer\` (default) or \`contributor\`. For someone who isn't an editor, app and page reads return what they may see — the same presentation as the app. **PATCH** replaces the audience, editors, widgets and filters you send. A page's widgets are \`layout.widgets\`: \`{ id, type, w, h, title?, config }\`, with \`w\` in columns of 12 and \`h\` in rows of 40 px. Inputs bind to page filters with \`{ "filter": "<filter id>" }\`.

Widget data itself is read only in the app, as the signed-in person — there is no API for it, so an API key can never see data through an app that its owner couldn't. The widget catalogue lists every Phase 2 widget with its group and config JSON schema; apps take \`nav\` (style and header options) and menus take groups, page / report / record / workflow / tasks entries, headings and dividers. Page options travel in \`layout.options\` (\`{ hidden, min_role }\`); page parameters, variables and rules in \`layout.params\`, \`layout.variables\` and \`layout.rules\`; app-level ones in the app's \`params\`, \`variables\` and \`rules\`.
`,
}
