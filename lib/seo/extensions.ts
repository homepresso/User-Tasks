import { SHAREPOINT_PRICE, SHAREPOINT_TRIAL } from '@/lib/seo/sharepoint-facts'

/**
 * The paid extensions, as the public site states them: /extensions, the
 * detail pages (/extensions/<slug>; SharePoint's is /sharepoint), the nav,
 * the sitemap and /llms.txt all read this one list.
 *
 * Release status is one field per extension: flip `status` from
 * 'coming-soon' to 'available' when an extension ships, and every badge,
 * call to action and structured-data offer follows. Nothing else changes.
 *
 * Rules: prices in USD; no customers, logos, ratings or invented numbers;
 * a coming-soon extension is never described as available.
 */

export type ExtensionStatus = 'available' | 'early-access' | 'coming-soon'

/** Gallery filter on /extensions (lib/seo/extensions-catalogue.ts lists the categories). */
export type ExtensionCategory = 'integrations' | 'platform' | 'services'

export type ExtensionId = 'sharepoint' | 'infrastructure' | 'processing'

export type Extension = {
  id: ExtensionId
  /** Short name: card title, breadcrumb, nav. */
  name: string
  /** Full product name, used in structured data. */
  productName: string
  /** Release status (the one field to flip). */
  status: ExtensionStatus
  /** Gallery category on /extensions. */
  category: ExtensionCategory
  /** Page with the details: /sharepoint for SharePoint, /extensions/<id> for the others. */
  href: string
  /** One line under the name. */
  tagline: string
  /** Two or three sentences: what it does. */
  summary: string
  /** Who it is for. */
  audience: string
  /** Key capabilities (card bullets; the detail page lists them all). */
  capabilities: string[]
  /** What stays free in the open-source core. */
  freeInCore: string
  price: { amount: string; value: string; currency: 'USD'; unit: string; unitText: string }
  /** Where it runs. */
  deployment: Array<{ label: string; detail: string }>
  /** Detail-page title (H1), meta title and description; unused for SharePoint, whose page has its own. */
  page: { title: string; metaTitle: string; description: string; keywords: string[] }
}

/** When the facts below were last reviewed (sitemap lastModified for the extension pages). */
export const EXTENSIONS_UPDATED = '2026-11-25'

/** Shown on every coming-soon badge. */
export const STATUS_LABEL: Record<ExtensionStatus, string> = {
  available: 'Available',
  'early-access': 'Early access',
  'coming-soon': 'Coming soon',
}

export const EXTENSIONS: Extension[] = [
  {
    id: 'sharepoint',
    name: 'SharePoint',
    productName: 'UserTasks SharePoint extension',
    status: 'available',
    category: 'integrations',
    href: '/sharepoint',
    tagline: 'Forms, workflows and migration for SharePoint Server on premises.',
    summary: 'Replaces SharePoint 2010 and 2013 workflows and InfoPath forms inside SharePoint Server 2016, 2019 and Subscription Edition lists and libraries, before Microsoft removes SharePoint 2010 workflows and InfoPath Forms Services from Subscription Edition in the July 13, 2027 update.',
    audience: 'SharePoint Server teams with SharePoint Designer 2010 workflows, InfoPath forms or Nintex workflows to move.',
    capabilities: [
      'The SharePoint Server connector: the SharePoint REST API as workflow steps',
      'A provider-hosted add-in with a UserTasks button on lists and libraries',
      'Workflows triggered by list and library events, and generated list forms embedded in SharePoint',
      'Importers for SharePoint Designer 2010 workflows and InfoPath list forms, and Nintex workflows with SharePoint steps (preview)',
      'Migration tooling: a scan of your sites and a dashboard per list',
    ],
    freeInCore: 'The SharePoint scanner and readiness report, and the InfoPath (.xsn) and Nintex importers for UserTasks forms and workflows.',
    price: { amount: SHAREPOINT_PRICE.amount, value: SHAREPOINT_PRICE.value, currency: 'USD', unit: SHAREPOINT_PRICE.unit, unitText: 'SharePoint farm per year' },
    deployment: [
      { label: 'Self-hosted', detail: 'Next to the farm with Docker or Kubernetes, or air-gapped. Production-ready.' },
      { label: 'UserTasks Cloud', detail: 'Through an outbound-only gateway. In beta.' },
    ],
    page: { title: '', metaTitle: '', description: '', keywords: [] },
  },
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    productName: 'UserTasks Infrastructure extension',
    status: 'early-access',
    category: 'platform',
    href: '/extensions/infrastructure',
    tagline: 'Run each service of UserTasks on infrastructure you choose.',
    summary: 'Moves the database, sign-in, file storage, email, the scheduler and more off the standard single stack and onto your own or separate infrastructure, with a guided switch that copies the data and can roll back. For self-hosted UserTasks.',
    audience: 'Platform and infrastructure teams that must run self-hosted UserTasks on approved databases, identity providers, storage and mail services, on premises or air-gapped.',
    capabilities: [
      'Database: move to your own or a managed PostgreSQL 15+ (password or Entra ID, Cloud SQL IAM and RDS IAM token sign-in)',
      'Sign-in: move from Supabase Auth to built-in accounts with password hashes kept, or make sign-in SSO-only (OIDC, SAML)',
      'File storage: S3 and S3-compatible (MinIO, Ceph, R2), Azure Blob Storage, Google Cloud Storage or a local folder',
      'Email through an API: Amazon SES, Azure Communication Services, Microsoft Graph or the Gmail API',
      'Background jobs, live updates, secret store (HashiCorp Vault, Azure Key Vault, Google Secret Manager, AWS Secrets Manager), cache (Redis) and key management (Vault Transit, AWS KMS, Azure Key Vault, Google Cloud KMS), each moved on its own',
      'A guided switch: connection test, plan, backup, data copy with verification, a switch log and rollback',
      'In the setup wizard, Settings → Infrastructure, usertasks-admin switch and the installers',
      'Works on premises and air-gapped',
    ],
    freeInCore: 'The standard single-stack install, email over SMTP and identity providers on built-in sign-in. Installs that already run with separated services keep running.',
    price: { amount: '$9,000', value: '9000', currency: 'USD', unit: 'per deployment, per year', unitText: 'deployment per year' },
    deployment: [
      { label: 'Self-hosted', detail: 'The Enterprise edition on your servers or cloud account, including on premises and air-gapped networks. Not offered for usertasks.com cloud workspaces.' },
    ],
    page: {
      title: 'Infrastructure add-on: run each UserTasks service on infrastructure you choose',
      metaTitle: 'Infrastructure Add-on: Your Own Database, Storage, Sign-in and Email | UserTasks',
      description: 'A paid add-on for self-hosted UserTasks that moves the database, sign-in, file storage (S3, Azure Blob, GCS), email APIs, secrets, cache and the scheduler onto your own infrastructure, with a tested plan, verified data copy, switch log and rollback. $9,000 USD per deployment per year. Early access.',
      keywords: ['UserTasks infrastructure add-on', 'self-hosted workflow separate database', 'workflow engine SAML OIDC AD FS', 'workflow S3 Azure Blob storage', 'air-gapped workflow infrastructure'],
    },
  },
  {
    id: 'processing',
    name: 'Processing',
    productName: 'UserTasks Processing extension',
    status: 'early-access',
    category: 'platform',
    href: '/extensions/processing',
    tagline: 'Workflow, agent and media processing on separate, scalable workers.',
    summary: 'Runs workflow, agent and media processing on separate worker processes instead of in the web app, so heavy work scales on its own and the web app stays responsive. For self-hosted UserTasks.',
    audience: 'Self-hosted teams with high workflow volume or long-running agent and media work that should scale apart from the web app.',
    capabilities: [
      'A continuous processor on separate worker processes',
      'Wake-ups, so new work starts at once',
      'Backpressure, so each worker takes only what it can handle',
      'Graceful drain for deploys and scale-down',
      'Health checks and Prometheus metrics for every worker',
      'Designer test runs on the workers (optional)',
      'Workers on the same or separate machines of your deployment: Docker Compose or Kubernetes (HPA, KEDA)',
    ],
    freeInCore: 'Reliability: stuck-job recovery, leases and checkpoints.',
    price: { amount: '$2,500', value: '2500', currency: 'USD', unit: 'per deployment, per year', unitText: 'deployment per year' },
    deployment: [
      { label: 'Self-hosted', detail: 'The Enterprise edition: workers next to your UserTasks install or on other machines of your deployment, scaled as you need. Not offered for usertasks.com cloud workspaces.' },
    ],
    page: {
      title: 'Processing add-on: workflow, agent and media processing on separate workers',
      metaTitle: 'Processing Add-on: Separate, Scalable Workflow Workers | UserTasks',
      description: 'A paid add-on for self-hosted UserTasks that runs workflow, agent and media processing on separate, scalable worker processes: a continuous processor, wake-ups, backpressure, graceful drain, health checks and Prometheus metrics. $2,500 USD per deployment per year. Early access.',
      keywords: ['UserTasks processing add-on', 'workflow workers', 'scalable workflow workers', 'self-hosted workflow engine workers', 'workflow engine worker processes Kubernetes'],
    },
  },
]

export function extensionById(id: ExtensionId): Extension {
  return EXTENSIONS.find((extension) => extension.id === id)!
}

/** The extensions with their own page under /extensions (SharePoint keeps /sharepoint). */
export const EXTENSION_DETAIL_IDS = ['infrastructure', 'processing'] as const satisfies readonly ExtensionId[]

export const EXTENSIONS_PAGE = {
  path: '/extensions',
  eyebrow: 'Extensions',
  title: 'Extensions: paid add-ons, integrations and support for UserTasks',
  metaTitle: 'Extensions: SharePoint, Infrastructure, Processing, Support and Consulting | UserTasks',
  description: 'UserTasks is open source (Apache-2.0). Paid extensions add what some organizations need on top: SharePoint Server integration ($7,500 USD per farm per year), Infrastructure ($9,000 USD per deployment per year) and Processing ($2,500 USD per deployment per year) in early access for self-hosted installs, support plans from $850 USD per month and consulting from $250 USD per hour.',
  definition: 'UserTasks extensions are paid add-ons to the open-source UserTasks core. The core, licensed Apache-2.0, is complete on its own; an extension adds a capability some organizations need, such as SharePoint Server integration, separated infrastructure or processing on separate runners. Each is licensed with a signed licence file that is checked offline, so extensions work on air-gapped networks.',
}

/** How licensing works, in one place (the page and /llms.txt). */
export const LICENSING_FACTS = [
  'The UserTasks core is open source under Apache-2.0 and free to run; extensions are the paid part.',
  'Each extension is licensed with a signed licence file that UserTasks verifies offline: no call home, so it works air-gapped.',
  'Extension licences are priced per year, in USD.',
  'Every paid extension ships in one image, UserTasks Enterprise, downloaded with any of your licences; each extension stays locked until its own licence is installed, so adding one later needs no reinstall. Without a licence it behaves like the open-source image.',
]

export const EXTENSIONS_FAQS: Array<{ question: string; answer: string }> = [
  { question: 'Is UserTasks free if extensions are paid?', answer: 'Yes. The UserTasks core is open source under Apache-2.0: workflows, forms, tasks, data tables, reports, integrations and the optional Agent, free to run on your own servers. Extensions are paid add-ons for specific needs: SharePoint Server integration, separated infrastructure and processing on separate runners.' },
  { question: 'Do extensions work on an air-gapped network?', answer: 'Yes. An extension licence is a signed file that UserTasks verifies offline, with no call home. Install it in Settings → Licence or with usertasks-admin licence install. For an air-gapped install, download an activation request (it holds no secrets), carry it to a connected computer, and carry the licence file back.' },
  { question: 'Which extensions are available today?', answer: `The SharePoint extension is available now, with a ${SHAREPOINT_TRIAL.days}-day free trial. The Infrastructure and Processing add-ons are in early access for self-hosted installs while the Enterprise edition is prepared for release; contact us to request early access.` },
  { question: 'What stays free without an extension?', answer: 'The SharePoint scanner and readiness report, the standard single-stack install (and installs that already run with separated services), and processing reliability: stuck-job recovery, leases and checkpoints. Everything else in the core is free too.' },
  { question: 'Do I need a different install for each extension?', answer: 'No. All paid extensions ship in one image, UserTasks Enterprise. Each one stays locked until its own licence is installed, so on the Enterprise edition adding an extension is just installing its licence in Settings → Licence: no reinstall, no new image. An install on the open-source image switches to Enterprise once, with one command that keeps its data (usertasks upgrade --edition enterprise).' },
  { question: 'How are extensions priced?', answer: 'Per year, in USD. SharePoint is $7,500 per SharePoint farm per year, including updates and support. Infrastructure is $9,000 and Processing is $2,500 per deployment per year.' },
  { question: 'Can I buy support or consulting?', answer: 'Yes. Support plans are monthly, in USD: SMB $850, Mid-market $1,500 and Enterprise $2,500 per month; public sector plans are quoted on request. Every plan includes email support, and phone support when needed. Consultants are on hand from $250 USD per hour.' },
]

/**
 * Structured data for one extension: a Product (and SoftwareApplication) with
 * a USD Offer. A coming-soon extension's offer is a PreOrder with no claim
 * that it can be bought or downloaded today.
 */
export function extensionProductNode(baseUrl: string, extension: Extension): Record<string, unknown> {
  const available = extension.status === 'available'
  return {
    '@type': ['Product', 'SoftwareApplication'],
    '@id': `${baseUrl}${extension.href}#extension`,
    name: extension.productName,
    description: `${extension.summary}${available ? '' : ` ${STATUS_LABEL[extension.status]}.`}`,
    url: `${baseUrl}${extension.href}`,
    applicationCategory: 'BusinessApplication',
    brand: { '@id': `${baseUrl}/#organization` },
    isRelatedTo: { '@id': `${baseUrl}/#software` },
    offers: {
      '@type': 'Offer',
      price: extension.price.value,
      priceCurrency: extension.price.currency,
      url: available ? `${baseUrl}${extension.href}` : `${baseUrl}/contact`,
      availability: available ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: extension.price.value, priceCurrency: extension.price.currency, unitText: extension.price.unitText, billingDuration: 'P1Y' },
      ...(available ? {} : { description: `${STATUS_LABEL[extension.status]}: not yet available to buy or download. Contact us for early access.` }),
    },
  }
}
