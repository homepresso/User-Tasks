import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { DocumentsPage } from '@/components/marketing/documents-page'
import { DOCUMENTS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = pageMetadata({
  path: '/documents',
  title: DOCUMENTS_PAGE.metaTitle,
  description: DOCUMENTS_PAGE.description,
  socialTitle: DOCUMENTS_PAGE.title,
  keywords: ['document workflow automation', 'read word document in workflow', 'excel to data table', 'pdf ocr workflow', 'compare documents redline', 'word tracked changes comparison', 'redact pii documents', 'pdf merge split workflow', 'document processing open source'],
})

export default function Page() {
  return <DocumentsPage />
}
