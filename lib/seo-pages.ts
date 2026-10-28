export type SeoPage = {
  slug: string
  eyebrow: string
  title: string
  description: string
  intro: string
  outcomes: string[]
  sections: Array<{ title: string; body: string; points: string[] }>
  steps: Array<{ title: string; body: string }>
  faqs: Array<{ question: string; answer: string }>
}

export const SEO_PAGES: SeoPage[] = [
  {
    slug: 'workflow-automation',
    eyebrow: 'Workflow automation platform',
    title: 'Workflow automation for people, systems, data, and AI',
    description: 'Build governed workflow automation with visual orchestration, human tasks, integrations, decision tables, document generation, an API, MCP server and CLI, log export, and optional AI agents.',
    intro: 'UserTasks is workflow automation software for operational processes that cannot be reduced to a single integration or approval. Model the full path from request to decision, system action, human work, escalation, and measurable outcome.',
    outcomes: ['Visual, event-driven workflow design', 'Human approvals, queues, SLAs, and escalation', 'REST, OData, database, webhook, and OAuth integrations', 'API, MCP and CLI for every operation, with log export to Splunk, Datadog, and OpenTelemetry', 'Cloud, private, or on-premises deployment path'],
    sections: [
      { title: 'Automate the entire operational process', body: 'A production workflow usually includes more than automated API calls. UserTasks keeps business rules, user tasks, generated documents, notifications, integrations, and system updates inside one traceable process.', points: ['Start from schedules, webhooks, data changes, task events, or API calls', 'Branch, loop, retry, pause, run parallel paths, or call reusable sub-workflows', 'Preserve variables, node outputs, errors, and execution history for every run', 'Create, update, publish, and monitor workflows from the usertasks CLI or CI pipelines'] },
      { title: 'Keep human work inside the automation', body: 'Route work to a person or team when judgment is required. Assignment, queue acceptance, due dates, outcomes, reminders, redirection, and escalation remain connected to the workflow that created the task.', points: ['Capture typed task fields and return them to the workflow', 'Use defined outcomes to control downstream workflow branches', 'Track workload and progress through task queues, the task tracker, and reports'] },
      { title: 'Connect systems without hiding governance', body: 'Reusable integration references turn external operations into governed building blocks. Credentials and OAuth tokens stay centralized while workflows and agents reuse the same operation definitions.', points: ['Generic REST and OData services plus database and service connectors', 'API key, bearer, basic, and OAuth 2.0 authentication', 'Redacted call logs, duration, status, caller context, and response diagnostics'] },
    ],
    steps: [
      { title: 'Choose a measurable process', body: 'Start with one process that has a clear trigger, owner, outcome, and current bottleneck.' },
      { title: 'Model decisions and exceptions', body: 'Map the normal route alongside rework, rejection, timeout, integration failure, and escalation paths.' },
      { title: 'Connect people and systems', body: 'Add reusable references, human tasks, decision tables, notifications, and data operations.' },
      { title: 'Publish, observe, and improve', body: 'Activate the workflow, review run evidence, measure throughput, and refine the process.' },
    ],
    faqs: [
      { question: 'What is workflow automation?', answer: 'Workflow automation uses triggers, rules, and actions to move work through a repeatable process. It can coordinate system operations and human tasks while recording state, decisions, exceptions, and outcomes.' },
      { question: 'Can UserTasks automate long-running processes?', answer: 'Yes. Workflows can pause for user tasks, events, schedules, reminders, and external callbacks while retaining execution context and run history.' },
      { question: 'Can I monitor workflows in my existing log platform?', answer: 'Yes. Workflow runs, step logs, integration calls, task changes, and audit and security events form one event stream that UserTasks ships to Splunk HEC, Datadog Logs, any OpenTelemetry collector, or a signed webhook. Developers can also follow it live with usertasks logs tail.' },
      { question: 'Can workflow automation run on premises?', answer: 'UserTasks supports a managed cloud path and a private or on-premises deployment path for organizations that require infrastructure ownership, private networking, or specific data-location controls.' },
    ],
  },
  {
    slug: 'bpm-workflow-automation',
    eyebrow: 'Business process management',
    title: 'BPM workflow automation that turns process models into real work',
    description: 'Use UserTasks as a BPM and workflow automation platform for processes, business rules, human tasks, SLAs, integrations, and operational reporting with an API and MCP server.',
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
      { question: 'Is UserTasks a BPM platform?', answer: 'UserTasks provides executable workflow modeling, human tasks, business rules, integrations, SLAs, operational data, and reporting—the core capabilities needed to manage and automate business processes.' },
      { question: 'How is BPM different from a simple automation?', answer: 'A simple automation usually connects a trigger to a few actions. BPM coordinates an end-to-end process with ownership, decisions, human work, exceptions, controls, and performance measurement.' },
      { question: 'Can business users participate without editing workflows?', answer: 'Yes. Users work through task inboxes, queues, and reports — or through your own applications via the API — while workflow and rule authoring remains permission controlled.' },
    ],
  },
  {
    slug: 'on-premises-workflow-automation',
    eyebrow: 'Private and on-premises automation',
    title: 'On-premises workflow automation with modern orchestration',
    description: 'Deploy workflow automation in your own environment with private connectivity, human tasks, integrations, governance, audit history, and AI controls. The engine is open source under Apache-2.0.',
    intro: 'Organizations with private networks, data-residency requirements, regulated workloads, or infrastructure ownership policies still need modern workflow automation. The self-hosted edition of UserTasks is open source, so the full workflow engine runs in an organization-controlled environment rather than as a reduced connector gateway.',
    outcomes: ['Organization-controlled deployment', 'Private access to internal systems', 'Tenant, role, and object-level governance', 'Operational logs and retained workflow evidence'],
    sections: [
      { title: 'What on-premises should mean', body: 'A credible on-premises automation plan covers the application runtime, database, object storage, identity, secrets, background workers, outbound connectivity, monitoring, backup, and upgrade ownership—not only where workflow definitions are stored.', points: ['Define network zones and permitted ingress and egress', 'Choose identity, SMTP, storage, database, and secret-management integrations', 'Establish backup, recovery, observability, patching, and upgrade responsibilities', 'Ship workflow, audit, and security events to an internal Splunk, Datadog, or OpenTelemetry collector'] },
      { title: 'Connect internal systems directly', body: 'Keep workflow execution close to databases and services that are not exposed publicly. Reusable references allow governed access to REST, OData, databases, webhooks, storage, and custom operations.', points: ['Private DNS and network routes for internal endpoints', 'Central encrypted credentials and refreshable OAuth tokens', 'Call-level status, duration, redaction, and caller attribution'] },
      { title: 'Retain cloud-grade product capabilities', body: 'Deployment control should not force teams back to scripts. Designers still use visual workflows, human tasks, decision tables, document generation, reports, APIs, and governed AI agents.', points: ['Human-in-the-loop workflow and SLA management', 'Headless API access for your own internal applications', 'API, OAuth, MCP, CLI, audit, retention, and reporting capabilities'] },
    ],
    steps: [
      { title: 'Classify requirements', body: 'Separate hard regulatory or network requirements from preferences so the target architecture is explicit.' },
      { title: 'Design the platform boundary', body: 'Map identity, DNS, TLS, database, storage, email, secrets, workers, monitoring, backup, and external dependencies.' },
      { title: 'Prove a representative workflow', body: 'Test a process containing internal integration calls, human work, generated documents, notifications, and failure recovery.' },
      { title: 'Plan operations before migration', body: 'Assign ownership for upgrades, capacity, incident response, recovery tests, security reviews, and support.' },
    ],
    faqs: [
      { question: 'Does UserTasks support on-premises deployment?', answer: 'Yes. The self-hosted edition is open source under Apache-2.0 and suits organizations that require control of infrastructure, networking, and data location. The final topology is planned around the organization’s operating and security requirements.' },
      { question: 'Can an on-premises deployment call cloud services?', answer: 'Yes, when network policy permits it. Outbound integrations can be restricted to approved services, while internal references can remain private.' },
      { question: 'Is private cloud different from on premises?', answer: 'The operating model can differ, but both can provide organization-controlled networking and data placement. The important decision is who owns each platform dependency and operational responsibility.' },
    ],
  },
]

export function getSeoPage(slug: string) {
  return SEO_PAGES.find((page) => page.slug === slug)
}
