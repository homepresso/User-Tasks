import type { Metadata } from 'next'
import { requireTenant } from '@/lib/actions/require-tenant'
import { getThemeDesignerData } from '@/app/actions/workspace-theme'
import { ThemeDesignerLoader } from '@/components/settings/theme-designer/theme-designer-loader'
import { InlineNotice } from '@/components/ui/inline-notice'
import { resolveStorageUrl } from '@/lib/storage/refs'

export const metadata: Metadata = { title: 'Theme' }

/**
 * Workspace theme designer. Every member can open it (read-only); saving
 * needs settings.edit, which the service checks.
 */
export default async function ThemeSettingsPage() {
  const data = await getThemeDesignerData()
  if (!data) return <InlineNotice tone="error" message="Could not load the workspace theme." />
  let workspaceLogoUrl: string | null = null
  try {
    const { supabase, tenantId } = await requireTenant()
    const { data: tenant } = await supabase.from('tenants').select('branding').eq('id', tenantId).maybeSingle()
    const logo = (tenant?.branding as { logo_url?: unknown } | null)?.logo_url
    workspaceLogoUrl = typeof logo === 'string' ? resolveStorageUrl(logo) : null
  } catch {
    workspaceLogoUrl = null
  }
  return <ThemeDesignerLoader initial={data} workspaceLogoUrl={workspaceLogoUrl} />
}
