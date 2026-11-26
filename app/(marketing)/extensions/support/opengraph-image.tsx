import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { SUPPORT_PAGE } from '@/lib/seo/support'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = SUPPORT_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: SUPPORT_PAGE.eyebrow, title: 'Support from the team that builds UserTasks.', subtitle: 'Monthly plans in USD: email support, and phone support when needed. Consultants from $250 per hour.' })
}
