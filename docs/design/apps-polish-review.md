# Apps and widgets: polish review (Nov 2026)

What made app pages look unfinished, what changed, and what is left. Branch `apps-polish`.

Screenshots are not checked in. They are in `out/apps-polish-shots/` (gitignored), taken on a throwaway local stack with fictional demo data: an app built like the one in the owner's report ("Test App": tasks by status donut, my tasks, waiting for approval, team queue, all open tasks, SLA, filters, a left nav bar with placeholder entries and a page header half-way down).

| Folder | What it shows |
|---|---|
| `before/` | `main` at the branch point (b10cf0fe5): `light-*`, `dark-*`, `mobile-*`, `tablet-*` |
| `after/` | this branch, same data, nothing in the app changed |
| `fixed/` | this branch after the builder's **Checks → Fix all**, Save, Publish (`light-00-checks-before-fix.png` shows the panel) |

File names match across folders: `*-01-home`, `*-02-task-drawer`, `*-03-insights`, `light-04-builder`, `light-05-builder-checks`, `light-06-apps-landing`, `mobile-01-home`, `mobile-02-task-drawer`, `tablet-01-home`.

---

## 1. The owner's report, item by item

### 1.1 Navigation and headers repeated

**Before:** the app header ("Test App"), a "Home" tab, a left nav bar whose first item was "Home" (badge 2) and then another "Home", and a page header ("Apps › Test App / Home" with a large solid icon) under the first row of widgets. That is four ways of saying the same thing.

**Now:**
- **One navigation.** A docked nav bar that lists every page of the app replaces the app's tabs on its page. The new nav bar setting `app_nav` (default `hide`; `show` keeps both) controls this. If the bar lists only some pages, the tabs stay so no page becomes unreachable, and the builder warns. Its fix is **Add the missing pages**, after which the bar replaces the tabs.
- **No tabs for a single page.** An app with one page and no extra menu entries shows no tabs.
- **Each target once.** The nav renderer drops repeated targets. The menu editor's **Add entry** now picks the first page that isn't already in the menu, so it no longer adds a second "Home". The builder warns about duplicates (fix: **Remove duplicates**).
- **Page header.**
  - It is quieter now: the page's own icon in a soft accent tile, the page title and an optional subtitle.
  - The "Apps › app" breadcrumb only shows where the app header doesn't (embedded pages, or apps that hide their title).
  - The builder warns when the header isn't the first widget (fix: **Move to the top**). Specs and the Agent guide say "first widget only".
- **App header.** Icon, name and subtitle (with a tooltip when truncated), then the actions: **Copy link** (with filters), **Full screen** and **Edit**.
  - It is sticky inside the UserTasks shell.
  - Coloured headers keep their actions at AA contrast: text is black or white, chosen from the app colour's luminance.
- **Phones.** One menu button in the header holds the app's pages plus the nav bar's entries. Before, there were two stacked hamburgers.

### 1.2 Placeholder labels shown to viewers

**Before:** menu entries read "Link" and "Link ↗" (the editor's default labels).

**Now** (`lib/apps/labels.ts`):
- A placeholder ("Link", "Page", "Form", "New tile", "New submission", an empty label…) is never shown as is. The entry takes its target's name instead:
  - the page title;
  - the link's last path segment, else its host ("…/travel-policy" → "Travel policy");
  - the form, report, workflow or table name;
  - the tasks view.
- The server fills in object names that the viewer may see. `ObjectFacts.names` feeds `presentMenu` and `presentLayout` for buttons and tiles.
- The builder asks for real labels:
  - the menu editor shows an inline warning;
  - Checks offers **Use target names**;
  - the publish dialog lists them;
  - the spec compiler warns the Agent.

### 1.3 Widget sizing

**Before:**
- an untitled task list with its last row cut in half;
- "Waiting for approval" 9 rows tall for one task;
- a tall, sparse "No open tasks for this team." card;
- a donut with bands of empty space;
- a last row ending one column short of the right edge.

**Now** (`lib/apps/grid.ts`, measured in `SizedGrid` and `WidgetBody`):
- **Auto height** (new widget field `height: 'auto' | 'fixed'`, plus `max_h`):
  - Lists, cards, people widgets and small summaries grow and shrink with their content up to a cap, then scroll inside with a top and bottom fade (pure-CSS scroll shadows).
  - New widgets and spec- or template-built widgets default to auto.
  - Widgets saved before this change shrink to their content but never grow past the size the builder gave them. Existing apps lose empty space; nothing grows.
- **Rows stay rows.** Widgets that start on the same grid row form a band, and a band takes the height its content needs.
  - **Equal rows** is on by default; Page options can turn it off ("Line up the cards in each row"). Every widget in a clean band lines up at the band's height.
  - A masonry column (one tall card next to two stacked ones) is left as built.
  - If shrinking would ever let a later widget jump ahead of an earlier one, the built sizes stay.
- **Fill.** The last card of a short row stretches to the grid's right edge. This only happens when no other widget moves.
- **Lists never clip a row.** Fixed and older cards show the rows that fit (rows are a fixed 52 px) and a **View all (n)** link. It opens a sheet with every loaded row and "Open in Tasks". On phones, lists stop at about 8 rows.
- **Compact empty states.** An icon chip, one line and an optional action, sized to fit. Error states use the same layout with **Try again**.
- **Titles.**
  - Data widgets always show a title. Untitled ones get a plain one: "My tasks", "Team queue", "Open tasks", "Tasks by status", "Overdue tasks"…
  - New widgets start with it, the builder shows it as the placeholder and Checks offers **Use "My tasks"**.
- **Donut.** The legend goes beside or below the donut, whichever leaves the bigger donut.
- **Gutters.** The filter bar is no longer a boxed card. It sits on the grid's left edge, and all gaps are 12 px.

### 1.4 Icons

- Page entries use their page's icon. A page without one gets a house (first page) or a page icon, never a robot or briefcase from somewhere else.
- The builder warns when a page entry's icon differs from its page's (fix: **Use page icons**). A new nav bar's page entries follow the page icon live.
- Pages get an icon picker in the builder toolbar. The `icon` column already existed, so no migration was needed.
- The app icon stays the app's: header tile, Apps cards and the Apps menu.
- **Icon names are validated.**
  - `lib/apps/icon-names.ts` lists every built-in name.
  - The spec compiler rejects unknown names in plain language ("app.icon: "Robot" is not an icon — use … Bot, Rocket…", or "write it as "House"" for a case slip).
  - `apps_spec_reference` lists the names.
  - A test keeps the list in step with `components/apps/app-icon.tsx`.
  - Added: ClipboardCheck, CircleCheck and Plus (used by the guide's own example).

### 1.5 The Agent launcher over a card corner

- App pages reserve the launcher's height below the last row (`[data-app-page-root]`, using `--agent-launcher-reserve`). The last card always scrolls clear of the button.
- The shell's own scroll room no longer doubles this on app pages.

### 1.6 Task quick-view drawer

**Before:**
- the title wrapped against the close button;
- the meta row didn't line up with the title;
- sections had uneven padding;
- actions were small links in the middle;
- a big empty space below;
- no Approve or Reject for an approval task.

**Now** (`components/apps/task-quick-view.tsx`):
- **Sticky header** on one left edge:
  - status pill, priority and an open-in-page icon;
  - the title, clamped to two lines (full title on hover, plus "Show full title" for long ones);
  - context (subtitle and team);
  - due date (relative, overdue in danger, absolute date on hover), and assignee and requester with avatars.
- **Body:**
  - a summary with **Show more**;
  - **Details**: the task's form fields with values as a read-only preview, up to 10. Secrets never leave the server (`fieldPreview` in `lib/services/task-panel.ts`).
  - progress, effort and subtasks;
  - latest activity with an avatar.
  - Every section uses one heading style and one spacing scale.
- **Sticky footer** with the task's real actions. These come from the same server rules and actions as the task lists (`tasks.quickActions`, `runQuickAction`):
  - Claim or Accept for queued tasks;
  - the configured outcomes as verbs (**Approve**, **Reject**, **Complete**), with an optional note;
  - **Open form to complete** when the form must be filled;
  - **More actions** (hold, redirect, escalate, comment, invite);
  - the links (Open task, Open form, Process view, Timeline, Attachments).
- Full width on phones, with the footer still sticky.

---

## 2. Full review by area

Legend: **Fixed** = on this branch. **Deferred** = see section 3.

### Typography and hierarchy
- **Fixed.** App title: text-xl semibold, tight tracking. Page title: text-xl in the page header. Widget title: text-sm semibold with a tooltip. Values use tabular figures; meta text is xs muted.
- **Fixed.** Truncation with tooltips (`title` or Tooltip) on app title and subtitle, widget titles, list rows, people and drawer fields.

### Numbers, dates and statuses
- **Fixed.** Durations read "45m", "3h 20m", "2d 4h" (`formatDurationParts`; cycle time and bottlenecks use it).
- **Fixed.** Due chips and recent rows show relative time, with the absolute date on hover or focus.
- **Fixed.** Gauge, KPI and goal units come from config ("%", the currency code, the summed column's name, "tasks", "records"), never the bare word "rows".
- Already fine: thousands separators and compact 12.3k (`lib/format/number`), and the currency from the widget's own config (USD only as the default when none is set).
- **Fixed.** Recent rows use the product's shared `StatusPill`.
- **Fixed.** Task rows show the shared priority bars (`PriorityMark`).
- **Fixed.** Bug: task rows began with "· Operations" when a task had no process.

### Charts
- **Fixed.**
  - A subtle entrance animation (bars grow, lines draw), off with reduced motion.
  - Hover highlight on clickable bars (others dim), pointer cursor, active filter value stays bright.
  - Active dots on lines.
  - Stacked and combo charts get a series legend with totals.
  - An all-zero chart shows the compact "Nothing to chart for these filters yet." instead of an empty axis.
- Already fine: tooltips, palette from theme tokens, light gridlines, compact axis labels, table toggle.

### Lists and tables
- **Fixed.**
  - Row hover and focus wash; the whole row is the click target (stretched link) and Claim stays above it.
  - Arrow keys, Home and End move between rows (`onListKeys`).
  - Fixed 52 px row height, View all, and loading skeletons shaped like rows.
- Deferred: zebra option (the style editor already has a stripe colour), and inline row actions on hover.

### Cards
- **Fixed.**
  - One card style: theme card surface, subtle border, theme shadow.
  - Header: title, a refresh spinner while refetching, then the **⋯ menu**. It holds "Updated 2 min ago", **Refresh**, **Open full screen** (the widget in a large dialog) and **Download CSV** (only the rows the viewer already loaded, `lib/apps/widget-csv.ts`).
  - Bug: "own" widgets (team workload, KPI, Kanban…) were called as functions, so their hooks ran outside the widget's providers and header-slot actions and data reporting never reached them. They now render as elements.
- Deferred: an optional widget description shown as a tooltip.

### Page chrome
- **Fixed.**
  - Filter bar: compact, on the grid edge, a chip for each filter changed from its default (× resets it) and **Reset filters**.
  - Header actions: Copy link, Full screen, Edit. Sticky header.
  - Cards fade up once on open (off with reduced motion).
- Already present: page transitions (shell), and scroll position resets on page change (the shell remounts `main`).

### Builder
- **Fixed.**
  - A **Checks** button and panel listing every design check, each with Show widget, a one-click fix where safe, and **Fix all**.
  - The publish dialog repeats the warnings as "N design checks to look at" (`compareAppVersions.design_warnings`).
  - Preview at desktop, tablet and phone widths.
  - New widgets go after the selected widget.
  - Height setting: Auto (with "up to N rows") or Fixed.
  - Page icon picker; "Line up the cards in each row" in Page options.
- Deferred: alignment guides while dragging.

### Data
- **Fixed.** Team workload counts tasks routed to the team's queue and tasks assigned to its members, each once, only what the viewer may see. Before, workflows that assign people individually showed nothing. The empty state and the docs now say so.

### Responsive, dark mode and accessibility
- **Fixed.**
  - One phone menu. Lists capped on phones.
  - Drawer full width on phones with safe-area padding.
  - Focus rings on rows, chips, menus and due dates.
  - aria labels on the ⋯ menus, chips, priority marks and the refresh spinner.
  - Reduced motion respected (cards, charts, drawer).
  - Dark mode checked (`dark-*` shots).

### AI spec, templates and Agent guidance
- **Fixed.**
  - `APP_DESIGN_GUIDE` covers: one navigation (nav bar only to replace the tabs, listing every page), real labels, page header first only, a title on every data widget, auto height for lists (`max_h`), and page icons.
  - The example spec follows these rules.
  - Spec widgets default to auto height for lists. The compiler adds the design checks to its warnings and rejects unknown icons.
  - Templates give every data widget a title and auto height.

---

## 3. Deferred, ranked by impact

1. **Assignee avatars in task rows.** `HomeTask` has no assignee. This needs a small server change shared with Home (`shapeTasks`).
2. **Alignment guides and snapping while dragging in the builder.** Today rows fill on display, but the builder shows the stored widths.
3. **An optional widget description** (the header tooltip) and per-widget "last updated" text without opening the menu.
4. **Inline row actions on hover** (complete / approve from the list) and a zebra option for lists.
5. **Fit-whole-rows for every list widget.** Task lists, the overdue list and recent activity have it. My submissions, the activity feed, people and filtered lists still scroll, with the fade on auto cards.
6. **Docking the Agent launcher into the app header** (the alternative to reserved space) for app-only and embed views.
7. **Merge with `gallery-apps`.** It also changes `components/apps/app-icon.tsx` (17 icons) and the My submissions widget. After it lands, add its icon names to `lib/apps/icon-names.ts` (the parity test will fail until then) and rebase.

## 4. Notes for reviewers

- **Behaviour changes for existing apps:**
  - list widgets lose empty space (never taller);
  - cards in a clean row line up;
  - short rows stretch to the edge;
  - a nav bar listing every page hides the app tabs on its page;
  - placeholder labels show target names.
- All of these are display-time only, so layouts as stored are unchanged. **No migrations.**
- **New stored fields** (all optional, in existing JSON): widget `height` and `max_h`, page option `equal_rows`, nav bar `app_nav`.
- **Tests:** `__tests__/apps-polish.test.ts` covers labels, checks and fixes, display layout (no reorder, masonry, fill, equal rows), titles and caps, CSV, durations, field preview, icon validation and icon-registry parity.
