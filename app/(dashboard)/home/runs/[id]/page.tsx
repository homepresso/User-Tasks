'use client'

import { use } from 'react'
import { RunProgressView } from '@/components/home/run-progress-view'

/** Process view: a run's progress for its submitter / starter / followers (no internal data). */
export default function RunProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <RunProgressView runId={id} />
}
