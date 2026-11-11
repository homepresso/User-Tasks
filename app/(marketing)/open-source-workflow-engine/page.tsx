import type { Metadata } from 'next'
import { SeoSolutionPage } from '@/components/marketing/seo-solution-page'
import { getSeoPage, seoPageMetadataInput } from '@/lib/seo-pages'
import { pageMetadata } from '@/lib/seo/site'

const page = getSeoPage('open-source-workflow-engine')!
export const metadata: Metadata = pageMetadata(seoPageMetadataInput(page))
export default function Page() { return <SeoSolutionPage page={page} /> }
