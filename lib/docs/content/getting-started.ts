import type { DocPageDef } from '../types'

export const GETTING_STARTED_PAGES: DocPageDef[] = [
  {
    slug: 'quickstart/cloud',
    title: 'Quickstart: cloud',
    description: 'Sign in to the hosted edition, build and run a first workflow, and drive it from the CLI.',
    body: `
The cloud edition at usertasks.com runs the same open-source code as a self-hosted install, operated for you. This page takes you from sign-in to a running workflow in about ten minutes.

## 1. Sign in

Open [/login](/login) and sign in with your workspace slug, email and password, or with the invitation link you were sent. New to UserTasks and want a hosted workspace? [Contact us](/contact).

The first time a workspace owner signs in, \`/onboarding\` asks for the organisation profile (name, URL identifier, industry and size).

## 2. Build a workflow

1. Go to **Automations → New workflow**.
2. Pick a trigger. **Webhook** is the easiest to test: it gives you a URL you can POST to.
3. Drag nodes from the palette onto the canvas and connect them. Click a node to open its settings panel.
4. Click **Test run** to execute the draft with sample variables and inspect every step.
5. Click **Publish**. Runs always use the published version; you can keep editing the draft.

::image designer | The workflow designer with the settings panel open on a User Task node | An invoice approval workflow: an integration call, a decision table, a user task with typed fields and an email.

## 3. Run it and watch it

Start the workflow from the designer, by calling its webhook, or from the API. Open **Automations → Runs** to follow each run step by step; a run that reaches a User Task waits until someone completes the task in **Tasks**.

## 4. Do the same from a terminal

\`\`\`bash
npm install -g @usertasks/cli          # Node.js 20+
usertasks login --url https://usertasks.com   # opens your browser
usertasks workflows list
usertasks workflows start --set workflow_id=<id> --set variables:='{"amount": 1200}'
usertasks logs tail --category workflow
\`\`\`

## Next steps

- [Concepts](/docs/concepts): workflows, runs, tasks and the asset types around them.
- [Workflows](/docs/workflows): the designer, triggers and the [node reference](/docs/workflows/nodes).
- [CLI](/docs/cli) and [API](/docs/api): automate everything you just did by hand.
- [Ship logs](/docs/observability) to Splunk, Datadog, OpenTelemetry or a webhook.
`,
  },
  {
    slug: 'quickstart/self-host',
    title: 'Quickstart: self-host',
    description: 'Run UserTasks on your own machine or servers with Supabase, create the first workspace and sign in.',
    body: `
UserTasks is a Next.js application backed by Supabase (Postgres, Auth, Storage, Vault, pg_cron and pg_net). You run the app; Supabase can be hosted on supabase.com or self-hosted. This page gets a local install running. For production, read [Self-hosting](/docs/self-hosting).

> [!TIP]
> Every install starts on Supabase with no provider settings. Supabase is an excellent platform and our recommended way to run UserTasks. If you'd like files, email, secrets, sign-in or the database in AWS, Azure, Google Cloud or your own network, you can move one area at a time with \`usertasks-admin switch\` whenever you're ready. See [Choose your topology](/docs/topologies).

## Requirements

- Node.js 20 or later
- Docker (for a local Supabase stack) or a Supabase project
- The Supabase CLI (\`npx supabase\` works)

## 1. Database

\`\`\`bash
git clone <repository-url> usertasks && cd usertasks
npm install
npx supabase init                            # first time only
npx supabase start && npx supabase db reset  # applies supabase/migrations
\`\`\`

\`supabase start\` prints the API URL, anon key and service-role key you need next.

## 2. Configuration

\`\`\`bash
cp .env.example .env.local
\`\`\`

Fill in at least \`NEXT_PUBLIC_SUPABASE_URL\`, \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`, \`SUPABASE_SERVICE_ROLE_KEY\`, \`NEXT_PUBLIC_APP_URL\`, \`CRON_SECRET\` and \`ENCRYPTION_KEY\`. Every variable is described in [Environment variables](/docs/self-hosting/environment).

## 3. First workspace and owner

Self-signup is off in self-hosted mode. Create the first workspace from the command line:

\`\`\`bash
set -a; . ./.env.local; set +a
npm run bootstrap -- --email admin@example.com --password 'a-strong-password' --org "Acme Inc"
\`\`\`

The script prints the workspace slug.

## 4. Run

\`\`\`bash
npm run dev            # or: npm run build && npm start
\`\`\`

Open http://localhost:3000, sign in with the slug, email and password, and finish setup at \`/onboarding\`. Invite more people from **Settings → Invitations**.

## 5. Turn on background work

Schedules, the run queue, SLAs, reminders, log shipping and sync jobs run when pg_cron calls the app. Add two Vault secrets (the URL must be reachable from the database; for a local stack use \`http://host.docker.internal:3000\`):

\`\`\`sql
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret', 'Bearer secret for usertasks cron endpoints');
select vault.create_secret('http://host.docker.internal:3000', 'app_base_url', 'Public base URL of the UserTasks app');
\`\`\`

> [!NOTE]
> Without these secrets, synchronous runs, tasks and the API still work, but scheduled triggers, delays, queued runs and log export wait until something calls the processor.

## Docker

\`\`\`bash
cp .env.example .env   # fill it in
docker compose up --build
\`\`\`

The image runs the app only; the database stays in Supabase. See [Self-hosting](/docs/self-hosting#docker) for build arguments and optional database drivers.
`,
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    description: 'The building blocks of UserTasks — workflows, runs, tasks, integrations, rules, data — and how they fit together.',
    body: `
UserTasks is a **headless workflow engine**: it runs your processes and exposes everything through a REST API, an MCP server and a CLI, so your own applications and AI clients can drive it. It also ships a complete web app (designer, task list, settings) for the people who build and operate those processes.

## Workspaces

Everything belongs to a **workspace** (a tenant). Data is isolated per workspace by Postgres row-level security and server-side checks. People are members of one or more workspaces with **roles** that grant permissions.

## Workflows and runs

A **workflow** is a graph of nodes: one **trigger**, then logic, operations and actions joined by edges. You edit a **draft** and **publish** it; each publish creates an immutable **version**. A **run** is one execution of the published version. Runs carry **variables**, write a step-by-step log, and can **wait**: for a person (User Task), for a time (delay, pause until), or for an external event. Waiting runs are resumed from a durable **queue**.

## Tasks

A **task** is work for a person. User Task nodes create tasks with typed **fields** and **outcomes**; completing the task (in the app, through the API, MCP or CLI) resumes the run on the outcome's path. Tasks have assignees or teams, due dates, SLAs, reminders and escalation.

## Reusable assets

| Asset | What it is | Used from |
|---|---|---|
| [Integration](/docs/integrations) | A connection to an external system (base URL + authentication) | References |
| [Reference](/docs/integrations/references) | One saved operation on an integration (REST, OData or a database query) | Call API / Reference nodes, agents, reports, MCP |
| [Connector](/docs/integrations/connectors) | A pre-built integration for a known service | Integrations |
| [Decision table](/docs/decision-tables) | Ordered business rules: inputs in, outputs out | Decision Table node, API, MCP |
| [Data table](/docs/data-tables) | A typed table inside UserTasks | Data node, triggers, reports, OData |
| [Email template](/docs/email-templates) | Subject and HTML with variables | Send Email node, task notifications |
| [Custom workflow step](/docs/custom-steps) | Your own code as a typed node | Custom Activity node |
| [AI agent](/docs/agents) | A model with instructions, tools and an output schema | Run Agent node, API, MCP |
| [Report](/docs/reports) | A saved query and chart over tasks, runs or data | App, API, MCP |

## Surfaces

Every operation is available four ways, and they enforce the same permissions:

- the **web app** for designers, approvers and admins;
- the **REST API** at \`/api/v1\` ([API](/docs/api)), described by an OpenAPI 3.1 document;
- the **MCP server** at \`/api/mcp\` ([MCP](/docs/mcp)) for AI assistants;
- the **CLI** \`usertasks\` ([CLI](/docs/cli)) and the TypeScript [SDK](/docs/sdk).

Configuration moves between workspaces as files: [config as code](/docs/config-as-code) and GitHub sync. Everything that happens is recorded in an [event stream](/docs/observability) you can tail or ship to your log platform.

## Common use cases

Worked examples with an architecture sketch, the features involved and a snippet ([all use cases](https://usertasks.com/use-cases)):

- [Headless task management](https://usertasks.com/use-cases/headless-task-management) — human tasks and approvals inside your own app, through the [Tasks API](/docs/tasks/api).
- [Approvals and compliance](https://usertasks.com/use-cases/approvals-and-compliance) — approval matrices in [decision tables](/docs/decision-tables), SLAs, escalation and audit.
- [AI agent orchestration](https://usertasks.com/use-cases/ai-agent-orchestration) — [agents](/docs/agents) as workflow steps with a person reviewing the result.
- [Middleware and integration hub](https://usertasks.com/use-cases/middleware-integration-hub) — [webhooks](/docs/integrations/webhooks) in, transforms, calls out, retries and log export.
- [Replacing SharePoint 2010 and 2013 workflows](https://usertasks.com/use-cases/sharepoint-workflow-replacement), and migration guides for [Nintex](https://usertasks.com/use-cases/nintex-migration) and [K2](https://usertasks.com/use-cases/k2-migration).
`,
  },
]
