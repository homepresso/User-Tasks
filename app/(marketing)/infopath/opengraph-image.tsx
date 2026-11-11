import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { INFOPATH_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = INFOPATH_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: INFOPATH_PAGE.eyebrow, title: 'Bring your InfoPath forms to UserTasks.', subtitle: 'Drop in an .xsn: every view a form, rules and validation converted, nothing stored.' })
}
