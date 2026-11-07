import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ControlDetailPage } from '@/components/gallery/control-pages'
import { GALLERY_CONTROLS, getGalleryControl } from '@/lib/gallery/site'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return GALLERY_CONTROLS.map((control) => ({ slug: control.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const control = getGalleryControl((await params).slug)
  if (!control) return {}
  const url = `/gallery/controls/${control.slug}`
  const title = control.kind === 'control_bundle' ? control.title : `${control.title} form control`
  const description = `${control.summary} A free web component for UserTasks forms (cloud or self-hosted).`
  return {
    title: `${title} | UserTasks gallery`,
    description,
    keywords: [...control.tags, `${control.title.toLowerCase()} form field`, 'web component'],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'article' },
  }
}

export default async function GalleryControlRoute({ params }: Props) {
  const control = getGalleryControl((await params).slug)
  if (!control) notFound()
  return <ControlDetailPage control={control} />
}
