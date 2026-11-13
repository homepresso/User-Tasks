import { notFound } from 'next/navigation'
import { ExtensionSettingsPage } from '@/components/extensions/extension-settings-page'
import { getExtensionManifest } from '@/lib/extensions/registry'

/**
 * One typed settings page of an extension, rendered by core from the
 * manifest's schema. Access (workspace / instance / personal scope) is
 * enforced by lib/services/extensions on every read and save.
 */
export default async function ExtensionSettingsRoute({ params }: { params: Promise<{ ext: string; page: string }> }) {
  const { ext, page } = await params
  const manifest = getExtensionManifest(ext)
  if (!manifest?.contributes.ui.settingsPages.some((p) => p.id === page)) notFound()
  return <ExtensionSettingsPage extensionId={ext} pageId={page} />
}
