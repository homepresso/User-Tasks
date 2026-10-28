import type { ScreenshotName } from '@/lib/docs/screenshot-names'

/**
 * Use-case pages for the cloud marketing site (/use-cases and
 * /use-cases/<slug>). Pure data so the pages, the landing section, the sitemap
 * and tests share one list. Statements about other vendors stay factual and
 * neutral: plain product names, no logos, no disparagement.
 */

export type UseCaseIcon = 'inbox' | 'shield' | 'bot' | 'plug' | 'list' | 'route' | 'layers'

/** One box in the architecture diagram. Keep labels short (~26 chars). */
export type DiagramItem = { label: string; note?: string }

export type UseCaseDiagram = {
  /** Accessible name and description of the SVG. */
  title: string
  desc: string
  left: { label: string; items: DiagramItem[] }
  center: { label: string; items: string[] }
  right: { label: string; items: DiagramItem[] }
}

export type UseCase = {
  slug: string
  icon: UseCaseIcon
  eyebrow: string
  /** Page heading. */
  title: string
  /** <title> / Open Graph title (without the brand suffix). */
  metaTitle: string
  description: string
  /** One or two sentences for cards. */
  summary: string
  keywords: string[]
  problem: { title: string; body: string; points: string[] }
  solution: { title: string; body: string; points: string[] }
  diagram: UseCaseDiagram
  /** Concept mapping for migration pages: what you have → what you use. */
  mapping?: { title: string; body: string; from: string; rows: Array<{ from: string; to: string; href?: string }> }
  /** Dated facts with their sources (SharePoint retirement timeline). */
  timeline?: { title: string; body: string; events: Array<{ date: string; text: string }>; sources: Array<{ label: string; href: string }> }
  features: Array<{ title: string; body: string; href: string }>
  snippet: { title: string; body: string; language: 'shell' | 'ts' | 'json'; code: string }
  screenshot: { name: ScreenshotName; alt: string; caption: string }
  steps?: Array<{ title: string; body: string }>
  faqs: Array<{ question: string; answer: string }>
  /** Small print under the hero (trademark notice on migration pages). */
  disclaimer?: string
  related: string[]
}

const TRADEMARKS = 'UserTasks is an independent product and is not affiliated with or endorsed by the vendors named on this page. Product names are trademarks of their respective owners.'

export const USE_CASES: UseCase[] = [
  {
    slug: 'headless-task-management',
    icon: 'inbox',
    eyebrow: 'Headless task management',
    title: 'Human tasks and approvals inside your own app',
    metaTitle: 'Headless task management: human tasks in your own UI',
    description: 'Put approvals and human work inside your own portal or React app. UserTasks runs the workflow, creates typed tasks with outcomes, queues and SLAs, and exposes them through a REST API, TypeScript SDK and MCP server.',
    summary: 'Approvals and human steps inside your own portal or React app, with typed fields, outcomes, queues and SLAs behind an API.',
    keywords: ['headless task management', 'human task API', 'approval API', 'embedded workflow tasks', 'workflow engine for React'],
    problem: {
      title: 'Your users already have an app. The workflow should live there.',
      body: 'Customer portals, internal tools and line-of-business apps all need human steps: someone approves a refund, checks a document, fills in missing details. Sending people to a separate workflow product breaks the experience, and building assignment, deadlines, escalation and history yourself is a project of its own.',
      points: ['Approvals buried in email threads with no deadline or audit trail', 'A second UI that users have to learn and log in to', 'Home-grown task tables that never get escalation, reminders or reporting'],
    },
    solution: {
      title: 'UserTasks runs the process; your UI shows the work.',
      body: 'A workflow reaches a User Task node, creates a task with typed fields and outcomes, and waits. Your app lists the tasks for the signed-in person, renders the fields in your own components and completes the task with an outcome and values. The run continues on that outcome’s path.',
      points: ['Typed task fields and named outcomes, validated by the engine', 'Individual or team assignment, queues, due dates, reminders and escalation', 'List and complete tasks from the REST API, the TypeScript SDK, the CLI or MCP', 'Task and run events over Server-Sent Events or signed webhooks to refresh your UI'],
    },
    diagram: {
      title: 'Headless task management architecture',
      desc: 'Your web app, mobile app and AI assistants call the UserTasks API and MCP server. UserTasks runs the workflow, creates user tasks with fields and outcomes, applies queues and SLAs, and records events. It pushes events to your UI, sends notifications and updates your systems of record.',
      left: { label: 'Your front ends', items: [{ label: 'React app or portal', note: 'REST API · SDK' }, { label: 'Mobile app', note: 'REST API' }, { label: 'AI assistant', note: 'MCP server' }] },
      center: { label: 'UserTasks engine', items: ['Workflow run', 'User Task: fields + outcomes', 'Queues, SLAs, escalation', 'Event stream'] },
      right: { label: 'Out to your stack', items: [{ label: 'Live UI updates', note: 'SSE · signed webhooks' }, { label: 'Notifications', note: 'Email templates' }, { label: 'Systems of record', note: 'REST · OData · SQL' }] },
    },
    features: [
      { title: 'Tasks API', body: 'List assigned tasks and complete them with an outcome and typed values.', href: '/docs/tasks/api' },
      { title: 'Fields and outcomes', body: 'Typed inputs and named outcomes that route the run.', href: '/docs/tasks/fields-and-outcomes' },
      { title: 'Assignment and SLAs', body: 'People or team queues, due dates, reminders, escalation and redirects.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'TypeScript SDK', body: 'Typed client generated from the OpenAPI 3.1 document.', href: '/docs/sdk' },
      { title: 'Event stream', body: 'Tail task and run events or ship them to your own endpoint.', href: '/docs/observability' },
      { title: 'MCP server', body: 'Let AI assistants list and act on tasks with the same permissions.', href: '/docs/mcp' },
    ],
    snippet: {
      title: 'Your server lists and completes tasks',
      body: 'Call the API from your back end (keep the API key off the browser), then render the fields with your own components.',
      language: 'ts',
      code: `import { apiKeyAuth, createClient } from '@usertasks/sdk'

const ut = createClient({
  baseUrl: process.env.USERTASKS_URL!,
  auth: apiKeyAuth(process.env.USERTASKS_API_KEY!),
})

// Open tasks for the inbox in your app
const { tasks } = await ut.GET('/tasks/assigned', { query: { status: 'todo,in_progress' } })

// The person clicks "Approve" in your UI
await ut.POST('/tasks/{id}/action', {
  path: { id: tasks[0].id },
  body: { action: 'complete', outcome: 'Approve', values: { approved_amount: 4200 } },
})`,
    },
    screenshot: { name: 'task-detail', alt: 'A UserTasks task with typed fields and Approve and Reject outcome buttons', caption: 'The same task in the built-in task list: fields, outcomes, notes and history. Your app can render it however it likes.' },
    faqs: [
      { question: 'Do my users need a UserTasks login?', answer: 'Not if your back end calls the API with an API key or OAuth token and acts for them. Tasks can still be assigned to individual UserTasks users or teams when you want the built-in task list, SSO and per-user permissions.' },
      { question: 'How does my UI find out that a task changed?', answer: 'Subscribe to the Server-Sent Events stream at /api/v1/events/stream, or ship task and run events to a signed webhook destination. Workflows can also call your API directly at any step.' },
      { question: 'Can I use it from a framework other than React?', answer: 'Yes. Everything is plain REST described by OpenAPI 3.1, so any language works. The TypeScript SDK is a convenience for Node.js and other fetch-capable runtimes.' },
      { question: 'What happens to a waiting task when I publish a new workflow version?', answer: 'Running instances stay on the version they started with. You can move live instances to the new version from the designer, the API or the CLI, choosing the node where each one continues.' },
    ],
    related: ['approvals-and-compliance', 'ai-agent-orchestration', 'middleware-integration-hub'],
  },
  {
    slug: 'approvals-and-compliance',
    icon: 'shield',
    eyebrow: 'Approvals and compliance',
    title: 'Multi-step approvals you can prove',
    metaTitle: 'Approval workflows with SLAs, escalation and audit trails',
    description: 'Build finance, HR and procurement approvals with decision-table approval matrices, SLAs, reminders, escalation, audit trails, retention policies and role-based governance.',
    summary: 'Finance, HR and procurement approvals with approval matrices, SLAs, escalation, audit trails and retention.',
    keywords: ['approval workflow software', 'approval matrix', 'invoice approval workflow', 'compliance workflow', 'audit trail workflow', 'SLA escalation'],
    problem: {
      title: 'Approvals are easy to start and hard to govern.',
      body: 'Who can approve what changes every quarter. Requests stall when an approver is away. And when the auditor asks why an invoice was paid, the answer is spread across inboxes, spreadsheets and a chat thread.',
      points: ['Approval limits hard-coded in scripts or kept in a spreadsheet', 'No deadline, so requests wait until someone chases them', 'Evidence that is incomplete, editable or gone when it is needed'],
    },
    solution: {
      title: 'Rules, people and evidence in one process.',
      body: 'A decision table holds the approval matrix: amount bands, departments, cost centres and the approvers they require. The workflow creates approval tasks in the right order, with deadlines, reminders and escalation, and every step, decision and permission change is recorded.',
      points: ['Approval matrices as decision tables that finance or HR can change and test', 'Sequential or parallel approvers, team queues and multi-assignee tasks', 'SLAs, reminders and escalation to a person, a team or the manager', 'Audit log, run history, retention policies with review and purge, and SSO'],
    },
    diagram: {
      title: 'Approval and compliance workflow architecture',
      desc: 'Requests arrive from a form, an API call or a business system. UserTasks evaluates the approval matrix in a decision table, creates approver tasks with SLAs, escalates overdue work and records audit evidence under retention policies. It then updates the ERP or HR system, stores the approval record and ships events to the log platform.',
      left: { label: 'Requests', items: [{ label: 'Purchase or invoice', note: 'ERP · API · webhook' }, { label: 'Leave or hiring request', note: 'HR system · your form' }, { label: 'Policy exception', note: 'Your portal' }] },
      center: { label: 'UserTasks engine', items: ['Decision table: approval matrix', 'Approver tasks with SLAs', 'Reminders and escalation', 'Audit trail and retention'] },
      right: { label: 'Outcomes', items: [{ label: 'ERP or HRIS updated', note: 'References · SQL' }, { label: 'Approval record', note: 'Word or PDF document' }, { label: 'SIEM and log platform', note: 'Splunk · Datadog · OTel' }] },
    },
    features: [
      { title: 'Decision tables', body: 'Ordered, typed rules with a test endpoint — the approval matrix as data.', href: '/docs/decision-tables' },
      { title: 'Assignment and SLAs', body: 'Due dates, reminders, escalation and redirects on every approval.', href: '/docs/tasks/assignment-and-slas' },
      { title: 'Audit and retention', body: 'Audit log, security events, retention policies with review, deletion queue.', href: '/docs/governance/audit-and-retention' },
      { title: 'Roles and permissions', body: 'Fine-grained permissions, scoped API keys, SSO and directory sync.', href: '/docs/governance/roles-and-permissions' },
      { title: 'Versions and live instances', body: 'Immutable published versions; move in-flight approvals when rules change.', href: '/docs/workflows/versions-and-runs' },
      { title: 'Log export', body: 'Ship task, run and security events to the platform your auditors use.', href: '/docs/observability/destinations' },
    ],
    snippet: {
      title: 'Test the approval matrix before you publish it',
      body: 'Decision tables are testable from the CLI or API, so a rule change can be checked in CI before it reaches a live approval.',
      language: 'shell',
      code: `# Who approves a 72k purchase in Finance?
usertasks decision-tables test <matrix-id> \\
  --set values:='{"amount":72000,"department":"Finance"}'

# Follow approvals and escalations as they happen
usertasks logs tail --type 'task.*'

# Approve from a script (or your own UI)
usertasks tasks complete <task-id> --outcome Approve --set approved_amount:=72000`,
    },
    screenshot: { name: 'decision-table', alt: 'A UserTasks decision table with amount bands and the approvers each band requires', caption: 'An approval matrix as a decision table: ordered rules, typed inputs and outputs.' },
    faqs: [
      { question: 'Can business users change approval limits without a developer?', answer: 'Yes. Approval limits live in decision tables that people with the right permission can edit and test. The workflow reads the table at run time, so a rule change does not need a new workflow version.' },
      { question: 'What evidence does UserTasks keep?', answer: 'Each run keeps its path, step logs, variables and the task outcomes with who completed them and when. Permission changes, sign-ins and key usage are audited as security events, and everything can be exported to your log platform.' },
      { question: 'How do retention policies work?', answer: 'Retention policies select records by age and type, can require a review before anything is purged, and send deletions through a queue that checks dependencies first.' },
      { question: 'What if an approver is unavailable?', answer: 'Tasks can escalate after a set time to a named person, a team or the assignee’s manager, send reminders before or after the due date, and be redirected by the assignee when that is allowed.' },
    ],
    related: ['headless-task-management', 'sharepoint-workflow-replacement', 'middleware-integration-hub'],
  },
  {
    slug: 'ai-agent-orchestration',
    icon: 'bot',
    eyebrow: 'AI agent orchestration',
    title: 'AI agents as workflow steps, with a person in the loop',
    metaTitle: 'AI agent orchestration with human-in-the-loop review',
    description: 'Run AI agents as governed workflow steps: granted tools only, structured outputs, human review tasks for low-confidence results, run history and traces — and an MCP server for AI assistants.',
    summary: 'Agents as governed workflow steps with granted tools, structured outputs, human review and full run history.',
    keywords: ['AI agent orchestration', 'human in the loop AI', 'AI workflow automation', 'MCP server workflow', 'AI guardrails workflow'],
    problem: {
      title: 'Agents are useful. Unsupervised agents are a risk.',
      body: 'A model can classify a document, draft a reply or pick the next step in seconds — but it can also be wrong, call a tool it should not, or leave no trace of why it decided what it did. Most teams need agents inside a process, not instead of one.',
      points: ['Agents with broad credentials and no permission boundary', 'No review step for uncertain or high-impact answers', 'Prompts, tool calls and results nobody can audit afterwards'],
    },
    solution: {
      title: 'The workflow decides what the agent may do, and when a person checks it.',
      body: 'A Run Agent node calls a model with instructions, granted tools and an output schema. The structured result goes into workflow variables, so the next node can branch on it — continue automatically when the answer is clear, or create a review task when it is not.',
      points: ['Any OpenAI-compatible model, connected as an AI connector', 'Only the tools you grant: references, workflows, external MCP servers', 'Structured outputs that conditions and decision tables can route on', 'Every run, step, tool call and token count recorded; prompts never exported'],
    },
    diagram: {
      title: 'AI agent orchestration architecture',
      desc: 'Emails, webhooks and schedules start workflows, and AI assistants connect through the MCP server. UserTasks runs the agent step with only its granted tools, routes its structured output through a condition, creates a human review task when needed and records run history. The agent calls the model and your APIs, and events go to your log platform.',
      left: { label: 'Triggers', items: [{ label: 'Inbound email or webhook', note: 'Documents, tickets' }, { label: 'Schedule', note: 'Batch triage' }, { label: 'AI assistant', note: 'MCP server' }] },
      center: { label: 'UserTasks engine', items: ['Run Agent: granted tools only', 'Structured output → condition', 'Human review task', 'Run history and traces'] },
      right: { label: 'Called by the agent', items: [{ label: 'Model', note: 'OpenAI-compatible API' }, { label: 'Your APIs', note: 'Granted references' }, { label: 'Event stream', note: 'agent.run.* events' }] },
    },
    features: [
      { title: 'AI agents', body: 'Instructions, granted tools and output schemas; run in a workflow or on demand.', href: '/docs/agents' },
      { title: 'User tasks', body: 'Review, correct or reject an agent’s answer before the process continues.', href: '/docs/tasks' },
      { title: 'Conditions and decision tables', body: 'Route on confidence, amount or category from the agent’s output.', href: '/docs/decision-tables' },
      { title: 'MCP server', body: 'Claude, ChatGPT, Cursor and other clients drive workflows and tasks with scoped permissions.', href: '/docs/mcp' },
      { title: 'Run history', body: 'The path taken, each step’s inputs and outputs, and errors.', href: '/docs/workflows/versions-and-runs' },
      { title: 'Event stream', body: 'Agent runs, token counts and failures as exportable events.', href: '/docs/observability/events' },
    ],
    snippet: {
      title: 'Run an agent, or let your assistant drive the engine',
      body: 'Execute an agent on demand from the CLI, or connect an MCP client with an API key or OAuth.',
      language: 'shell',
      code: `# Run an agent on demand (add --set async:=true to queue it)
usertasks agents execute <agent-id> --set message="Classify invoice INV-1042"

# Connect an MCP client (Claude Desktop, Cursor, …)
{
  "mcpServers": {
    "usertasks": {
      "url": "https://usertasks.com/api/mcp",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}`,
    },
    screenshot: { name: 'run-detail', alt: 'A UserTasks run detail page showing the path taken and the status and duration of each step', caption: 'Every run keeps its path, each step’s status and duration, and the error if one failed.' },
    faqs: [
      { question: 'Which models can agents use?', answer: 'Any chat-completions endpoint that is OpenAI-compatible and supports tool calling — for example OpenAI, Azure OpenAI, Groq, Together, Ollama, or an Anthropic-compatible proxy.' },
      { question: 'How do I stop an agent doing something it should not?', answer: 'Agents can only call the tools you grant, and those tools run with permission checks. Put a User Task after the agent so a person approves high-impact actions, and branch on the structured output so uncertain answers always go to review.' },
      { question: 'Are prompts and model outputs sent to my log platform?', answer: 'No. Agent runs, steps, tool calls, token counts and errors are recorded and emitted as agent.run.* events, but prompts and model outputs are not included in exported events.' },
      { question: 'Do I have to use AI at all?', answer: 'No. Agents are optional; every other feature works without them.' },
    ],
    related: ['headless-task-management', 'middleware-integration-hub', 'approvals-and-compliance'],
  },
  {
    slug: 'middleware-integration-hub',
    icon: 'plug',
    eyebrow: 'Middleware and integration hub',
    title: 'One place for webhooks in, transforms and calls out',
    metaTitle: 'Integration hub: webhooks, transforms, retries and observability',
    description: 'Receive webhooks, transform payloads, route with decision tables, call REST, OData and SQL systems with retries and error workflows, export every event to Splunk, Datadog or OpenTelemetry, and promote config across environments as code.',
    summary: 'Webhooks in, transforms, decision-table routing and API or database calls out — with retries, log export and config as code.',
    keywords: ['integration hub', 'webhook middleware', 'API orchestration', 'workflow integration platform', 'webhook to API', 'config as code integrations'],
    problem: {
      title: 'Point-to-point integrations multiply quietly.',
      body: 'Each new partner or SaaS tool gets its own script, function or cron job. Credentials end up in several places, failures are found by customers, and nobody can say which version is running in production.',
      points: ['Glue code spread across functions, scripts and schedulers', 'Silent failures and hand-written retry logic', 'Dev, test and prod drifting apart'],
    },
    solution: {
      title: 'A governed hub that is still just code and config.',
      body: 'Webhook and Middleware triggers receive events; expressions, JSON and collection nodes reshape them; decision tables route them; references call your APIs and databases with centrally stored credentials. Failures retry with backoff or go to an error workflow, and every call is an event you can export.',
      points: ['Webhook trigger (queue and answer) or Middleware trigger (answer with the result)', '70+ expression functions, JSON, CSV and Excel nodes for transforms', 'REST, OData and SQL references with encrypted credentials and OAuth', 'Export, diff and apply config between environments, or sync with GitHub'],
    },
    diagram: {
      title: 'Middleware and integration hub architecture',
      desc: 'Partner webhooks, SaaS events and files arrive through webhook and middleware triggers. UserTasks transforms the payload with expressions and JSON nodes, routes it with a decision table, and retries or runs an error workflow on failure. It calls REST and OData APIs and databases, and exports every event to Splunk, Datadog or OpenTelemetry.',
      left: { label: 'Events in', items: [{ label: 'Partner webhooks', note: 'Signed, per-hook secret' }, { label: 'SaaS events', note: 'Webhook trigger' }, { label: 'Files', note: 'CSV · Excel · JSON' }] },
      center: { label: 'UserTasks engine', items: ['Webhook / Middleware trigger', 'Transform: expressions + JSON', 'Decision table routing', 'Retries and error workflows'] },
      right: { label: 'Calls out', items: [{ label: 'REST and OData APIs', note: 'References · OAuth' }, { label: 'Databases', note: 'Postgres · SQL Server · more' }, { label: 'Log platform', note: 'Splunk · Datadog · OTel' }] },
    },
    features: [
      { title: 'Webhooks', body: 'Inbound webhooks per workflow with rotating secrets; synchronous middleware responses.', href: '/docs/integrations/webhooks' },
      { title: 'Integrations and references', body: 'Reusable REST, OData and database operations with stored credentials.', href: '/docs/integrations' },
      { title: 'Expressions and functions', body: 'Transform payloads inline with typed functions.', href: '/docs/workflows/expressions' },
      { title: 'Error handling', body: 'Stop or continue per node, retries with backoff, central error workflows.', href: '/docs/workflows/error-handling' },
      { title: 'Observability', body: 'One event stream with filters, live tail and export destinations.', href: '/docs/observability' },
      { title: 'Config as code', body: 'Export, diff and apply between environments; GitHub sync.', href: '/docs/config-as-code' },
    ],
    snippet: {
      title: 'Wire a webhook and promote it',
      body: 'Create the inbound hook, send it a payload, and move the whole configuration from dev to prod after review.',
      language: 'shell',
      code: `usertasks webhooks create <workflow-id> --set slug=order-intake
curl -X POST "$USERTASKS_URL/api/webhooks/inbound?hook=order-intake" \\
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" -d @order.json

usertasks --profile dev config export ./config
usertasks --profile prod config diff ./config --exit-code
usertasks --profile prod config apply ./config`,
    },
    screenshot: { name: 'log-export', alt: 'The UserTasks log export settings listing a Splunk HEC destination and a webhook destination with healthy status', caption: 'Log export: every run, call and change shipped to Splunk, Datadog, OpenTelemetry or a webhook.' },
    faqs: [
      { question: 'Can a workflow answer the webhook caller synchronously?', answer: 'Yes. A Middleware trigger keeps the request open until the run finishes and returns the run’s variables, so a workflow can validate or enrich a request in line. A Webhook trigger answers as soon as the run is queued.' },
      { question: 'What happens when a downstream system is down?', answer: 'Queue jobs retry automatically with backoff before they are marked dead. Per node you choose whether an error stops the run or continues with the error in variables, and a Workflow Error trigger can run a central error workflow.' },
      { question: 'Which databases can references query?', answer: 'Postgres, SQL Server and MySQL work out of the box; Snowflake, Oracle and MongoDB are available through optional drivers on self-hosted installs.' },
      { question: 'How do I keep dev and prod in step?', answer: 'Use config as code: export a workspace to files, review the change, diff it against production and apply it. Secrets stay out of Git. GitHub sync can commit every change and deploy pinned commits.' },
    ],
    related: ['ai-agent-orchestration', 'approvals-and-compliance', 'headless-task-management'],
  },
  {
    slug: 'sharepoint-workflow-replacement',
    icon: 'list',
    eyebrow: 'SharePoint workflow replacement',
    title: 'Replacing SharePoint 2010 and 2013 workflows',
    metaTitle: 'Replace retired SharePoint 2010 and 2013 workflows',
    description: 'Microsoft has retired SharePoint 2010 and SharePoint 2013 workflows in SharePoint Online. Map approval, collect-feedback and list-item workflows to UserTasks tasks, decision tables, webhooks and the SharePoint connector.',
    summary: 'Microsoft has retired SharePoint 2010 and 2013 workflows in SharePoint Online. Rebuild approvals and list workflows on an engine you control.',
    keywords: ['SharePoint 2013 workflow retirement', 'SharePoint 2010 workflow replacement', 'SharePoint Designer workflow alternative', 'SharePoint approval workflow migration', 'SharePoint list workflow'],
    problem: {
      title: 'The workflows behind many SharePoint sites have been switched off.',
      body: 'Approvals, feedback rounds and list-driven processes built with SharePoint Designer ran on the SharePoint 2010 and 2013 workflow engines. Microsoft has retired both in SharePoint Online, so those processes need a new home — and the definitions, task lists and history that went with them need to be rebuilt somewhere supported.',
      points: ['Approval and feedback workflows that no longer run', 'Task lists and workflow history lists with no engine behind them', 'Business rules hidden in SharePoint Designer conditions'],
    },
    solution: {
      title: 'Rebuild the process; keep SharePoint for content.',
      body: 'Your sites, lists and libraries stay in SharePoint. The process moves to UserTasks: approvals become User Tasks with outcomes and deadlines, conditions become decision tables, and the SharePoint connector reads and writes list items and files through Microsoft Graph.',
      points: ['SharePoint connector: list items, files, folders, libraries and search via Microsoft Graph', 'Approvals with outcomes, SLAs, reminders and escalation instead of task lists', 'Decision tables for the routing rules that lived in Designer conditions', 'Run history, audit and log export in place of workflow history lists'],
    },
    diagram: {
      title: 'SharePoint workflow replacement architecture',
      desc: 'SharePoint lists and libraries, scheduled checks and line-of-business systems start workflows in UserTasks through a schedule trigger, the SharePoint connector or an inbound webhook. UserTasks routes with decision tables, creates approval tasks with SLAs and records history. It writes status back to SharePoint list items and files, sends email and exports events.',
      left: { label: 'Starts from', items: [{ label: 'SharePoint list or library', note: 'Polled via Get List Items' }, { label: 'Line-of-business system', note: 'Inbound webhook' }, { label: 'Person in your portal', note: 'API · task list' }] },
      center: { label: 'UserTasks engine', items: ['Decision table: routing rules', 'Approval tasks with SLAs', 'Reminders and escalation', 'Run history and audit'] },
      right: { label: 'Writes back', items: [{ label: 'SharePoint list items', note: 'Create · update via Graph' }, { label: 'Documents', note: 'Upload to a library' }, { label: 'Email', note: 'Email templates' }] },
    },
    timeline: {
      title: 'What Microsoft has announced',
      body: 'Microsoft’s published timeline for SharePoint Online (Microsoft 365). Microsoft recommends migrating to Power Automate or another supported workflow orchestration solution. SharePoint Server on premises follows its own support lifecycle; check Microsoft’s pages for your version.',
      events: [
        { date: 'August 1, 2020', text: 'SharePoint 2010 workflows turned off for newly created tenants.' },
        { date: 'November 1, 2020', text: 'SharePoint 2010 workflow services removed from existing tenants.' },
        { date: 'April 2, 2024', text: 'SharePoint 2013 workflows turned off for new tenants.' },
        { date: 'April 2, 2026', text: 'SharePoint 2013 workflows removed from existing tenants and fully retired.' },
      ],
      sources: [
        { label: 'Microsoft Support: SharePoint 2010 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2010-workflow-retirement-1ca3fff8-9985-410a-85aa-8120f626965f' },
        { label: 'Microsoft Support: SharePoint 2013 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2013-workflow-retirement-4613d9cf-69aa-40f7-b6bf-6e7831c9691e' },
      ],
    },
    mapping: {
      title: 'Common SharePoint workflow patterns in UserTasks',
      body: 'Rebuild by pattern rather than action by action. Most SharePoint Designer workflows are one of a handful of shapes.',
      from: 'SharePoint workflow pattern',
      rows: [
        { from: 'Approval workflow (approve / reject)', to: 'User Task with Approve and Reject outcomes, assignees or a team queue, due date and escalation', href: '/docs/tasks/fields-and-outcomes' },
        { from: 'Collect Feedback', to: 'User Task with typed comment fields, assigned to several people; the run continues when they respond', href: '/docs/tasks' },
        { from: 'Workflow started when an item is created or changed', to: 'Schedule trigger with the SharePoint connector’s Get List Items, or an inbound webhook from the system that writes the item', href: '/docs/workflows/triggers' },
        { from: 'Conditions and lookups in SharePoint Designer', to: 'Condition and Switch nodes, and decision tables for rules the business maintains', href: '/docs/decision-tables' },
        { from: 'Update list item / create list item', to: 'SharePoint connector: Create List Item and Update List Item', href: '/docs/integrations/connectors' },
        { from: 'Pause for duration / pause until date', to: 'Delay and Pause Until nodes, resumed from the durable queue', href: '/docs/workflows/timing' },
        { from: 'Send an email', to: 'Send Email node with reusable email templates', href: '/docs/email-templates' },
        { from: 'Task list and workflow history list', to: 'The task list or your own UI, plus run history, audit and log export', href: '/docs/observability' },
      ],
    },
    features: [
      { title: 'Connectors', body: 'The SharePoint connector creates ready-made references for lists, files and search.', href: '/docs/integrations/connectors' },
      { title: 'Tasks and outcomes', body: 'Approvals and feedback with typed fields and named outcomes.', href: '/docs/tasks/fields-and-outcomes' },
      { title: 'Decision tables', body: 'Routing rules outside the workflow, testable from the API.', href: '/docs/decision-tables' },
      { title: 'Triggers', body: 'Schedules, webhooks, data events and task events.', href: '/docs/workflows/triggers' },
      { title: 'Email templates', body: 'Notifications with variables and a live preview.', href: '/docs/email-templates' },
      { title: 'Observability', body: 'Run history and exportable events in place of history lists.', href: '/docs/observability' },
    ],
    snippet: {
      title: 'Connect the site, import the rebuilt workflow',
      body: 'The SharePoint connector uses a Microsoft Entra app registration with Microsoft Graph permissions. Workflows are plain JSON you can review and version.',
      language: 'shell',
      code: `usertasks connectors catalog                 # includes SharePoint
usertasks connectors create -f sharepoint-hr-site.yaml
usertasks connectors test <id>

usertasks workflows create -f leave-approval.json
usertasks workflows publish <id> --set notes="Replaces the SharePoint 2013 leave approval"`,
    },
    screenshot: { name: 'designer', alt: 'The UserTasks workflow designer showing an approval workflow with the User Task settings panel open', caption: 'An approval rebuilt in the designer: trigger, decision, approval task and the update back to the list.' },
    steps: [
      { title: 'Inventory', body: 'List the workflows in each site with Microsoft’s assessment tooling, with owners, volumes and the lists they touch.' },
      { title: 'Group by pattern', body: 'Sort them into approvals, feedback, notifications and list updates; retire the ones nobody uses.' },
      { title: 'Rebuild one per pattern', body: 'Connect the site once, build a workflow per pattern and reuse it with different lists and rules.' },
      { title: 'Cut over by site', body: 'Point users at the new tasks, check results against the list, then remove the old workflow associations.' },
    ],
    faqs: [
      { question: 'Do I have to move my lists and documents out of SharePoint?', answer: 'No. Content can stay in SharePoint. UserTasks reads and writes list items and files through the SharePoint connector, which uses Microsoft Graph.' },
      { question: 'Can UserTasks import SharePoint Designer workflow files?', answer: 'No. Workflows are rebuilt, usually by pattern. Most Designer workflows are approvals, feedback rounds or list updates, which map to a small number of reusable UserTasks workflows.' },
      { question: 'What does Microsoft recommend?', answer: 'Microsoft recommends migrating to Power Automate or other supported workflow orchestration solutions. UserTasks is one option when you want an open-source engine with an API, CLI and on-premises deployment.' },
      { question: 'What about SharePoint Server on premises?', answer: 'On-premises support follows each SharePoint Server version’s lifecycle, as described on Microsoft’s retirement pages. UserTasks can be self-hosted next to an on-premises farm, but its SharePoint connector targets SharePoint Online through Microsoft Graph.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['approvals-and-compliance', 'nintex-migration', 'k2-migration'],
  },
  {
    slug: 'nintex-migration',
    icon: 'route',
    eyebrow: 'Nintex migration guide',
    title: 'Moving Nintex workflows to UserTasks',
    metaTitle: 'Nintex migration guide: workflows, forms, tasks and rules',
    description: 'A neutral guide to moving Nintex workflows to UserTasks: how forms, workflows, tasks, connectors, document generation and rules map, and a wave-based migration plan.',
    summary: 'A neutral concept map and migration plan for Nintex workflows, forms, tasks, connectors and rules.',
    keywords: ['Nintex migration', 'Nintex replacement', 'Nintex alternative', 'Nintex workflow migration', 'Nintex forms replacement'],
    problem: {
      title: 'A migration is a chance to simplify, not just to copy.',
      body: 'Teams move off a workflow platform for many reasons: licensing models, deployment requirements, a wish to own the user interface, or wanting processes in code review. Whatever the reason, the hard part is the same — inventory, rebuild, prove the result and retire the old automation safely.',
      points: ['Hundreds of workflows of varying age, ownership and value', 'Forms coupled to the workflow that runs behind them', 'Connections, credentials and schedules spread across the estate'],
    },
    solution: {
      title: 'Map concepts, rebuild by outcome, move in waves.',
      body: 'UserTasks covers the workflow layer — workflows, approvals, human tasks, connectors, document generation and governance — through a REST API, MCP server and CLI. User interfaces are built in your own front end, or people use the built-in task list.',
      points: ['Visual designer plus JSON definitions you can review and version', 'Tasks with typed fields and outcomes, queues, SLAs and escalation', 'Integrations, OpenAPI import and pre-built connectors', 'Open source under Apache-2.0, in the cloud or self-hosted'],
    },
    diagram: {
      title: 'Nintex to UserTasks migration architecture',
      desc: 'Forms move to your own UI or the UserTasks task list, workflows move to the designer, and connectors move to integrations. During a parallel run, tasks from the existing engine can be ingested through the tasks ingest API so people work from one inbox. UserTasks calls the same business systems, generates documents and exports events.',
      left: { label: 'What you have', items: [{ label: 'Forms', note: '→ your UI or task list' }, { label: 'Workflows and tasks', note: '→ designer and user tasks' }, { label: 'Connectors', note: '→ integrations' }] },
      center: { label: 'UserTasks engine', items: ['Workflows and sub-workflows', 'User tasks with SLAs', 'Decision tables', 'Tasks ingest for parallel runs'] },
      right: { label: 'Connected to', items: [{ label: 'Business systems', note: 'REST · OData · SQL' }, { label: 'Generated documents', note: 'Word · Excel · PowerPoint' }, { label: 'Your log platform', note: 'Event export' }] },
    },
    mapping: {
      title: 'Nintex concepts and their UserTasks equivalents',
      body: 'A starting point for a capability inventory. Check each workflow’s actual behaviour; names alone rarely tell the whole story.',
      from: 'In Nintex',
      rows: [
        { from: 'Forms', to: 'Your own UI against the Tasks API (headless), or the built-in task list with typed fields', href: '/docs/tasks/api' },
        { from: 'Workflows and components', to: 'Workflows in the visual designer, and reusable sub-workflows', href: '/docs/workflows/sub-workflows' },
        { from: 'Assign a task / request approval', to: 'User Task nodes with outcomes, team queues, SLAs, reminders and escalation', href: '/docs/tasks/assignment-and-slas' },
        { from: 'Connectors and extensions', to: 'Integrations, references, pre-built connectors and OpenAPI import', href: '/docs/integrations' },
        { from: 'Document generation', to: 'Word, Excel and PowerPoint document nodes', href: '/docs/workflows/nodes' },
        { from: 'Conditions and business rules', to: 'Condition and Switch nodes, and decision tables', href: '/docs/decision-tables' },
        { from: 'Workflow history and reporting', to: 'Run history, reports with a reporting API, and log export', href: '/docs/reports' },
        { from: 'Desktop RPA bots', to: 'Not included. Call existing bots or their APIs from a workflow step', href: '/docs/integrations/references' },
      ],
    },
    features: [
      { title: 'Workflow designer', body: 'Canvas or JSON, published as immutable versions.', href: '/docs/workflows/designer' },
      { title: 'Tasks', body: 'The built-in task list, or your own UI through the API.', href: '/docs/tasks' },
      { title: 'Connectors', body: 'Pre-built connectors with service-specific connection tests.', href: '/docs/integrations/connectors' },
      { title: 'OpenAPI import', body: 'Turn an API description into reusable references.', href: '/docs/integrations/openapi-import' },
      { title: 'Decision tables', body: 'Rules analysts maintain, separate from routing.', href: '/docs/decision-tables' },
      { title: 'Config as code', body: 'Move workflows between environments as reviewed files.', href: '/docs/config-as-code' },
    ],
    snippet: {
      title: 'One inbox during the parallel run',
      body: 'While some processes still run on the old platform, post their human steps to UserTasks so people work from one task list.',
      language: 'shell',
      code: `usertasks tasks ingest \\
  --set title="Approve PO-88213 (legacy workflow)" \\
  --set assignee_email=ap.lead@example.com \\
  --set idempotency_key=legacy-po-88213

# Rebuilt workflows are files you review and promote
usertasks workflows create -f purchase-order-approval.json
usertasks --profile prod config diff ./config --exit-code`,
    },
    screenshot: { name: 'integrations', alt: 'The UserTasks integrations page listing connected systems and their references', caption: 'Integrations: one connection per system, with reusable references for workflows, agents and reports.' },
    steps: [
      { title: 'Inventory', body: 'Catalog workflows, forms, connectors, owners, schedules, volumes and dependencies — and decide where each user interface will live.' },
      { title: 'Rationalize', body: 'Retire unused automation and combine duplicated patterns before rebuilding.' },
      { title: 'Build the foundation', body: 'Create shared integrations, references, decision tables, roles and reports first.' },
      { title: 'Migrate and reconcile', body: 'Move processes in waves with scenario tests, owner sign-off, monitoring and a rollback window.' },
    ],
    faqs: [
      { question: 'Can UserTasks import Nintex workflow files?', answer: 'No. Workflows are rebuilt. A capability inventory and a pattern-based rebuild usually produce fewer, simpler workflows than a one-to-one conversion.' },
      { question: 'What replaces Nintex forms?', answer: 'UserTasks is headless: build the screens in your own front end against the Tasks API, or use the built-in task list, which renders typed fields and outcome buttons.' },
      { question: 'Can both platforms run side by side?', answer: 'Yes. Rebuilt processes run in UserTasks while the rest stay where they are. The tasks ingest API can bring human steps from the existing engine into the UserTasks task list during the transition.' },
      { question: 'How is UserTasks licensed?', answer: 'The engine is open source under Apache-2.0 and can be self-hosted, or used as a managed cloud service. Compare infrastructure, support and migration effort against your current agreement.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['k2-migration', 'sharepoint-workflow-replacement', 'headless-task-management'],
  },
  {
    slug: 'k2-migration',
    icon: 'layers',
    eyebrow: 'K2 migration guide',
    title: 'Moving K2 applications to UserTasks',
    metaTitle: 'K2 migration guide: SmartForms, workflows and SmartObjects',
    description: 'A neutral guide to moving K2 applications to UserTasks: how SmartForms, workflows, worklists, SmartObjects, service instances and rules map, and how to migrate in waves.',
    summary: 'A neutral concept map and migration plan for K2 SmartForms, workflows, worklists and SmartObjects.',
    keywords: ['K2 migration', 'K2 replacement', 'K2 alternative', 'K2 SmartObjects replacement', 'K2 SmartForms replacement', 'Nintex Automation K2 migration'],
    problem: {
      title: 'K2 applications bundle forms, process and data.',
      body: 'A typical K2 application combines SmartForms, a workflow, SmartObjects over several data sources, roles and reports. Moving it is application modernisation rather than file conversion: the process intent has to survive while the coupling between screens, data and workflow is redesigned.',
      points: ['Forms, workflow and data access tightly coupled', 'Service instances and environment settings that only one person understands', 'Long-running instances that must finish or move cleanly'],
    },
    solution: {
      title: 'Separate the layers, then rebuild each one.',
      body: 'UserTasks replaces the process layer — workflows, worklists, rules, roles and governed data access — behind a REST API, MCP server and CLI. SmartForms screens are rebuilt in your own front end, or replaced by the built-in task list where a typed task form is enough.',
      points: ['Workflows and sub-workflows in the designer, as reviewable JSON', 'Worklists as task inboxes and team queues with SLAs and escalation', 'SmartObject-style data access through objects, data tables and references', 'Config as code and environment profiles in place of environment fields'],
    },
    diagram: {
      title: 'K2 to UserTasks migration architecture',
      desc: 'SmartForms move to your own UI or the UserTasks task list, workflows to the designer, and SmartObjects to objects, data tables and references. UserTasks runs workflows, worklist tasks with SLAs and decision tables, and calls the same SQL databases and services. Configuration moves between environments as code.',
      left: { label: 'What you have', items: [{ label: 'SmartForms', note: '→ your UI or task list' }, { label: 'Workflows and worklists', note: '→ designer and tasks' }, { label: 'SmartObjects', note: '→ objects and references' }] },
      center: { label: 'UserTasks engine', items: ['Workflows and sub-workflows', 'Task inbox and team queues', 'Decision tables', 'Objects and data tables'] },
      right: { label: 'Connected to', items: [{ label: 'SQL databases', note: 'SQL Server · Postgres' }, { label: 'Services', note: 'REST · OData' }, { label: 'Environments', note: 'Config as code' }] },
    },
    mapping: {
      title: 'K2 concepts and their UserTasks equivalents',
      body: 'Start with a capability inventory rather than screen-by-screen recreation.',
      from: 'In K2',
      rows: [
        { from: 'SmartForms and views', to: 'Your own UI against the Tasks API, or the built-in task list with typed fields', href: '/docs/tasks/api' },
        { from: 'Workflows, activities and events', to: 'Workflows in the designer: triggers, logic, actions, waits and sub-workflows', href: '/docs/workflows' },
        { from: 'Worklist and worklist items', to: 'Task inbox, team queues, outcomes, SLAs and escalation', href: '/docs/tasks' },
        { from: 'SmartObjects', to: 'Business objects over data tables and integration references', href: '/docs/data-tables' },
        { from: 'Service types and service instances', to: 'Integrations and references: REST, OData and SQL databases with stored credentials', href: '/docs/integrations/references' },
        { from: 'Roles and groups', to: 'Teams, roles and fine-grained permissions, with SSO and directory sync', href: '/docs/governance/teams-and-invitations' },
        { from: 'Rules and inline functions', to: 'Expressions and functions, conditions and decision tables', href: '/docs/workflows/expressions' },
        { from: 'Environment fields and deployment packages', to: 'Config as code: export, diff and apply per environment profile; GitHub sync', href: '/docs/config-as-code' },
      ],
    },
    features: [
      { title: 'Workflows', body: 'Triggers, branches, loops, parallel paths, waits and sub-workflows.', href: '/docs/workflows' },
      { title: 'Data tables and objects', body: 'Typed tables and business objects across tables and APIs.', href: '/docs/data-tables' },
      { title: 'References', body: 'Saved REST, OData and database operations.', href: '/docs/integrations/references' },
      { title: 'Tasks', body: 'Worklists as inboxes and queues, in the app or your own UI.', href: '/docs/tasks' },
      { title: 'Reports', body: 'Saved queries and charts over tasks, runs and data, with an API.', href: '/docs/reports' },
      { title: 'Live instance migration', body: 'Move in-flight runs between versions as processes evolve.', href: '/docs/workflows/versions-and-runs' },
    ],
    snippet: {
      title: 'Rebuild the data contract first',
      body: 'Start with the data and integration layer the application depends on, then build the workflow and screens on top of it.',
      language: 'shell',
      code: `# The database the K2 SmartObjects read from
usertasks integrations create -f erp-sql.yaml
usertasks references create -f get-vendor.yaml

# Workflow and rules as reviewable files
usertasks decision-tables import -f vendor-approval-matrix.json
usertasks workflows create -f vendor-onboarding.json`,
    },
    screenshot: { name: 'data-table', alt: 'A UserTasks data table with typed columns and rows', caption: 'A data table: typed columns, row events that start workflows, and an OData endpoint.' },
    steps: [
      { title: 'Portfolio assessment', body: 'Classify K2 applications by complexity, usage, business impact, integrations and retirement potential.' },
      { title: 'Capability mapping', body: 'Map workflows, worklists, SmartObjects, roles, reports, schedules and custom code — and decide where each screen will live.' },
      { title: 'Pilot migration', body: 'Rebuild one representative application to produce reusable patterns, tests and estimates.' },
      { title: 'Wave-based cutover', body: 'Migrate groups of applications with reconciliation, rollback, owner acceptance and retirement controls.' },
    ],
    faqs: [
      { question: 'What parts of a K2 application does UserTasks replace?', answer: 'The process layer: workflows, worklists and tasks, rules, roles and SmartObject-style data access. SmartForms screens are rebuilt in your own front end, or replaced by the built-in task list.' },
      { question: 'What replaces SmartObjects?', answer: 'Business objects combine a data table or reference with joined sources into one entity, and expose governed list, get, insert, update and delete operations to workflows, reports, the API and agents.' },
      { question: 'Can the result run on premises?', answer: 'Yes. The engine is open source under Apache-2.0 and can be self-hosted on your own servers or cloud account, next to the databases your applications use.' },
      { question: 'What happens to instances still running in K2?', answer: 'Let them finish where they are while new requests start in UserTasks, or bring their open human steps into the UserTasks task list through the tasks ingest API during the transition.' },
    ],
    disclaimer: TRADEMARKS,
    related: ['nintex-migration', 'sharepoint-workflow-replacement', 'middleware-integration-hub'],
  },
]

export function getUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug)
}

/** Old SEO pages folded into the migration guides (permanent redirects). */
export const USE_CASE_REDIRECTS: Record<string, string> = {
  '/k2-replacement': '/use-cases/k2-migration',
  '/nintex-replacement': '/use-cases/nintex-migration',
}
