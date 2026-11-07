import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { CONNECTOR_COUNT } from '@/lib/marketing-connectors'
import { INTEGRATIONS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = INTEGRATIONS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: INTEGRATIONS_PAGE.eyebrow, title: 'Connect to any system and any AI service.', subtitle: `${CONNECTOR_COUNT} connectors, any REST or OData API, databases, webhooks, MCP — and AI agents on the models you choose.` })
}
