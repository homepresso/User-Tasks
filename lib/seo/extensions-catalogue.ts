import { EXTENSIONS, extensionProductNode, type Extension, type ExtensionCategory, type ExtensionStatus } from '@/lib/seo/extensions'
import { CONSULTING, SUPPORT_PAGE, SUPPORT_PLANS, supportServiceNodes } from '@/lib/seo/support'

/**
 * The /extensions gallery: every card on the page, in one list. Software
 * extensions come from EXTENSIONS (lib/seo/extensions.ts), services (support
 * plans, consulting) from SERVICE_ITEMS below. Adding a card is one new
 * entry in either list; the grid, filters, search, structured data and
 * /llms.txt follow.
 *
 * Rules: prices in USD; no customers, logos, ratings or invented numbers; a
 * coming-soon item is never described as available.
 */

export type CatalogueIcon = 'server' | 'layers' | 'cpu' | 'lifebuoy' | 'headset' | 'puzzle'

export type CataloguePrice = {
  /** "$9,000" */
  amount: string
  /** Number as a string, for structured data. */
  value: string
  currency: 'USD'
  /** Short unit on the card: "/year", "/month", "/hour". */
  per: 'year' | 'month' | 'hour'
  /** "from $850/month" when the lowest of several prices. */
  from: boolean
  /** What one unit is: "per SharePoint farm". */
  detail?: string
}

export type CatalogueItem = {
  id: string
  name: string
  category: ExtensionCategory
  status: ExtensionStatus
  href: string
  icon: CatalogueIcon
  /** One line on the card. */
  summary: string
  /** null: priced on request ("Contact us"). */
  price: CataloguePrice | null
  /** Extra words the gallery search matches. */
  keywords: string[]
  /** Where the item comes from (structured data). */
  source: { kind: 'extension'; extension: Extension } | { kind: 'service'; nodeId: 'support' | 'consulting' }
}

export const EXTENSION_CATEGORIES: Array<{ id: ExtensionCategory; label: string; description: string }> = [
  { id: 'integrations', label: 'Integrations', description: 'Connect UserTasks to systems that need more than a connector.' },
  { id: 'platform', label: 'Platform add-ons', description: 'Run UserTasks on infrastructure and runners you choose.' },
  { id: 'services', label: 'Services', description: 'Support plans and consulting from the team that builds UserTasks.' },
]

const EXTENSION_ICONS: Partial<Record<string, CatalogueIcon>> = { sharepoint: 'server', infrastructure: 'layers', processing: 'cpu' }

/** "per SharePoint farm, per year" → "per SharePoint farm". */
function unitDetail(unit: string): string | undefined {
  const detail = unit.replace(/,?\s*per year$/i, '').trim()
  return detail && detail.toLowerCase() !== 'per year' ? detail : undefined
}

function extensionItem(extension: Extension): CatalogueItem {
  return {
    id: extension.id,
    name: extension.name,
    category: extension.category,
    status: extension.status,
    href: extension.href,
    icon: EXTENSION_ICONS[extension.id] ?? 'puzzle',
    summary: extension.tagline,
    price: { amount: extension.price.amount, value: extension.price.value, currency: 'USD', per: 'year', from: false, detail: unitDetail(extension.price.unit) },
    keywords: [extension.productName, extension.audience, ...extension.capabilities],
    source: { kind: 'extension', extension },
  }
}

const LOWEST_PLAN = SUPPORT_PLANS.filter((plan) => plan.price).sort((a, b) => Number(a.price!.value) - Number(b.price!.value))[0]!

/** Services: support plans and consulting. */
export const SERVICE_ITEMS: CatalogueItem[] = [
  {
    id: 'support',
    name: 'Support',
    category: 'services',
    status: 'available',
    href: SUPPORT_PAGE.path,
    icon: 'lifebuoy',
    summary: 'Monthly support plans: email support, and phone support when needed.',
    price: { amount: LOWEST_PLAN.price!.amount, value: LOWEST_PLAN.price!.value, currency: 'USD', per: 'month', from: true },
    keywords: ['support plans', 'help', 'email', 'phone', ...SUPPORT_PLANS.map((plan) => plan.name)],
    source: { kind: 'service', nodeId: 'support' },
  },
  {
    id: 'consulting',
    name: 'Consulting',
    category: 'services',
    status: 'available',
    href: `${SUPPORT_PAGE.path}#consulting`,
    icon: 'headset',
    summary: 'Consultants on hand for implementation, process design and migrations.',
    price: { amount: CONSULTING.rate.amount, value: CONSULTING.rate.value, currency: 'USD', per: 'hour', from: true },
    keywords: ['consultant', 'implementation', 'process design', 'migration', 'services'],
    source: { kind: 'service', nodeId: 'consulting' },
  },
]

/** Every card, in display order: integrations, platform add-ons, then services. */
export const CATALOGUE: CatalogueItem[] = EXTENSION_CATEGORIES.flatMap((category) => [...EXTENSIONS.map(extensionItem), ...SERVICE_ITEMS].filter((item) => item.category === category.id))

/** "$9,000/year", "from $850/month", "Contact us". */
export function priceLabel(item: Pick<CatalogueItem, 'price'>): string {
  if (!item.price) return 'Contact us'
  return `${item.price.from ? 'from ' : ''}${item.price.amount}/${item.price.per}`
}

/** Structured data for one card: the extension's Product, or the service's Service. */
export function catalogueItemNode(baseUrl: string, item: CatalogueItem): Record<string, unknown> {
  if (item.source.kind === 'extension') return extensionProductNode(baseUrl, item.source.extension)
  const id = `${baseUrl}${SUPPORT_PAGE.path}#${item.source.nodeId}`
  return supportServiceNodes(baseUrl).find((node) => node['@id'] === id)!
}
