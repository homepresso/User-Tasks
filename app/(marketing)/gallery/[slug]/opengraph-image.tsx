import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { galleryCategory, getGalleryPackage, triggerLabel } from '@/lib/gallery/site'

type Params = { slug: string }

/** Per-package link-preview card (see lib/brand/og.tsx). */
export async function generateImageMetadata({ params }: { params: Params | Promise<Params> }) {
  const pkg = getGalleryPackage((await params).slug)
  return [{ id: 'card', alt: pkg ? `${pkg.title} — UserTasks gallery package` : 'UserTasks gallery package', size: OG_SIZE, contentType: OG_CONTENT_TYPE }]
}

export default async function Image({ params }: { params: Promise<Params> }) {
  const pkg = getGalleryPackage((await params).slug)
  if (!pkg) return renderOgImage({ eyebrow: 'Package gallery', title: 'UserTasks gallery', subtitle: 'Ready-made workflow packages.' })
  return renderOgImage({ eyebrow: `${galleryCategory(pkg.category).title} · ${triggerLabel(pkg.trigger)}`, title: pkg.title, subtitle: pkg.summary })
}
