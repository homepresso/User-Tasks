'use client'

/**
 * Settings → Extensions: the extensions compiled into this build, their
 * version and publisher, licence state (entitlement port), whether they can
 * run here, enable / disable for this workspace (settings.edit; disabling
 * keeps settings and data), and links to their settings pages.
 */

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Blocks, Settings as SettingsIcon } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { Badge, Tag, type Tone } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { useJobs } from '@/components/jobs/jobs-provider'
import { listExtensionsAction, setExtensionEnabledAction } from '@/app/actions/extensions'
import { EXTENSIONS_CHANGED_EVENT } from './extensions-provider'
import { ExtIcon } from './ext-icon'
import { getExtensionManifest } from '@/lib/extensions/registry'
import { useState } from 'react'

const LICENCE: Record<string, { label: string; tone: Tone }> = {
  not_required: { label: 'Free', tone: 'neutral' },
  licensed: { label: 'Licensed', tone: 'success' },
  unlicensed: { label: 'Not licensed', tone: 'warning' },
  expired: { label: 'Licence expired', tone: 'danger' },
}

export function ExtensionsAdmin() {
  const { can } = usePermissions()
  const canEdit = can('settings.edit')
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [busy, setBusy] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['extensions'],
    queryFn: async () => {
      const result = await listExtensionsAction()
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
  })

  async function toggle(id: string, name: string, enabled: boolean) {
    setBusy(id)
    const result = await setExtensionEnabledAction(id, enabled)
    setBusy(null)
    if (!result.ok) {
      jobs.notify({ tone: 'error', title: `Could not ${enabled ? 'enable' : 'disable'} ${name}`, body: result.error })
      return
    }
    jobs.notify({ tone: 'success', title: `${name} ${enabled ? 'enabled' : 'disabled'}`, body: enabled ? null : 'Its settings and data are kept.' })
    await queryClient.invalidateQueries({ queryKey: ['extensions'] })
    window.dispatchEvent(new Event(EXTENSIONS_CHANGED_EVENT))
  }

  return (
    <div className="space-y-6" data-testid="extensions-admin">
      <PageHeader
        title="Extensions"
        description="Extensions compiled into this build. Enable them for this workspace; disabling hides them and stops their triggers and jobs, and keeps their settings and data."
      />
      {isLoading && <PageSkeleton variant="list" />}
      {error && <InlineNotice tone="danger">{(error as Error).message}</InlineNotice>}
      {data?.notice && <InlineNotice tone="warning">{data.notice}</InlineNotice>}
      {data?.problems.map((p) => <InlineNotice key={p} tone="warning">{p}</InlineNotice>)}
      {data && data.extensions.length === 0 && (
        <EmptyState icon={Blocks} title="No extensions in this build" description="Extensions are added when the app is built (USERTASKS_EXTENSIONS)." />
      )}
      <div className="space-y-3">
        {data?.extensions.map((ext) => {
          const licence = LICENCE[ext.licence.state] ?? { label: ext.licence.state, tone: 'neutral' as Tone }
          const icon = getExtensionManifest(ext.id)?.icon
          const disabledReason = !ext.runs_here ? 'Cannot run in this build' : !ext.licence.allowed && !ext.enabled ? ext.licence.reason ?? 'Not licensed' : null
          return (
            <Card key={ext.id} padding="md" data-extension={ext.id}>
              <div className="flex flex-wrap items-start gap-4">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted"><ExtIcon icon={icon} className="size-5" /></span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-fg">{ext.name}</h2>
                    <Tag mono>v{ext.version}</Tag>
                    <Badge tone={licence.tone} pill>{licence.label}</Badge>
                    {ext.enabled && <Badge tone="success" dot pill>Enabled</Badge>}
                  </div>
                  <p className="text-xs text-fg-muted">{ext.publisher.name} · <code className="font-mono">{ext.id}</code>{ext.licence.sku ? <> · {ext.licence.sku}</> : null}</p>
                  {ext.description && <p className="text-ui text-fg-muted">{ext.description}</p>}
                  {ext.problems.map((p) => <InlineNotice key={p} tone="warning" className="text-xs">{p}</InlineNotice>)}
                  {!ext.licence.allowed && ext.licence.reason && <p className="text-xs text-fg-muted">{ext.licence.reason}</p>}
                  {ext.enabled && ext.settings_pages.length > 0 && (
                    <div className="flex flex-wrap gap-3 pt-1">
                      {ext.settings_pages.map((page) => (
                        <Link key={page.id} href={`/settings/extensions/${ext.id}/${page.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-text underline-offset-4 hover:underline">
                          <SettingsIcon className="size-3.5" aria-hidden />{page.label}{page.scope !== 'workspace' ? ` (${page.scope === 'user' ? 'personal' : 'instance'})` : ''}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={ext.enabled}
                    onCheckedChange={(next) => void toggle(ext.id, ext.name, next)}
                    disabled={!canEdit || busy === ext.id || (!ext.enabled && Boolean(disabledReason))}
                    label={ext.enabled ? 'Enabled' : 'Disabled'}
                    aria-label={`${ext.enabled ? 'Disable' : 'Enable'} ${ext.name}`}
                    data-testid={`extension-toggle-${ext.id}`}
                  />
                  {!canEdit && <p className="text-xs text-fg-subtle">Needs Edit settings</p>}
                  {canEdit && !ext.enabled && disabledReason && <p className="text-xs text-fg-subtle">{disabledReason}</p>}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      {data && <p className="text-xs text-fg-subtle">UserTasks {data.platform_version}</p>}
    </div>
  )
}
