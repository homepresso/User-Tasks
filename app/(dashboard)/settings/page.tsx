'use client'

import { useEffect, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { SettingsTabs } from '@/components/settings/settings-tabs'
import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function SettingsPage() {
  const { profile } = useDashboardAuth()
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id ?? ''

  useEffect(() => {
    if (!tenantId) return
    async function loadBranding() {
      const { data } = await serverRead('settings.branding', { tenantId })
      setLogoUrl(data?.logoUrl ?? null)
    }
    loadBranding()
  }, [tenantId])

  if (!profile) return <PageSkeleton variant="settings" />

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <SettingsTabs profile={profile} tenantId={tenantId} logoUrl={logoUrl} />
    </div>
  )
}
