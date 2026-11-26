/**
 * Paid support and consulting, as the public site states them: /support,
 * the nav, the sitemap and /llms.txt all read this one file.
 *
 * Rules: prices in USD, per month for plans and per hour for consulting.
 * State only what the owner has given: the four plans and their prices,
 * email support with phone support when needed, and consultants from
 * $250 an hour. No response times, SLAs, uptime, coverage hours, named
 * contacts, seat limits, customers, logos or testimonials.
 */

export type SupportPlanId = 'smb' | 'mid-market' | 'enterprise' | 'public-sector'

export type SupportPlan = {
  id: SupportPlanId
  name: string
  /** Monthly price in USD; null when it is quoted on request (public sector). */
  price: { amount: string; value: string; currency: 'USD'; unit: string } | null
  /** Call-to-action label; every plan's goes to /contact. */
  cta: string
}

/** When the facts below were last reviewed (sitemap lastModified). */
export const SUPPORT_UPDATED = '2026-11-23'

export const SUPPORT_CONTACT_HREF = '/contact'

export const SUPPORT_PLANS: SupportPlan[] = [
  { id: 'smb', name: 'SMB', price: { amount: '$850', value: '850', currency: 'USD', unit: 'per month' }, cta: 'Talk to us' },
  { id: 'mid-market', name: 'Mid-market', price: { amount: '$1,500', value: '1500', currency: 'USD', unit: 'per month' }, cta: 'Talk to us' },
  { id: 'enterprise', name: 'Enterprise', price: { amount: '$2,500', value: '2500', currency: 'USD', unit: 'per month' }, cta: 'Talk to us' },
  { id: 'public-sector', name: 'Public sector', price: null, cta: 'Contact us' },
]

/** What every plan includes. */
export const SUPPORT_INCLUDES: Array<{ title: string; body: string }> = [
  { title: 'Email support', body: 'Write to the team that builds UserTasks about your installation, your processes or a problem you have hit.' },
  { title: 'Phone support when needed', body: 'When a conversation is quicker than an email thread, we can talk it through with you by phone.' },
]

export const CONSULTING = {
  rate: { amount: '$250', value: '250', currency: 'USD' as const, unit: 'per hour' },
  summary: 'Consultants are on hand for hands-on help with UserTasks, starting at $250 USD per hour.',
  areas: [
    'Implementation: setting up UserTasks and your first processes',
    'Process design: turning the way you work into forms, workflows and tasks',
    'Migrations: moving processes from other workflow tools',
  ],
}

export const SUPPORT_PAGE = {
  path: '/extensions/support',
  eyebrow: 'Support',
  title: 'Support plans and consulting for UserTasks',
  metaTitle: 'Support Plans and Consulting: SMB, Mid-market, Enterprise, Public Sector | UserTasks',
  description: 'Paid UserTasks support plans, priced per month in USD: SMB $850, Mid-market $1,500 and Enterprise $2,500 per month; public sector on request. Email support, and phone support when needed. Consultants from $250 USD per hour.',
  definition: 'UserTasks support is an optional paid plan from the team that builds UserTasks. Every plan includes email support, and phone support when needed. UserTasks itself is open source under Apache-2.0 and free to run without a plan.',
  /** Under the plan cards: neutral wording instead of terms we have not published. */
  detailsNote: 'Prices are in USD, per month. We agree the details with you when you sign up.',
}

/** Built only from the facts above. */
export const SUPPORT_FAQS: Array<{ question: string; answer: string }> = [
  { question: 'How much does UserTasks support cost?', answer: 'Support plans are priced per month in USD: SMB is $850 per month, Mid-market is $1,500 per month and Enterprise is $2,500 per month. Public sector plans are quoted on request: contact us.' },
  { question: 'Is phone support included?', answer: 'Yes, when needed, alongside email. Every support plan includes email support, and phone support when needed.' },
  { question: 'How do I get a quote for the public sector?', answer: 'Contact us and tell us about your organization and what you need. We will talk through a public sector plan with you.' },
  { question: 'What exactly does a plan cover?', answer: 'Every plan includes email support, and phone support when needed. We agree the details with you when you sign up; talk to us about your requirements.' },
  { question: 'Do you offer consulting?', answer: 'Yes. Consultants are on hand, starting at $250 USD per hour, for work such as implementation, process design and migrations. Contact us to talk about what you need.' },
  { question: 'Do I need a support plan to use UserTasks?', answer: 'No. UserTasks is open source under Apache-2.0 and free to run. The documentation and tutorials are free for everyone; a paid support plan is optional, for teams that want help directly from the team that builds UserTasks.' },
]

/**
 * Structured data: a Service (support plans) with one Offer per plan, monthly
 * USD prices where there is one and none for the public sector, and a Service
 * for consulting with an hourly minimum price.
 */
export function supportServiceNodes(baseUrl: string): Array<Record<string, unknown>> {
  const url = `${baseUrl}${SUPPORT_PAGE.path}`
  const contact = `${baseUrl}${SUPPORT_CONTACT_HREF}`
  return [
    {
      '@type': 'Service',
      '@id': `${url}#support`,
      name: 'UserTasks support',
      serviceType: 'Software support',
      description: SUPPORT_PAGE.definition,
      url,
      provider: { '@id': `${baseUrl}/#organization` },
      isRelatedTo: { '@id': `${baseUrl}/#software` },
      offers: SUPPORT_PLANS.map((plan) => plan.price
        ? {
            '@type': 'Offer',
            name: `${plan.name} support plan`,
            url: contact,
            price: plan.price.value,
            priceCurrency: plan.price.currency,
            priceSpecification: { '@type': 'UnitPriceSpecification', price: plan.price.value, priceCurrency: plan.price.currency, unitText: 'month', billingDuration: 'P1M' },
          }
        : {
            '@type': 'Offer',
            name: `${plan.name} support plan`,
            url: contact,
            description: 'Priced on request. Contact us for a quote.',
          }),
    },
    {
      '@type': 'Service',
      '@id': `${url}#consulting`,
      name: 'UserTasks consulting',
      serviceType: 'Consulting',
      description: CONSULTING.summary,
      url: `${url}#consulting`,
      provider: { '@id': `${baseUrl}/#organization` },
      isRelatedTo: { '@id': `${baseUrl}/#software` },
      offers: {
        '@type': 'Offer',
        url: contact,
        priceCurrency: CONSULTING.rate.currency,
        priceSpecification: { '@type': 'UnitPriceSpecification', minPrice: CONSULTING.rate.value, priceCurrency: CONSULTING.rate.currency, unitCode: 'HUR', unitText: 'hour' },
      },
    },
  ]
}
