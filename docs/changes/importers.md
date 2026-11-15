# Importers from extensions

Extensions can now add **importers**: workflows and forms from another
product's files (for example SharePoint Designer 2010 workflows from the
SharePoint extension), next to the core InfoPath importer.

## What changes for people

- **Automations → Import from…** lists the workflow importers of the
  extensions enabled and licensed in the workspace; **Forms → Import** lists
  form importers under the InfoPath and UserTasks entries. Nothing changes in
  a build without extension importers.
- The dialog analyses the files first (nothing is stored): mapping coverage,
  steps to review, placeholders, a 0–100 complexity score, readiness (ready /
  import then review / rebuild) and the full report (Markdown / JSON). An
  import creates **draft** workflows (inactive) and forms; steps the importer
  could not map become labelled placeholder steps that keep the original.
- Preview importers (mapping not verified on real exports yet) say so.

## API, MCP, CLI

| | REST (`/api/v1`) | MCP | CLI |
|---|---|---|---|
| List | `GET /importers` | `importers_list` | `importers list` |
| Analyse (dry run) | `POST /importers/{importer}/analyze` | `importers_analyze` | `importers analyze` |
| Import | `POST /importers/{importer}/import` | `importers_import` | `importers import` |

`importer` is `ext.<extension>.<key>` (or `auto`). Files go as
`files: [{ name, content_base64 }]`. Extension importers need the extension
enabled and licensed (402 otherwise — importers lock when a licence lapses,
imported workflows keep running); an import needs `workflows.create` /
`forms.edit` (or the importer's permission); audited. `IMPORT_MAX_MB`
(default 20) bounds the files of one import.

## For extension authors

Manifest `contributes.importers[]`, server `importers.<key>: { detect?,
analyze, import }`, `ctx.workflows.create` with `nodes` / `edges`,
`ctx.importers.infopath` and the `infopath.enrich` hook: see
[contribution points](/docs/developers/extensions/contribution-points#importers).
The core InfoPath importer is unchanged for uploads.
