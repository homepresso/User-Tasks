import type { MetadataRoute } from 'next'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { ALL_DOC_PAGES } from '@/lib/docs/registry'
import { GALLERY_ACTIONS, GALLERY_CONTROLS, GALLERY_PACKAGES, GALLERY_UPDATED } from '@/lib/gallery/site'
import { pageUpdated, PUBLIC_PAGES, useCasePages } from '@/lib/seo/public-pages'
import { DOCS_UPDATED, isoDate, SITE_CONTENT_UPDATED } from '@/lib/seo/site'

/**
 * Every public page with a stable lastModified: the date its content was last
 * reviewed (lib/seo), never the build time, so the value means something.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isCloud()) return []
  const baseUrl = publicBaseUrl()
  const site = isoDate(SITE_CONTENT_UPDATED)
  const docs = isoDate(DOCS_UPDATED)
  const gallery = isoDate(GALLERY_UPDATED)
  const priority = (path: string, group: string) => path === '/docs' ? 0.85 : group === 'company' ? 0.6 : 0.9
  return [
    { url: baseUrl, lastModified: site, changeFrequency: 'weekly', priority: 1 },
    ...PUBLIC_PAGES.filter((page) => page.path !== '/gallery').map((page) => ({ url: `${baseUrl}${page.path}`, lastModified: isoDate(pageUpdated(page)), changeFrequency: 'monthly' as const, priority: priority(page.path, page.group) })),
    ...useCasePages().map((page) => ({ url: `${baseUrl}${page.path}`, lastModified: site, changeFrequency: 'monthly' as const, priority: 0.85 })),
    { url: `${baseUrl}/gallery`, lastModified: gallery, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${baseUrl}/gallery/share`, lastModified: gallery, changeFrequency: 'monthly', priority: 0.6 },
    ...GALLERY_PACKAGES.map((pkg) => ({ url: `${baseUrl}/gallery/${pkg.slug}`, lastModified: isoDate(pkg.released), changeFrequency: 'monthly' as const, priority: 0.8 })),
    ...(GALLERY_CONTROLS.length ? [{ url: `${baseUrl}/gallery/controls`, lastModified: gallery, changeFrequency: 'weekly' as const, priority: 0.8 }] : []),
    ...GALLERY_CONTROLS.map((control) => ({ url: `${baseUrl}/gallery/controls/${control.slug}`, lastModified: isoDate(control.released), changeFrequency: 'monthly' as const, priority: 0.7 })),
    ...(GALLERY_ACTIONS.length ? [{ url: `${baseUrl}/gallery/actions`, lastModified: gallery, changeFrequency: 'weekly' as const, priority: 0.8 }] : []),
    ...GALLERY_ACTIONS.map((action) => ({ url: `${baseUrl}/gallery/actions/${action.slug}`, lastModified: isoDate(action.released), changeFrequency: 'monthly' as const, priority: 0.7 })),
    ...ALL_DOC_PAGES.map((page) => ({ url: `${baseUrl}/docs/${page.slug}`, lastModified: docs, changeFrequency: 'monthly' as const, priority: 0.75 })),
    { url: `${baseUrl}/docs/api-explorer`, lastModified: docs, changeFrequency: 'monthly', priority: 0.7 },
  ]
}
