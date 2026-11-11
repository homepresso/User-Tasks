import type { MetadataRoute } from 'next'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { AI_CRAWLERS, PRIVATE_PATHS, publicAllowList } from '@/lib/seo/robots-config'

export default function robots(): MetadataRoute.Robots {
  if (!isCloud()) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  const baseUrl = publicBaseUrl()
  const allow = publicAllowList()
  return {
    rules: [
      { userAgent: '*', allow: allow, disallow: PRIVATE_PATHS },
      // Named group: a crawler that matches a named group ignores `*`, so it repeats the same rules.
      { userAgent: AI_CRAWLERS, allow: allow, disallow: PRIVATE_PATHS },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
