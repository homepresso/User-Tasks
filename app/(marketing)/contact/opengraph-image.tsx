import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = 'Contact UserTasks'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Contact', title: 'Talk to UserTasks', subtitle: 'Workflow automation, migration, or private deployment.' })
}
