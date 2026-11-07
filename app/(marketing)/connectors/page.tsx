import type { Metadata } from 'next'
import { IntegrationsPage } from '@/components/marketing/integrations-page'
import { INTEGRATIONS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: INTEGRATIONS_PAGE.metaTitle,
  description: INTEGRATIONS_PAGE.description,
  keywords: ['workflow integrations', 'workflow connectors', 'openapi import', 'rest api integration', 'database workflow integration', 'webhook workflow', 'mcp server', 'ai agents workflow', 'workday integration', 'servicenow integration', 'salesforce integration', 'sap odata integration', 'docusign workflow integration', 'adobe sign integration', 'dropbox sign integration', 'e-signature workflow'],
  alternates: { canonical: '/connectors' },
  openGraph: { title: INTEGRATIONS_PAGE.title, description: INTEGRATIONS_PAGE.description, url: '/connectors', type: 'website' },
}

export default function Page() {
  return <IntegrationsPage />
}
