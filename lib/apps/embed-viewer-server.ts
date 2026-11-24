import { cache } from 'react'
import { enforceHostWorkspace } from '@/lib/workspace-host'

export type EmbedViewer =
  | { kind: 'member'; userId: string }
  | { kind: 'non_member' }
  | { kind: 'signed_out'; onWorkspaceAddress: boolean }

/**
 * Who is looking at an embedded app (/embed/apps/<slug>…): a signed-in member,
 * someone signed in but not a member of the workspace on this address, or
 * nobody. Once per request (React cache): the app's layout (which draws the
 * app — app/embed/apps/[slug]/layout.tsx) and its page (which draws the
 * signed-out / no-access notices) both ask; on a move between the app's pages
 * only the page asks again.
 */
export const embedViewer = cache(async (): Promise<EmbedViewer> => {
  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') return { kind: 'non_member' }
  if (host.kind === 'member') return { kind: 'member', userId: host.userId }
  if (host.kind === 'none') {
    const { getCachedUser } = await import('@/lib/supabase/server')
    const id = (await getCachedUser())?.id ?? null
    if (id) return { kind: 'member', userId: id }
  }
  return { kind: 'signed_out', onWorkspaceAddress: host.kind === 'signed_out' }
})
