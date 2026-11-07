import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { MEDIA_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = MEDIA_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: MEDIA_PAGE.eyebrow, title: 'See, hear and redact: AI for images, audio and video.', subtitle: 'Transcribe, analyse, blur faces and bleep spoken PII inside your workflows — with your own provider key.' })
}
