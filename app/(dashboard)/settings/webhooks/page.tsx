"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { formatRelativeDate } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions-context'

export default function WebhooksPage() {
  const { can } = usePermissions()

  const { data: deadLetters } = useQuery({
    queryKey: ['dead-letter-events'],
    queryFn: () => serverQuery('settings.deadLetters'),
    enabled: can('settings.manage_webhooks'),
  })

  if (!can('settings.manage_webhooks')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Webhook Delivery</h1>

      <Card>
        <h3 className="text-sm font-semibold mb-4">
          Failed Deliveries
          {deadLetters && deadLetters.length > 0 && (
            <span className="text-xs font-normal ml-2" style={{ color: 'var(--theme-muted-text)' }}>
              ({deadLetters.length})
            </span>
          )}
        </h3>

        {!deadLetters?.length ? (
          <p className="text-sm py-4" style={{ color: 'var(--theme-muted-text)' }}>
            No failed deliveries. All webhooks are being delivered successfully.
          </p>
        ) : (
          <div className="space-y-2">
            {deadLetters.map((dl) => (
              <div key={dl.id} className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-red-500">{dl.event_type}</span>
                  <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    {formatRelativeDate(dl.created_at)}
                  </span>
                </div>
                <p className="text-xs font-mono truncate" style={{ color: 'var(--theme-muted-text)' }}>
                  {dl.target_url}
                </p>
                <p className="text-xs text-red-400 mt-1">
                  {dl.error_message} ({dl.attempts} attempts)
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
