import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { StyleGuide } from './style-guide'

export const metadata: Metadata = { title: 'UI primitives (dev)' }

/**
 * Living style guide for components/ui (docs/design/foundations.md). Dev only:
 * it renders inside the dashboard shell with the workspace theme, so switching
 * the theme (Settings → Theme) or the OS light/dark setting re-skins it.
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <StyleGuide />
}
