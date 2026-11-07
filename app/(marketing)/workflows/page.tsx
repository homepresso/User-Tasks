import type { Metadata } from 'next'
import { WorkflowsPage } from '@/components/marketing/workflows-page'
import { WORKFLOWS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: WORKFLOWS_PAGE.metaTitle,
  description: WORKFLOWS_PAGE.description,
  keywords: ['complex workflows', 'visual workflow designer', 'workflow builder', 'parallel workflow', 'sub-workflows', 'decision table workflow', 'human in the loop workflow', 'workflow sla escalation', 'workflow versioning', 'live workflow migration', 'open source workflow engine'],
  alternates: { canonical: '/workflows' },
  openGraph: { title: WORKFLOWS_PAGE.title, description: WORKFLOWS_PAGE.description, url: '/workflows', type: 'website' },
}

export default function Page() {
  return <WorkflowsPage />
}
