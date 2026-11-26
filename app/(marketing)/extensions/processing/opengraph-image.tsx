import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { extensionById, STATUS_LABEL } from '@/lib/seo/extensions'

const extension = extensionById('processing')

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = extension.page.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: `${extension.name} add-on · ${STATUS_LABEL[extension.status]}`, title: extension.tagline, subtitle: `Self-hosted UserTasks (Enterprise edition). ${extension.price.amount} USD ${extension.price.unit}.` })
}
