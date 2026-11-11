import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { buildLlmsTxt } from '@/lib/seo/llms'

// Built from the page, use-case and docs registries at build time, like the sitemap.
export const dynamic = 'force-static'

/** GET /llms.txt — a Markdown map of the public site for AI assistants (https://llmstxt.org). Cloud edition only. */
export function GET() {
  if (!isCloud()) return new Response('Not found', { status: 404 })
  return new Response(buildLlmsTxt(publicBaseUrl()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  })
}
