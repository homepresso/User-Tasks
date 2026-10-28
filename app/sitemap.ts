import type { MetadataRoute } from 'next'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { ALL_DOC_PAGES } from '@/lib/docs/registry'
import { GALLERY_PACKAGES, GALLERY_UPDATED } from '@/lib/gallery/site'
import { SEO_PAGES } from '@/lib/seo-pages'
import { USE_CASES } from '@/lib/use-cases'

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isCloud()) return []
  const baseUrl = publicBaseUrl()
  const now = new Date()
  return [
    { url: baseUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    ...SEO_PAGES.map((page) => ({ url: `${baseUrl}/${page.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.9 })),
    { url: `${baseUrl}/deploy-anywhere`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${baseUrl}/use-cases`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    ...USE_CASES.map((useCase) => ({ url: `${baseUrl}/use-cases/${useCase.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.85 })),
    { url: `${baseUrl}/gallery`, lastModified: new Date(`${GALLERY_UPDATED}T00:00:00Z`), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/gallery/share`, lastModified: new Date(`${GALLERY_UPDATED}T00:00:00Z`), changeFrequency: 'monthly', priority: 0.6 },
    ...GALLERY_PACKAGES.map((pkg) => ({ url: `${baseUrl}/gallery/${pkg.slug}`, lastModified: new Date(`${pkg.released}T00:00:00Z`), changeFrequency: 'monthly' as const, priority: 0.8 })),
    { url: `${baseUrl}/docs`, lastModified: now, changeFrequency: 'weekly', priority: 0.85 },
    { url: `${baseUrl}/open-source`, lastModified: now, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${baseUrl}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.7 },
    ...ALL_DOC_PAGES.map((page) => ({ url: `${baseUrl}/docs/${page.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.75 })),
    { url: `${baseUrl}/docs/api-explorer`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
  ]
}
