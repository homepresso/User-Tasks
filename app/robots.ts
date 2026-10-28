import type { MetadataRoute } from 'next'
import { isCloud, publicBaseUrl } from '@/lib/deployment'

export default function robots(): MetadataRoute.Robots {
  if (!isCloud()) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  const baseUrl = publicBaseUrl()
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/docs/', '/open-source', '/workflow-automation', '/bpm-workflow-automation', '/on-premises-workflow-automation', '/deploy-anywhere', '/use-cases', '/gallery'],
      disallow: ['/api/', '/settings', '/reports', '/tasks', '/automations', '/agents', '/packages', '/data', '/integrations', '/extensibility', '/team', '/activity', '/oauth', '/invite', '/login', '/signup', '/forgot-password', '/reset-password', '/check-email', '/onboarding'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}
