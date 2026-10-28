import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CommunityPackagePage } from '@/components/gallery/community-package-page'
import { getCommunityPackage } from '@/lib/services/gallery-community'

type Props = { params: Promise<{ slug: string }> }

/** Community packages change with moderation: rendered on request. */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pkg = await getCommunityPackage((await params).slug)
  if (!pkg) return {}
  const url = `/gallery/community/${pkg.slug}`
  return {
    title: `${pkg.title} (community package) | UserTasks gallery`,
    description: `${pkg.summary} Shared by ${pkg.author_name} in the UserTasks community gallery.`,
    alternates: { canonical: url },
    openGraph: { title: pkg.title, description: pkg.summary, url, type: 'article' },
  }
}

export default async function CommunityPackageRoute({ params }: Props) {
  const pkg = await getCommunityPackage((await params).slug)
  if (!pkg) notFound()
  return <CommunityPackagePage pkg={pkg} />
}
