'use client'

import { use } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { RunTimeline } from '@/components/timeline/run-timeline'

/** A run's timeline on its own page (/timeline/<runId>): linkable; the same visibility as the process views. */
export default function TimelinePage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params)
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader breadcrumbs={[{ label: 'Home', href: '/home' }, { label: 'Timeline' }]} title="Timeline" />
      <RunTimeline target={{ runId }} />
    </div>
  )
}
