import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { DeployAnywherePage } from '@/components/marketing/deploy-anywhere-page'
import { DEPLOY_ANYWHERE } from '@/lib/topologies'

export const metadata: Metadata = pageMetadata({
  path: '/deploy-anywhere',
  title: 'Deploy Anywhere: Supabase, AWS, Azure, Google Cloud or On-Premises | UserTasks',
  description: DEPLOY_ANYWHERE.description,
  socialTitle: DEPLOY_ANYWHERE.title,
  keywords: ['deploy workflow engine on aws', 'workflow automation azure', 'workflow engine google cloud', 'supabase workflow engine', 'multi-cloud workflow automation', 'air-gapped workflow automation'],
})

export default function Page() {
  return <DeployAnywherePage />
}
