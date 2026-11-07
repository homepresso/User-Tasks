# UI audit screenshots: index

These screenshots are the evidence for [`ui-polish-spec.md`](./ui-polish-spec.md).

**Capture setup:**

- Taken 2026-11-04 from `main` (release-dec5).
- Local dev server against the local Supabase stack, Northwind workspace, signed in as Ada (owner),
  workspace theme Gallery.
- Images are not committed (about 80 PNGs). They live in the session scratchpad at
  `ui-audit-shots/`, captured by `uiaudit-tools/shots.mjs` and `uiaudit-tools/dark-preview.mjs`.
  Re-run those scripts to regenerate them.

**Naming:**

- Format: `NN-surface--<mode>[-<width>].png`.
- Mode is `light` or `dark`. Width is omitted for 1440px; `-390` means mobile.
- Shots are full-page where the page scrolls the document. Many dashboard pages scroll an inner
  container, so those shots show the first viewport only.

**Notes on the capture:**

- `--dark` shots render **light**. The Gallery preset has no real dark palette (spec §1, item 10).
  `21b`/`21c` show the theme designer previewing Noir (true dark) and Gallery's "dark" (identical to
  light). Neither was saved.
- Some shots don't exist:
  - Notification panel, form designer "Rules" and "WCAG" tabs: the selector timed out.
  - Signup: `/signup` redirects to `/login` in this deployment mode.
- The round "N" at bottom-left of every shot is the Next.js dev-tools badge, not product UI.

## Index

| File(s) | Surface | Modes / widths | Spec refs |
|---|---|---|---|
| `01-home` | Home: metric cards, compact charts, task tabs and table | light, dark, 390 | §1.1, §1.4, §1.10, §5.1 |
| `02-home-tab2` | Home, second task tab (Task queue) | light | §5.1 |
| `03-tasks-list` | My tasks list (accent header, violet Due Date column) | light, dark, 390 | §1.4, §1.6, §5.2 |
| `04-task-detail` | Task detail (serif 4-line title, effort tiles, floating timer) | light, dark, 390 | §1.1, §5.3 |
| `05-automations-list` | Workflows list (cards, MCP banner, tag row) | light, dark, 390 | §1.7, §1.8, §5.4 |
| `06-workflow-designer`, `06b-designer-node` | Workflow designer (two toolbar rows, four columns, Tailwind-coloured nodes) | light | §1.7, §5.5 |
| `07-workflow-runs`, `07b-run-detail` | Runs list, run detail (nested compare tiles, Title Case) | light | §5.6 |
| `08-forms-library` | Forms library (44-tag cloud, 9 actions per row) | light, dark, 390 | §1.7, §5.7 |
| `09-form-designer`, `09-form-designer-tab{1,2,3,5,6}-*` | Form designer dialog and inspector tabs (wrapping tab labels) | light | §1.3, §5.8 |
| `10-form-runtime` | `/f/<id>` runtime form (double frame) | light | §5.9 |
| `11-data-list`, `12-data-table`, `13-data-schema` | Data tables list, rows grid (170px rows), schema | light (+dark, 390 for 11/12) | §1.6, §5.10 |
| `14-reports`, `15-report-detail`, `15b-reports-workflows` | Reports hub (orphan KPI row), a report (full-width blue bar) | light (+dark, 390 for 14) | §1.4, §1.8, §5.11 |
| `16-integrations`, `17-integration-detail`, `45-integrations-new` | Integrations list, detail, "new" flow | light (+dark, 390 for 16) | §1.8, §5.12 |
| `18-agents`, `19-agent-detail` | AI agents list (emerald pills), detail | light (+dark, 390 for 18) | §1.4, §5.13 |
| `20-settings` | Settings → Profile (narrow card) | light, dark, 390 | §5.14 |
| `21-settings-theme`, `21b-theme-noir-preview`, `21c-theme-gallery-dark-preview` | Theme designer; Noir dark vs Gallery "dark" | light, dark, 390 | §1.10, §5.14 |
| `22-settings-governance` | Governance roles (nested cards) | light | §1.2, §5.14 |
| `23-settings-ocr`, `24-settings-infra`, `31-settings-apikeys` | Document OCR, Infrastructure, API keys | light | §5.14 |
| `25-gallery-inapp` | In-app Packages (gallery installs) | light | §5.15 |
| `26-activity`, `27-team`, `28-rules`, `29-queue`, `30-extensibility` | Secondary dashboard pages | light | §5.17 |
| `32-not-found` | 404 (Next default, unstyled) | light | §1.9, §4.5 |
| `40-command-search` | ⌘K search ("Searching…" text only) | light | §4.3 |
| `41-header-forms-menu` | Header Forms dropdown (in the sidebar) | light | §4.1, §4.2 |
| `42-avatar-menu` | Avatar menu | light | §4.2 |
| `44-new-automation-dialog` | "New Automation" dialog | light | §3.12, §5.4 |
| `46-empty-search-tasks` | Tasks with `?q=` (ignored: no empty state) | light | §5.2 |
| `47-tasks-new` | New task page | light | §5.2 |
| `50-landing` | Marketing landing (full page) | light | §5.16 |
| `51-docs`, `56-docs-page` | Docs index and a docs page | light | §5.16 |
| `52-public-gallery`, `53-public-gallery-controls` | Public `/gallery` and controls | light | §5.15 |
| `54-login`, `55-signup` | Login (signup redirects to login) | light | §5.16 |
