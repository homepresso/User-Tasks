# Release notes: Customise your Home

Home is now a grid of widgets that you can arrange yourself. The default order also changes, so your task list comes straight after the cards.

## The new default order

1. The three cards: **My tasks**, **My submissions** and **Following**.
2. The task list (**My tasks**, **Task queue**, **Following**, **My submissions**), at full width.
3. The **My activity** charts.
4. **Favourite forms**, then **Drafts**.

If you haven't customised Home, you get this order automatically.

## Customise your Home

Select **Edit layout** at the top right of Home. In edit mode:

- **Move** a widget by dragging its handle (the bar with its name). The other widgets make room as you drag.
- **Resize** a widget from its right edge, its bottom edge or the corner button. Widths snap to a 12-column grid. Each widget has a smallest and a largest size.
- **Hide** a widget with its eye button, and bring it back from **Add widget**.
- **Reset to default** goes back to the standard layout.
- Select **Done** to save, or **Cancel** to discard your changes.

Each card and each chart is its own widget. The **7 / 30 / 90 days** picker sits in Home's header and applies to every chart. Outside edit mode nothing can be dragged, so clicking and scrolling work as before. An empty **Drafts** widget takes up no space.

**Keyboard:** Tab to a widget's handle. The arrow keys move it one place earlier or later, and **Home** / **End** move it to the start or the end. **Shift** + arrow keys make it narrower, wider, shorter or taller. You can also focus the corner button and use the plain arrow keys to resize. Screen readers announce each change, for example "Task list moved to position 3 of 12".

## Phones and tablets

Home saves one layout, sized for the 12-column desktop grid:

- **Tablets** use 6 columns. Each widget takes half its desktop width, but never less than it needs to stay readable.
- **Phones** stack the widgets in one column in your order. In edit mode on a phone you can reorder widgets and hide them, but not resize them.

## Saved to your account

Your layout is saved on the server for you and for this workspace, so it follows you to other browsers and devices. Each workspace keeps its own layout. Widgets added in a future release appear in their default place, and widgets that are removed simply disappear from your layout.

## API, MCP and CLI

- REST: `GET`, `PUT` and `DELETE /api/v1/home/layout` (read, save, reset).
- MCP: `home_layout`.
- CLI: `usertasks home layout`, `usertasks home set-layout -f layout.json` and `usertasks home reset-layout`.

A layout lists the visible widgets in order, each as `{ id, w, h }`, plus the ids of the hidden ones. Only known widget ids are accepted. Sizes are clamped to each widget's limits, and the body can be at most 8 KB. These are personal endpoints, so they need a credential bound to a user.

## Upgrading

No migration is needed. The layout is stored under `home_layout` in the existing `users.preferences` column, keyed by workspace.
