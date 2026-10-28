import { buildSearchIndex } from '@/lib/docs/render'

// Built from the docs registry at build time and served as a static file.
export const dynamic = 'force-static'

/** GET /docs/search-index.json — titles and headings for the docs search box. */
export function GET() {
  return Response.json(buildSearchIndex(), { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600' } })
}
