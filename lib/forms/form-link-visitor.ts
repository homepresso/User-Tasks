import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { enforceHostWorkspace, getHostWorkspace, originForSubdomain, requestPath, type EnforcedHost } from '@/lib/workspace-host'
import { frameContext, wantsEmbed, type FrameContext } from './embed'

/**
 * Who is opening a form link page (/f/<id>, /form/<name>, /form-login) and
 * how (server only).
 *
 * In a frame from another origin the visitor is always treated as signed
 * out, without reading the session or switching their workspace
 * (lib/forms/embed.ts): a third-party page can't make a member act as
 * themselves. Elsewhere it's enforceHostWorkspace({ allowSignedOut }).
 */
export interface FormLinkVisitor {
  host: EnforcedHost
  frame: FrameContext
  /** The embedded look: ?embed=1, or shown in a frame. */
  embed: boolean
  /** This request's path + query (the way back after signing in). */
  path: string
}

export async function requestFrameContext(): Promise<FrameContext> {
  try {
    const h = await headers()
    return frameContext((name) => h.get(name))
  } catch {
    return 'top' // outside a request (tests, prerender)
  }
}

export async function formLinkVisitor(query: Record<string, string | string[] | undefined>): Promise<FormLinkVisitor> {
  const frame = await requestFrameContext()
  const embed = wantsEmbed(query) || frame !== 'top'
  const path = await requestPath()
  if (frame !== 'cross-origin-frame') return { host: await enforceHostWorkspace({ allowSignedOut: true }), frame, embed, path }
  // Cross-origin frame: the address rules without the session.
  const host = await getHostWorkspace()
  if (host.kind === 'unknown') notFound()
  if (host.kind === 'moved') {
    const origin = originForSubdomain(host.subdomain)
    if (origin) permanentRedirect(`${origin}${path}`)
    notFound()
  }
  return { host: host.kind === 'workspace' ? { kind: 'signed_out', tenant: host.tenant } : { kind: 'none' }, frame, embed, path }
}

/** The signed-in user for a form link page, or null (always null in a frame from another origin). */
export async function formLinkUser(visitor: FormLinkVisitor): Promise<{ id: string } | null> {
  if (visitor.frame === 'cross-origin-frame' || visitor.host.kind === 'signed_out') return null
  const { getCachedUser } = await import('@/lib/supabase/server')
  const user = await getCachedUser()
  return user ? { id: user.id } : null
}
