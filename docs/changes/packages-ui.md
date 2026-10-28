# Release notes: package import, history and removal

Packages are now easy to find, every change to them is on record, and a
package can be removed together with everything it installed.

## New

- **Packages in the navigation.** **Automations → Packages** (permission
  `packages.view`) next to Workflows, Integrations and Agents; Settings →
  Packages stays.
- **Import by drag and drop.** Drop a `.utpkg` anywhere on the drop zone of
  the Installed tab — or **Import package** to choose one. With nothing
  installed the page is one large drop zone. The import runs the existing
  wizard: Package (verification) → Changes (the plan) → Configure → Done.
- **Install in another workspace.** A package authored here can be
  installed into another workspace you belong to (and hold
  `packages.install` in) straight from **Authored here**, through the same
  wizard against that workspace.
- **History.** A timeline of every install, upgrade, reinstall, downgrade,
  reconfigure (Complete setup) and uninstall, failed attempts included: when,
  who, channel (app / CLI / API / MCP), source, version from → to, signature
  status, items created / updated / removed / kept, rows, runs cancelled,
  requirement changes, options and errors. Filters (package, action, status,
  user, dates), a detail drawer with the full plan / diff that was applied
  (credentials never stored), and CSV export. Per package from its card.
  Earlier installs are reconstructed from the audit log.
- **Remove a package and all its artifacts.** The uninstall dialog lists
  every artifact and what will happen to it (with row counts), and offers
  **Remove everything including data tables and their rows** (typed
  confirmation of the package name) and **Also remove items changed since
  install**, each with its warning. Unfinished runs of the package's
  workflows are listed and block the uninstall unless you cancel them in the
  same step. Missing delete permissions are reported before anything is
  removed. A summary per artifact follows, and the uninstall is in the
  history.
- **REST:** `GET /api/v1/package-events`, `GET /api/v1/package-events/{id}`;
  `POST /api/v1/package-installs/{id}/uninstall` gains `cancel_runs` and its
  dry run returns `active_runs`, `missing_permissions` and `blockers`.
- **MCP:** `packages_history`, `packages_history_get`; `packages_uninstall`
  gains `cancel_runs`.
- **CLI:** `usertasks packages history [package] [--action] [--status]
  [--channel] [--user] [--since] [--until]`, `usertasks package-events get
  <id>`; `packages uninstall --cancel-runs` (and the dry run exits 7 when
  something blocks it).

## Changed

- Uninstall refuses up front when a section's delete permission is missing
  (it used to remove what it could and drop the install record).

## Upgrade notes

- Apply migration `20261113000000_package_events.sql` (new service-role-only
  table `package_events`, backfilled from the audit log; idempotent). Until
  it is applied, installs still work but no history is recorded.
