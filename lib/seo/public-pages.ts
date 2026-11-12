import { AI_ASSISTANTS_PAGE, DATA_REPORTS_PAGE, DOCUMENTS_PAGE, FORMS_PAGE, INFOPATH_PAGE, INTEGRATIONS_PAGE, MEDIA_PAGE, TASKS_PAGE, WORKFLOWS_PAGE } from '@/lib/marketing-pages'
import { SEO_PAGES } from '@/lib/seo-pages'
import { DEPLOY_ANYWHERE } from '@/lib/topologies'
import { USE_CASES } from '@/lib/use-cases'
import { SITE_CONTENT_UPDATED } from '@/lib/seo/site'

/**
 * Every indexable top-level page of the public site, in one list: the
 * sitemap, robots.txt and /llms.txt read it, and the SEO tests check each
 * page has metadata. Gallery, use-case and docs pages are listed from their
 * own registries.
 */

export type PublicPageGroup = 'product' | 'guide' | 'company'

export type PublicPage = {
  path: string
  /** Page heading. */
  title: string
  description: string
  group: PublicPageGroup
  /** YYYY-MM-DD; defaults to SITE_CONTENT_UPDATED. */
  updated?: string
}

export const USE_CASES_INDEX = {
  title: 'Use cases: headless tasks, approvals, AI agents, integrations, surveys, media and migrations',
  description: 'How teams use UserTasks: human tasks inside their own apps, governed approvals, AI agents with human review, an integration hub, customer and employee surveys, quizzes, inspections, event registration and document sign-off on ready-made form controls, records requests and evidence redaction, claims, KYC, call QA and moderation on images, audio and video, and replacing SharePoint, Nintex and K2 workflows.',
}

export const OPEN_SOURCE_PAGE = {
  title: 'Open source (Apache-2.0): run UserTasks locally with Git, Docker and npm',
  description: 'UserTasks is open source under Apache-2.0. Clone it from GitHub and run it locally from source with Supabase, as a Docker stack without Supabase, or drive it with the CLI from npm — then create your admin account in the browser.',
}

export const CONTACT_PAGE = {
  title: 'Contact UserTasks',
  description: 'Contact UserTasks about workflow automation, BPM, on-premises deployment, SharePoint, InfoPath, K2 or Nintex migration, integrations, and enterprise requirements.',
}

const product = (page: { slug: string; title: string; description: string }): PublicPage => ({ path: `/${page.slug}`, title: page.title, description: page.description, group: 'product' })

export const PUBLIC_PAGES: PublicPage[] = [
  product(WORKFLOWS_PAGE),
  product(FORMS_PAGE),
  product(TASKS_PAGE),
  product(AI_ASSISTANTS_PAGE),
  product(DATA_REPORTS_PAGE),
  product(INTEGRATIONS_PAGE),
  product(DOCUMENTS_PAGE),
  product(MEDIA_PAGE),
  product(DEPLOY_ANYWHERE),
  product(INFOPATH_PAGE),
  ...SEO_PAGES.map((page): PublicPage => ({ path: `/${page.slug}`, title: page.title, description: page.description, group: 'guide', updated: page.updated })),
  { path: '/use-cases', title: USE_CASES_INDEX.title, description: USE_CASES_INDEX.description, group: 'guide' },
  { path: '/gallery', title: 'Package gallery', description: 'Ready-made workflow packages to install: forms, workflows, data tables and reports for HR, finance, IT, operations and customer teams.', group: 'product' },
  { path: '/docs', title: 'UserTasks documentation', description: 'Guides and reference for the UserTasks workflow engine: designer, nodes, expressions, tasks, integrations, decision tables, agents, governance, REST API, MCP, CLI, log export and self-hosting.', group: 'company' },
  { path: '/open-source', title: OPEN_SOURCE_PAGE.title, description: OPEN_SOURCE_PAGE.description, group: 'company' },
  { path: '/contact', title: CONTACT_PAGE.title, description: CONTACT_PAGE.description, group: 'company' },
]

export function useCasePages(): PublicPage[] {
  return USE_CASES.map((useCase) => ({ path: `/use-cases/${useCase.slug}`, title: useCase.title, description: useCase.description, group: 'guide' }))
}

export function pageUpdated(page: PublicPage): string {
  return page.updated ?? SITE_CONTENT_UPDATED
}
