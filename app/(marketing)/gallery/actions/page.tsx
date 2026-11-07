import type { Metadata } from 'next'
import { ACTIONS_DESCRIPTION, ACTIONS_TITLE, ActionsIndexPage } from '@/components/gallery/action-pages'

export const metadata: Metadata = {
  title: `${ACTIONS_TITLE}: math, text, business calendars, data transforms, validation and crypto | UserTasks`,
  description: ACTIONS_DESCRIPTION,
  keywords: ['custom workflow actions', 'workflow custom code step', 'loan amortisation schedule workflow', 'business days SLA calculator', 'IBAN validation workflow', 'JSON transform workflow step', 'HMAC signature workflow', 'sandboxed JavaScript workflow'],
  alternates: { canonical: '/gallery/actions' },
  openGraph: { title: ACTIONS_TITLE, description: ACTIONS_DESCRIPTION, url: '/gallery/actions', type: 'website' },
}

export default function GalleryActionsRoute() {
  return <ActionsIndexPage />
}
