import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { getSeoPage } from '@/lib/seo-pages'

const page = getSeoPage('on-premises-workflow-automation')!

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = page.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: page.eyebrow, title: page.title, subtitle: page.description })
}
