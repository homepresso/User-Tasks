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

export type ExtensionStatus = 'available' | 'coming-soon'

export type ExtensionId = 'sharepoint' | 'infrastructure' | 'processing'

export type Extension = {
  id: ExtensionId
  /** Short name: card title, breadcrumb, nav. */
  name: string
  /** Full product name, used in structured data. */
  productName: string
  /** Release status (the one field to flip). */
  status: ExtensionStatus
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
export const EXTENSIONS_UPDATED = '2026-11-23'

/** Shown on every coming-soon badge. */
export const STATUS_LABEL: Record<ExtensionStatus, string> = {
  available: 'Available',
  'coming-soon': 'Coming soon',
}

export const EXTENSIONS: Extension[] = [
  {
    id: 'sharepoint',
    name: 'SharePoint',
    productName: 'UserTasks SharePoint extension',
    status: 'available',
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
    status: 'coming-soon',
    href: '/extensions/infrastructure',
    tagline: 'Run each service of UserTasks on infrastructure you choose.',
    summary: 'Moves the database, sign-in, file storage, email, the scheduler and more off the standard single stack and onto your own or separate infrastructure, with a guided switch that copies the data and can roll back.',
    audience: 'Platform and infrastructure teams that must run UserTasks on approved databases, identity providers, storage and mail services, on premises or air-gapped.',
    capabilities: [
      'Database: move to your own or a separate PostgreSQL',
      'Sign-in: OIDC, SAML, Microsoft Entra ID, AD FS or built-in',
      'File storage: S3, Azure Blob Storage, Google Cloud Storage or local disk',
      'Email: SMTP, Microsoft 365 or Azure Communication Services',
      'Scheduler and more, each moved on its own',
      'A guided switch with data copy and rollback, and a log of every switch',
      'Supported in the setup wizard and the installers',
      'Works on premises and air-gapped',
    ],
    freeInCore: 'The standard single-stack install. Installs that already run with separated services keep running.',
    price: { amount: '$9,000', value: '9000', currency: 'USD', unit: 'per deployment, per year', unitText: 'deployment per year' },
    deployment: [
      { label: 'Self-hosted', detail: 'On your servers or cloud account, including on premises and air-gapped networks.' },
    ],
    page: {
      title: 'Infrastructure extension: run each UserTasks service on infrastructure you choose',
      metaTitle: 'Infrastructure Extension: Separate Database, Sign-in, Storage and Email | UserTasks',
      description: 'A paid UserTasks extension that moves the database, sign-in (OIDC, SAML, Entra ID, AD FS), file storage (S3, Azure Blob, GCS, local), email (SMTP, Microsoft 365, ACS) and the scheduler onto your own infrastructure, with a guided switch, data copy and rollback. $9,000 USD per deployment per year. Coming soon.',
      keywords: ['UserTasks infrastructure extension', 'self-hosted workflow separate database', 'workflow engine SAML OIDC AD FS', 'workflow S3 Azure Blob storage', 'air-gapped workflow infrastructure'],
    },
  },
  {
    id: 'processing',
    name: 'Processing',
    productName: 'UserTasks Processing extension',
    status: 'coming-soon',
    href: '/extensions/processing',
    tagline: 'Workflow, agent and media processing on separate, scalable runners.',
    summary: 'Runs workflow, agent and media processing on separate worker processes and runners instead of in the web app, so heavy work scales on its own and the web app stays responsive.',
    audience: 'Teams with high workflow volume, long-running agent or media work, or data-residency rules that keep processing on their own side.',
    capabilities: [
      'A continuous processor on separate worker processes and runners',
      'Wake-ups, so new work starts at once',
      'Backpressure, so runners take only what they can handle',
      'Graceful drain for deploys and scale-down',
      'Health checks and metrics for every runner',
      'Designer test runs on the workers',
      'UserTasks Cloud: host runners on your own side for data residency',
    ],
    freeInCore: 'Reliability: stuck-job recovery, leases and checkpoints.',
    price: { amount: '$2,500', value: '2500', currency: 'USD', unit: 'per deployment, per year', unitText: 'deployment per year' },
    deployment: [
      { label: 'Self-hosted', detail: 'Runners next to your UserTasks install, scaled as you need.' },
      { label: 'UserTasks Cloud', detail: 'Runners hosted on your side, so the data they process stays with you.' },
    ],
    page: {
      title: 'Processing extension: workflow, agent and media processing on separate runners',
      metaTitle: 'Processing Extension: Separate, Scalable Workflow Runners | UserTasks',
      description: 'A paid UserTasks extension that runs workflow, agent and media processing on separate, scalable worker processes and runners: a continuous processor, wake-ups, backpressure, graceful drain, health and metrics. Cloud customers can host runners on their side. $2,500 USD per deployment per year. Coming soon.',
      keywords: ['UserTasks processing extension', 'workflow runners', 'scalable workflow workers', 'remote workflow runners data residency', 'workflow engine worker processes'],
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
  title: 'Extensions: paid add-ons for SharePoint, infrastructure and processing',
  metaTitle: 'Extensions: SharePoint, Infrastructure and Processing Add-ons | UserTasks',
  description: 'UserTasks is open source (Apache-2.0). Three paid extensions add what some organizations need on top: SharePoint Server integration ($7,500 USD per farm per year), Infrastructure service separation ($9,000 USD per deployment per year, coming soon) and Processing on separate runners ($2,500 USD per deployment per year, coming soon).',
  definition: 'UserTasks extensions are paid add-ons to the open-source UserTasks core. The core, licensed Apache-2.0, is complete on its own; an extension adds a capability some organizations need, such as SharePoint Server integration, separated infrastructure or processing on separate runners. Each is licensed with a signed licence file that is checked offline, so extensions work on air-gapped networks.',
}

/** How licensing works, in one place (the page and /llms.txt). */
export const LICENSING_FACTS = [
  'The UserTasks core is open source under Apache-2.0 and free to run; extensions are the paid part.',
  'Each extension is licensed with a signed licence file that UserTasks verifies offline: no call home, so it works air-gapped.',
  'Prices are per year, in USD.',
  'Every paid extension ships in one image, UserTasks Enterprise, downloaded with any of your licences; each extension stays locked until its own licence is installed, so adding one later needs no reinstall. Without a licence it behaves like the open-source image.',
]

export const EXTENSIONS_FAQS: Array<{ question: string; answer: string }> = [
  { question: 'Is UserTasks free if extensions are paid?', answer: 'Yes. The UserTasks core is open source under Apache-2.0: workflows, forms, tasks, data tables, reports, integrations and the optional Agent, free to run on your own servers. Extensions are paid add-ons for specific needs: SharePoint Server integration, separated infrastructure and processing on separate runners.' },
  { question: 'Do extensions work on an air-gapped network?', answer: 'Yes. An extension licence is a signed file that UserTasks verifies offline, with no call home. Install it in Settings → Licence or with usertasks-admin licence install. For an air-gapped install, download an activation request (it holds no secrets), carry it to a connected computer, and carry the licence file back.' },
  { question: 'Which extensions are available today?', answer: `The SharePoint extension is available now, with a ${SHAREPOINT_TRIAL.days}-day free trial. The Infrastructure and Processing extensions are being finished and are coming soon; contact us if you would like early access or to be told when they ship.` },
  { question: 'What stays free without an extension?', answer: 'The SharePoint scanner and readiness report, the standard single-stack install (and installs that already run with separated services), and processing reliability: stuck-job recovery, leases and checkpoints. Everything else in the core is free too.' },
  { question: 'Do I need a different install for each extension?', answer: 'No. All paid extensions ship in one image, UserTasks Enterprise. Each one stays locked until its own licence is installed, so on the Enterprise edition adding an extension is just installing its licence in Settings → Licence: no reinstall, no new image. An install on the open-source image switches to Enterprise once, with one command that keeps its data (usertasks upgrade --edition enterprise).' },
  { question: 'How are extensions priced?', answer: 'Per year, in USD. SharePoint is $7,500 per SharePoint farm per year, including updates and support. Infrastructure is $9,000 and Processing is $2,500 per deployment per year.' },
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
    description: `${extension.summary}${available ? '' : ' Coming soon.'}`,
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
      ...(available ? {} : { description: 'Coming soon. Contact us for early access.' }),
    },
  }
}
