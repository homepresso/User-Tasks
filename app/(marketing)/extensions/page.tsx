import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { EXTENSIONS_PAGE } from '@/lib/seo/extensions'
import { ExtensionsPage } from '@/components/marketing/extensions-page'

export const metadata: Metadata = pageMetadata({
  path: EXTENSIONS_PAGE.path,
  title: EXTENSIONS_PAGE.metaTitle,
  description: EXTENSIONS_PAGE.description,
  socialTitle: EXTENSIONS_PAGE.title,
  keywords: ['UserTasks extensions', 'workflow engine paid extensions', 'SharePoint Server workflow extension', 'workflow infrastructure separation', 'workflow runners', 'open core workflow platform'],
})

export default function Page() {
  return <ExtensionsPage />
}
