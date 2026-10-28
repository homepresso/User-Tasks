import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { GalleryPackagePage } from '@/components/gallery/package-page'
import { GALLERY_PACKAGES, galleryCategory, getGalleryPackage, triggerLabel } from '@/lib/gallery/site'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return GALLERY_PACKAGES.map((pkg) => ({ slug: pkg.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pkg = getGalleryPackage((await params).slug)
  if (!pkg) return {}
  const url = `/gallery/${pkg.slug}`
  const title = `${pkg.title} workflow package`
  const description = `${pkg.summary} ${triggerLabel(pkg.trigger)}. Free download for UserTasks cloud or self-hosted.`
  return {
    title: `${title} | UserTasks gallery`,
    description,
    keywords: [...pkg.tags, `${pkg.title.toLowerCase()} workflow`, galleryCategory(pkg.category).title],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'article' },
  }
}

export default async function GalleryPackageRoute({ params }: Props) {
  const pkg = getGalleryPackage((await params).slug)
  if (!pkg) notFound()
  return <GalleryPackagePage pkg={pkg} />
}
