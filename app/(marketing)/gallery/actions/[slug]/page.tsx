import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ActionDetailPage } from '@/components/gallery/action-pages'
import { GALLERY_ACTIONS, getGalleryAction } from '@/lib/gallery/site'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return GALLERY_ACTIONS.map((action) => ({ slug: action.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const action = getGalleryAction((await params).slug)
  if (!action) return {}
  const url = `/gallery/actions/${action.slug}`
  const title = `${action.title} workflow action`
  const description = `${action.summary} A free, sandboxed custom step for UserTasks workflows (cloud or self-hosted).`
  return {
    title: `${title} | UserTasks gallery`,
    description,
    keywords: [...action.tags, `${action.title.toLowerCase()} workflow step`, 'custom workflow action'],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'article' },
  }
}

export default async function GalleryActionRoute({ params }: Props) {
  const action = getGalleryAction((await params).slug)
  if (!action) notFound()
  return <ActionDetailPage action={action} />
}
