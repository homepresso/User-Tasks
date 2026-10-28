import type { Metadata } from 'next'
import { SeoSolutionPage } from '@/components/marketing/seo-solution-page'
import { getSeoPage } from '@/lib/seo-pages'

const page = getSeoPage('bpm-workflow-automation')!
export const metadata: Metadata = { title: 'BPM Workflow Automation and Business Process Management | UserTasks', description: page.description, keywords: ['BPM', 'business process management', 'BPM workflow', 'business process automation'], alternates: { canonical: '/bpm-workflow-automation' }, openGraph: { title: page.title, description: page.description, url: '/bpm-workflow-automation', type: 'website' } }
export default function BpmWorkflowAutomationPage() { return <SeoSolutionPage page={page} /> }
