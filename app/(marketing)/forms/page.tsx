import type { Metadata } from 'next'
import { FormsPage } from '@/components/marketing/forms-page'
import { FORMS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: FORMS_PAGE.metaTitle,
  description: FORMS_PAGE.description,
  keywords: ['workflow forms', 'form builder', 'grid form designer', 'form to workflow', 'form file upload', 'autocomplete lookup field', 'QR code form', 'form submitted trigger', 'approval form', 'open source form builder'],
  alternates: { canonical: '/forms' },
  openGraph: { title: FORMS_PAGE.title, description: FORMS_PAGE.description, url: '/forms', type: 'website' },
}

export default function Page() {
  return <FormsPage />
}
