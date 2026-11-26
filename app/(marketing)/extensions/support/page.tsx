import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { SUPPORT_PAGE } from '@/lib/seo/support'
import { SupportPage } from '@/components/marketing/support-page'

export const metadata: Metadata = pageMetadata({
  path: SUPPORT_PAGE.path,
  title: SUPPORT_PAGE.metaTitle,
  description: SUPPORT_PAGE.description,
  socialTitle: SUPPORT_PAGE.title,
  keywords: ['UserTasks support', 'UserTasks support plans', 'workflow platform support', 'open source workflow engine support', 'UserTasks consulting', 'workflow automation consulting'],
})

export default function Page() {
  return <SupportPage />
}
