# Release notes: packages and export coverage

A designer can now package the artifacts that make up a process and deploy
them to other environments as one signed file, and every artifact type can
be exported and imported on its own.

## New

- **Packages.** Pick a root artifact (usually a workflow); everything it uses
  is included automatically — sub-workflows, custom steps, decision tables,
  data tables, integrations with their references and objects, connectors,
  email templates, agents, custom roles, retention policies, MCP servers —
  each with the reason it is there. Add or leave out items and choose schema
  only or schema + rows per data table. **Build version** exports the current
  state with secrets removed, signs it (ed25519) and stores it as a
  published version; the `.utpkg` file (ZIP: `manifest.json`, the
  config-as-code layout under `assets/`, rows as NDJSON, `README.md`) can be
  downloaded again at any time.
- **Requirements.** Every credential, secret, `${env:}` reference,
  environment-specific URL / host, assignee and built-in role a package
  depends on becomes a requirement. Installs ask for the values — or install
  **incomplete**: connections that need configuration are created disabled
  and the workflows that depend on them cannot be activated or published
  until **Complete setup** (the designer shows why).
- **Package library** (Settings → Packages): installed packages with
  version, source, signer and Complete / Incomplete status with a checklist,
  and Complete setup, Upgrade and Uninstall. The install wizard verifies the
  file, shows the dry-run plan, asks for requirement values and installs.
- **Upgrade in place.** Installing a newer version updates what the earlier
  install created (field diffs first), keeps local credentials and
  requirement values, flags assets changed locally (optionally keeps them)
  and assets removed from the package (never deleted), merges rows.
- **Uninstall** lists what will be removed first; locally changed assets and
  data tables with rows are kept unless forced.
- **REST:** `/api/v1/packages` (list, create, get, update, delete,
  `/contents`, `/preview`, `/inspect`), `/api/v1/packages/{id}/versions`
  (build, list, get, `/download`) and `/api/v1/package-installs` (list, get,
  `/plan`, install, `/{id}/upgrade`, `/{id}/complete`, `/{id}/uninstall`).
- **MCP:** `packages_list`, `packages_get`, `packages_preview`,
  `packages_create`, `packages_update`, `packages_delete`,
  `packages_contents`, `packages_versions_list`, `packages_build`,
  `packages_version_get`, `packages_download`, `packages_inspect`,
  `packages_installs_list`, `packages_installs_get`, `packages_install_plan`,
  `packages_install`, `packages_upgrade`, `packages_complete_setup`,
  `packages_uninstall`.
- **CLI:** `usertasks packages list|create|add|remove|contents|build|download|inspect|install|upgrade|complete|uninstall|installs`.
  `install` prompts for missing values on a terminal (secrets without
  echo); in scripts use `--set <requirement>.<field>=value`, `-f values.yaml`
  and `${env:VAR}`, or `--keep-incomplete`. `inspect` verifies a file offline.
- **Permissions:** `packages.view`, `packages.manage`, `packages.install`
  (Owner, Admin and Manager by default). OAuth scopes `packages:read` /
  `packages:write`; `config:read` includes `packages.view` and `config:write`
  all three.
- **Export coverage.** Every artifact type exports and imports on its own:
  the generic **Export** / **Import** buttons on list and detail pages, `GET
  /config/export?ids=…&with_dependencies=true&include_rows=true`, MCP
  `config_export` / `config_apply` and `usertasks config export --ids …
  --with-dependencies --include-rows`. Data-table rows travel as the
  `table_rows` section (`data-rows/` folder) and apply with `rows_mode`
  merge / replace / skip. See `docs/export-coverage.md`.

## Fixed

- `notification_template_id` (user-task notification email templates) and
  retention-trigger `policy_ids` are remapped on import.
- Decision-table export files from the editor and from REST/MCP import into
  each other.

## Upgrade

Apply `20261103400000_packages.sql` (tables, permissions for the system
roles, CLI OAuth scopes) before deploying. Set `ENCRYPTION_KEY` (or
`PACKAGE_SIGNING_KEY`) so packages are signed. API keys created before this
release do not have the `packages.*` permissions; add them to keys that
should build or install packages.
