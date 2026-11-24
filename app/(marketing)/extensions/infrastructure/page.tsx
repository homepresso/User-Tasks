import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { extensionById } from '@/lib/seo/extensions'
import { ExtensionDetailPage } from '@/components/marketing/extensions-page'

const extension = extensionById('infrastructure')

export const metadata: Metadata = pageMetadata({
  path: extension.href,
  title: extension.page.metaTitle,
  description: extension.page.description,
  socialTitle: extension.page.title,
  keywords: extension.page.keywords,
})

export default function Page() {
  return <ExtensionDetailPage extension={extension} />
}
