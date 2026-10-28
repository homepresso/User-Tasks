import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = 'UserTasks use cases'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Use cases', title: 'How teams use UserTasks', subtitle: 'Headless tasks, approvals, AI agents with human review, integrations and migrations.' })
}
