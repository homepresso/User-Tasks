import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { TASKS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = TASKS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: TASKS_PAGE.eyebrow, title: `${TASKS_PAGE.title}.`, subtitle: 'One task list, team queues, SLAs and escalation, with a process view and timeline on every request.' })
}
