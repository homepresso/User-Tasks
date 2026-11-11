import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { WorkflowsPage } from '@/components/marketing/workflows-page'
import { WORKFLOWS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/workflows',
  title: WORKFLOWS_PAGE.metaTitle,
  description: WORKFLOWS_PAGE.description,
  socialTitle: WORKFLOWS_PAGE.title,
  keywords: ['complex workflows', 'visual workflow designer', 'workflow builder', 'parallel workflow', 'sub-workflows', 'decision table workflow', 'human in the loop workflow', 'workflow sla escalation', 'workflow versioning', 'live workflow migration', 'open source workflow engine'],
})

export default function Page() {
  return <WorkflowsPage />
}
