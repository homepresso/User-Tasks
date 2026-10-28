import { notFound } from 'next/navigation'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { GalleryReview } from '@/components/settings/gallery-review'
import {
  communityGalleryEnabled, headlessMode, isGalleryModerator, listAbuseReports, listCommunityPackages, listModerationQueue,
} from '@/lib/services/gallery-community'

/**
 * Settings → Gallery review: the community gallery moderation queue.
 * Instance admins only (the Settings → Infrastructure check); everyone
 * else gets a 404, and every action re-checks it.
 */
export const dynamic = 'force-dynamic'

export default async function GalleryReviewPage() {
  const { user } = await getSessionDbWithUser()
  const viewer = user ? { id: user.id, email: user.email ?? null } : null
  if (!viewer || !(await isGalleryModerator(viewer))) notFound()
  if (!communityGalleryEnabled()) return <GalleryReview enabled={false} pending={[]} decided={[]} reports={[]} listed={[]} headless={headlessMode()} />
  const [pending, approved, rejected, reports, listed] = await Promise.all([
    listModerationQueue(viewer, { status: 'pending' }),
    listModerationQueue(viewer, { status: 'approved' }),
    listModerationQueue(viewer, { status: 'rejected' }),
    listAbuseReports(viewer),
    listCommunityPackages(),
  ])
  const decided = [...approved, ...rejected].sort((a: any, b: any) => String(b.reviewed_at ?? '').localeCompare(String(a.reviewed_at ?? ''))).slice(0, 20)
  return <GalleryReview enabled pending={pending} decided={decided} reports={reports} listed={listed.map((p) => ({ id: p.id, slug: p.slug, title: p.title, version: p.current_version, downloads: p.downloads, author: p.author_name }))} headless={headlessMode()} />
}
