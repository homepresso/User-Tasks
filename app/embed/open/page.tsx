import type { Metadata } from 'next'
import { EmbedNotice } from '@/components/embed/designer-states'
import { isSafeAppPath } from '@/lib/embed/designers'

/**
 * Inside an embedding frame, a page that has no /embed/ equivalent (the
 * dashboard shell's escape guard sends a framed visit here): it opens in
 * UserTasks, in a new tab, instead of showing the full app inside the host
 * page. Only same-origin paths.
 */

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Open in UserTasks', robots: { index: false, follow: false } }

export default async function EmbedOpenPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).to
  const to = typeof raw === 'string' && isSafeAppPath(raw) ? raw : '/home'
  return <EmbedNotice title="This opens in UserTasks" body="This page isn't available inside this window. Open it in UserTasks (a new tab), then come back here." openHref={to} />
}
