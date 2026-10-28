import type { Metadata } from 'next'
import { DeployAnywherePage } from '@/components/marketing/deploy-anywhere-page'
import { DEPLOY_ANYWHERE } from '@/lib/topologies'

export const metadata: Metadata = {
  title: 'Deploy Anywhere: Supabase, AWS, Azure, Google Cloud or On-Premises | UserTasks',
  description: DEPLOY_ANYWHERE.description,
  keywords: ['deploy workflow engine on aws', 'workflow automation azure', 'workflow engine google cloud', 'supabase workflow engine', 'multi-cloud workflow automation', 'air-gapped workflow automation'],
  alternates: { canonical: '/deploy-anywhere' },
  openGraph: { title: DEPLOY_ANYWHERE.title, description: DEPLOY_ANYWHERE.description, url: '/deploy-anywhere', type: 'website' },
}

export default function Page() {
  return <DeployAnywherePage />
}
