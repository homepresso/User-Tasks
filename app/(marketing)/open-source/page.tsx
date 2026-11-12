import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { OPEN_SOURCE_PAGE } from '@/lib/seo/public-pages'
import { OpenSourcePage as OpenSourceContent } from '@/components/marketing/open-source-page'

export const metadata: Metadata = pageMetadata({
  path: '/open-source',
  title: OPEN_SOURCE_PAGE.title,
  description: OPEN_SOURCE_PAGE.description,
  socialTitle: 'UserTasks — open source, running locally in minutes',
})

export default function OpenSourcePage() {
  return <OpenSourceContent />
}
