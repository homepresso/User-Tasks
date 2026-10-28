import { renderHomeOgImage, renderOgImage } from '@/lib/brand/og'
import { ALL_DOC_PAGES, getDocPage, sectionOf } from '@/lib/docs/registry'

/**
 * Link-preview card for each docs page, at /og/docs/<slug>. A route handler
 * because the opengraph-image file convention is not allowed under the docs
 * catch-all segment; app/docs/[...slug]/page.tsx points og:image here.
 */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return ALL_DOC_PAGES.map((page) => ({ slug: page.slug.split('/') }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const page = getDocPage((await params).slug.join('/'))
  if (!page) return renderHomeOgImage()
  const section = sectionOf(page.slug)
  return renderOgImage({ eyebrow: section ? `Docs · ${section.title}` : 'Docs', title: page.title, subtitle: page.description })
}
