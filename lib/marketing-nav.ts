/**
 * The public site's navigation: the Product, Solutions and Resources mega
 * menus, the plain links, the mobile menu and the footer all read this one
 * list, so a page added here shows up everywhere. Pure data (icon names are
 * resolved in the client header) so server and client code can share it.
 */

/** Art for a Product tile: a small CSS illustration in components/marketing/nav-art.tsx. */
export type NavArtKind = 'workflows' | 'forms' | 'tasks' | 'agent' | 'data' | 'integrations'

export type NavIconName =
  | 'book' | 'graduation' | 'package' | 'sparkles' | 'server' | 'github' | 'terminal' | 'mail' | 'scale' | 'shield'
  | 'users' | 'wallet' | 'laptop' | 'building' | 'handshake' | 'briefcase' | 'inbox' | 'bot' | 'plug' | 'list' | 'files' | 'waves' | 'code'

export type ProductTile = { href: string; title: string; outcome: string; description: string; art: NavArtKind }
export type MenuItem = { href: string; title: string; description: string; icon: NavIconName; badge?: string; external?: boolean }

export const PRODUCT_TILES: ProductTile[] = [
  { href: '/workflows', title: 'Workflows', outcome: 'Processes you can actually see', description: 'Visual designer, process view and a timeline for every run.', art: 'workflows' },
  { href: '/forms', title: 'Forms', outcome: 'Forms that do the typing for you', description: 'Grid designer, Lists, rules and a wizard that writes the form.', art: 'forms' },
  { href: '/tasks-and-approvals', title: 'Tasks', outcome: 'Approvals that chase themselves', description: 'One inbox, approvals, queues, SLAs and acting on behalf.', art: 'tasks' },
  { href: '/ai-assistants', title: 'AI Agent', outcome: 'An Agent that asks before it acts', description: 'On every screen: builds from a process, works tasks with you.', art: 'agent' },
  { href: '/data-and-reports', title: 'Data & Reports', outcome: 'Numbers without the export', description: 'Data tables, saved reports, charts, OData and a reporting API.', art: 'data' },
  { href: '/connectors', title: 'Integrations & API', outcome: 'Systems that finally talk', description: 'Connectors, any REST API, MCP in both directions and a CLI.', art: 'integrations' },
]

/** Smaller Product links under the tiles. */
export const PRODUCT_MORE: MenuItem[] = [
  { href: '/documents', title: 'Documents', description: 'Read, redline, convert and redact files', icon: 'files' },
  { href: '/media', title: 'Images, audio & video', description: 'Transcribe, analyse and redact media', icon: 'waves' },
  { href: '/deploy-anywhere', title: 'Deploy anywhere', description: 'Cloud, Docker, Kubernetes, air-gapped', icon: 'server' },
]

/** The featured card in the Product menu (opens the homepage demo in Build mode). */
export const PRODUCT_FEATURE = { href: '/#demo-build', eyebrow: 'Interactive demo', title: 'Watch the Agent build an app', description: 'One sentence in, a table, two forms, a workflow and a report out.' }

export const SOLUTIONS_BY_USE_CASE: MenuItem[] = [
  { href: '/use-cases/approvals-and-compliance', title: 'Approvals & compliance', description: 'Sign-offs you can prove, with an audit trail', icon: 'shield' },
  { href: '/use-cases/contract-review-approval', title: 'Contract review', description: 'Redlines, approvals and e-signature', icon: 'handshake' },
  { href: '/use-cases/legal-request-intake', title: 'Legal front door', description: 'One intake for every legal request', icon: 'scale' },
  { href: '/use-cases/ai-agent-orchestration', title: 'AI with a person in the loop', description: 'Agents that stop for a human decision', icon: 'bot' },
  { href: '/use-cases/middleware-integration-hub', title: 'Integration hub', description: 'Webhooks in, APIs out, retries handled', icon: 'plug' },
  { href: '/sharepoint-workflow-migration', title: 'Replace SharePoint workflows', description: 'Move off retired 2010, 2013 and Designer workflows', icon: 'list' },
  { href: '/infopath', title: 'Migrate from InfoPath', description: 'Upload an .xsn, get working forms', icon: 'files', badge: 'New' },
]

/** By team: the gallery's ready-made packages, filtered by category. */
export const SOLUTIONS_BY_TEAM: MenuItem[] = [
  { href: '/gallery?category=hr-people', title: 'HR & onboarding', description: 'Onboarding, leave, offboarding, reviews', icon: 'users' },
  { href: '/gallery?category=finance', title: 'Finance & purchasing', description: 'Purchase requests, expenses, invoices', icon: 'wallet' },
  { href: '/gallery?category=it-security', title: 'IT requests', description: 'Access, equipment, incidents, changes', icon: 'laptop' },
  { href: '/gallery?category=operations-compliance', title: 'Operations', description: 'Contracts, audits, policies, suppliers', icon: 'building' },
  { href: '/gallery?category=customer-sales', title: 'Customer & sales', description: 'Quotes, discounts, complaints, KYC', icon: 'briefcase' },
]

export const RESOURCES: MenuItem[] = [
  { href: '/docs', title: 'Documentation', description: 'Every node, field, permission and command', icon: 'book' },
  { href: '/docs/tutorials', title: 'Tutorials', description: 'Your first form, approval and agent', icon: 'graduation' },
  { href: '/docs/tutorials/agent-build-from-process', title: 'Build with the Agent', description: 'From a process description to a working app', icon: 'sparkles', badge: 'New' },
  { href: '/gallery', title: 'Package gallery', description: 'Ready-made processes to install', icon: 'package' },
  { href: '/docs/api', title: 'API & MCP', description: 'REST, OData, MCP server and the SDK', icon: 'code' },
  { href: '/docs/cli', title: 'CLI', description: 'Every operation from your terminal', icon: 'terminal' },
  { href: '/deploy-anywhere', title: 'Self-hosting', description: 'Docker, Kubernetes, your cloud or air-gapped', icon: 'server' },
  { href: '/open-source', title: 'Open source', description: 'Apache-2.0: run it locally in minutes', icon: 'github' },
  { href: '/contact', title: 'Contact', description: 'Talk to the team about your process', icon: 'mail' },
]

/** Footer "Guides" column: migration guides, deployment and open source (lib/seo-pages.ts and the migration use cases). */
export const GUIDES: Array<{ href: string; label: string }> = [
  { href: '/sharepoint-workflow-migration', label: 'SharePoint workflow migration' },
  { href: '/infopath-migration-guide', label: 'InfoPath migration guide' },
  { href: '/use-cases/nintex-migration', label: 'Moving from Nintex' },
  { href: '/use-cases/k2-migration', label: 'Moving from K2' },
  { href: '/on-premises-workflow-automation', label: 'On-premises & air-gapped' },
  { href: '/docs/self-hosting/choose', label: 'Self-hosting guide' },
  { href: '/open-source-workflow-engine', label: 'Open-source workflow engine' },
  { href: '/workflow-automation', label: 'Workflow automation' },
  { href: '/bpm-workflow-automation', label: 'BPM' },
]

/** Where "Start free" goes: the cloud self-signup page (app/(marketing)/start). */
export const START_HREF = '/start'
/** Where "See a demo" goes: the interactive demo on the homepage. */
export const DEMO_HREF = '/#demo'

export const ANNOUNCEMENT = { label: 'New', text: 'The UserTasks Agent builds a whole process from one description.', href: '/#demo-build', cta: 'Watch it build' }
