import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { DataReportsPage } from '@/components/marketing/data-reports-page'
import { DATA_REPORTS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/data-and-reports',
  title: DATA_REPORTS_PAGE.metaTitle,
  description: DATA_REPORTS_PAGE.description,
  socialTitle: DATA_REPORTS_PAGE.title,
  keywords: ['workflow reports', 'data tables', 'workflow analytics', 'OData', 'Power BI workflow data', 'reporting API', 'approval time report'],
})

export default function Page() {
  return <DataReportsPage />
}
