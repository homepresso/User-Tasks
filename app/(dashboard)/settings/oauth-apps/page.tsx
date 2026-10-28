"use client"

import { useQuery } from '@tanstack/react-query'
import { listOAuthClients } from '@/app/actions/oauth-clients'
import { OAuthClientsManager } from '@/components/settings/oauth-clients-manager'
import { usePermissions } from '@/lib/permissions-context'

export default function OAuthAppsPage() {
  const { can } = usePermissions()

  const { data, refetch } = useQuery({
    queryKey: ['oauth-clients'],
    queryFn: () => listOAuthClients(),
    enabled: can('settings.manage_api_keys'),
  })

  if (!can('settings.manage_api_keys')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  const clients = data ?? []

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">OAuth Apps</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          Register OAuth 2.0 clients so external services can obtain scoped access tokens for your workspace API.
        </p>
      </div>
      <OAuthClientsManager clients={clients} onChanged={() => { void refetch() }} />
    </div>
  )
}
