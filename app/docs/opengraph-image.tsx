import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = 'UserTasks documentation'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Documentation', title: 'Build, run and drive workflows', subtitle: 'Guides and reference for the designer, tasks, integrations, the API, MCP and CLI.' })
}
