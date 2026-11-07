# Release notes: compact activity widgets and a Favourite forms tab on Home

Home's default layout puts your decisions, on-time rate and submissions straight under the cards, in a short row. Favourite forms moves into the list as a tab.

## The new default layout

1. The three cards: **My tasks**, **My submissions** and **Following**.
2. **My decisions**, **On time** and **My submissions**, a third of the width each.
3. The list: **My tasks**, **Task queue**, **Following**, **My submissions** and the new **Favourite forms** tab.
4. **Tasks completed** and **Time to complete** side by side, then **Processes I work in most** at full width.
5. **Drafts**.

If you haven't customised Home, you get this layout automatically.

If you saved your own layout, it stays as it is. Home shows a one-time note: "Home has a new default layout… Reset to try it?". **Try the new default** opens edit mode with the new layout. Select **Done** to keep it, or **Cancel** to go back to yours.

## Compact widgets

**My decisions**, **On time** and **My submissions** now show just the headline and one bar, for example "53% approved" above the stacked outcome bar, or the on-time meter. Their default height fits exactly that.

- The chevron (⌄) at the top right **expands** a widget to show its legend, table and notes (such as the tasks you completed without a decision). The widget grows to fit its details, and collapses again with the same button.
- Home remembers which widgets you expanded, per person, in this browser.
- The chevron is a real button with `aria-expanded`, and `aria-controls` points at the details it shows.
- In edit mode the widgets show collapsed, and the collapsed size is their minimum.

## Favourite forms is a tab

The **Favourite forms** tab sits next to **My submissions** and lists your starred forms alphabetically. Each row shows the name, the description, an **Open** button and a star to remove it. **Open** goes to the form's page for filling in (`/f/<id>`). With more than ten favourites, the tab has a search box. With none, it explains how to star a form. Home remembers the tab like the others.

The separate **Favourite forms** widget is gone. Saved layouts that had it read without it, and everything else stays where you put it. `PUT /home/layout` still accepts the old `favorites` id from older clients, but drops it.

## For developers

- `lib/home/layout.ts`: new default order and sizes, `compact` widgets (`COMPACT_ROWS`, `displayItems`, `rowsForHeight`, `parseExpandedWidgets`, `toggleExpandedWidget`) and `RETIRED_HOME_WIDGET_IDS`.
- An expanded compact widget grows to the measured height of its content (rounded up to whole grid rows, never below its saved size). Only how it is drawn changes. The saved layout keeps the collapsed size.
- `lib/home/favorites.ts`: what the Favourite forms tab lists (sorting, search past ten, empty states).
- localStorage: `usertasks.home.expanded.<user>` (expanded widgets) and `usertasks.home.new-default-2026-12.<user>` (the note was seen).
