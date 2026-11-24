import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { EXTENSIONS_PAGE } from '@/lib/seo/extensions'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = EXTENSIONS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: EXTENSIONS_PAGE.eyebrow, title: 'An open-source core. Extensions when you need more.', subtitle: 'SharePoint, Infrastructure and Processing: paid add-ons, licensed offline, priced in USD.' })
}
