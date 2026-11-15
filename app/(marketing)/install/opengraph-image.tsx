import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = 'Install UserTasks with one command'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: 'Install', title: 'Install UserTasks with one command', subtitle: 'Docker on Linux, macOS and Windows: signed releases, then usertasks upgrade.' })
}
