import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { InfoPathPage } from '@/components/marketing/infopath-page'
import { INFOPATH_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/infopath',
  title: INFOPATH_PAGE.metaTitle,
  description: INFOPATH_PAGE.description,
  socialTitle: INFOPATH_PAGE.title,
  keywords: ['InfoPath migration', 'InfoPath replacement', 'migrate InfoPath forms', 'xsn converter', 'InfoPath to web forms', 'SharePoint InfoPath alternative', 'InfoPath forms services retirement', 'open source form builder'],
})

export default function Page() {
  return <InfoPathPage />
}
