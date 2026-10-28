"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { Card } from '@/components/ui/card'
import { ApiKeysManager } from '@/components/api-keys/api-keys-manager'
import { ApiExplorer } from '@/components/api-keys/api-explorer'
import { usePermissions } from '@/lib/permissions-context'

export default function ApiKeysPage() {
  const { can } = usePermissions()

  const { data } = useQuery({
    queryKey: ['api-keys-page'],
    queryFn: () => serverQuery('settings.apiKeysPage'),
    enabled: can('settings.manage_api_keys'),
  })

  if (!can('settings.manage_api_keys')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  const apiKeys = data?.apiKeys ?? []
  const workflowSources = data?.workflowSources ?? []
  const webhooks = data?.webhooks ?? []
  const workflows = data?.workflows ?? []
  const tables = data?.tables ?? []
  const users = data?.users ?? []
  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const odataBaseUrl = `${appUrl}/api/odata`

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">API Keys</h1>
      <Card>
        <ApiKeysManager
          apiKeys={apiKeys}
          workflowSources={workflowSources}
          webhooks={webhooks}
          workflows={workflows}
          tables={tables}
          users={users}
        />
      </Card>

      <div className="pt-2">
        <h2 className="text-xl font-semibold mb-1">OData Endpoint</h2>
        <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
          Use OData to discover your data-table schema and perform CRUD on table rows with standard entity-set semantics.
        </p>
        <Card className="p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-xs font-semibold mb-2">Service URL</p>
              <code className="block text-xs break-all" style={{ color: 'var(--theme-card-text)' }}>{odataBaseUrl}</code>
              <p className="text-[11px] mt-2" style={{ color: 'var(--theme-muted-text)' }}>
                Returns the OData service document listing each table as an entity set.
              </p>
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-xs font-semibold mb-2">Metadata URL</p>
              <code className="block text-xs break-all" style={{ color: 'var(--theme-card-text)' }}>{`${odataBaseUrl}/$metadata`}</code>
              <p className="text-[11px] mt-2" style={{ color: 'var(--theme-muted-text)' }}>
                Returns EDM metadata so clients can understand available tables and fields.
              </p>
            </div>
          </div>

          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
            <p className="text-xs font-semibold">Example OData Calls</p>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] mb-1" style={{ color: 'var(--theme-muted-text)' }}>List rows with filtering and count</p>
                <pre className="text-xs overflow-x-auto rounded-lg p-3" style={{ backgroundColor: '#0f172a', color: '#e2e8f0' }}>{`GET ${odataBaseUrl}/employee_expense_claims?$top=25&$count=true&$filter=amount gt 1000&$orderby=amount desc`}</pre>
              </div>
              <div>
                <p className="text-[11px] mb-1" style={{ color: 'var(--theme-muted-text)' }}>Create a row</p>
                <pre className="text-xs overflow-x-auto rounded-lg p-3" style={{ backgroundColor: '#0f172a', color: '#e2e8f0' }}>{`POST ${odataBaseUrl}/employee_expense_claims
{
  "employee_name": "Alex Morgan",
  "department": "Finance",
  "amount": 1250
}`}</pre>
              </div>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              Authenticate with the same API keys used for the REST API via <code>Authorization: Bearer ...</code> or <code>?key=...</code>.
            </p>
          </div>
        </Card>
      </div>

      <div className="pt-2">
        <h2 className="text-xl font-semibold mb-1">API Explorer</h2>
        <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
          Test API endpoints directly from the browser. Select an API key and an endpoint, fill in parameters, and send requests.
        </p>
        <Card>
          <ApiExplorer apiKeys={apiKeys.map(k => ({
            id: k.id,
            name: k.name,
            key_prefix: k.key_prefix,
            key_plain: (k as any).key_plain ?? undefined,
            is_revoked: k.is_revoked ?? false,
            expires_at: k.expires_at,
          }))} />
        </Card>
      </div>
    </div>
  )
}
