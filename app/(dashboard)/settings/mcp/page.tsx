"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { McpSettingsView } from './mcp-settings-view'
import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function McpSettingsPage() {
  const { can } = usePermissions()
  const { profile } = useDashboardAuth()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id

  const { data, isLoading } = useQuery({
    queryKey: ['mcp-settings', tenantId],
    queryFn: async () => {
      // toolCategories comes from /api/mcp/tool-categories rather
      // than a direct import of lib/mcp/metadata — importing it here
      // would drag every DB driver SDK (mysql2, pg, mongodb, etc.)
      // into the client bundle via the tool registry.
      const [settings, toolCategoriesResult] = await Promise.all([
        serverQuery('settings.mcp', { tenantId: tenantId! }),
        fetch('/api/mcp/tool-categories').then(r => r.ok ? r.json() : { categories: [] }),
      ])

      return {
        ...settings,
        toolCategories: toolCategoriesResult?.categories ?? [],
      }
    },
    enabled: can('settings.view') && !!tenantId,
  })

  if (!can('settings.view')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (isLoading && !data) {
    return <PageSkeleton variant="settings" />
  }

  return (
    <McpSettingsView
      apiKeys={data?.apiKeys ?? []}
      tenantSlug={data?.tenantSlug ?? ''}
      mcpServers={data?.mcpServers ?? []}
      toolCategories={data?.toolCategories ?? []}
    />
  )
}
