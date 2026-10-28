import type { Metadata } from 'next'
import { GALLERY_DESCRIPTION, GALLERY_TITLE, GalleryIndexPage } from '@/components/gallery/gallery-index'
import { communityCard } from '@/lib/gallery/site'
import { listCommunityPackages } from '@/lib/services/gallery-community'

export const metadata: Metadata = {
  title: `${GALLERY_TITLE}: ready-made workflows to download and share | UserTasks`,
  description: GALLERY_DESCRIPTION,
  keywords: ['workflow templates', 'workflow package', 'community workflow gallery', 'employee onboarding workflow', 'expense approval workflow', 'Workday workflow', 'SAP S/4HANA approval workflow', 'no-code workflow templates'],
  alternates: { canonical: '/gallery' },
  openGraph: { title: GALLERY_TITLE, description: GALLERY_DESCRIPTION, url: '/gallery', type: 'website' },
}

/** Official packages are static; community ones are re-read every five minutes (and on every moderation decision). */
export const revalidate = 300

export default async function GalleryRoute() {
  const community = await listCommunityPackages()
  return <GalleryIndexPage communityCards={community.map(communityCard)} />
}
