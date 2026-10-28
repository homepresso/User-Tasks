"use client"

import { use } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { IntegrationConfig } from '@/components/integrations/integration-config'
import { IntegrationWizard } from '@/components/integrations/integration-wizard'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { ExportAssetButton } from '@/components/shared/config-transfer'

export default function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: integration } = useQuery({
    queryKey: ['integration', id],
    queryFn: async () => (await serverRead('integrations.get', { id })).data,
  })

  const { data: references } = useQuery({
    queryKey: ['integration-references', id],
    queryFn: async () => (await serverRead('integrations.referencesFor', { integrationId: id })).data ?? [],
  })

  if (!integration) return null

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/integrations" className="rounded-md p-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-semibold">{integration.name}</h1>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
          integration.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {integration.is_active ? 'Active' : 'Inactive'}
        </span>
        <Link
          href={`/integrations/${id}/calls`}
          className="ml-auto text-xs px-2.5 py-1 rounded-md border transition-colors hover:bg-[var(--theme-row-highlight)]"
          style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
        >
          View Call Logs →
        </Link>
        <ExportAssetButton ids={[integration.id]} name={integration.name} className="!h-7" />
      </div>

      <IntegrationWizard
        integration={integration}
        references={references ?? []}
      />

      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <ObjectPermissions objectType="integration" objectId={id} objectName={integration.name} showExecute={true} />
      </div>
    </div>
  )
}
