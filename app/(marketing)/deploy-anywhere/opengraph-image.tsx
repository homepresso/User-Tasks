import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { DEPLOY_ANYWHERE } from '@/lib/topologies'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = DEPLOY_ANYWHERE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: DEPLOY_ANYWHERE.eyebrow, title: 'Start on Supabase. Move each piece when you’re ready.', subtitle: 'Supabase only, hybrid, AWS, Azure, Google Cloud, multi-cloud or air-gapped — one reversible switch at a time.' })
}
