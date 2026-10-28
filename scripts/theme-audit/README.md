# Theme contrast audit

Two checks that every built-in theme stays legible in light and dark mode.

| File | What it does |
|---|---|
| `tokens.ts` | Token audit: every preset × light / dark against the pair list in `lib/theme/contrast.ts` (card / muted / input text, text on washes, primary & accent text, on-primary, status badges, success / warning / danger, sidebar text / accent / active / hover, top bar, focus ring, chart series). Writes `tokens.md` + `tokens.json`; exits 1 on any failure. The same check runs in CI as `__tests__/theme-contrast-audit.test.ts`. |
| `run.ts` | DOM audit on a local stack: applies each preset to the Northwind demo workspace through the REST API, opens the main pages in both colour schemes (tasks, task detail, queue, workflows, designer with the config panel and with a connection selected, Run dialog, live instances, run viewer, integrations, decision table, reports, a report, a data table, settings + appearance, theme designer, log export, API keys, activity, global search, notifications), and runs axe-core `color-contrast` plus a pixel check, then restores the workspace theme. |
| `page-checks.js` | The in-page part of `run.ts` (collects visible text runs; samples the background under each from a screenshot taken with all text transparent, so gradients, images, washes and overlays are measured as painted). |

Targets: 4.5:1 for body text, 3:1 for large text, sidebar highlights and graphics (WCAG 2.2 AA). The renderer's legibility pass (`lib/theme/legibility.ts`) raises any colour of a stored or custom theme that falls short, so a failure in the DOM audit points at a component colour, not a palette.

## Token audit

```sh
npx tsx scripts/theme-audit/tokens.ts /tmp/theme-audit
```

## DOM audit

Prerequisites are the same as `scripts/screenshots` (see its README): local Supabase stack, the
Northwind demo seeded with `scripts/screenshots/seed-demo.ts` (its `.out/api-key.txt` and
`.out/demo-state.json` are used), the app as a production build on a local port, and a tools dir with
`playwright-core` **and** `axe-core` in `SCREENSHOT_TOOLS_DIR`. System Google Chrome is used.

```sh
(cd "$SCREENSHOT_TOOLS_DIR" && npm i playwright-core axe-core)
npx tsx scripts/theme-audit/run.ts /tmp/theme-audit-dom                       # all 43 presets, ~45 min
npx tsx scripts/theme-audit/run.ts /tmp/theme-audit-dom --presets=basecamp,nebula --pages=tasks,designer
```

Output: `results.ndjson` (per preset / mode / page: every text run's measured ratio, plus axe
violations), `summary.md` (counts per page / mode and failures grouped by element signature — the
class / inline-style pattern that produced the colour, which is usually the root cause) and JPEG
shots of the tasks list and designer per preset / mode. It refuses to run against a non-local stack.
Applying presets adds theme-change entries to the demo workspace's activity log.
