'use client'

import { useEffect, useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { StatusPill } from '@/components/ui/badge'
import { listIssuedTrialsAction } from '@/app/actions/licence'

/**
 * Settings → Licence → Trials issued (usertasks.com instance admins only;
 * hidden on self-hosted installations): every self-serve trial, newest first,
 * with the requester, farm, expiry and whether the licence was e-mailed or
 * sent again. The team also gets each one in ChirpMe (sub-tab Trials).
 */

type Data = Extract<Awaited<ReturnType<typeof listIssuedTrialsAction>>, { ok: true }>['data']

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' }) : '—'
}

export function IssuedTrials() {
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => {
    listIssuedTrialsAction().then((r) => { if (r.ok) setData(r.data) }).catch(() => undefined)
  }, [])
  if (!data?.cloud) return null
  const now = Date.now()
  return (
    <Card data-testid="issued-trials">
      <CardHeader title="Trials issued" description="Self-serve 30-day trials from usertasks.com/sharepoint/trial and from installations starting one online. One per farm and per company email domain." />
      <CardBody className="space-y-3">
        {!data.available && <InlineNotice tone="warning" message={`Trials aren't available yet: ${data.reason ?? 'not configured'}. The website shows "Contact us" until then.`} />}
        {!data.trials.length ? <p className="text-ui text-fg-muted">No trials yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-fg-muted"><tr><th className="py-1 pr-3">Company</th><th className="pr-3">Requester</th><th className="pr-3">Farm</th><th className="pr-3">From</th><th className="pr-3">Issued</th><th className="pr-3">Ends</th><th>Licence</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.trials.map((t) => (
                  <tr key={t.licence_id}>
                    <td className="py-1.5 pr-3 font-medium">{t.company}</td>
                    <td className="pr-3">{t.name}<br /><a className="text-fg-muted underline" href={`mailto:${t.email}`}>{t.email}</a></td>
                    <td className="pr-3 font-mono">{t.farm_id}</td>
                    <td className="pr-3">{t.source === 'product' ? 'Product' : 'Website'}</td>
                    <td className="pr-3">{day(t.issued_at)}</td>
                    <td className="pr-3">{Date.parse(t.expires_at) > now ? <StatusPill status="active" tone="success" label={day(t.expires_at)} /> : <StatusPill status="ended" tone="neutral" label={`Ended ${day(t.expires_at)}`} />}</td>
                    <td className="font-mono">{t.licence_id}<br /><span className="text-fg-muted">{t.emailed_at ? 'emailed' : 'not emailed'}{t.resent_count ? ` · re-sent ${t.resent_count}×` : ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
