import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { EmbedProvider } from '@/components/embed/embed-provider'
import { frameContext } from '@/lib/forms/embed'
import { getExtensionManifest } from '@/lib/extensions/registry'
import { renderEmbeddedExtensionPage } from '@/lib/extensions/page-host'

/**
 * Trusted embedding (lib/embedding.ts): /embed/x/<extension id>/<path> serves
 * an extension page the manifest declares `embeddable`, without the app
 * shell, for a frame or dialog on an approved site (frame-ancestors from
 * EMBED_FRAME_ANCESTORS, set by proxy.ts). Same checks as /x/. Signed out:
 * at the top level → /login and back; inside a frame (sign-in pages are
 * never framable) → open UserTasks in a new tab to sign in, then reload.
 * At the top level the sign-in returns to the full app page (/x/…).
 */

export const dynamic = 'force-dynamic'

function queryString(searchParams: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export default async function EmbeddedExtensionPageRoute({ params, searchParams }: {
  params: Promise<{ ext: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ext, path } = await params
  const query = await searchParams
  const result = await renderEmbeddedExtensionPage(ext, path ?? [], query)
  if (result.kind === 'not_found') notFound()
  const appPath = `/x/${encodeURIComponent(ext)}${(path ?? []).map((s) => `/${encodeURIComponent(decodeURIComponent(s))}`).join('')}${queryString(query)}`
  if (result.kind === 'signed_out') {
    const h = await headers()
    const where = frameContext((name) => h.get(name))
    if (where === 'top') redirect(`/login?redirect=${encodeURIComponent(appPath)}`)
    const loginHref = `/login?redirect=${encodeURIComponent(appPath)}`
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">Sign in to UserTasks</h1>
        <p className="text-sm text-muted-foreground">
          Sign-in can&apos;t happen inside this window. Open UserTasks in a new tab, sign in there and carry on — or come back here and reload.
        </p>
        <div className="flex gap-2">
          <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={loginHref} target="_blank" rel="noopener">Open UserTasks</a>
          <a className="rounded-md border px-4 py-2 text-sm" href={`/embed${appPath}`}>Reload</a>
        </div>
        <p className="text-xs text-muted-foreground">If you are signed in and still see this, your browser blocks cookies in embedded windows — use Open UserTasks.</p>
      </main>
    )
  }
  const manifest = getExtensionManifest(ext)
  const prefixes = (manifest?.contributes.ui.pages ?? []).filter((p) => p.embeddable).map((p) => `/x/${ext}${p.path ? `/${p.path}` : ''}`)
  return <EmbedProvider embeddablePrefixes={prefixes}>{result.node}</EmbedProvider>
}
