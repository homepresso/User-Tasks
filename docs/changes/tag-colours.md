# Release notes: Tag colours

Tags now have colours, and the colour is the same wherever the tag appears.
Feedback was that lists needed more colour: every tag in every list is now a
coloured chip, with no setup.

## New

- **Automatic colours.** A tag nobody has coloured gets a colour from its
  name — the same tag always looks the same, for everyone. Names match
  without regard to case or extra spaces (`Finance` = `finance`).
- **Choose a colour.** Click a tag in the Workflows or Integrations list or
  on a task page and pick one of 15 palette colours (gray, red, orange,
  amber, yellow, lime, green, teal, cyan, blue, indigo, violet, purple,
  pink, rose) or **Auto**. Each colour has light and dark versions tinted
  into the workspace theme's surface, with AA-contrast text.
- **Settings → Tags, the central tag page.** Every tag (registry and in
  use) with colour, description, total and counts per object type (tasks,
  workflows, forms, integrations, references, agents, workflow activities —
  only objects you may see), searchable and sortable. Select a tag to see
  where it's used: the objects grouped by type, linked, paged. With
  `tags.manage`: colour and description, **rename** (every object),
  **merge** into another tag, **remove from all objects** (each one
  transaction, audited), **New tag** ahead of use, bulk colour and delete
  unused, and the settings **Automatic colours** and **Anyone can add new
  tags**.
- **Autocomplete when adding tags** (one shared tag input): matching
  workspace tags with colour and usage, best match first, keyboard
  navigation, Enter / comma to add, the existing spelling instead of a
  near-duplicate, **Create “…”** only when you may add new tags.
- **Tags… in row menus** (Workflows, Forms library, Integrations, Agents):
  edit an item's tags in place, saved at once through its own update and
  permission; **bulk add / remove** for selected workflows, references and
  agents.
- **Tags in more places.** Coloured tags now show in the task lists (Home,
  My tasks including queued tasks, the Task tracker, My team, completed-task
  search, phone cards, subtasks), on the task page, in the Workflows list,
  the Forms library and form details, Integrations and references, Agents,
  workflow activities and global search results.
- **Permission `tags.manage`** ("Manage tags"): Owner, Admin and Manager by
  default (existing workspaces included). OAuth: part of `settings:write`.
- **REST / MCP / CLI:** `GET /api/v1/tags`, `PUT` / `DELETE /tags/style`,
  `POST /tags/rename`, `POST /tags/remove`, `GET /tags/suggest`,
  `GET /tags/objects`, `POST /tags/apply`, `GET` / `PATCH /tags/settings`;
  MCP `tags_list`, `tags_suggest`, `tags_objects`, `tags_set_style`,
  `tags_reset_style`, `tags_rename`, `tags_remove`, `tags_apply`,
  `tags_settings_get`, `tags_settings_update`; `usertasks tags list |
  suggest | objects | set-style | reset-style | rename | remove | apply |
  settings | update-settings`.

## Changed

- The old hex colour picker in the Workflows and Integrations lists is gone.
  Colours chosen there are copied into the new registry, each mapped to the
  nearest palette colour.
- Creating a tag no longer asks for a colour: it gets its automatic one and
  can be recoloured any time.

## Upgrade

Apply migration `20270121150000_tag_styles.sql` (additive): the
`tag_styles` table with RLS (members read; `tags.manage` writes), the copy
of existing `tag_definitions` colours, `tag_usage` / `tag_objects`
(SECURITY INVOKER: RLS applies), `rename_tag` / `remove_tag` (service role
only) and the `tags.manage` permission. Until it is applied
every tag shows its automatic colour and saving a colour says the migration
is needed.

Not in config-as-code or packages: tag colours are workspace settings.
Data tables, reports, apps and packages have no tags today, so they aren't
in the tag lists.
