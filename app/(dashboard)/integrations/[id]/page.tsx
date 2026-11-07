"use client"

import { use } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { IntegrationWizard } from '@/components/integrations/integration-wizard'
import Link from 'next/link'
import { Plug } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { ExportAssetButton } from '@/components/shared/config-transfer'

export default function IntegrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: integration, isLoading } = useQuery({
    queryKey: ['integration', id],
    queryFn: async () => (await serverRead('integrations.get', { id })).data,
  })

  const { data: references } = useQuery({
    queryKey: ['integration-references', id],
    queryFn: async () => (await serverRead('integrations.referencesFor', { integrationId: id })).data ?? [],
  })

  if (!integration) {
    if (isLoading) return <PageSkeleton variant="detail" />
    return (
      <EmptyState
        variant="error"
        title="Integration not found"
        description="It may have been deleted, or you don't have access to it."
        action={{ label: 'Back to integrations', href: '/integrations' }}
      />
    )
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: integration.name }]}
        icon={<Plug />}
        title={integration.name}
        badge={<StatusPill status={integration.is_active ? 'active' : 'inactive'} />}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/integrations/${id}/calls`}>Call logs</Link>
            </Button>
            <ExportAssetButton ids={[integration.id]} name={integration.name} />
          </>
        }
      />
      <div className="space-y-6">
      <IntegrationWizard
        integration={integration}
        references={references ?? []}
      />

      <Card padding="md">
        <ObjectPermissions objectType="integration" objectId={id} objectName={integration.name} showExecute={true} />
      </Card>
      </div>
    </div>
  )
}
