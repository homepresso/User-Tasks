import type { Metadata } from 'next'
import { SeoSolutionPage } from '@/components/marketing/seo-solution-page'
import { getSeoPage } from '@/lib/seo-pages'

const page = getSeoPage('on-premises-workflow-automation')!
export const metadata: Metadata = { title: 'On-Premises Workflow Automation Software | UserTasks', description: page.description, keywords: ['on premises workflow automation', 'on prem automation', 'self hosted workflow automation', 'private workflow automation'], alternates: { canonical: '/on-premises-workflow-automation' }, openGraph: { title: page.title, description: page.description, url: '/on-premises-workflow-automation', type: 'website' } }
export default function OnPremisesWorkflowAutomationPage() { return <SeoSolutionPage page={page} /> }
