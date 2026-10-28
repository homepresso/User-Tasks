import type { Metadata } from 'next'
import { SharePage } from '@/components/gallery/share-page'
import { sessionUser } from '@/lib/gallery/http'
import { communityGalleryEnabled, listMySubmissions } from '@/lib/services/gallery-community'

export const metadata: Metadata = {
  title: 'Share your solution | UserTasks community gallery',
  description: 'Upload a UserTasks workflow package to the community gallery: automatic validation, moderator review, and a Community listing with your name, licence, versions and downloads.',
  alternates: { canonical: '/gallery/share' },
}

export const dynamic = 'force-dynamic'

export default async function ShareRoute() {
  const enabled = communityGalleryEnabled()
  const user = enabled ? await sessionUser() : null
  let name = ''
  if (user) {
    const { getServiceDb } = await import('@/lib/providers/db')
    const { data } = await (getServiceDb() as any).from('users').select('display_name').eq('id', user.id).maybeSingle()
    name = String(data?.display_name ?? '')
  }
  const submissions = user ? await listMySubmissions(user).catch(() => []) : []
  return <SharePage enabled={enabled} user={user ? { name } : null} submissions={submissions} />
}
