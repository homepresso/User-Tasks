import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { FORMS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = FORMS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: FORMS_PAGE.eyebrow, title: 'Forms that start and drive your workflows.', subtitle: 'Grid designer, lookups, file uploads, themes and QR form pages — validated on the server.' })
}
