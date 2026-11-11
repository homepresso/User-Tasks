import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { OPEN_SOURCE_PAGE } from '@/lib/seo/public-pages'
import { RefocusAnnouncement } from '@/components/marketing/refocus-announcement'

export const metadata: Metadata = pageMetadata({
  path: '/open-source',
  title: OPEN_SOURCE_PAGE.title,
  description: OPEN_SOURCE_PAGE.description,
  socialTitle: 'UserTasks is going open source',
  type: 'article',
})

export default function OpenSourcePage() {
  return <RefocusAnnouncement />
}
