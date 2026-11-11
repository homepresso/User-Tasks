import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { buildLlmsFullTxt } from '@/lib/seo/llms'

// Built from the page, use-case and docs registries at build time, like the sitemap.
export const dynamic = 'force-static'

/** GET /llms-full.txt — the full text of the guides, use cases and docs as Markdown. Cloud edition only. */
export function GET() {
  if (!isCloud()) return new Response('Not found', { status: 404 })
  return new Response(buildLlmsFullTxt(publicBaseUrl()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  })
}
