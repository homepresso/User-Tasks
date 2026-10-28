# Release notes: workspace theme designer, API, MCP, CLI and config as code

Each workspace now has one brand theme that every member sees. Before this
release, themes were per browser. The theme covers colours for light and
dark, fonts and weights, corner radii and shadows, density, sidebar and
top bar styles, logos, the favicon and a wordmark. The 43 built-in themes
are now starting templates.

## New

- **Theme designer** at **Settings → Theme** (`/settings/theme`). It edits a
  draft and shows a live preview of the app (sidebar, top bar, task list
  with highlighted rows, buttons, inputs, status pills, task detail with
  outcome buttons and a chart) in light and dark. It also has undo and
  redo, reset to template, and JSON import and export. Colour fields show
  WCAG contrast badges. **Save for workspace** asks for confirmation first,
  because the theme changes for every member right away. If someone else
  saved in the meantime, you can load their version or overwrite it.
  Members without `settings.edit` see the designer read-only.
  `/settings/brand-theme` redirects to `/settings/theme`.
- **Fonts:** pick from the curated Google Fonts list or the system stacks,
  or upload a `.woff2` file (at most 1 MB). Uploads go to the new
  `brand-fonts` storage bucket, in the workspace's folder, and are served
  with `@font-face`.
- **Logos:** separate logos for light and dark sidebars, plus a favicon.
  They are stored in the workspace's `logos` folder.
- **REST:** `GET` / `PUT /api/v1/workspace-theme` (`PUT` takes the whole
  theme plus an optional `expected_version`; a mismatch returns 409),
  `POST /workspace-theme/apply-preset`, `GET /workspace-theme/presets` and
  `POST /workspace-theme/fonts` (multipart `file`, or JSON with
  `content_base64`).
- **MCP:** `workspace_theme_get`, `workspace_theme_presets_list`,
  `workspace_theme_update`, `workspace_theme_apply_preset` and
  `workspace_theme_font_upload`.
- **CLI:** `usertasks workspace-theme get | update | presets |
  apply-preset <preset_id> | upload-font`. A file saved with
  `get -o json > theme.json` can be sent back with `update -f theme.json`.
- **Config as code:** the singleton section `workspace_theme` is stored as
  `workspace-theme.json` at the root of the config folder.

## Permissions

Reading the theme and listing templates is open to every member. REST
needs no permission. MCP needs `tasks.view_own`, which every role has.
Changing the theme or uploading a font needs `settings.edit`.

## Behaviour changes

- `usertasks config export` and `GET /config/export` now include
  `workspace-theme.json` when no `types` / `ids` filter is given. Plans
  therefore show one more asset, `workspace_theme`. Applying a config folder
  that contains the file replaces the theme of the target workspace, which
  needs `settings.edit`. A dry run lists that requirement under
  `missing_permissions`.
- When a theme is applied in another workspace or environment:
  - Uploaded fonts are matched by file name in the target workspace's
    `brand-fonts` folder. If the file is missing, that font falls back to the
    default and the apply returns a warning. Upload the file there and apply
    again.
  - Logo and favicon URLs that are not the target workspace's own uploads
    are dropped, with a warning.
- GitHub sync push and deploy do not carry the theme yet. Only
  `config export` / `config apply` do.
- Generated CLI commands can now take body fields as positional arguments
  (`workspace-theme apply-preset <preset_id>`).

## Database

`20261102000000_brand_fonts_bucket.sql` adds the public `brand-fonts`
bucket. It accepts `font/woff2` only, up to 1 MB. Writes need membership
plus `settings.edit` for the path's tenant folder, the same rule as `logos`.
