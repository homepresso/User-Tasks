# Release notes: Home cards chart your activity, task rows expand

Home's top row is now four cards, each with a small chart. The separate row of compact widgets under the cards is gone; its information moved into the cards.

## The four cards

| Card | Number | Chart |
|---|---|---|
| **My tasks** | open tasks, with **overdue** and **past SLA** chips | completed tasks per day (a small column chart) and the on-time meter |
| **My decisions** | approval rate | the stacked outcome bar (Approved, Rejected, Sent back, your own labels) |
| **My submissions** | in progress | the period's submissions by process status, with the median end-to-end time |
| **Following** | active processes, with an **updated today** chip | active against finished |

- The numbers are counts right now. The charts follow **7 / 30 / 90 days** in the header.
- Select a card's number to open its tab in the list.
- The chevron (⌄) still expands a card to show its full legend, a table and notes.

## Task rows expand

In **My tasks** and **Task queue**, click a task (or press Enter or Space on its title) to expand it in place. It shows the description, up to six filled-in fields and the subtasks, each with status, assignee, due date and progress. The details load when you open the row. Each row also has an **Open task form** button that goes straight to the task's form (`/tasks/<id>#task-form`).

The list header is now a solid band in your theme's brand colour, with its on-colour text.

## Your saved layout

- If you haven't customised Home, you get the new layout automatically.
- If you saved your own layout, it is mapped to the new cards:
  - **On time** and the **My submissions** chart widget are retired and dropped;
  - **My decisions** moves into the top row, right after **My tasks**;
  - cards still at the old default width (a third) become a quarter, so the four share one row. Widths you chose yourself are kept.
- Home shows the one-time "Home has a new default layout" note again (a new version of it), so you can try the new default with **Try the new default**, then **Done** or **Cancel**.

## Fixed

- **Tasks completed** and **Time to complete** no longer shake on very wide screens or at some zoom levels. The chart's box could overflow by a fraction of a pixel, show a scrollbar, get narrower, lose the scrollbar and start again. The plot box now has a fixed size that the chart can't change, chart resizes are debounced, and the cards only report their height while expanded, ignoring 1px wobble.

## For developers

- `lib/home/layout.ts`:
  - `HOME_WIDGET_IDS` order: `metric.tasks`, `chart.decisions`, `metric.submissions`, `metric.following`, `tasks`, then the charts and `drafts`.
  - The four cards are `group: 'metric'`, `compact: true`, 3 × 4 rows (`COMPACT_ROWS` is now 4).
  - `RETIRED_HOME_WIDGET_IDS` adds `chart.on_time` and `chart.submissions`. `PUT /home/layout` still accepts them and drops them.
  - `normaliseHomeLayout` maps pre-merge layouts (see above).
- New read `home.taskDetails` (`lib/services/home.ts`, `shapeTaskDetails`): description excerpt, key fields and direct subtasks of a task the caller may see on Home (assignee, assigner, collaborator, a member of its unassigned team, or `tasks.view_all`).
- localStorage: the hint key is now `usertasks.home.new-default-2026-12-cards.<user>`.
- The `.home-grid` CSS moved from `app/globals.css` to `components/home/home-grid.css` (imported by `app/(dashboard)/home/page.tsx`).
