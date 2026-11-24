import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AppsLanding } from '@/components/apps/apps-landing'

export const metadata: Metadata = { title: 'Apps' }

/** The Apps page: apps shared with you, and the ones you design (components/apps/apps-landing.tsx). */
export default function AppsPage() {
  return (
    <Suspense>
      <AppsLanding />
    </Suspense>
  )
}
