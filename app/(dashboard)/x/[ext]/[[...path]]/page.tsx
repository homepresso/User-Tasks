import { notFound } from 'next/navigation'
import { renderExtensionPage } from '@/lib/extensions/page-host'

/**
 * Extension custom pages (escape hatch): /x/<extension id>/<path>. Rendered
 * inside the app shell from the extension's pages entry, after the checks in
 * lib/extensions/page-host (extension usable in the workspace, page declared
 * in the manifest, its guard passes). Not found otherwise — always, in a
 * build without extensions.
 */
export default async function ExtensionPageRoute({ params, searchParams }: {
  params: Promise<{ ext: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ext, path } = await params
  const rendered = await renderExtensionPage(ext, path ?? [], await searchParams)
  if (!rendered) notFound()
  return rendered
}
