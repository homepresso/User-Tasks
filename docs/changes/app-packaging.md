# Release notes: Package and share apps

Apps can now travel between workspaces as signed packages (`.utpkg`), the
same packages workflows use — and apps are part of config as code and GitHub
sync.

## New

- **Package / Export an app.** **Package** on an app's card in **Apps I
  design**, or **App settings → General → Package / Export**, lists what the
  package will contain: the app (pages, widgets, filters, options, hidden and
  minimum-role flags, menu, navigation and settings), the uploaded SVG icons
  it uses (as files), and everything it uses — forms, workflows, data tables
  with their views, reports, API references with their integration
  (definitions only, never credentials), agents, linked apps, and what those
  use. Leave items out, include sample rows per table, and **Download
  package** builds the next signed version. The package is kept under
  Settings → Packages, so packaging again publishes the next version.
- **Never exported:** the audience and editors, credentials, the embed
  allow-list and usage data.
- **Install an app.** **Apps → Install app** (Settings → Packages), from a
  file or the gallery. The preview lists what will be created or updated,
  credentials to provide, required permissions (Build apps) and embed sites
  the workspace doesn't allow yet. The app gets a free address, every object
  it uses is remapped to the installed copies, **the installer becomes its
  editor and its audience starts empty** ("Choose who can use it" opens App
  settings → Audience), and the access-issues check runs. Icons are
  sanitised again; people and teams not in the workspace are removed from
  filters and visibility rules; "Allow app viewers" on card views needs
  Manage references.
- **Upgrade in place.** A newer version of the package updates the app's
  pages, menu and settings with a per-item diff, and keeps its address,
  audience, editors and pages added locally ("Keep assets changed in this
  workspace" keeps a locally changed app as it is).
- **Config as code and GitHub sync:** an `apps` section / `apps/` folder,
  one file per app with its pages and icons; app saves queue a sync change.
- **API, CLI, MCP:** `POST /api/v1/apps/{id}/package/preview`,
  `POST /api/v1/apps/{id}/package` (`usertasks apps package-preview`,
  `usertasks apps package`; `apps_package_preview`, `apps_package`); `app`
  is an item type for `/api/v1/packages` and `usertasks packages add`.
  Installs use the existing `/api/v1/package-installs` (`apps` in the plan:
  embed origins to allow, audience prompt).

## For developers

- `lib/apps/references.ts` is the one walker for every reference an app
  makes (`collectAppReferences` / `rewriteAppReferences`); packaging,
  dependencies, plans and installs use it, and a test fails when a widget,
  button or menu schema gains an id field the walker doesn't know.
- No migration.
