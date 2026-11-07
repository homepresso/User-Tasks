import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { WORKFLOWS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = WORKFLOWS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: WORKFLOWS_PAGE.eyebrow, title: 'Complex workflows, built visually — without limits.', subtitle: 'Branches, parallel paths, loops, sub-workflows, rules, people, SLAs and error paths — tested, versioned, migrated live.' })
}
