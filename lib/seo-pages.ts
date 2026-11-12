import { breadcrumbNode, faqNode, howToNode, webPageNode } from '@/lib/seo/site'

/**
 * Solution and guide pages of the public site (/<slug>), rendered by
 * components/marketing/seo-solution-page.tsx and also published in the
 * sitemap and /llms.txt.
 *
 * Written to be cited: each page opens with a plain definition, FAQ answers
 * lead with a direct 40–60 word answer, dates come with their sources, and
 * nothing is claimed that the product doesn't do. Statements about other
 * vendors stay factual and neutral: plain product names, no logos, no
 * disparagement, no feature scorecards we can't verify.
 */

export type SeoFaq = { question: string; answer: string }
export type SeoSource = { label: string; href: string }

export type SeoPage = {
  slug: string
  /** Short label: hero pill, breadcrumb and nav. */
  eyebrow: string
  /** H1 and Open Graph title. */
  title: string
  /** <title>, brand included. Unique per page. */
  metaTitle: string
  description: string
  keywords: string[]
  /** Date the page's facts were last checked (YYYY-MM-DD): shown on the page and used as the sitemap's lastModified. */
  updated: string
  /** "X is …" — the first paragraph under the hero; what an answer engine should quote. */
  definition: string
  intro: string
  outcomes: string[]
  sections: Array<{ title: string; body: string; points: string[] }>
  /** Optional table (a mapping or a factual comparison). */
  comparison?: { title: string; body: string; columns: [string, string] | [string, string, string]; rows: string[][]; note?: string }
  /** Dated facts with their sources. */
  timeline?: { title: string; body: string; events: Array<{ date: string; text: string }>; sources: SeoSource[] }
  steps: Array<{ title: string; body: string }>
  stepsTitle?: string
  /** Set when the steps are real product steps (published as HowTo structured data). */
  howTo?: { name: string; description: string; totalTime?: string }
  faqs: SeoFaq[]
  /** Product page this solution page leads to (shown in the hero and before the FAQ). */
  related?: { href: string; label: string; body: string }
  /** Further reading at the end of the page: other guides, use cases and docs. */
  links: Array<{ href: string; label: string }>
  /** Trademark notice when other vendors are named. */
  disclaimer?: string
}

const TRADEMARKS = 'UserTasks is an independent open-source project and is not affiliated with or endorsed by Microsoft. SharePoint, InfoPath and Power Automate are trademarks of the Microsoft group of companies; other product names are trademarks of their respective owners.'

const MS_SHAREPOINT_2010 = { label: 'Microsoft Support: SharePoint 2010 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2010-workflow-retirement-1ca3fff8-9985-410a-85aa-8120f626965f' }
const MS_SHAREPOINT_2013 = { label: 'Microsoft Support: SharePoint 2013 workflow retirement', href: 'https://support.microsoft.com/en-us/office/sharepoint-2013-workflow-retirement-4613d9cf-69aa-40f7-b6bf-6e7831c9691e' }
const MS_EOS_2026 = { label: 'Microsoft Lifecycle: Ending support in 2026', href: 'https://learn.microsoft.com/en-us/lifecycle/end-of-support/end-of-support-2026' }
const MS_INFOPATH_LIFECYCLE = { label: 'Microsoft Lifecycle: InfoPath 2013', href: 'https://learn.microsoft.com/en-us/lifecycle/products/infopath-2013' }
const MS_INFOPATH_BLOG = { label: 'Microsoft Tech Community: Support update for InfoPath Forms Services in Microsoft 365', href: 'https://techcommunity.microsoft.com/blog/spblog/support-update-for-infopath-forms-services-in-microsoft-365/3858190' }

export const SEO_PAGES: SeoPage[] = [
  {
    slug: 'workflow-automation',
    related: { href: '/workflows', label: 'See how complex workflows are built', body: 'Branches, parallel paths, loops, sub-workflows, decision tables, people, SLAs and error paths on one canvas — with Save & Test, versions and live migration.' },
    eyebrow: 'Workflow automation platform',
    title: 'Workflow automation for people, systems, data, and AI',
    metaTitle: 'Workflow Automation Software for People and Systems | UserTasks',
    description: 'Build governed workflow automation with visual orchestration, human tasks, integrations, decision tables, document generation, an API, MCP server and CLI, log export, and optional AI agents.',
    keywords: ['workflow automation', 'workflow automation software', 'business workflow automation', 'human workflow automation', 'approval workflow software'],
    updated: '2026-11-11',
    definition: 'Workflow automation is software that moves work through a repeatable process using triggers, rules and actions, handing steps to people when judgment is needed. UserTasks is an open-source (Apache-2.0) workflow automation platform that combines a visual workflow designer, forms, a task list for approvals, integrations and reports, and runs in the cloud or on your own servers.',
    intro: 'UserTasks is workflow automation software for operational processes that cannot be reduced to a single integration or approval. Model the full path from request to decision, system action, human work, escalation, and measurable outcome.',
    outcomes: ['Visual, event-driven workflow design', 'Human approvals, queues, SLAs, and escalation', 'REST, OData, database, webhook, and OAuth integrations', 'API, MCP and CLI for every operation, with log export to Splunk, Datadog, and OpenTelemetry', 'Cloud, private, or on-premises deployment path'],
    sections: [
      { title: 'Automate the entire operational process', body: 'A production workflow usually includes more than automated API calls. UserTasks keeps business rules, user tasks, generated documents, notifications, integrations, and system updates inside one traceable process.', points: ['Start from schedules, webhooks, data changes, task events, or API calls', 'Branch, loop, retry, pause, run parallel paths, or call reusable sub-workflows', 'Preserve variables, node outputs, errors, and execution history for every run', 'Create, update, publish, and monitor workflows from the usertasks CLI or CI pipelines'] },
      { title: 'Keep human work inside the automation', body: 'Route work to a person or team when judgment is required. Assignment, queue acceptance, due dates, outcomes, reminders, redirection, and escalation remain connected to the workflow that created the task.', points: ['Capture typed task fields and return them to the workflow', 'Use defined outcomes to control downstream workflow branches', 'Track workload and progress through My tasks (queued tasks included), the task tracker, and reports'] },
      { title: 'Connect systems without hiding governance', body: 'Reusable integration references turn external operations into governed building blocks. Credentials and OAuth tokens stay centralized while workflows and agents reuse the same operation definitions.', points: ['Generic REST and OData services plus database and service connectors', 'API key, bearer, basic, and OAuth 2.0 authentication', 'Redacted call logs, duration, status, caller context, and response diagnostics'] },
    ],
    steps: [
      { title: 'Choose a measurable process', body: 'Start with one process that has a clear trigger, owner, outcome, and current bottleneck.' },
      { title: 'Model decisions and exceptions', body: 'Map the normal route alongside rework, rejection, timeout, integration failure, and escalation paths.' },
      { title: 'Connect people and systems', body: 'Add reusable references, human tasks, decision tables, notifications, and data operations.' },
      { title: 'Publish, observe, and improve', body: 'Activate the workflow, review run evidence, measure throughput, and refine the process.' },
    ],
    faqs: [
      { question: 'What is workflow automation?', answer: 'Workflow automation uses triggers, rules, and actions to move work through a repeatable process. It coordinates system operations and human tasks while recording state, decisions, exceptions, and outcomes, so a request such as a purchase approval moves from submission to decision to system update without anyone chasing it by email.' },
      { question: 'Can UserTasks automate long-running processes?', answer: 'Yes. Workflows can pause for user tasks, events, schedules, reminders, and external callbacks for days or weeks while keeping their execution context and run history. Runs resume from a durable queue, and live instances can be migrated to a newer published version of the workflow when the process changes.' },
      { question: 'Can I monitor workflows in my existing log platform?', answer: 'Yes. Workflow runs, step logs, integration calls, task changes, and audit and security events form one event stream that UserTasks ships to Splunk HEC, Datadog Logs, any OpenTelemetry collector, or a signed webhook. Developers can also follow it live from a terminal with usertasks logs tail.' },
      { question: 'Can workflow automation run on premises?', answer: 'Yes. UserTasks is open source under Apache-2.0 and the self-hosted edition runs the same code as the cloud: on Docker Compose, on Kubernetes with the Helm chart, or in an air-gapped network from a signed offline bundle. Organizations choose it for infrastructure ownership, private networking and data-location control.' },
    ],
    links: [
      { href: '/open-source-workflow-engine', label: 'Open-source workflow engine' },
      { href: '/bpm-workflow-automation', label: 'BPM workflow automation' },
      { href: '/tasks-and-approvals', label: 'Tasks and approvals' },
      { href: '/docs/workflows', label: 'Workflow documentation' },
    ],
  },
  {
    slug: 'bpm-workflow-automation',
    related: { href: '/workflows', label: 'Explore the workflow designer', body: 'From process model to running workflow: control flow, business rules, human tasks, SLAs, testing with real forms and versioned change.' },
    eyebrow: 'Business process management',
    title: 'BPM workflow automation that turns process models into real work',
    metaTitle: 'BPM Software and Workflow Automation: Executable Process Models | UserTasks',
    description: 'Use UserTasks as a BPM and workflow automation platform for processes, business rules, human tasks, SLAs, integrations, and operational reporting with an API and MCP server.',
    keywords: ['BPM software', 'business process management', 'BPM workflow automation', 'open source BPM', 'process automation platform'],
    updated: '2026-11-11',
    definition: 'Business process management (BPM) is the practice of designing, running, measuring and improving end-to-end business processes. UserTasks is an open-source BPM and workflow automation platform: process models drawn in its visual designer are the executable workflows, with human tasks, decision tables, SLAs, integrations and reports attached to every run.',
    intro: 'Business process management is valuable when the designed process becomes an observable operating system rather than a diagram that drifts away from reality. UserTasks connects process design directly to runtime work, data, evidence, and improvement.',
    outcomes: ['Executable process models', 'Business rules and decision tables', 'Human task and SLA management', 'Process reporting and audit evidence'],
    sections: [
      { title: 'From process definition to execution', body: 'Model the trigger, activities, decisions, parallel work, exceptions, and completion criteria on a visual workflow canvas. Each published definition becomes an executable process with retained run history.', points: ['Reusable sub-workflows for shared process stages', 'Conditions and decision tables for transparent routing', 'Versioned assets and activation controls for governed change'] },
      { title: 'Human-centric BPM', body: 'BPM must coordinate the work that automation cannot complete alone. UserTasks creates accountable assignments with task fields, outcomes, notes, reminders, queues, and escalation.', points: ['Direct, team, role, and queue-based assignment patterns', 'Due dates, estimated completion, priority, and dependencies', 'Inbox, queue, tracker, and report views for operational teams'] },
      { title: 'Measure the process that actually ran', body: 'Runtime evidence supports process improvement. Analyze duration, status, node execution, errors, assignments, SLA state, integration calls, and business-rule results instead of relying only on the intended model.', points: ['Workflow run and node-level diagnostics', 'Task throughput, workload, and overdue work', 'Integration call, decision table, and agent run reporting', 'Every run and step exported to Splunk, Datadog, OpenTelemetry, or a webhook for alerting'] },
    ],
    steps: [
      { title: 'Define the process boundary', body: 'Document the trigger, final outcome, process owner, participating teams, and systems of record.' },
      { title: 'Separate rules from flow', body: 'Place frequently changing eligibility and routing logic in decision tables instead of burying it inside branches.' },
      { title: 'Design operational ownership', body: 'Define who receives work, how queues operate, when SLAs begin, and what escalation should do.' },
      { title: 'Establish improvement measures', body: 'Track completion time, rework, exceptions, wait time, integration failure, and outcome distribution.' },
    ],
    faqs: [
      { question: 'Is UserTasks a BPM platform?', answer: 'Yes. UserTasks provides executable process modeling, human tasks, business rules in decision tables, integrations, SLAs, operational data, and reporting: the core capabilities needed to manage and automate business processes. It is open source under Apache-2.0 and runs in the cloud or on your own servers.' },
      { question: 'How is BPM different from a simple automation?', answer: 'A simple automation connects a trigger to a few actions. BPM coordinates an end-to-end process with ownership, decisions, human work, exceptions, controls, and performance measurement, so the organization can see where requests wait, which rules sent them there, and how long each step really takes.' },
      { question: 'Does UserTasks run BPMN 2.0 diagrams?', answer: 'Not directly. UserTasks workflows are JSON definitions drawn on its own visual canvas rather than BPMN 2.0 XML. If you have diagrams from another tool, attach the BPMN 2.0 or draw.io file in the Agent panel and the Agent proposes a workflow from it, which you review and confirm.' },
      { question: 'Can business users participate without editing workflows?', answer: 'Yes. People work through forms, the task list, team queues and reports, or through your own applications via the API, while workflow and rule authoring stays permission controlled. Analysts can maintain decision tables without touching the workflow that calls them.' },
    ],
    links: [
      { href: '/open-source-workflow-engine', label: 'Open-source workflow engine' },
      { href: '/workflow-automation', label: 'Workflow automation' },
      { href: '/data-and-reports', label: 'Data and reports' },
      { href: '/docs/decision-tables', label: 'Decision tables (docs)' },
    ],
  },
  {
    slug: 'on-premises-workflow-automation',
    eyebrow: 'On-premises and air-gapped',
    title: 'On-premises workflow automation, self-hosted or air-gapped',
    metaTitle: 'On-Premises Workflow Automation: Self-Hosted and Air-Gapped | UserTasks',
    description: 'Self-hosted workflow automation you run on your own servers: Docker Compose, Kubernetes with a Helm chart, or an air-gapped network from a signed offline bundle. Forms, tasks, workflows and integrations, open source under Apache-2.0.',
    keywords: ['on-premises workflow automation', 'self-hosted workflow automation', 'air-gapped workflow', 'on-prem workflow engine', 'self-hosted BPM', 'workflow software on premises'],
    updated: '2026-11-12',
    definition: 'On-premises workflow automation means the workflow engine, its database, file storage, identity and logs all run on infrastructure your organization controls, rather than in a vendor’s cloud. UserTasks is open source (Apache-2.0) and its self-hosted edition is the same product as the cloud: forms, tasks, workflows, integrations and the optional AI Agent.',
    intro: 'Organizations with private networks, data-residency requirements, regulated workloads, or infrastructure ownership policies still need modern workflow automation. UserTasks runs in full inside your network — not as a connector gateway to someone else’s cloud — on Docker, on Kubernetes or with no internet access at all.',
    outcomes: ['Docker Compose or Kubernetes (Helm), same image', 'Air-gapped install from a signed offline bundle', 'PostgreSQL, MinIO, Keycloak or AD FS, LDAP, SMTP', 'Local AI models through Ollama or vLLM, or no AI'],
    sections: [
      { title: 'What runs inside your network', body: 'A self-hosted UserTasks installation is the application container, a worker, PostgreSQL 15 or later, S3-compatible storage and an SMTP relay. Everything else is optional and swappable: the same image runs on a laptop, a VM with Docker Compose, or a Kubernetes cluster.', points: ['PostgreSQL behind PgBouncer; Patroni, CloudNativePG and other operators work', 'Built-in sign-in, plus Keycloak, AD FS, Authentik and other OIDC or SAML providers, and LDAP / Active Directory directory sync', 'MinIO or another S3-compatible store, or local disk and NFS', 'Secrets in mounted files, HashiCorp Vault or OpenBao, with Vault Transit envelope encryption'] },
      { title: 'Air-gapped installs', body: 'For networks with no route to the internet, the air-gapped bundle carries everything needed offline: OCI images, the Helm chart, Docker Compose files, the CLI and SDK, the documentation and SPDX SBOMs. Every file is checksummed and the checksums are signed with ed25519.', points: ['Verify the bundle against the published key fingerprint before loading anything', 'Load images into Docker, or push them to an internal registry for Kubernetes', 'The on-premises reference profile runs on a network with no route out, and its smoke test checks the app cannot reach the internet', 'Optional AI on Ollama, vLLM or any OpenAI-compatible endpoint inside the network'] },
      { title: 'Connect internal systems directly', body: 'Keep workflow execution close to databases and services that are not exposed publicly. Reusable references give governed access to REST, OData, SQL databases, webhooks, storage and custom operations, with credentials held centrally.', points: ['Private DNS and network routes for internal endpoints', 'SQL Server, PostgreSQL, Oracle, MySQL and other database connectors', 'Call-level status, duration, redaction and caller attribution', 'Logs to syslog over TLS, Splunk HEC, an OpenTelemetry collector or a webhook to Fluent Bit or Vector'] },
    ],
    comparison: {
      title: 'Cloud, self-hosted and air-gapped compared',
      body: 'The same code and features in each case; what changes is who operates the platform and where its data lives.',
      columns: ['', 'UserTasks Cloud', 'Self-hosted or air-gapped'],
      rows: [
        ['Who operates it', 'The UserTasks team', 'Your team, on your servers or cloud account'],
        ['Where data lives', 'An isolated workspace in the UserTasks cloud', 'Your PostgreSQL database and your storage'],
        ['Internet access', 'Required', 'Optional: air-gapped installs need none'],
        ['How it runs', 'Managed service', 'Docker Compose or Kubernetes (Helm chart), same image'],
        ['AI Agent', 'Optional, on your provider key', 'Optional, on a local model (Ollama, vLLM) or your provider key'],
        ['Licence and price', 'Free during the beta', 'Apache-2.0, free to run'],
      ],
      note: 'Config as code moves workflows, forms and settings between the cloud and your own servers in either direction.',
    },
    steps: [
      { title: 'Classify requirements', body: 'Separate hard regulatory or network requirements from preferences so the target topology is explicit: connected, private or air-gapped.' },
      { title: 'Pick each service', body: 'Choose the database, sign-in, storage, email, secrets, KMS and log export from the supported options, or keep the defaults.' },
      { title: 'Install and smoke test', body: 'Start with Docker Compose or the Helm chart (or load the offline bundle), create the admin account on the /setup screen with the setup code from the server log, and run the smoke checks.' },
      { title: 'Prove a representative workflow', body: 'Build one process with internal integration calls, a form, approvals, generated documents and failure recovery, then plan upgrades, backups and monitoring.' },
    ],
    stepsTitle: 'From requirements to a running installation',
    faqs: [
      { question: 'Does UserTasks support on-premises deployment?', answer: 'Yes. The self-hosted edition is open source under Apache-2.0 and is the same product as the cloud edition. It runs on Docker Compose or on Kubernetes with the Helm chart, using PostgreSQL 15 or later, S3-compatible storage and an SMTP relay, inside a network your organization controls.' },
      { question: 'Can UserTasks run in an air-gapped network?', answer: 'Yes. The air-gapped bundle contains the container images, Helm chart, Compose files, CLI, SDK, documentation and SBOMs, with checksums signed with ed25519. Verify it, load the images into Docker or an internal registry, and start the on-premises profile. Nothing needs to reach the internet at install time or at runtime.' },
      { question: 'Can I use AI features without sending data outside?', answer: 'Yes. The Agent and AI workflow steps are optional and off until an administrator enables them. On premises they can use a local model served by Ollama, vLLM or any OpenAI-compatible endpoint inside your network, so prompts and documents never leave it. You can also leave AI switched off entirely.' },
      { question: 'Which identity providers work on premises?', answer: 'Built-in passwords work out of the box. Single sign-on works with OIDC or SAML providers such as Keycloak, AD FS, Authentik, Dex, Zitadel and Microsoft Entra ID, and users, groups and managers can be synchronized from LDAP or Active Directory, or provisioned over SCIM from an on-premises identity provider.' },
      { question: 'Is private cloud different from on premises?', answer: 'The operating model differs, but both give organization-controlled networking and data placement. UserTasks supports both: run it on AWS, Azure or Google Cloud with their managed databases and storage, or on your own hardware. The important decision is who owns each dependency and operational responsibility.' },
    ],
    related: { href: '/deploy-anywhere', label: 'See every deployment topology', body: 'Cloud, Supabase, AWS, Azure, Google Cloud, Kubernetes, on premises and air-gapped: what runs where, and how to move between them.' },
    links: [
      { href: '/docs/self-hosting/choose', label: 'Self-hosting guide: choose, install, set up' },
      { href: '/docs/self-hosting/install', label: 'Install step by step (Docker, Kubernetes, air-gapped)' },
      { href: '/docs/topologies/on-premises', label: 'On-premises and air-gapped topology (docs)' },
      { href: '/docs/self-hosting/air-gapped', label: 'Air-gapped install guide' },
      { href: '/open-source-workflow-engine', label: 'Open-source workflow engine' },
      { href: '/sharepoint-workflow-migration', label: 'SharePoint workflow migration' },
    ],
  },
  {
    slug: 'sharepoint-workflow-migration',
    eyebrow: 'SharePoint workflow migration',
    title: 'SharePoint workflow migration: replace 2010, 2013 and SharePoint Designer workflows',
    metaTitle: 'SharePoint Workflow Migration: Replace 2010, 2013 and Designer Workflows | UserTasks',
    description: 'Microsoft has retired SharePoint 2010 and 2013 workflows in SharePoint Online, and SharePoint Designer 2013 reached end of support on July 14, 2026. How to move approvals, list workflows, InfoPath forms and task lists to UserTasks, in the cloud or on premises.',
    keywords: ['SharePoint workflow migration', 'SharePoint 2013 workflow replacement', 'SharePoint 2010 workflow retirement', 'SharePoint Designer workflow alternative', 'Power Automate alternative', 'SharePoint approval workflow', 'SharePoint workflow on premises'],
    updated: '2026-11-11',
    definition: 'SharePoint workflow migration is the move of approvals, feedback rounds and list-driven processes built on the SharePoint 2010 and 2013 workflow engines, usually with SharePoint Designer, to a supported workflow platform. UserTasks is an open-source platform for that move: sites, lists and libraries stay in SharePoint, while workflows, forms and approval tasks move to UserTasks, in the cloud or on premises.',
    intro: 'The workflow engines behind many SharePoint sites are gone, and the tools used to build them are out of support. Rebuild the processes once, on a platform that also replaces the InfoPath forms and task lists that went with them — and keep SharePoint for content.',
    outcomes: ['Approvals with outcomes, SLAs and escalation', 'InfoPath forms imported from the .xsn', 'Lists and files read and written through Microsoft Graph', 'Self-hosted next to your farm, or in the cloud'],
    timeline: {
      title: 'What Microsoft has announced',
      body: 'Microsoft’s published dates for SharePoint Online (Microsoft 365) workflows and the related on-premises products. Microsoft recommends migrating to Power Automate or another supported workflow orchestration solution.',
      events: [
        { date: 'August 1, 2020', text: 'SharePoint 2010 workflows turned off for newly created tenants.' },
        { date: 'November 1, 2020', text: 'SharePoint 2010 workflows removed from existing tenants.' },
        { date: 'April 2, 2024', text: 'SharePoint 2013 workflows turned off for new tenants.' },
        { date: 'April 2, 2026', text: 'SharePoint 2013 workflows removed from existing tenants and fully retired in SharePoint Online.' },
        { date: 'July 14, 2026', text: 'SharePoint Designer 2013, SharePoint Server 2016, SharePoint Server 2019 and InfoPath 2013 reached end of support.' },
      ],
      sources: [MS_SHAREPOINT_2010, MS_SHAREPOINT_2013, MS_EOS_2026],
    },
    sections: [
      { title: 'What a SharePoint migration has to cover', body: 'A SharePoint “workflow” is rarely only a workflow. It is usually an InfoPath or list form that collects the request, a SharePoint Designer workflow that routes it, a task list where approvers respond, a history list, and the list or library the data lives in. Plan for all five, not just the routing.', points: ['Workflows: approvals, collect feedback, notifications and list-item updates', 'Forms: InfoPath templates and customized list forms', 'Tasks: workflow task lists and the emails that pointed to them', 'Data: lists and document libraries, which can stay where they are'] },
      { title: 'Power Automate or an alternative?', body: 'Power Automate is Microsoft’s recommended path and a natural fit if every process stays inside Microsoft 365. Teams look at alternatives when they need something else as well: an engine they can self-host or run air-gapped, forms and approvals in the same product, or workflow definitions they can review as code.', points: ['UserTasks is open source (Apache-2.0) and can run entirely on your own servers', 'Forms, workflows, a task list, data tables and reports in one product', 'An importer that rebuilds InfoPath .xsn templates as forms', 'Workflows as JSON, with a REST API, MCP server and CLI for every operation'] },
      { title: 'SharePoint Server farms on premises', body: 'Organizations still on SharePoint Server 2016 or 2019 face the July 14, 2026 end of support for the server, SharePoint Designer 2013 and InfoPath Forms Services together. UserTasks can be self-hosted inside the same network, so the processes move without moving to a public cloud.', points: ['Run UserTasks on Docker or Kubernetes next to the farm, or air-gapped', 'The SharePoint connector targets SharePoint Online through Microsoft Graph', 'For SharePoint Server, call its REST API with a generic REST reference where your farm accepts one of the supported sign-in methods, or move list data into UserTasks data tables', 'Sign in with AD FS or another SAML or OIDC provider, and sync users from Active Directory'] },
    ],
    comparison: {
      title: 'How SharePoint pieces map to UserTasks',
      body: 'Rebuild by pattern rather than action by action: most SharePoint Designer workflows are one of a handful of shapes.',
      columns: ['In SharePoint', 'In UserTasks'],
      rows: [
        ['Approval workflow (approve / reject)', 'A User Task with Approve and Reject outcomes, assigned to people or a team queue, with a due date, reminders and escalation'],
        ['Collect Feedback workflow', 'A User Task with comment fields assigned to several people; the run continues when they respond'],
        ['Workflow started when an item is created or changed', 'A schedule trigger with the SharePoint connector’s Get List Items, an inbound webhook, or a form submission'],
        ['SharePoint Designer conditions and lookups', 'Condition and Switch nodes, and decision tables for rules the business maintains'],
        ['Create / update list item', 'SharePoint connector: Create List Item and Update List Item, through Microsoft Graph'],
        ['Pause for duration / until date', 'Delay and Pause Until nodes, resumed from the durable queue'],
        ['InfoPath form', 'A UserTasks form, imported from the .xsn: each view a form, rules and validation converted where they translate'],
        ['Workflow task list', 'One task list (My tasks) with team queues, acting on behalf, mobile access and email notifications'],
        ['Workflow history list', 'Run history, a timeline on every request, audit trail and log export to Splunk, Datadog or OpenTelemetry'],
        ['Lists and document libraries', 'Stay in SharePoint, or move into UserTasks data tables with reports and an OData feed'],
      ],
    },
    steps: [
      { title: 'Inventory', body: 'Scan each site with Microsoft’s assessment tooling to list 2010 and 2013 workflows and InfoPath forms, with owners, volumes and the lists they touch.' },
      { title: 'Group by pattern', body: 'Sort workflows into approvals, feedback, notifications and list updates, and retire the ones nobody uses.' },
      { title: 'Import the forms', body: 'Upload each InfoPath .xsn to the importer; finish the rules it flags and point data connections at a data table or integration.' },
      { title: 'Rebuild one workflow per pattern', body: 'Connect the site once with the SharePoint connector, build a workflow per pattern and reuse it with different lists and rules.' },
      { title: 'Cut over by site', body: 'Run old and new side by side, check results against the list, then point users at the new forms and tasks and remove the old associations.' },
    ],
    stepsTitle: 'A five-step migration plan',
    faqs: [
      { question: 'Are SharePoint 2013 workflows still supported?', answer: 'No, not in SharePoint Online. Microsoft turned SharePoint 2013 workflows off for new tenants on April 2, 2024 and removed them from existing tenants on April 2, 2026. SharePoint 2010 workflows were removed in November 2020. On premises, SharePoint Server 2016 and 2019 reached end of support on July 14, 2026.' },
      { question: 'What replaces SharePoint Designer workflows?', answer: 'Microsoft recommends Power Automate or another supported workflow orchestration solution. UserTasks is one such option: an open-source platform where approvals become user tasks with outcomes and deadlines, Designer conditions become decision tables, and the SharePoint connector reads and writes list items and files through Microsoft Graph.' },
      { question: 'Is UserTasks an alternative to Power Automate?', answer: 'For SharePoint approvals, list workflows and forms, yes. Power Automate is Microsoft’s recommended path and fits processes that stay inside Microsoft 365. UserTasks suits teams that also want to self-host or run air-gapped, keep forms, approvals and workflows in one product, or manage workflows as code through an API and CLI.' },
      { question: 'Can UserTasks import SharePoint Designer workflows?', answer: 'No. SharePoint Designer workflows are rebuilt, usually by pattern. Most are approvals, feedback rounds, notifications or list updates, which map to a few reusable UserTasks workflows. InfoPath forms are different: the importer reads the .xsn template and rebuilds each view as a UserTasks form automatically.' },
      { question: 'Do my lists and documents have to leave SharePoint?', answer: 'No. Content can stay in SharePoint Online. UserTasks reads and writes list items, files and folders through the SharePoint connector, which uses a Microsoft Entra app registration with Microsoft Graph permissions; Sites.Selected limits it to the sites you grant. You can also move list data into UserTasks data tables.' },
      { question: 'Can UserTasks run on premises next to SharePoint Server?', answer: 'Yes. UserTasks is open source and self-hosts on Docker or Kubernetes, including air-gapped networks, so it can run in the same network as a SharePoint Server farm. Its built-in SharePoint connector targets SharePoint Online through Microsoft Graph; on-premises farms are reached through their REST API with a generic reference.' },
    ],
    related: { href: '/infopath', label: 'Try the InfoPath importer', body: 'Drop an .xsn on the page for a free, analyze-only preview: every view, field and rule, and what it becomes. Nothing is stored.' },
    links: [
      { href: '/use-cases/sharepoint-workflow-replacement', label: 'SharePoint workflow replacement architecture' },
      { href: '/infopath-migration-guide', label: 'InfoPath migration guide' },
      { href: '/on-premises-workflow-automation', label: 'On-premises workflow automation' },
      { href: '/use-cases/nintex-migration', label: 'Moving from Nintex' },
      { href: '/docs/integrations/connectors', label: 'Connectors, including SharePoint (docs)' },
    ],
    disclaimer: TRADEMARKS,
  },
  {
    slug: 'infopath-migration-guide',
    eyebrow: 'InfoPath migration guide',
    title: 'InfoPath migration guide: move InfoPath forms to a supported platform',
    metaTitle: 'InfoPath Migration Guide: InfoPath Replacement After End of Support | UserTasks',
    description: 'InfoPath 2013 and InfoPath Forms Services reached end of support on July 14, 2026. A step-by-step guide to replacing InfoPath forms: import the .xsn, finish rules and data connections, keep submissions, and run it in the cloud or on premises.',
    keywords: ['InfoPath migration', 'InfoPath replacement', 'InfoPath alternative', 'InfoPath end of support', 'InfoPath 2013 end of life', 'InfoPath Forms Services retirement', 'convert InfoPath forms', 'xsn to web form'],
    updated: '2026-11-11',
    definition: 'InfoPath migration is the work of moving forms built with Microsoft InfoPath — .xsn form templates with their views, rules, validation and data connections — to a supported form platform. UserTasks is an open-source forms and workflow platform with a built-in InfoPath importer that rebuilds each view of an .xsn as a form and lists anything that needs a person.',
    intro: 'Microsoft has ended support for InfoPath 2013 and removed InfoPath Forms Services from SharePoint Online. Forms that still do real work need a new home. This guide covers the decisions and the steps, from inventory to retiring the old form library.',
    outcomes: ['Free .xsn preview, no account, nothing stored', 'One form per view, or views as steps', 'Rules, validation and formulas converted where they translate', 'Submissions in a data table, with a workflow'],
    timeline: {
      title: 'The InfoPath end-of-support dates',
      body: 'From Microsoft’s announcements. Microsoft recommends Power Apps, Power Automate or Microsoft Forms as replacements and points to the Microsoft 365 Assessment tool for finding InfoPath usage.',
      events: [
        { date: 'June 2023', text: 'Microsoft announced that InfoPath Forms Services would be removed from SharePoint Online, aligned with the end of InfoPath 2013 extended support.' },
        { date: 'May 18, 2026', text: 'Publishing new InfoPath forms, or updates to existing forms, blocked in SharePoint Online.' },
        { date: 'July 14, 2026', text: 'InfoPath 2013 reached the end of extended support. InfoPath Forms Services removed from SharePoint Online, with no option to extend.' },
        { date: 'July 14, 2026', text: 'Extended support for InfoPath Forms Services in SharePoint Server 2016, 2019 and Subscription Edition ended.' },
      ],
      sources: [MS_INFOPATH_BLOG, MS_INFOPATH_LIFECYCLE, MS_EOS_2026],
    },
    sections: [
      { title: 'Choosing an InfoPath replacement', body: 'The right replacement depends on what the forms do. Simple surveys can move to almost any form tool. Business forms with repeating tables, calculations, conditional sections, validation and an approval process behind them need a platform that has all of those, and ideally one that can read the original template.', points: ['Repeating tables become Lists (editable tables with calculated columns), repeating sections become Repeating sections', 'Rules on load, change, button click and submit become form rules', 'The approval behind the form becomes a workflow with tasks', 'Submissions land in a data table you can report on'] },
      { title: 'What the importer converts, and what it doesn’t', body: 'The importer reads the template’s data source for field types and required fields, each view for controls, labels and layout, and the manifest for rules, validation and calculations. XPath conditions and formulas become UserTasks conditions and expression functions.', points: ['Converted: text, number, date, choice, check box, rich text, list box, people picker, bulleted list, hyperlink, picture and attachment controls; repeating tables (nested ones as nested Lists) and repeating sections; choice sections; layout tables; defaults; formulas; validation, including on repeating fields; most rules', 'Also converted: conditional formatting (colour, shading, bold, italic, underline, strikethrough) as styles in your theme, user roles as role conditions, and signature lines, ink and digital signatures as electronic signature fields', 'Kept as a turned-off rule with the original XPath: data connections until you point them at a data table or integration, and the few XPath forms with no equivalent, such as position() or a secondary data source (GetDOM)', 'Not converted: form code (JScript, C#) and signature certificates. Every item, converted or not, is in the downloadable import report'] },
      { title: 'Keep the data, retire the library', body: 'The importer converts the template, not past submissions. Keep the old form library read-only as an archive, or move the records you still need into the data table the importer can create, using a workflow that reads a CSV or Excel export.', points: ['Optional data table for submissions, with a child table per repeating table', 'A draft workflow that saves each submission, ready to publish', 'Reports, charts and an OData feed for Excel and Power BI over the submissions'] },
    ],
    comparison: {
      title: 'InfoPath concepts in UserTasks',
      body: 'The importer’s mapping for the most common parts of a form template. The full table is in the documentation.',
      columns: ['In InfoPath', 'In UserTasks'],
      rows: [
        ['Each view', 'A form of its own, or all views as steps of one form'],
        ['Text box, date picker, drop-down, option buttons, check box', 'Text, number, currency, date, single select, radio and yes / no fields, typed from the data source'],
        ['Repeating table', 'A List field: an editable table, with row arithmetic as calculated columns; a repeating table inside it becomes a nested List'],
        ['Repeating section', 'A Repeating section: a card per item with the same controls and layout'],
        ['Picture, signature line, ink picture', 'Image field, display image, electronic signature field'],
        ['Conditional formatting', 'Styles in your theme’s tones (colour, shading, bold, italic, underline, strikethrough), hide and read-only rules'],
        ['Section, optional section', 'Section and optional section, with show conditions'],
        ['“Cannot be blank”, patterns, ranges', 'Required, pattern, min / max and length checks, enforced on the server'],
        ['Rules on fields, buttons, load and submit', 'Form rules: set values, show messages, hide, make read-only, go to step'],
        ['Data connection to a SharePoint list or web service', 'A data table or API integration with the same name (re-import to wire up)'],
        ['Form library of submissions', 'A data table, with reports and an OData feed'],
      ],
    },
    steps: [
      { title: 'Inventory your forms', body: 'Run the Microsoft 365 Assessment tool or list the form libraries yourself. Note each form’s owner, usage, views and data connections, and retire the ones nobody uses.' },
      { title: 'Preview a template', body: 'Drop the .xsn on usertasks.com/infopath. The preview reads it in memory, shows every view, field and rule and what it becomes, and stores nothing.' },
      { title: 'Import it', body: 'In UserTasks go to Forms, then Import, then InfoPath form (.xsn). Choose one form per view or views as steps, and optionally a data table for submissions.' },
      { title: 'Finish what needs a person', body: 'Open the report’s Needs attention items. Turned-off rules carry the InfoPath rule name and original XPath in their notes; complete them in the Rules tab.' },
      { title: 'Wire up data connections', body: 'Create a data table or API integration with the connection’s name and import the file again: UserTasks offers to update the forms it made, and query rules then use it.' },
      { title: 'Publish and share', body: 'Publish the submission workflow, share the form link or embed it in a page, then make the old InfoPath library read-only.' },
    ],
    stepsTitle: 'How to migrate an InfoPath form',
    howTo: { name: 'How to migrate an InfoPath form to UserTasks', description: 'Import a Microsoft InfoPath form template (.xsn) into UserTasks, finish the parts that need a person, and retire the old form.', totalTime: 'PT30M' },
    faqs: [
      { question: 'When did InfoPath support end?', answer: 'InfoPath 2013 reached the end of extended support on July 14, 2026. On the same date Microsoft removed InfoPath Forms Services from SharePoint Online, with no option to extend, and extended support for InfoPath Forms Services in SharePoint Server 2016, 2019 and Subscription Edition ended. Publishing new forms in SharePoint Online was blocked from May 18, 2026.' },
      { question: 'What is the best replacement for InfoPath?', answer: 'It depends on the forms. Microsoft recommends Power Apps, Power Automate or Microsoft Forms. UserTasks suits business forms with repeating tables, rules and an approval process behind them: it imports the .xsn directly, keeps the workflow and task list in the same product, and can run on your own servers.' },
      { question: 'Can I convert an InfoPath .xsn automatically?', answer: 'Yes, largely. The UserTasks importer reads an .xsn from InfoPath 2007, 2010 or 2013 and rebuilds each view as a form, converting fields, repeating tables and sections (nested too), pictures, signatures, validation, defaults, formulas, conditional formatting and most rules. What it can’t convert is listed in a report and kept as a turned-off rule, never silently dropped.' },
      { question: 'What happens to forms that read a SharePoint list?', answer: 'Data connections don’t move by themselves. Create a data table, or an integration for the web service, with the same name as the connection, then import the file again: the query rules use it. Until then the import report says what each connection was for, and drop-downs it filled become text fields.' },
      { question: 'What happens to existing InfoPath submissions?', answer: 'The importer converts the form template, not past submissions. Keep the old form library as a read-only archive, or move the records you still need into the data table the importer creates, for example with a workflow that reads a CSV or Excel export. New submissions then land in that table.' },
      { question: 'Is the InfoPath importer free?', answer: 'Yes. The preview at usertasks.com/infopath is free, needs no account and stores nothing. The importer is part of UserTasks, which is open source under Apache-2.0: run it on your own servers at no cost, or use the cloud edition, which is free during the beta.' },
    ],
    related: { href: '/infopath', label: 'Try the InfoPath importer now', body: 'Drop an .xsn on the page and see every view, field and rule and what it becomes. Free, no account, nothing stored.' },
    links: [
      { href: '/infopath', label: 'InfoPath importer: free preview' },
      { href: '/docs/tasks/import-infopath', label: 'Import InfoPath forms (docs)' },
      { href: '/docs/tutorials/migrate-infopath', label: 'Tutorial: migrate an expense report' },
      { href: '/sharepoint-workflow-migration', label: 'SharePoint workflow migration' },
      { href: '/forms', label: 'The UserTasks form designer' },
    ],
    disclaimer: TRADEMARKS,
  },
  {
    slug: 'open-source-workflow-engine',
    eyebrow: 'Open-source workflow engine',
    title: 'An open-source workflow engine and BPM platform, licensed Apache-2.0',
    metaTitle: 'Open Source Workflow Engine and BPM Platform (Apache-2.0) | UserTasks',
    description: 'UserTasks is an open-source workflow engine with a visual designer, human tasks, forms, decision tables, integrations and reports, driven by a REST API, MCP server and CLI. Apache-2.0, self-hosted or in the cloud.',
    keywords: ['open source workflow engine', 'open source BPM', 'open source workflow automation', 'self-hosted workflow engine', 'headless workflow engine', 'Apache 2.0 workflow engine', 'workflow engine API'],
    updated: '2026-11-12',
    definition: 'An open-source workflow engine runs process definitions — triggers, steps, decisions, waits and human tasks — and publishes its source under an open-source licence. UserTasks is an open-source workflow engine and BPM platform licensed under Apache-2.0, with a visual designer, forms, a task list, decision tables, integrations and reports, all driven by a REST API, MCP server and CLI.',
    intro: 'Use UserTasks as a complete process platform, or headless behind your own applications. The cloud edition and the self-hosted edition run the same code, and config as code moves a workspace between them.',
    outcomes: ['Apache-2.0 licence, every feature included', 'Under 1 ms median workflow step time, measured on live runs', 'REST API (OpenAPI 3.1), MCP server, SDK and CLI', 'Cloud, Docker, Kubernetes or air-gapped'],
    sections: [
      { title: 'What the engine does', body: 'Workflows are versioned definitions drawn on a visual canvas and stored as JSON. Each published version runs from a durable queue, so long-running processes survive restarts and resume after waits, timers and callbacks.', points: ['Triggers: schedules, webhooks, data changes, task events, form submissions and API calls', 'Branches, parallel paths, loops, sub-workflows, retries and error paths', 'Immutable published versions, with live instance migration between them', 'Median time to run a workflow step under 1 ms, measured on live runs'] },
      { title: 'People, forms and rules in the same engine', body: 'Most processes stop for a person at some point. UserTasks treats that as a first-class step: the workflow creates a task with typed fields and outcomes, and continues on the outcome chosen.', points: ['Grid form designer with Lists, rules, lookups and file uploads', 'One task list with team queues, SLAs, reminders, escalation and acting on behalf', 'Decision tables for rules the business maintains', 'Data tables, saved reports and charts over tasks, runs and your own data'] },
      { title: 'Built for developers', body: 'Every screen is backed by the REST API, so anything people do in the app can be automated, tested and reviewed. Workflows, forms and settings are files you can diff and promote between environments.', points: ['REST API described by OpenAPI 3.1, with a TypeScript SDK', 'MCP server so AI clients can build and run processes', 'The usertasks CLI: workflows as files, config diff and apply, logs tail', 'Log export to Splunk, Datadog, OpenTelemetry and webhooks'] },
    ],
    comparison: {
      title: 'What “open source” covers',
      body: 'One codebase, two ways to run it.',
      columns: ['', 'Self-hosted (open source)', 'UserTasks Cloud'],
      rows: [
        ['Licence', 'Apache-2.0', 'Same code, operated by the UserTasks team'],
        ['Price', 'Free to run', 'Free during the beta'],
        ['Features', 'Everything: workflows, forms, tasks, data, reports, integrations, Agent', 'Everything'],
        ['Runs on', 'Docker Compose, Kubernetes (Helm), AWS, Azure, Google Cloud, your servers, air-gapped', 'Managed service'],
        ['Stack', 'TypeScript and Next.js, PostgreSQL 15+, S3-compatible storage', 'Managed'],
        ['Moving between them', 'Config as code: export, diff and apply', 'Config as code'],
      ],
    },
    steps: [
      { title: 'Start', body: 'Sign up for the cloud edition, or install it yourself with Docker and create the admin account on the /setup screen.' },
      { title: 'Build', body: 'Draw a workflow, add a form and an approval, or describe the process and let the Agent propose one.' },
      { title: 'Integrate', body: 'Connect systems with connectors, OpenAPI import or REST references, and call the engine from your own code.' },
      { title: 'Operate', body: 'Publish, watch runs and tasks, export logs, and promote changes between environments as code.' },
    ],
    stepsTitle: 'From first workflow to production',
    faqs: [
      { question: 'What is an open-source workflow engine?', answer: 'An open-source workflow engine is software that executes process definitions — triggers, steps, decisions, waits and human tasks — whose source code is published under an open-source licence. You can run it on your own infrastructure, inspect how it works, and extend it, without depending on a single vendor’s hosted service.' },
      { question: 'Is UserTasks really open source?', answer: 'Yes. UserTasks is licensed under Apache-2.0, a permissive licence that allows commercial use, modification and redistribution. The self-hosted edition includes every feature: workflows, forms, tasks, data tables, reports, integrations and the optional AI Agent. The cloud edition at usertasks.com runs the same code.' },
      { question: 'Is UserTasks a BPMN engine?', answer: 'No. UserTasks does not execute BPMN 2.0 XML. Workflows are JSON definitions drawn on its own visual canvas, with human tasks, decision tables, timers, sub-workflows and error paths. If you have BPMN 2.0 or draw.io diagrams, the Agent can read one and propose an equivalent workflow for you to review.' },
      { question: 'Can I embed UserTasks in my own application?', answer: 'Yes. UserTasks can run headless: your application starts workflows, lists and completes tasks, and reads reports through the REST API or the TypeScript SDK, while UserTasks handles routing, SLAs, escalation, audit and integrations. Forms can also be shared as links or embedded in your own pages.' },
      { question: 'What does UserTasks run on?', answer: 'UserTasks is a TypeScript and Next.js application backed by PostgreSQL 15 or later and S3-compatible storage. It runs on Docker Compose, on Kubernetes with the Helm chart, on AWS, Azure or Google Cloud, or air-gapped from a signed offline bundle. Supabase is the recommended starting platform.' },
      { question: 'Do I have to use AI?', answer: 'No. The Agent and AI workflow steps are optional and stay off until an administrator enables them with a provider key: OpenAI, Claude, Gemini, Grok, Azure OpenAI, Mistral, Groq, Ollama or any OpenAI-compatible model. The Agent proposes changes; people apply and confirm them.' },
    ],
    related: { href: '/workflows', label: 'See the workflow designer', body: 'Branches, parallel paths, loops, sub-workflows, decision tables, people, SLAs and error paths on one canvas — with Save & Test, versions and live migration.' },
    links: [
      { href: '/open-source', label: 'Why UserTasks is open source' },
      { href: '/bpm-workflow-automation', label: 'BPM workflow automation' },
      { href: '/on-premises-workflow-automation', label: 'On-premises and air-gapped' },
      { href: '/docs/api', label: 'API and MCP (docs)' },
      { href: '/docs/self-hosting/choose', label: 'Self-hosting guide' },
      { href: '/docs/quickstart/self-host', label: 'Self-host quickstart' },
    ],
  },
]

export function getSeoPage(slug: string) {
  return SEO_PAGES.find((page) => page.slug === slug)
}

/** Metadata for a solution or guide page (title, description, canonical, Open Graph, Twitter). */
export function seoPageMetadataInput(page: SeoPage) {
  return { path: `/${page.slug}`, title: page.metaTitle, description: page.description, socialTitle: page.title, keywords: page.keywords, type: 'article' as const }
}

/** The page's own JSON-LD nodes (the site-wide Organization / WebSite / SoftwareApplication come from the marketing layout). */
export function seoPageJsonLd(page: SeoPage, baseUrl: string) {
  const path = `/${page.slug}`
  return [
    webPageNode(baseUrl, path, { name: page.title, description: page.description, updated: page.updated }),
    breadcrumbNode(baseUrl, [{ name: page.eyebrow, path }]),
    faqNode(page.faqs),
    ...(page.howTo ? [howToNode(page.howTo.name, page.steps, { description: page.howTo.description, totalTime: page.howTo.totalTime })] : []),
  ]
}

