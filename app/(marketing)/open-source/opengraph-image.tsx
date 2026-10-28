import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = 'UserTasks is going open source'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Open source', title: 'UserTasks is going open source', subtitle: 'A strong, fully open-source workflow engine for enterprise headless use.' })
}
