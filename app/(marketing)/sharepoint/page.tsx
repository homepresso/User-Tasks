import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { SharePointPage } from '@/components/marketing/sharepoint-page'
import { SHAREPOINT_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/sharepoint',
  title: SHAREPOINT_PAGE.metaTitle,
  description: SHAREPOINT_PAGE.description,
  socialTitle: SHAREPOINT_PAGE.title,
  keywords: ['SharePoint Server workflow replacement', 'SharePoint 2010 workflow retirement', 'SharePoint Subscription Edition workflow', 'InfoPath Forms Services replacement', 'SharePoint add-in', 'SharePoint on-premises forms', 'SharePoint Designer 2010 workflow migration', 'SharePoint remote event receivers'],
})

export default function Page() {
  return <SharePointPage />
}
