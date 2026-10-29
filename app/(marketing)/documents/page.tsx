import type { Metadata } from 'next'
import { DocumentsPage } from '@/components/marketing/documents-page'
import { DOCUMENTS_PAGE } from '@/lib/marketing-pages'

export const metadata: Metadata = {
  title: DOCUMENTS_PAGE.metaTitle,
  description: DOCUMENTS_PAGE.description,
  keywords: ['document workflow automation', 'read word document in workflow', 'excel to data table', 'pdf ocr workflow', 'compare documents redline', 'word tracked changes comparison', 'redact pii documents', 'pdf merge split workflow', 'document processing open source'],
  alternates: { canonical: '/documents' },
  openGraph: { title: DOCUMENTS_PAGE.title, description: DOCUMENTS_PAGE.description, url: '/documents', type: 'website' },
}

export default function Page() {
  return <DocumentsPage />
}
