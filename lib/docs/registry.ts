import type { DocPageDef, DocSectionDef } from './types'
import { GETTING_STARTED_PAGES } from './content/getting-started'
import { WORKFLOW_PAGES } from './content/workflows'
import { DOCUMENT_PAGES } from './content/documents'
import { MEDIA_PAGES } from './content/media'
import { TASK_PAGES } from './content/tasks'
import { FORM_WIZARD_PAGE } from './content/form-wizard'
import { SURVEY_CONTROLS_PAGE } from './content/survey-controls'
import { INTEGRATION_PAGES } from './content/integrations'
import { BUILDING_BLOCK_PAGES } from './content/building-blocks'
import { GOVERNANCE_PAGES } from './content/governance'
import { API_PAGES, CLI_PAGES, SDK_PAGES } from './content/developers'
import { OBSERVABILITY_PAGES, PROJECT_PAGES, SELF_HOSTING_PAGES } from './content/operations'
import { SERVICE_PAGES, TOPOLOGY_PAGES } from './content/deploy'

/** The form wizard and survey controls pages right after Forms. */
function withFormWizard(pages: DocPageDef[]): DocPageDef[] {
  const at = pages.findIndex((page) => page.slug === 'tasks/forms')
  const extra = [FORM_WIZARD_PAGE, SURVEY_CONTROLS_PAGE]
  return at < 0 ? [...pages, ...extra] : [...pages.slice(0, at + 1), ...extra, ...pages.slice(at + 1)]
}

/** Sidebar order. Every page belongs to exactly one section. */
export const DOC_SECTIONS: DocSectionDef[] = [
  { title: 'Getting started', pages: GETTING_STARTED_PAGES },
  { title: 'Workflows', pages: WORKFLOW_PAGES },
  { title: 'Documents', pages: DOCUMENT_PAGES },
  { title: 'Media (images, audio, video)', pages: MEDIA_PAGES },
  { title: 'Tasks', pages: withFormWizard(TASK_PAGES) },
  { title: 'Integrations', pages: INTEGRATION_PAGES },
  { title: 'Building blocks', pages: BUILDING_BLOCK_PAGES },
  { title: 'Governance and security', pages: GOVERNANCE_PAGES },
  { title: 'API and MCP', pages: API_PAGES, links: [{ title: 'API Explorer', href: '/docs/api-explorer' }] },
  { title: 'CLI, SDK and config', pages: [...CLI_PAGES, ...SDK_PAGES] },
  { title: 'Observability', pages: OBSERVABILITY_PAGES },
  { title: 'Deploy anywhere', pages: TOPOLOGY_PAGES },
  { title: 'Choosing services', pages: SERVICE_PAGES },
  { title: 'Self-hosting', pages: SELF_HOSTING_PAGES },
  { title: 'Project', pages: PROJECT_PAGES },
]

export const ALL_DOC_PAGES: DocPageDef[] = DOC_SECTIONS.flatMap((section) => section.pages)

const BY_SLUG = new Map(ALL_DOC_PAGES.map((page) => [page.slug, page]))

export function getDocPage(slug: string): DocPageDef | undefined {
  return BY_SLUG.get(slug)
}

export function docHref(slug: string): string {
  return `/docs/${slug}`
}

export function sectionOf(slug: string): DocSectionDef | undefined {
  return DOC_SECTIONS.find((section) => section.pages.some((page) => page.slug === slug))
}

/** Previous and next page in sidebar order. */
export function neighbours(slug: string): { prev?: DocPageDef; next?: DocPageDef } {
  const index = ALL_DOC_PAGES.findIndex((page) => page.slug === slug)
  if (index < 0) return {}
  return { prev: ALL_DOC_PAGES[index - 1], next: ALL_DOC_PAGES[index + 1] }
}

export { LEGACY_DOC_REDIRECTS } from './redirects'
