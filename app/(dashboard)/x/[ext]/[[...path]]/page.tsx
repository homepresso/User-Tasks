import { notFound, redirect } from 'next/navigation'
import { renderExtensionPageResult } from '@/lib/extensions/page-host'

/**
 * Extension custom pages (escape hatch): /x/<extension id>/<path>. Rendered
 * inside the app shell from the extension's pages entry, after the checks in
 * lib/extensions/page-host (extension usable in the workspace, page declared
 * in the manifest, its guard passes). Signed out: sign in and come back here
 * (links into extension pages from other systems keep their target). Not
 * found otherwise — always, in a build without extensions.
 */
export default async function ExtensionPageRoute({ params, searchParams }: {
  params: Promise<{ ext: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ext, path } = await params
  const query = await searchParams
  const result = await renderExtensionPageResult(ext, path ?? [], query)
  if (result.kind === 'signed_out') {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
    const target = `/x/${encodeURIComponent(ext)}${(path ?? []).map((s) => `/${encodeURIComponent(decodeURIComponent(s))}`).join('')}${q.size ? `?${q}` : ''}`
    redirect(`/login?redirect=${encodeURIComponent(target)}`)
  }
  if (result.kind !== 'page') notFound()
  return result.node
}
