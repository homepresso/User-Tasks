import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { DOCUMENTS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = DOCUMENTS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: DOCUMENTS_PAGE.eyebrow, title: 'Read, compare and transform documents in your workflows.', subtitle: 'Word, Excel, PowerPoint and PDF — redlines, conversion, extraction and redaction in the run.' })
}
