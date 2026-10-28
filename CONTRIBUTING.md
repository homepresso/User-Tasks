# Contributing to UserTasks

Thanks for helping. This guide covers local setup, the checks a change must
pass, database changes, and how to add a workflow node.

## Setup

Follow the quick start in [README.md](README.md): install dependencies, point
`.env.local` at a Supabase project (local `supabase start` is easiest), and
run `npm run dev`.

This project uses **Next.js 16**, which changed several APIs and conventions.
Read the relevant guide in `node_modules/next/dist/docs/` before touching
routing, caching, metadata or config, rather than relying on older Next.js
knowledge. Request interception lives in `proxy.ts` (the Next 16 name for
middleware).

## Branches and pull requests

- Branch from `main` (`feature/...`, `fix/...`) and open a pull request
  against `main`.
- Keep pull requests focused: one feature or fix, with tests where the
  change touches engine, validation, permissions or API behaviour.
- Describe what changed and how you verified it. Include a migration note if
  the schema changed.
- By contributing you agree that your contributions are licensed under the
  Apache License 2.0.

## Checks

CI (`.github/workflows/ci.yml`) runs these on every pull request; run them
locally first:

```bash
npx next typegen        # once per fresh clone: generates next-env.d.ts and route types
npx tsc --noEmit -p .   # must report 0 errors
npm test                # Vitest, tests in __tests__/
npm run build           # must succeed with only the Supabase URL/anon key set
```

`npm run lint` is **not** part of CI yet: the codebase has a large backlog of
pre-existing ESLint errors. Please don't add new ones in the files you touch,
and cleanup pull requests are welcome.

## Database changes

Schema lives in `supabase/migrations/`. To change it:

```bash
npx supabase migration new <short_description>   # creates a timestamped file
# write the SQL, then apply it locally
npx supabase db reset
npm run db:types                                  # regenerate lib/database.types.ts (linked project)
```

Guidelines:

- Every tenant-scoped table needs `tenant_id` and row-level security. Follow
  the `tenant_isolation` policy pattern used by recent migrations (for
  example `20260803_task_dependencies.sql`).
- Make migrations re-runnable where practical (`if not exists`,
  `create or replace`).
- Never put secrets in a migration. Values like the cron secret live in
  Supabase Vault.

## Adding a workflow node

A node type touches these places:

1. **Schema**: add the type to the `NodeType` union and a `NODE_CATALOG`
   entry (label, icon, category, colour, description) in
   `lib/workflow-schema.ts`, plus defaults in `createDefaultNode` if needed.
2. **Engine**: handle it in the node `switch` in `lib/workflow-engine.ts`.
   Put pure, testable logic in `lib/workflow-node-handlers.ts`.
3. **Config panel**: add its settings UI in
   `components/automations/node-config-panel.tsx`.
4. **Validation**: add required-field checks in `lib/workflow-validation.ts`.
5. **Summary**: add a one-line config summary in `lib/workflow-utils.ts`
   (shown on the canvas and in the process viewer).
6. **API and MCP**: if the node is authorable through the API, document its
   config in the workflow authoring guidance in `lib/mcp/tools/workflows.ts`
   and normalisation in `lib/portability/normalize.ts`.
7. **Tests**: cover the handler and validation in
   `__tests__/workflow-node-handlers.test.ts` and
   `__tests__/workflow-validation.test.ts`; `workflow-schema.test.ts` checks
   catalog integrity.

## Gallery packages

The [package gallery](https://usertasks.com/gallery) is where the UserTasks
community shares solutions. There are two ways to add one.

**Share it on usertasks.com (Community).** Build the package in
**Automations → Packages** (or `usertasks packages build`), then sign in at
[usertasks.com/gallery/share](https://usertasks.com/gallery/share) and upload
the `.utpkg` with a title, description, category, tags, screenshots, a licence
(Apache-2.0 by default) and the author name and link to show. The package is
validated straight away; a moderator reviews it, and you get an email with the
decision. Approved packages are listed as **Community**.

**Contribute an official package with a pull request.** Official packages are
folders in `gallery/packages/<slug>/`: a `gallery.json` (metadata, how it
starts, setup steps, flow steps, `sample_input` and what a run with it
reaches), a `README.md` and the config-as-code assets. The rules (placeholder
hosts, `__SECRET__` credentials, routed or install-time assignees, a response
model on every reference, valid forms and lookups) are in
[gallery/README.md](gallery/README.md). Before opening the pull request:

```bash
npm run gallery:build -- --validate my-package
npm run gallery:build -- --out /tmp/g my-package
npm run gallery:verify -- --dir /tmp/g my-package     # local Supabase stack only
npm run gallery:build                                  # commit public/gallery and lib/gallery/catalog.json
```

CI checks that the committed build matches the sources (`npm run
gallery:check`) and runs the validator on every package. Maintainers sign
releases with the UserTasks Gallery key. The public repository link appears on
the website once the repository is launched (`NEXT_PUBLIC_REPOSITORY_URL`).

## Code of conduct

Everyone taking part in this project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

Please don't open public issues for vulnerabilities. See
[SECURITY.md](SECURITY.md).
