# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — run ESLint (flat config, `eslint.config.mjs`)
- `npm run test` — run all tests once
- `npm run test:watch` — run tests in watch mode (re-runs on file changes)
- `npm run test:coverage` — run tests with coverage report
- `npm run bootstrap -- --email … --password … --org …` — create the first tenant + owner (self-hosted)
- `npm run db:types` — regenerate `lib/database.types.ts` from the linked Supabase project

## Testing

Uses **Vitest** (`vitest.config.ts`) with tests in `__tests__/` (58 files). Coverage targets the workflow engine library files. CI (`.github/workflows/ci.yml`) runs tsc, vitest and build; lint is not in CI (large pre-existing error backlog).

| Area | Test files |
|------|-----------|
| Workflow engine | `expression-functions`, `expression-resolver`, `workflow-schema`, `workflow-validation`, `workflow-utils`, `workflow-node-handlers`, `workflow-condition-operators`, `workflow-error-attribution`, `workflow-schedule`, `conditions`, `decision-table-engine`, `doc-handlers`, `csv-excel-handlers` |
| Tasks | `task-completion`, `task-data-object`, `task-field-allowlist`, `task-field-schema`, `lifecycle-events` |
| Data tables / reports | `data-table-cells`, `data-table-workflow-triggers`, `report-config`, `like-filter-utils`, `escape-like-pattern`, `odata` |
| Agents | `agent-chat-routing`, `agent-executor`, `agent-rate-limit`, `agent-references` |
| MCP | `mcp-*` (authz, metadata, golden descriptions, report/workflow/retention/extensibility contracts) |
| Auth / OAuth / API | `api-spec-auth`, `oauth-core`, `oauth-rest-broker`, `secret-fields`, `sanitize-svg` |
| Governance / sync | `directory-sync`, `github-sync-*`, `portability-*`, `email-templates` |
| Deployment / public site | `deployment`, `seo-foundation`, `contact-route` |

## Architecture

Next.js 16 App Router project with React 19, TypeScript, and Tailwind CSS v4.

- `app/` — App Router pages and layouts (no `src/` directory)
- `app/layout.tsx` — root layout (DM Sans, Space Mono, Fraunces via `next/font/google`)
- `app/page.tsx` — landing page in `cloud` mode; redirects to `/tasks` or `/login` in `self_hosted` mode (`DEPLOYMENT_MODE`, see `lib/deployment.ts`)
- `lib/workflow-engine.ts` — workflow runtime; node catalog in `lib/workflow-schema.ts`; queue drained by `lib/workflow-queue-processor.ts`
- Supabase (Postgres + RLS, Auth, Storage, Vault, pg_cron) — migrations in `supabase/migrations/`; self-host guide in `docs/self-hosting.md`
- `@/*` path alias maps to project root (tsconfig paths)
- Tailwind v4 via `@tailwindcss/postcss` plugin (PostCSS-based, no `tailwind.config` file)

## Important: Next.js 16 Breaking Changes

This project uses Next.js 16.2.1, which has breaking changes from earlier versions. **Always read the relevant guide in `node_modules/next/dist/docs/` before writing code** that touches Next.js APIs, routing, or conventions. Do not rely on training data for Next.js patterns.
