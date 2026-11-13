/**
 * Per-page article metadata for the docs chrome: the source file behind each
 * page ("Edit this page"), breadcrumbs, reading time and the "Last updated"
 * line. Server-only (imports the content modules); nothing here reaches the
 * client bundle.
 */

import type { DocBlock, DocListItem } from './markdown'
import { stripInline } from './markdown'
import { docHref, sectionOf } from './registry'
import type { DocPageDef } from './types'
import { GETTING_STARTED_PAGES } from './content/getting-started'
import { WORKFLOW_PAGES } from './content/workflows'
import { CUSTOM_ACTIONS_PAGE, OFFICIAL_ACTIONS_PAGE } from './content/custom-actions'
import { DOCUMENT_PAGES } from './content/documents'
import { MEDIA_PAGES } from './content/media'
import { TASK_PAGES } from './content/tasks'
import { CUSTOM_FORM_CONTROLS_PAGE } from './content/custom-form-controls'
import { GALLERY_FORM_CONTROLS_PAGE } from './content/gallery-form-controls'
import { FORM_WIZARD_PAGE } from './content/form-wizard'
import { SURVEY_CONTROLS_PAGE } from './content/survey-controls'
import { INFOPATH_IMPORT_PAGE } from './content/infopath-import'
import { INTEGRATION_PAGES } from './content/integrations'
import { BUILDING_BLOCK_PAGES } from './content/building-blocks'
import { GOVERNANCE_PAGES } from './content/governance'
import { AI_ASSISTANT_PAGES } from './content/ai-assistants'
import { TUTORIAL_PAGES } from './content/tutorials'
import { API_PAGES, CLI_PAGES, SDK_PAGES } from './content/developers'
import { EXTENSION_PAGES } from './content/extensions'
import { OBSERVABILITY_PAGES, PROJECT_PAGES, SELF_HOSTING_PAGES } from './content/operations'
import { SERVICE_PAGES, TOPOLOGY_PAGES } from './content/deploy'
import { SELF_HOSTING_GUIDE_PAGES } from './content/self-hosting-guide'

const CONTENT = 'lib/docs/content'

/**
 * Which repository file defines each page. Single pages first: some are
 * spread into another module's list (custom actions into workflows, the
 * form-control pages into tasks) and must keep their own file.
 */
const SOURCES: Array<[DocPageDef | DocPageDef[], string]> = [
  [CUSTOM_ACTIONS_PAGE, `${CONTENT}/custom-actions.ts`],
  [OFFICIAL_ACTIONS_PAGE, `${CONTENT}/custom-actions.ts`],
  [CUSTOM_FORM_CONTROLS_PAGE, `${CONTENT}/custom-form-controls.ts`],
  [GALLERY_FORM_CONTROLS_PAGE, `${CONTENT}/gallery-form-controls.ts`],
  [FORM_WIZARD_PAGE, `${CONTENT}/form-wizard.ts`],
  [SURVEY_CONTROLS_PAGE, `${CONTENT}/survey-controls.ts`],
  [INFOPATH_IMPORT_PAGE, `${CONTENT}/infopath-import.ts`],
  [GETTING_STARTED_PAGES, `${CONTENT}/getting-started.ts`],
  [WORKFLOW_PAGES, `${CONTENT}/workflows.ts`],
  [DOCUMENT_PAGES, `${CONTENT}/documents.ts`],
  [MEDIA_PAGES, `${CONTENT}/media.ts`],
  [TASK_PAGES, `${CONTENT}/tasks.ts`],
  [INTEGRATION_PAGES, `${CONTENT}/integrations.ts`],
  [BUILDING_BLOCK_PAGES, `${CONTENT}/building-blocks.ts`],
  [GOVERNANCE_PAGES, `${CONTENT}/governance.ts`],
  [AI_ASSISTANT_PAGES, `${CONTENT}/ai-assistants.ts`],
  [TUTORIAL_PAGES, `${CONTENT}/tutorials.ts`],
  [[...API_PAGES, ...CLI_PAGES, ...SDK_PAGES], `${CONTENT}/developers.ts`],
  [EXTENSION_PAGES, `${CONTENT}/extensions.ts`],
  [[...OBSERVABILITY_PAGES, ...PROJECT_PAGES, ...SELF_HOSTING_PAGES], `${CONTENT}/operations.ts`],
  [[...SERVICE_PAGES, ...TOPOLOGY_PAGES], `${CONTENT}/deploy.ts`],
  [SELF_HOSTING_GUIDE_PAGES, `${CONTENT}/self-hosting-guide.ts`],
]

const SOURCE_BY_SLUG = new Map<string, string>()
for (const [pages, file] of SOURCES) {
  for (const page of Array.isArray(pages) ? pages : [pages]) {
    if (!SOURCE_BY_SLUG.has(page.slug)) SOURCE_BY_SLUG.set(page.slug, file)
  }
}

/** Repository-relative path of the file that defines a page, if known. */
export function pageSourcePath(slug: string): string | null {
  return SOURCE_BY_SLUG.get(slug) ?? null
}

/** "Edit this page on GitHub": only with a configured repository and a known source file. */
export function editPageUrl(slug: string, repository: string | null, branch = 'main'): string | null {
  const file = pageSourcePath(slug)
  if (!repository || !file) return null
  return `${repository.replace(/\/+$/, '')}/edit/${branch}/${file}`
}

export interface Crumb {
  name: string
  path: string
}

/** Docs → section (its first page) → page, without repeats (a section's first page is the page itself). */
export function breadcrumbs(page: DocPageDef): Crumb[] {
  const section = sectionOf(page.slug)
  const crumbs: Crumb[] = [
    { name: 'Docs', path: '/docs' },
    ...(section ? [{ name: section.title, path: docHref(section.pages[0].slug) }] : []),
    { name: page.title, path: docHref(page.slug) },
  ]
  return crumbs.filter((crumb, index, all) => all.findIndex((other) => other.path === crumb.path) === index)
}

function listWords(items: DocListItem[]): number {
  return items.reduce((total, item) => total + countWords(item.text) + (item.items ? listWords(item.items) : 0), 0)
}

function countWords(text: string): number {
  return stripInline(text).split(/\s+/).filter(Boolean).length
}

/** Prose words per minute; code and tables are skimmed, so they count at a third. */
const WORDS_PER_MINUTE = 220

/** Estimated reading time in whole minutes (at least 1). */
export function readingMinutes(blocks: DocBlock[]): number {
  let words = 0
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'callout':
        words += countWords(block.text)
        break
      case 'list':
        words += listWords(block.items)
        break
      case 'code':
        words += block.code.split(/\s+/).filter(Boolean).length / 3
        break
      case 'table':
        words += [...block.head, ...block.rows.flat()].reduce((total, cell) => total + countWords(cell), 0) / 3
        break
      case 'directive':
        words += 20
        break
    }
  }
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** `2026-11-13` → `November 13, 2026` (UTC, so the build's timezone cannot shift the day). */
export function formatDocDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}
