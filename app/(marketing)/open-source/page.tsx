import type { Metadata } from 'next'
import { RefocusAnnouncement } from '@/components/marketing/refocus-announcement'

export const metadata: Metadata = {
  title: 'UserTasks is going open source — what changes',
  description: 'Why UserTasks is refocusing on an open-source, enterprise headless workflow engine: what we are keeping, what we are retiring, and what it means for existing workspaces.',
  alternates: { canonical: '/open-source' },
  openGraph: { title: 'UserTasks is going open source', description: 'Thank you for trying UserTasks. We are refocusing on a strong, fully open-source workflow engine for enterprise headless use.', url: '/open-source', type: 'article' },
}

export default function OpenSourcePage() {
  return <RefocusAnnouncement />
}
