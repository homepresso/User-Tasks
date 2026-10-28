import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { GALLERY_PACKAGES } from '@/lib/gallery/site'

/** Link-preview card for the gallery (see lib/brand/og.tsx). */
export const alt = 'UserTasks package gallery'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Package gallery', title: 'Install a working process in minutes', subtitle: `${GALLERY_PACKAGES.length} ready-made workflows for HR, finance, IT, sales, compliance and headless integration.` })
}
