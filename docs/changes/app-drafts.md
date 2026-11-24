# Release notes: drafts and publishing for apps

Apps now work like forms: what you change in the app builder is a draft, and
the people who use the app keep seeing the published version until you
publish it.

## New

- **Drafts.** Every change in the builder — pages, widgets, filters, rules,
  menu, navigation, style, the app's name and icon — goes to the app's
  draft, shared by all its editors. The app's audience sees only the
  published version: pages, widgets, rules (and the actions they run on the
  server), the Apps menu card and the full-screen / embedded page.
- **Publish.** **Publish** in the builder shows what changes against the
  published version (pages added and removed, widgets and rules changed,
  menu, navigation and style), anything that blocks publishing and any
  access issues, takes an optional note and publishes the draft as the next
  version.
- **Preview.** See the draft exactly as the audience will — as yourself, as a
  contributor or as a viewer of the app.
- **Version history, Compare, Restore, Discard.** Every published version
  with who published it, when and the note; compare any two versions (or the
  draft); restore a version into the draft; discard the draft.
- **Status everywhere.** **Unpublished** and **Changes not published** on the
  app cards, in the Apps menu and in the builder header.
- **The Agent saves to the draft.** An app the Agent builds or changes is
  saved as a draft (the plan card says so), with **Publish now** / **Keep it
  as a draft** buttons and a preview link afterwards. Ask it to make the
  change live and it can publish in the same confirmed step.
- **Packages and config as code** carry the published version; **Export the
  draft instead** packages the draft. Installs publish the app as version 1;
  upgrades publish the next version, or go to the draft when the app has
  unpublished changes in the workspace.
- **API, CLI and MCP.** `POST /api/v1/apps/{id}/publish`,
  `DELETE /api/v1/apps/{id}/draft`, `GET /api/v1/apps/{id}/versions`,
  `GET /api/v1/apps/{id}/versions/{version}`, `GET /api/v1/apps/{id}/compare`,
  `POST /api/v1/apps/{id}/versions/{version}/restore`; `?version=draft|published`
  on the app and page reads; `publish` / `publish_note` on
  `POST /api/v1/apps/spec/apply`. CLI `usertasks apps publish`,
  `draft-discard`, `versions`, `version`, `compare`, `version-restore`; MCP
  `apps_publish`, `apps_draft_discard`, `apps_versions`, `apps_version_get`,
  `apps_compare`, `apps_version_restore`.

## Changed

- **An app nobody published is visible to its editors only.** A new app
  (from the builder, the Agent or the API) is unpublished until someone
  publishes it, even when its audience is already set.
- Every existing app was published as **version 1** by the migration, so
  nothing changes for the people using it today.
- `GET /api/v1/apps/{id}` and the page reads return the **draft** to the
  app's editors (what the write endpoints change) and the published version
  to everyone else.
- The `apps` and `app_pages` rows (the draft) are readable through the
  database API by the app's editors only; the audience reads the published
  snapshot (`app_versions`).

## Not versioned

The app's address (slug), its audience and its editors take effect at once,
like form permissions.

## Upgrade

Deploy the code, then apply migration `20270123090000_app_drafts.sql`. Until
it is applied there are no drafts: every save is live, as before, and the
draft endpoints answer 409.
