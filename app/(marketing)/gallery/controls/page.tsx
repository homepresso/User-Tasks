import type { Metadata } from 'next'
import { CONTROLS_DESCRIPTION, CONTROLS_TITLE, ControlsIndexPage } from '@/components/gallery/control-pages'

export const metadata: Metadata = {
  title: `${CONTROLS_TITLE}: charts, maps, address search, signatures and more | UserTasks`,
  description: CONTROLS_DESCRIPTION,
  keywords: ['form controls', 'web components', 'custom form fields', 'Google Places address autocomplete', 'signature pad', 'chart form field', 'Likert scale', 'editable table field', 'PDF viewer field', 'Lit web components'],
  alternates: { canonical: '/gallery/controls' },
  openGraph: { title: CONTROLS_TITLE, description: CONTROLS_DESCRIPTION, url: '/gallery/controls', type: 'website' },
}

export default function GalleryControlsRoute() {
  return <ControlsIndexPage />
}
