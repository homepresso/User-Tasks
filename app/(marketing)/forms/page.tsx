import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { FormsPage } from '@/components/marketing/forms-page'
import { FORMS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/forms',
  title: FORMS_PAGE.metaTitle,
  description: FORMS_PAGE.description,
  socialTitle: FORMS_PAGE.title,
  keywords: ['workflow forms', 'form builder', 'grid form designer', 'form to workflow', 'form file upload', 'autocomplete lookup field', 'QR code form', 'form submitted trigger', 'approval form', 'open source form builder'],
})

export default function Page() {
  return <FormsPage />
}
