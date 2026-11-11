import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { IntegrationsPage } from '@/components/marketing/integrations-page'
import { INTEGRATIONS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/connectors',
  title: INTEGRATIONS_PAGE.metaTitle,
  description: INTEGRATIONS_PAGE.description,
  socialTitle: INTEGRATIONS_PAGE.title,
  keywords: ['workflow integrations', 'workflow connectors', 'openapi import', 'rest api integration', 'database workflow integration', 'webhook workflow', 'mcp server', 'ai agents workflow', 'workday integration', 'servicenow integration', 'salesforce integration', 'sap odata integration', 'docusign workflow integration', 'adobe sign integration', 'dropbox sign integration', 'e-signature workflow'],
})

export default function Page() {
  return <IntegrationsPage />
}
