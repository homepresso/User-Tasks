import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { SHAREPOINT_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = SHAREPOINT_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: SHAREPOINT_PAGE.eyebrow, title: 'Workflows and forms for SharePoint Server.', subtitle: 'An add-in for 2016, 2019 and Subscription Edition: embedded forms, list-event triggers, the full REST API and InfoPath migration.' })
}
