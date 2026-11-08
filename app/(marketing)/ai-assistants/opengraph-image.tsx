import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { AI_ASSISTANTS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = AI_ASSISTANTS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: AI_ASSISTANTS_PAGE.eyebrow, title: 'Agent: your AI co-worker in every screen.', subtitle: 'Fill forms, work tasks and design workflows, on your own model and key. It proposes; you confirm.' })
}
