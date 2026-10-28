import { OG_CONTENT_TYPE, OG_DEFAULT_ALT, OG_SIZE, renderHomeOgImage } from '@/lib/brand/og'

/** Default link-preview card (see lib/brand/og.tsx). */
export const alt = OG_DEFAULT_ALT
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderHomeOgImage()
}
