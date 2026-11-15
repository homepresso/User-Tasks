'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Frame } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { getEmbeddingAction, setEmbeddingAction } from '@/app/actions/gateways'

/** Settings → Trusted embedding: the sites approved to frame this workspace's embeddable pages. */
export function EmbeddingSettings() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canView = can('settings.view')
  const canEdit = can('settings.edit')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['workspace-embedding'],
    queryFn: async () => {
      const r = await getEmbeddingAction()
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    enabled: canView,
  })
  useEffect(() => { if (data) setText(data.origins.join('\n')) }, [data])

  if (!canView) return <p className="text-sm text-fg-muted">Not authorized.</p>
  if (isLoading && !data) return <PageSkeleton variant="settings" />

  async function save() {
    setSaving(true)
    try {
      const r = await setEmbeddingAction(text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))
      if (!r.ok) setNotice({ tone: 'danger', message: r.error })
      else { setNotice({ tone: 'success', message: 'Saved.' }); void queryClient.invalidateQueries({ queryKey: ['workspace-embedding'] }) }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Frame size={22} /> Trusted embedding</h1>
        <p className="text-sm mt-1 text-fg-muted">
          Sites that may show this workspace&apos;s embeddable pages in a frame or dialog — for example the UserTasks dialog in your SharePoint
          farm. Every other page refuses to be framed.
        </p>
      </div>
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {data && !data.supported && <InlineNotice tone="info" message={data.reason ?? 'Per-workspace lists are not available on this instance.'} />}
      <Card className="p-4 space-y-3">
        <label className="block text-sm">
          <span className="block text-xs text-fg-muted mb-1">Approved sites (one origin per line: https://sharepoint.contoso.com, https://*.contoso.com)</span>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} placeholder="https://sharepoint.contoso.com" />
        </label>
        {data?.workspace_url && <p className="text-xs text-fg-muted">Applies on {data.workspace_url}.</p>}
        {(data?.instance_origins ?? []).length > 0 && <p className="text-xs text-fg-muted">Also allowed for every workspace on this instance: {data!.instance_origins.join(', ')}</p>}
        {canEdit && <Button size="sm" onClick={() => void save()} loading={saving}>Save</Button>}
      </Card>
    </div>
  )
}
