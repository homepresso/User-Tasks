import type { Metadata } from 'next'
import { SeoSolutionPage } from '@/components/marketing/seo-solution-page'
import { getSeoPage } from '@/lib/seo-pages'

const page = getSeoPage('workflow-automation')!
export const metadata: Metadata = { title: 'Workflow Automation Software for People and Systems | UserTasks', description: page.description, keywords: ['workflow automation', 'workflow automation software', 'business workflow automation', 'human workflow automation'], alternates: { canonical: '/workflow-automation' }, openGraph: { title: page.title, description: page.description, url: '/workflow-automation', type: 'website' } }
export default function WorkflowAutomationPage() { return <SeoSolutionPage page={page} /> }
